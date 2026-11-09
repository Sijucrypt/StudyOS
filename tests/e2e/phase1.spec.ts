import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("local-fixture-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("sign-in, academic changes and cross-user isolation", async ({ page, browser }, info) => {
  const session = "UNIOSUN " + info.project.name;
  const semester = "Harmattan " + info.project.name;
  await page.goto("/courses/new");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill("alice@studyos.test");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Sign-in failed", { exact: false })).toBeVisible();
  await signIn(page, "alice@studyos.test");

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Display name").fill("Alex");
  await page.getByLabel("Timezone").fill("Africa/Lagos");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toHaveText("Profile saved.");
  await page.reload();
  await expect(page.getByLabel("Display name")).toHaveValue("Alex");

  await page.getByRole("link", { name: "Academics", exact: true }).click();
  await page.getByRole("textbox", { name: "Session label" }).fill(session);
  await page.getByRole("button", { name: "Create session" }).click();
  const article = page.locator("article").filter({ has: page.getByRole("heading", { name: session, exact: true }) });
  await article.getByText("Manage session").click();
  await article.getByRole("textbox", { name: "Session label" }).fill(session + " edited");
  await article.getByRole("button", { name: "Save changes" }).click();
  const updatedArticle = page.locator("article").filter({ has: page.getByRole("heading", { name: session + " edited", exact: true }) });
  await updatedArticle.getByText("Add semester").click();
  await updatedArticle.getByLabel("Semester name").fill(semester);
  await updatedArticle.getByRole("button", { name: "Create semester" }).click();
  await expect(page.getByRole("heading", { name: semester, exact: true })).toBeVisible();
  const semesterURL = page.url();

  await page.getByText("Optional UNIOSUN Harmattan import").click();
  await page.getByRole("button", { name: "Import Harmattan courses" }).click();
  await expect(page.getByRole("status")).toContainText("10 courses added");
  await expect(page.locator(".record-list li")).toHaveCount(10);
  await page.reload();
  await expect(page.getByText("Optional UNIOSUN Harmattan import")).toHaveCount(0);

  await page.goto("/courses/new");
  await page.getByLabel("Course code").fill("lab " + info.project.name);
  await page.getByLabel("Course title").fill("Independent lab");
  await page.getByLabel("Units").fill("3");
  await page.getByRole("button", { name: "Create course" }).click();
  await expect(page.getByRole("heading", { name: "Independent lab", exact: true })).toBeVisible();
  const courseURL = page.url();
  await page.getByLabel("Course title").fill("Independent lab revised");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Independent lab revised" })).toBeVisible();
  await page.getByRole("link", { name: "View topics" }).click();
  await expect(page).toHaveURL(/\/topics$/);
  const topicURL = page.url();
  await page.getByLabel("Topic title").fill("Practice");
  await page.getByRole("button", { name: "Add topic" }).click();
  await page.getByText("Manage topic").click();
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(page.getByText("1 of 1 active topics complete")).toBeVisible();

  if (!(await page.getByRole("button", { name: "Save topic" }).isVisible())) {
    await page.getByText("Manage topic").click();
  }
  await page.locator("details").getByRole("textbox", { name: "Topic title" }).fill("Practice revised");
  await page.getByRole("button", { name: "Save topic" }).click();
  await expect(page.getByRole("heading", { name: "Practice revised" })).toBeVisible();

  await page.goto(courseURL);
  await page.getByLabel("Location").selectOption({ label: session + " edited / " + semester });
  await page.getByRole("button", { name: "Apply change" }).click();
  await expect(page.getByRole("status")).toContainText("Course moved");
  expect(page.url().split("?")[0]).toBe(courseURL);
  await page.goto(topicURL);
  await expect(page.getByText("1 of 1 active topics complete")).toBeVisible();

  await page.goto(courseURL);
  await page.getByLabel("Location").selectOption({ label: "Standalone" });
  await page.getByLabel("Action").selectOption("copy");
  await page.getByRole("button", { name: "Apply change" }).click();
  await expect(page.getByRole("status")).toContainText("Course copied");
  expect(page.url().split("?")[0]).not.toBe(courseURL);
  await page.getByRole("link", { name: "View topics" }).click();
  await expect(page.getByText("No topics yet.")).toBeVisible();

  await page.goto(courseURL);
  await page.getByRole("button", { name: "Archive course" }).click();
  await expect(page.getByText("This course is archived.")).toBeVisible();
  await page.getByRole("button", { name: "Restore course" }).click();
  await expect(page.getByText("This course is archived.")).toHaveCount(0);
  await page.goto(semesterURL);
  await page.getByRole("button", { name: "Archive semester" }).click();
  await expect(page.getByText("This semester or its academic session is archived.")).toBeVisible();
  await page.getByRole("button", { name: "Restore semester" }).click();
  await expect(page.getByRole("link", { name: "Add course" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );

  const other = await browser.newPage();
  try {
    await signIn(other, "bob@studyos.test");
    await other.goto(courseURL);
    await expect(other.getByRole("heading", { name: "Independent lab revised" })).toHaveCount(0);
    await expect(other.getByText("This page could not be found.")).toBeVisible();
  } finally {
    await other.close();
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(topicURL);
  await expect(page).toHaveURL(/\/login$/);
});
