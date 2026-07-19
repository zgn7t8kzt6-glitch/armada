import { expect, test } from "@playwright/test";
import { signInAdmin, unique } from "./helpers";

// Flows 10–11: document versioning with signed download; weekly report
// generation and finalization.
test.describe("documents and reports", () => {
  test("upload document, upload a new version, and retrieve a signed download", async ({ page }) => {
    await signInAdmin(page);
    await page.goto("/documents");
    await expect(page.getByText(/Do not upload patient-identifiable information/).first()).toBeVisible();

    const title = unique("e2e doc");
    await page.getByRole("button", { name: "+ New document" }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Title").fill(title);
    await modal.getByLabel(/File \(first version/).setInputFiles({
      name: "policy-v1.txt", mimeType: "text/plain", buffer: Buffer.from("EverTide test policy v1"),
    });
    await modal.getByRole("button", { name: "Create document" }).click();
    await expect(page).toHaveURL(/\/documents\//, { timeout: 20_000 });
    await expect(page.getByText("policy-v1.txt")).toBeVisible();

    // New immutable version.
    await page.getByRole("button", { name: /Upload new version/ }).click();
    const vModal = page.getByRole("dialog");
    await vModal.getByLabel("File", { exact: true }).setInputFiles({
      name: "policy-v2.txt", mimeType: "text/plain", buffer: Buffer.from("EverTide test policy v2"),
    });
    await vModal.getByLabel(/What changed/).fill("Second revision");
    await vModal.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText("New version uploaded")).toBeVisible();
    await expect(page.getByText("v2")).toBeVisible();

    // Signed download redirects to a supabase signed URL and returns the file.
    const href = await page.locator("a[href^='/api/documents/download/']").first().getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.ok()).toBeTruthy();
    expect(await res.text()).toContain("EverTide test policy");
  });

  test("generate and finalize a weekly report", async ({ page }) => {
    await signInAdmin(page);
    await page.goto("/reports");
    await page.getByRole("button", { name: /Generate weekly \(this week\)/ }).click();
    await expect(page).toHaveURL(/\/reports\//, { timeout: 20_000 });
    await expect(page.getByText("Scorecard")).toBeVisible();
    await expect(page.getByText(/Milestones & opening date/)).toBeVisible();

    await page.getByLabel(/Leadership narrative/).fill("e2e finalization narrative");
    await page.getByRole("button", { name: "Finalize report" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Finalize", exact: true }).click();
    await expect(page.getByText("Report finalized")).toBeVisible();
    await expect(page.getByText("e2e finalization narrative")).toBeVisible();
  });
});
