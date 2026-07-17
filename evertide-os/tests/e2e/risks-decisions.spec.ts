import { expect, test } from "@playwright/test";
import { signInAdmin, unique } from "./helpers";

// Flows 8–9: risk creation + occurred conversion; decision approval and
// immutability.
test.describe("risks and decisions", () => {
  test("create risk and convert an occurred risk into a linked issue", async ({ page }) => {
    await signInAdmin(page);
    await page.goto("/risks");

    const title = unique("e2e risk");
    await page.getByRole("button", { name: "+ New risk" }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Risk", { exact: true }).fill(title);
    await modal.getByLabel("Probability").selectOption("high");
    await modal.getByLabel("Impact").selectOption("severe");
    await expect(modal.getByText(/Calculated score: 12/)).toBeVisible();
    await modal.getByRole("button", { name: "Register risk" }).click();
    await expect(page.getByText("Risk registered")).toBeVisible();

    await page.getByRole("link", { name: new RegExp(title) }).click();
    await page.getByRole("button", { name: /Risk occurred/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Convert" }).click();

    // Lands on the linked issue; the risk record is retained.
    await expect(page).toHaveURL(/\/issues\//, { timeout: 15_000 });
    await expect(page.getByText(`Occurred risk: ${title}`)).toBeVisible();
  });

  test("approve a decision and verify protected fields become immutable", async ({ page }) => {
    await signInAdmin(page);
    await page.goto("/decisions");

    const title = unique("e2e decision");
    await page.getByRole("button", { name: "+ Log decision" }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Decision title").fill(title);
    await modal.getByLabel(/The decision/).fill("We will use vendor X.");
    await modal.getByLabel(/Rationale/).fill("Best price and support.");
    await modal.getByRole("button", { name: "Log decision" }).click();
    await expect(page).toHaveURL(/\/decisions\//);

    await page.getByRole("button", { name: "Approve…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText(/now immutable/)).toBeVisible();

    // The free-edit draft form is gone; only sanctioned fields remain.
    await expect(page.getByText(/Approved decision — substance is immutable/)).toBeVisible();
    await expect(page.getByLabel("Implementation status")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  });
});
