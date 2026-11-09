import { expect, test, type Page } from "@playwright/test";
import { localDate, shiftDay, weekStart } from "../../src/features/planner/dates";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("local-fixture-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("recurring calendar, deadlines, persistent timer and corrected analytics work together", async ({ page, browser }, info) => {
  await signIn(page, "alice@studyos.test");
  await page.goto("/courses/new");
  await page.getByLabel("Course code").fill("PLAN-" + info.project.name);
  const courseName = "Planner course " + info.project.name;
  await page.getByLabel("Course title").fill(courseName);
  await page.getByRole("button", { name: "Create course" }).click();
  await expect(page.getByRole("heading", { name: courseName })).toBeVisible();
  const course = page.url();
  const planner = course + "/planner";
  const today = localDate(new Date(), "Africa/Lagos");
  const future = shiftDay(today, 1);
  const past = shiftDay(today, -1);
  const repeat = "Weekly source review";
  const findItem = (title: string) => page.locator(".planner-agenda-day li").filter({
    has: page.getByText(title, { exact: true }),
  });

  await page.getByRole("link", { name: "View topics" }).click();
  await page.getByLabel("Topic title").fill("Source review");
  await page.getByRole("button", { name: "Add topic" }).click();
  await expect(page.getByRole("heading", { name: "Source review" })).toBeVisible();
  await page.goto(planner);
  await expect(page.getByRole("heading", { name: "Study planner" })).toBeVisible();
  await page.getByLabel("Session title").fill(repeat);
  await page.getByLabel("Topic (optional)").selectOption({ label: "Source review" });
  await page.getByLabel("Starts (Africa/Lagos)").fill(future + "T17:00");
  await page.getByLabel("Duration (minutes)").fill("45");
  await page.getByLabel("Repeats").selectOption("weekly");
  await page.getByLabel("Repeat until (optional)").fill(shiftDay(future, 14));
  await page.getByRole("button", { name: "Add study session" }).click();
  await expect(findItem(repeat)).toBeVisible();
  await expect(findItem(repeat).getByText(/· Source review/)).toBeVisible();

  await page.getByRole("link", { name: "Month", exact: true }).click();
  await expect(page).toHaveURL(/view=month/);
  await expect(page.getByLabel("Month calendar")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
  await page.getByRole("link", { name: "Week", exact: true }).click();
  await expect(page).toHaveURL(/view=week/);
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("date=" + weekStart(shiftDay(future, 7)) + "$"));
  await expect(findItem(repeat)).toBeVisible();
  await findItem(repeat).getByText("Session actions").click();
  await findItem(repeat).getByRole("button", { name: "Cancel session", exact: true }).click();
  await expect(findItem(repeat).getByText("Cancelled")).toBeVisible();
  await page.reload();
  await expect(findItem(repeat).getByText("Cancelled")).toBeVisible();
  await page.goto(planner + "?view=day&date=" + future);
  await expect(findItem(repeat).getByText("Planned")).toBeVisible();

  await page.getByLabel("Deadline title").fill("Assignment draft");
  await page.getByLabel("Due (Africa/Lagos)").fill(future + "T19:00");
  await page.getByRole("button", { name: "Add deadline", exact: true }).click();
  await expect(findItem("Assignment draft").getByText("Open", { exact: true })).toBeVisible();
  await findItem("Assignment draft").getByText("Deadline actions").click();
  await findItem("Assignment draft").getByRole("button", { name: "Mark deadline done" }).click();
  await expect(findItem("Assignment draft").getByText("Done", { exact: true })).toBeVisible();

  await page.getByLabel("Session title").fill("Catch-up reading");
  await page.getByLabel("Starts (Africa/Lagos)").fill(past + "T08:00");
  await page.getByRole("button", { name: "Add study session" }).click();
  await expect(findItem("Catch-up reading").getByText("Missed")).toBeVisible();
  await findItem("Catch-up reading").getByText("Session actions").click();
  await findItem("Catch-up reading").getByRole("link", { name: "Use timer" }).click();
  const timer = page.getByRole("region", { name: "Study timer" });
  await expect(timer.getByText("Selected session · Catch-up reading")).toBeVisible();
  await timer.getByRole("button", { name: "Start timer" }).click();
  await expect(timer.getByRole("status")).toHaveText("Running");
  await expect(timer.getByLabel("Elapsed study time")).not.toHaveText("00:00:00");
  await timer.getByRole("button", { name: "Pause timer" }).click();
  await expect(timer.getByRole("status")).toHaveText("Paused");
  const elapsed = await timer.getByLabel("Elapsed study time").textContent();
  await page.reload();
  await expect(timer.getByRole("status")).toHaveText("Paused");
  await expect(timer.getByLabel("Elapsed study time")).toHaveText(elapsed!);
  await timer.getByRole("button", { name: "Resume timer" }).click();
  await expect(timer.getByRole("status")).toHaveText("Running");
  await timer.getByRole("button", { name: "Finish and log" }).click();
  await expect(timer.getByRole("status")).toContainText("Logged");
  await expect(findItem("Catch-up reading").getByText("Completed")).toBeVisible();

  await page.getByRole("link", { name: "Study logs and analytics" }).click();
  await expect(page.getByRole("heading", { name: "Study analytics" })).toBeVisible();
  await expect(page.getByText("1 of 1", { exact: true })).toBeVisible();
  await page.getByText("Correct log duration", { exact: true }).click();
  await page.getByLabel("Corrected duration (seconds)").fill("120");
  await page.getByLabel("Reason for correction").fill("Checked against my notes");
  await page.getByRole("button", { name: "Save corrected time" }).click();
  await expect(page.getByText("2m · Corrected")).toBeVisible();
  await page.reload();
  await expect(page.getByText("2m · Corrected")).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: /^2m$/ })).toBeVisible();

  const other = await browser.newPage();
  try {
    await signIn(other, "bob@studyos.test");
    await other.goto(planner);
    await expect(other.getByText("This page could not be found.")).toBeVisible();
  } finally {
    await other.close();
  }
});
