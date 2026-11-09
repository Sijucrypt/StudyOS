import { expect, test, type Page } from "@playwright/test";
import { pdfFixture } from "../support/documents.mjs";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("local-fixture-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("generates and saves cited resources, answers selected-source questions, and keeps results private", async ({ page, browser }, info) => {
  await signIn(page, "alice@studyos.test");
  await page.goto("/courses/new");
  await page.getByLabel("Course code").fill("AI-" + info.project.name);
  await page.getByLabel("Course title").fill("Biology " + info.project.name);
  await page.getByRole("button", { name: "Create course" }).click();
  await expect(page.getByRole("heading", { name: "Biology " + info.project.name })).toBeVisible();
  const course = page.url();
  await page.getByRole("link", { name: "Course library" }).click();
  await page.getByLabel("Choose a file").setInputFiles({
    name: "Photosynthesis.pdf",
    mimeType: "application/pdf",
    buffer: pdfFixture("Photosynthesis turns sunlight into chemical energy."),
  });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByText("Text extracted", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.goto(course + "/studio");
  await expect(page.getByText("No external AI provider is contacted.", { exact: false })).toBeVisible();
  const consent = page.getByLabel("Use the selected excerpts in this local demo.");
  await consent.evaluate((control) => control.removeAttribute("required"));
  await page.getByRole("button", { name: "Generate draft" }).click();
  await expect(page.getByText("Review and confirm the source-sharing choice before continuing.")).toBeVisible();
  await page.getByLabel("Photosynthesis.pdf", { exact: true }).check();
  await consent.check();
  await page.getByRole("button", { name: "Generate draft" }).click();
  await expect(page.getByRole("heading", { name: "Summary · demo" })).toBeVisible();
  const resource = page.url();
  const reference = page.getByRole("link", { name: "Photosynthesis.pdf · page 1" });
  await expect(reference).toHaveAttribute("href", /\/materials\/[^?]+\?page=1$/);
  await reference.click();
  await expect(page.getByText("Page 1 of 1")).toBeVisible({ timeout: 15_000 });
  await page.goto(resource);

  await page.getByText("Edit and save resource").click();
  await page.getByLabel("Resource title").fill("Photosynthesis revision");
  await page.getByRole("button", { name: "Save resource" }).click();
  await expect(page.getByRole("status")).toHaveText("Resource saved.");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Photosynthesis revision" })).toBeVisible();
  await expect(reference).toBeVisible();
  await page.goto(course + "/studio");
  await expect(page.getByRole("link", { name: "Photosynthesis revision" })).toBeVisible();
  await expect(page.getByText("Summary · Saved")).toBeVisible();

  await page.getByLabel("Resource format").selectOption("mcq");
  await page.getByLabel("Photosynthesis.pdf", { exact: true }).check();
  await page.getByLabel("Use the selected excerpts in this local demo.").check();
  await page.getByRole("button", { name: "Generate draft" }).click();
  await expect(page.getByRole("heading", { name: "Multiple-choice quiz · demo" })).toBeVisible();
  await page.getByText("Reveal answer", { exact: true }).click();
  await expect(page.getByText("Correct answer:", { exact: false })).toBeVisible();

  await page.goto(course + "/chat");
  async function ask(question: string) {
    await page.getByLabel("Photosynthesis.pdf", { exact: true }).check();
    await page.getByRole("textbox", { name: "Question" }).fill(question);
    await page.getByLabel("Use the selected excerpts in this local demo.").check();
    await page.getByRole("button", { name: "Ask question" }).click();
    await expect(page.getByRole("region", { name: "Answer" }).getByRole("heading", { name: question })).toBeVisible();
  }

  await ask("What is photosynthesis?");
  const answer = page.url();
  await expect(page.getByText("Photosynthesis turns sunlight into chemical energy.")).toBeVisible();
  await expect(reference).toBeVisible();
  await ask("What is quantum tunneling?");
  await expect(page.getByRole("status")).toContainText("enough evidence");
  await expect(reference).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );

  const other = await browser.newPage();
  try {
    await signIn(other, "bob@studyos.test");
    for (const privateUrl of [resource, answer]) {
      await other.goto(privateUrl);
      await expect(other.getByText("This page could not be found.")).toBeVisible();
    }
  } finally {
    await other.close();
  }
});
