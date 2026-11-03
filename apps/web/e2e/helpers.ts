import { expect, type Page } from '@playwright/test';

export const PASSWORD = process.env.E2E_PASSWORD ?? '';

/** Two-step sign-in (email → password). */
export async function signIn(page: Page, email: string) {
  if (!PASSWORD) throw new Error('Set E2E_PASSWORD to the seed password');
  await page.goto('/login');
  const another = page.getByRole('button', { name: 'Use another email' });
  if (await another.isVisible().catch(() => false)) await another.click();
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/home/);
}
