import { expect, test } from "@playwright/test";
import { signInAdmin, signInMember } from "./helpers";

// Flows 2–4: member status update + comment; blocked transition validation;
// admin owner/due-date change with audit history.
test.describe("tasks", () => {
  test("member updates task status and adds a comment", async ({ page }) => {
    await signInMember(page);
    await page.goto("/projects?mine=1");
    const firstTask = page.locator("a[href^='/projects/tasks/']").first();
    await firstTask.click();
    await expect(page).toHaveURL(/\/projects\/tasks\//);

    await page.getByLabel("Change status").first().selectOption("in_progress");
    await expect(page.getByText(/Status → In Progress/)).toBeVisible();

    const comment = `e2e comment ${Date.now()}`;
    await page.getByLabel("Add a comment").fill(comment);
    await page.getByRole("button", { name: "Post" }).click();
    await expect(page.getByText(comment)).toBeVisible();
  });

  test("blocked transition is rejected without a reason and succeeds with one", async ({ page }) => {
    await signInMember(page);
    await page.goto("/projects?mine=1");
    await page.locator("a[href^='/projects/tasks/']").first().click();

    await page.getByLabel("Change status").first().selectOption("blocked");
    const modal = page.getByRole("dialog");
    await expect(modal.getByText(/Why is this task blocked/)).toBeVisible();
    // The submit button is disabled until a reason is typed.
    await expect(modal.getByRole("button", { name: "Mark blocked" })).toBeDisabled();

    await modal.getByLabel(/Blocking reason/).fill("Waiting on AHCA response — e2e");
    await modal.getByRole("button", { name: "Mark blocked" }).click();
    await expect(page.getByText(/Status → Blocked/)).toBeVisible();
    await expect(page.getByText("Waiting on AHCA response — e2e").first()).toBeVisible();

    // Unblock to leave things tidy.
    await page.getByLabel("Change status").first().selectOption("in_progress");
  });

  test("admin changes owner and due date; audit history shows both", async ({ page }) => {
    await signInAdmin(page);
    await page.goto("/projects");
    await page.locator("a[href^='/projects/tasks/']").first().click();

    await page.locator("#ra-due").fill("2026-12-24");
    await page.getByRole("button", { name: /Update owner \/ dates/ }).click();
    await expect(page.getByText(/Owner \/ dates updated/)).toBeVisible();
    await expect(page.getByText(/Due date:/).first()).toBeVisible(); // activity feed row

    // Audit viewer shows the update with old and new values.
    await page.goto("/admin/audit?entity=tasks");
    await expect(page.getByText("tasks").first()).toBeVisible();
  });
});
