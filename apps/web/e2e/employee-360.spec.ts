import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('admin opens a new employee page, changes their email and password, and they sign in with the new details', async ({ page, browser }) => {
  const stamp = Date.now();
  const email = `e360.${stamp}@futuristglobal.com`;
  const newEmail = `e360.renamed.${stamp}@futuristglobal.com`;
  const firstPassword = 'First-Pass-2026';
  const newPassword = 'Second-Pass-2026';

  await signIn(page, 'admin@futuristglobal.com');
  await page.goto('/admin/employees');
  await page.getByRole('button', { name: 'Add employee' }).click();
  const add = page.getByRole('dialog', { name: 'Add an employee' });
  await add.getByLabel('First name').fill('Tessa');
  await add.getByLabel('Last name').fill(`Three${stamp % 1000}`);
  await add.getByLabel('Work email').fill(email);
  await add.getByRole('button', { name: 'Next' }).click(); // access: keep the default role
  await add.getByRole('button', { name: 'Next' }).click();
  await add.getByLabel(/^(Temporary )?password$/i).fill(firstPassword);
  await add.getByRole('button', { name: 'Next' }).click(); // review
  await add.getByRole('button', { name: 'Create account' }).click();
  await expect(add.getByLabel('Sign-in message')).toContainText(firstPassword);
  await add.getByRole('button', { name: 'Open their page' }).click();

  await expect(page).toHaveURL(/\/admin\/employees\/[a-z0-9]+/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tessa');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Employees' })).toBeVisible();
  await expect(page.getByText(email).first()).toBeVisible();

  // Tabs are kept in the URL.
  await page.getByRole('tab', { name: 'Employment' }).click();
  await expect(page).toHaveURL(/tab=employment/);
  await page.getByRole('tab', { name: 'Access' }).click();
  await expect(page).toHaveURL(/tab=access/);
  await expect(page.getByRole('complementary', { name: 'What they can do' })).toBeVisible();
  await page.getByRole('tab', { name: 'Attendance' }).click();
  await expect(page.getByText('No attendance in the last 30 days')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Attendance' })).toHaveAttribute('aria-selected', 'true');

  // Change email.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Change email' }).click();
  const emailDialog = page.getByRole('dialog', { name: /Change Tessa's email/ });
  await emailDialog.getByLabel('New work email').fill(newEmail);
  await emailDialog.getByRole('button', { name: 'Change email' }).click();
  await expect(emailDialog).toBeHidden();
  await expect(page.getByText(newEmail).first()).toBeVisible();

  // Set a new password: shown once to hand over.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Set a new password' }).click();
  const pwDialog = page.getByRole('dialog', { name: /Set a new password for Tessa/ });
  await pwDialog.getByLabel('New password').fill(newPassword);
  await pwDialog.getByRole('button', { name: 'Set password' }).click();
  const message = pwDialog.getByLabel('Sign-in message');
  await expect(message).toContainText(newEmail);
  await expect(message).toContainText(newPassword);
  await pwDialog.getByRole('button', { name: 'Done' }).click();

  // They sign in with the new email and password.
  const ctx = await browser.newContext();
  const them = await ctx.newPage();
  await signIn(them, newEmail, newPassword);

  // Their device shows up; the admin signs them out everywhere.
  await page.reload();
  await page.getByRole('tab', { name: 'Devices' }).click();
  await expect(page.getByRole('list', { name: 'Signed-in devices' }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await page.getByRole('dialog', { name: /Sign Tessa out everywhere/ }).getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(page.getByText('Not signed in anywhere')).toBeVisible();
  await them.reload();
  await expect(them).toHaveURL(/\/login/);
  await ctx.close();

  // Activity shows the admin's changes.
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('changed an email').first()).toBeVisible();
});

test('HR cannot open an Administrator page', async ({ page }) => {
  await signIn(page, 'hr@futuristglobal.com');
  await page.goto('/admin/employees?q=admin');
  await page.getByRole('link', { name: /admin@futuristglobal\.com/ }).first().click();
  await expect(page.getByText("You can't manage this person")).toBeVisible();
});
