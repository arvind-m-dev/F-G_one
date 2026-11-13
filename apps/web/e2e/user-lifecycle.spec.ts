import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

/** Opens the "More actions" menu on the employee page and picks one action. */
async function more(page: Page, item: string) {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('HR creates a person with an exception; admin suspends, unsuspends, deactivates, archives and restores them', async ({ page, browser }) => {
  const stamp = Date.now();
  const email = `life.${stamp}@futuristglobal.com`;
  const password = 'Life-Cycle-2026';
  const last = `Cycle${stamp % 10000}`;

  // 1. HR creates the account through the wizard, with one extra permission.
  await signIn(page, 'hr@futuristglobal.com');
  await page.goto('/admin/employees');
  await page.getByRole('button', { name: 'Add employee' }).click();
  await expect(page).toHaveURL(/add=1/);
  const wizard = page.getByRole('dialog', { name: 'Add an employee' });
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard.getByText(/Too small|at least 1|Required/i).first()).toBeVisible(); // step 1 is validated
  await wizard.getByLabel('First name').fill('Lena');
  await wizard.getByLabel('Last name').fill(last);
  await wizard.getByLabel('Work email').fill(email);
  await wizard.getByLabel('Designation').fill('Communications Associate');
  await wizard.getByRole('button', { name: 'Next' }).click();

  // 2. Access: Employee role plus "Publish announcements"; sensitive permissions are not available to HR.
  await expect(wizard.getByRole('combobox', { name: 'Main role' })).toHaveValue(/.+/);
  await wizard.getByRole('button', { name: /Exceptions for this person/ }).click();
  await expect(wizard.getByRole('radio', { name: 'Allow: Manage roles and permissions' })).toBeDisabled();
  await wizard.getByRole('radio', { name: 'Allow: Publish announcements' }).click();
  await wizard.getByRole('radio', { name: 'Block: Create channels and groups' }).click();
  const preview = wizard.getByRole('complementary', { name: 'What they can do' });
  await expect(preview).toContainText('Publish announcements');
  await expect(preview).toContainText('an exception for this person');
  await expect(preview.getByText('Blocked for them')).toBeVisible();
  await wizard.getByRole('button', { name: 'Next' }).click();

  // 3. Password, then back and forth keeps what was entered.
  await wizard.getByLabel('Password', { exact: true }).fill(password);
  await wizard.getByRole('button', { name: 'Back' }).click();
  await wizard.getByRole('button', { name: 'Back' }).click();
  await expect(wizard.getByLabel('Work email')).toHaveValue(email);
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard.getByLabel('Password', { exact: true })).toHaveValue(password);
  await wizard.getByRole('button', { name: 'Next' }).click();

  // 4. Review and create.
  await expect(wizard.getByText(email)).toBeVisible();
  await expect(wizard.getByText('Allowed')).toBeVisible();
  await expect(wizard.getByText('Blocked', { exact: true })).toBeVisible();
  await wizard.getByRole('button', { name: 'Create account' }).click();
  await expect(wizard.getByLabel('Sign-in message')).toContainText(`Password: ${password}`);
  await wizard.getByRole('button', { name: 'Open their page' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Lena');
  await page.getByRole('tab', { name: 'Access' }).click();
  await expect(page.getByRole('complementary', { name: 'What they can do' })).toContainText('Publish announcements');
  const personUrl = page.url().split('?')[0]!;

  // They sign in and have exactly that extra access.
  const themCtx = await browser.newContext();
  const them = await themCtx.newPage();
  await signIn(them, email, password);
  const meRes = await them.request.get('/api/auth/me');
  const me = (await meRes.json()) as { permissions: string[] };
  expect(me.permissions).toContain('announcements.manage');
  expect(me.permissions).not.toContain('channels.create');
  expect(me.permissions).not.toContain('employees.manage');
  await them.goto('/app/chat');
  await expect(them.getByRole('button', { name: 'Browse channels' }).first()).toBeVisible();
  await expect(them.getByRole('button', { name: 'Create channel' })).toHaveCount(0);
  await them.goto('/app/home');
  await expect(them.getByRole('heading', { name: /Lena/ })).toBeVisible();

  // 2. An administrator suspends them: their open page goes to sign-in.
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signIn(admin, 'admin@futuristglobal.com');
  await admin.goto(personUrl);
  await expect(admin.getByRole('heading', { level: 1 })).toContainText('Lena');
  await more(admin, 'Suspend');
  const suspend = admin.getByRole('dialog', { name: /Suspend Lena/ });
  await suspend.getByLabel('Reason (optional)').fill('Security review');
  await suspend.getByRole('button', { name: 'Suspend' }).click();
  await expect(suspend).toBeHidden();
  await expect(admin.getByText(/Suspended since .*Reason: Security review/)).toBeVisible();
  await expect(them).toHaveURL(/\/login/);

  // Suspended people are listed under their own filter.
  await admin.goto(`/admin/employees?status=SUSPENDED&q=${last}`);
  await expect(admin.getByRole('link', { name: new RegExp(email) })).toBeVisible();
  await admin.goto(personUrl);

  // 3. Lift the suspension: they can sign in again.
  await more(admin, 'Lift suspension');
  await admin.getByRole('dialog', { name: /Lift the suspension/ }).getByRole('button', { name: 'Lift suspension' }).click();
  await expect(admin.getByText('Active', { exact: true }).first()).toBeVisible();
  // A fresh device (the bounced tab remembers the account, which the sign-in helper does not expect).
  const againCtx = await browser.newContext();
  await signIn(await againCtx.newPage(), email, password);
  await againCtx.close();

  // 4. Deactivate, archive (hidden from "All"), restore.
  await more(admin, 'Deactivate');
  await admin.getByRole('dialog', { name: /Deactivate Lena/ }).getByRole('button', { name: 'Deactivate' }).click();
  await expect(admin.getByText('Deactivated', { exact: true }).first()).toBeVisible();
  await more(admin, 'Archive');
  await admin.getByRole('dialog', { name: /Archive Lena/ }).getByRole('button', { name: 'Archive' }).click();
  await expect(admin.getByText(/^Archived on /)).toBeVisible();

  await admin.goto(`/admin/employees?q=${last}`);
  await expect(admin.getByText('No employees match')).toBeVisible();
  await admin.getByRole('radio', { name: 'Archived', exact: true }).click();
  await expect(admin).toHaveURL(/status=ARCHIVED/);
  await expect(admin.getByRole('link', { name: new RegExp(email) })).toBeVisible();

  await admin.goto(personUrl);
  await more(admin, 'Restore');
  await admin.getByRole('dialog', { name: /Restore Lena/ }).getByRole('button', { name: 'Restore' }).click();
  await expect(admin.getByText('Deactivated', { exact: true }).first()).toBeVisible();

  // The activity log records each step.
  await admin.getByRole('tab', { name: 'Activity' }).click();
  await expect(admin.getByRole('tabpanel')).toContainText(/suspend/i);

  await themCtx.close();
  await adminCtx.close();
});
