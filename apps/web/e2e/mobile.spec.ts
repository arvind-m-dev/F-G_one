import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('mobile navigation drawer works', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'People' }).last().click();
  await expect(page).toHaveURL(/\/people/);
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
});
