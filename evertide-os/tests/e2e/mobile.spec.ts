import { expect, test } from "@playwright/test";
import { signInMember } from "./helpers";

// Flow 12: mobile viewport navigation and core actions (375px width).
test.describe("mobile", () => {
  test.use({ viewport: { width: 375, height: 720 } });

  test("bottom navigation reaches every module without horizontal scroll", async ({ page }) => {
    await signInMember(page);
    await page.goto("/");
    await expect(page.getByText(/Waiting on You/)).toBeVisible();

    // No horizontal page scroll (§10).
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // Bottom nav primary items.
    const nav = page.getByRole("navigation", { name: "Mobile" });
    await nav.getByRole("link", { name: "My Work" }).click();
    await expect(page).toHaveURL(/\/my-work/);
    await nav.getByRole("link", { name: "Huddle" }).click();
    await expect(page).toHaveURL(/\/huddles/);

    // Drawer reaches the rest.
    await nav.getByRole("button", { name: "More" }).click();
    await page.getByRole("dialog", { name: "More navigation" }).getByRole("link", { name: "Scoreboard" }).click();
    await expect(page).toHaveURL(/\/scoreboard/);
  });

  test("core action: member updates a task from the phone", async ({ page }) => {
    await signInMember(page);
    await page.goto("/projects?mine=1");
    await page.locator("a[href^='/projects/tasks/']").first().click();
    await page.getByLabel("Change status").first().selectOption("in_progress");
    await expect(page.getByText(/Status → In Progress/)).toBeVisible();
  });
});
