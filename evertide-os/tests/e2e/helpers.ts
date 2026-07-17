import { expect, type Page } from "@playwright/test";

// Signs in through the test-auth endpoint (enabled only when ALLOW_TEST_AUTH=1
// or NODE_ENV=test — never in production, spec §14).
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "shlomo@evertide.example";
export const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL ?? "mordechai@evertide.example";

export async function signIn(page: Page, email: string): Promise<void> {
  const res = await page.request.post("/api/test-auth", { data: { email } });
  expect(res.ok(), `test-auth sign-in for ${email}: ${res.status()}`).toBeTruthy();
}

export async function signInAdmin(page: Page): Promise<void> {
  await signIn(page, ADMIN_EMAIL);
}

export async function signInMember(page: Page): Promise<void> {
  await signIn(page, MEMBER_EMAIL);
}

export function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
