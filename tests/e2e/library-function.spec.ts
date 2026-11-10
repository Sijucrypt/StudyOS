import { expect, test } from "@playwright/test";
import { pdfFixture } from "../support/documents.mjs";

test("scheduled library function rejects unauthorized calls and processes a private PDF", async ({ page }, info) => {
  test.skip(process.env.STUDYOS_TEST_LIBRARY_FUNCTION !== "1", "Run with the standalone fixture worker disabled.");
  const route = "/api/internal/library-worker";
  const headers = { Authorization: "Bearer " + "a".repeat(43) };
  expect((await page.request.post(route)).status()).toBe(401);
  expect((await page.request.post(route, { headers: { Authorization: "Bearer " + "b".repeat(43) } })).status()).toBe(401);
  const idle = await page.request.post(route, { headers });
  expect(idle.status()).toBe(200);
  expect(await idle.json()).toEqual({ processed: false });

  await page.goto("/login");
  await page.getByLabel("Email").fill("alice@studyos.test");
  await page.getByLabel("Password").fill("local-fixture-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/courses/new");
  const title = "Scheduled worker " + info.project.name;
  await page.getByLabel("Course code").fill("WORKER-" + info.project.name);
  await page.getByLabel("Course title").fill(title);
  await page.getByRole("button", { name: "Create course" }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Course library" }).click();
  const name = "scheduled-" + info.project.name + ".pdf";
  await page.getByLabel("Choose a file").setInputFiles({ name, mimeType: "application/pdf", buffer: pdfFixture() });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByText("Upload received.", { exact: false })).toBeVisible();
  await page.getByRole("link", { name, exact: true }).click();
  for (let i = 0; i < 2; i++) {
    const tick = await page.request.post(route, { headers });
    expect(tick.status()).toBe(200);
    expect(await tick.json()).toEqual({ processed: true });
  }
  await expect(page.getByText("Text extracted", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".react-pdf__Page canvas")).toBeVisible({ timeout: 15_000 });
});
