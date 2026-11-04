import { expect, type Page } from '@playwright/test';

export const PASSWORD = process.env.E2E_PASSWORD ?? '';

/** Two-step sign-in (email → password). */
export async function signIn(page: Page, email: string, password = PASSWORD) {
  if (!password) throw new Error('Set E2E_PASSWORD to the seed password');
  await page.goto('/login');
  // The page first shows the email step, then switches to saved accounts if this browser has any. Wait for it to settle.
  const another = page.getByRole('button', { name: 'Use another email' });
  const emailField = page.getByLabel('Work email');
  await expect(another.or(emailField).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  if (await another.isVisible().catch(() => false)) await another.click();
  await emailField.fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/home/);
}
