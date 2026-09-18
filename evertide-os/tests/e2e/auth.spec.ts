import { expect, test } from "@playwright/test";
import { signInAdmin } from "./helpers";

// Flow 1: login and organization/site selection.
test.describe("authentication", () => {
  test("unauthenticated users land on the login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.getByRole("button", { name: /email me a sign-in link/i })).toBeVisible();
  });

  test("a seeded user can authenticate and reach the Jacksonville site", async ({ page }) => {
    await signInAdmin(page);
    await page.goto("/");
    await expect(page.getByText(/Good morning/)).toBeVisible();
    await expect(page.getByText("Jacksonville Site 1").first()).toBeVisible();
    await expect(page.getByText(/Waiting on You/)).toBeVisible();
  });
});
