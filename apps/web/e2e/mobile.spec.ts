import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('mobile: bottom tabs and single-view chat', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  const tabs = page.getByRole('navigation', { name: 'Primary' });
  await tabs.getByRole('link', { name: 'Directory' }).click();
  await expect(page).toHaveURL(/\/app\/people/);
  await tabs.getByRole('link', { name: 'Chat' }).click();
  await page.getByRole('link', { name: /general/ }).first().click();
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
  await expect(tabs).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to conversations' }).click();
  await expect(page.getByRole('heading', { name: 'Chat' })).toBeVisible();
});
