import { expect, test } from "@playwright/test";
import { signInAdmin, unique } from "./helpers";

// Flows 5–7: KPI entry clears MISSING; full huddle lifecycle with carryover;
// high-priority issue appears in the huddle agenda.
test.describe("scoreboard and huddle", () => {
  test("KPI owner enters a weekly value; MISSING disappears for that KPI", async ({ page }) => {
    await signInAdmin(page); // Shlomo owns "Cash runway"
    await page.goto("/scoreboard?category=Financial");
    const card = page.locator("section", { hasText: "Cash runway" }).first();
    await card.getByRole("button", { name: /Enter|Edit/ }).click();

    const modal = page.getByRole("dialog");
    await modal.getByLabel(/This week's value/).fill("6.5");
    await modal.getByRole("button", { name: "Save value" }).click();
    await expect(page.getByText("KPI saved")).toBeVisible();
    await expect(card.getByText("6.5 months")).toBeVisible();
    await expect(card.getByText("MISSING")).toHaveCount(0);
  });

  test("create high-priority issue → it appears in the huddle agenda; full huddle flow with carryover", async ({ page }) => {
    await signInAdmin(page);

    // High-priority issue (auto-flagged for the huddle).
    const issueTitle = unique("e2e high issue");
    await page.goto("/issues");
    await page.getByRole("button", { name: "+ Log issue" }).click();
    const issueModal = page.getByRole("dialog");
    await issueModal.getByLabel(/What happened/).fill(issueTitle);
    await issueModal.getByLabel("Priority").selectOption("high");
    await issueModal.getByRole("button", { name: "Log issue" }).click();
    await expect(page.getByText("Issue logged")).toBeVisible();

    // Create a huddle for today and start it — the agenda freezes.
    await page.goto("/huddles");
    await page.getByRole("button", { name: "+ New huddle" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL(/\/huddles\//);
    await page.getByRole("button", { name: /Start huddle/ }).click();
    await expect(page.getByText(/agenda frozen/)).toBeVisible();

    // The high-priority issue is on the agenda.
    await expect(page.getByText(issueTitle).first()).toBeVisible();

    // Add a new commitment.
    const commitment = unique("e2e commitment");
    await page.getByLabel("New commitment").fill(commitment);
    await page.getByLabel("Commitment owner").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText(commitment)).toBeVisible();

    // Resolve any prior open commitments by carrying them, then end.
    while (await page.getByRole("button", { name: "Carry" }).count()) {
      await page.getByRole("button", { name: "Carry" }).first().click();
      const carryModal = page.getByRole("dialog");
      await carryModal.getByRole("button", { name: "Carry over" }).click();
      await expect(page.getByText(/Carried/).first()).toBeVisible();
    }

    await page.getByRole("button", { name: /End huddle/ }).click();
    await expect(page.getByText(/Huddle ended|Frozen record/)).toBeVisible({ timeout: 15_000 });

    // Completed huddle renders the frozen snapshot.
    await expect(page.getByText("Frozen record. This agenda snapshot never changes.")).toBeVisible();
  });
});
