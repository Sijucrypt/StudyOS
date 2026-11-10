import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pdfFixture } from "../support/documents.mjs";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("local-fixture-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("private PDF library, extraction failure, and conflict-safe note autosave", async ({ page, browser }, info) => {
  await signIn(page, "alice@studyos.test");
  await page.goto("/courses/new");
  await page.getByLabel("Course code").fill("LIB-" + info.project.name);
  await page.getByLabel("Course title").fill("Source test " + info.project.name);
  await page.getByRole("button", { name: "Create course" }).click();
  await expect(page.getByRole("heading", { name: "Source test " + info.project.name })).toBeVisible();
  const course = page.url();

  await page.getByRole("link", { name: "Course library" }).click();
  await expect(page).toHaveURL(/\/library$/);
  const library = page.url();
  await page.getByLabel("Choose a file").setInputFiles({
    name: "first-" + info.project.name + ".pdf", mimeType: "application/pdf", buffer: pdfFixture(),
  });
  await page.getByRole("button", { name: "Upload file" }).click();
  await page.getByRole("link", { name: "first-" + info.project.name + ".pdf" }).click();
  await expect(page.getByText("Text extracted", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".react-pdf__Page canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Page 1 of 1")).toBeVisible();
  const source = page.url();
  await page.reload();
  await expect(page.getByRole("link", { name: "Download original" })).toBeVisible();

  await page.goto(library);
  await page.getByLabel("Choose a file").setInputFiles({
    name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%%EOF"),
  });
  await page.getByRole("button", { name: "Upload file" }).click();
  await page.getByRole("link", { name: "broken.pdf" }).click();
  await expect(page.getByText("Text extraction failed. The original is available.")).toBeVisible({ timeout: 30_000 });
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download original" }).click();
  expect((await download).suggestedFilename()).toBe("broken.pdf");

  await page.goto("/library");
  await page.getByLabel("Search by filename").fill("first-" + info.project.name);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("link", { name: "first-" + info.project.name + ".pdf" })).toBeVisible();
  await expect(page.getByRole("link", { name: "broken.pdf" })).toHaveCount(0);

  await page.goto(course);
  await page.getByRole("link", { name: "Course notes" }).click();
  await page.getByRole("button", { name: "New note" }).click();
  const body = page.getByRole("textbox", { name: "Note content" });
  await expect(body).toBeVisible();
  const note = page.url();
  await page.getByLabel("Note title").fill("Revision check");
  await body.fill("This is a study note.");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByLabel("Note title")).toHaveValue("Revision check");
  await expect(body).toHaveText("This is a study note.");

  const stale = await page.context().newPage();
  try {
    await stale.goto(note);
    await expect(stale.getByRole("textbox", { name: "Note content" })).toHaveText("This is a study note.");
    await body.fill("The current revision.");
    await expect(page.getByRole("status")).toHaveText("Saved");
    await stale.getByRole("textbox", { name: "Note content" }).fill("Stale draft");
    await expect(stale.getByRole("alert").filter({ hasText: "Your draft is still here" })).toBeVisible();
    await expect(stale.getByRole("textbox", { name: "Note content" })).toHaveText("Stale draft");
  } finally {
    await stale.close();
  }
  await page.reload();
  await expect(body).toHaveText("The current revision.");

  const exportUrl = note + "/export?format=";
  const manage = page.locator("summary").filter({ hasText: "Manage note" });
  await manage.focus();
  await page.keyboard.press("Enter");
  if (info.project.name === "desktop") {
    const viewport = page.viewportSize()!;
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ ...viewport, width });
      await expect(page.getByRole("link", { name: "Download JSON" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize(viewport);
  }
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Download Markdown" })).toBeFocused();
  const markdownEvent = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const markdown = await markdownEvent;
  expect(markdown.suggestedFilename()).toBe("revision-check.md");
  expect(await readFile((await markdown.path())!, "utf8")).toBe("# Revision check\n\nThe current revision\\.\n");
  const jsonEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download JSON" }).click();
  const json = await jsonEvent;
  expect(json.suggestedFilename()).toBe("revision-check.json");
  const payload = JSON.parse(await readFile((await json.path())!, "utf8"));
  expect(payload).toMatchObject({
    schemaVersion: 1, title: "Revision check",
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The current revision." }] }] },
  });
  expect(payload.revision).toBeGreaterThan(1);
  expect(payload).not.toHaveProperty("userId");
  expect((await page.request.get(exportUrl + "md")).headers()).toMatchObject({
    "cache-control": "private, no-store",
    "content-disposition": 'attachment; filename="revision-check.md"',
    "x-content-type-options": "nosniff",
  });
  expect((await page.request.get(exportUrl + "html")).status()).toBe(400);

  const other = await browser.newPage();
  try {
    const guest = await other.request.get(exportUrl + "md", { maxRedirects: 0 });
    expect([303, 307]).toContain(guest.status());
    expect(guest.headers().location).toMatch(/\/login$/);
    expect(guest.headers()["content-disposition"]).toBeUndefined();
    await signIn(other, "bob@studyos.test");
    await other.goto(note);
    await expect(other.getByText("This page could not be found.")).toBeVisible();
    expect((await other.request.get(source + "/file?preview=1", { maxRedirects: 0 })).status()).toBe(404);
    expect((await other.request.get(exportUrl + "json", { maxRedirects: 0 })).status()).toBe(404);
  } finally {
    await other.close();
  }
});
