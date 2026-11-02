import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('unauthenticated visitors are sent to login', async ({ page }) => {
  await page.goto('/home');
  await expect(page).toHaveURL(/\/login\?next=%2Fhome/);
});

test('wrong password shows a generic error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Work email').fill('employee@futuristglobal.com');
  await page.getByLabel('Password', { exact: true }).fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password' })).toBeVisible();
});

test('employee dashboard shows live data and hides admin navigation', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  await expect(page.getByRole('heading', { name: /Ananya/ })).toBeVisible();
  await expect(page.getByText('Upcoming holidays')).toBeVisible();
  await expect(page.getByText('Team availability')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace' }).getByText('Administration')).toHaveCount(0);
  await page.goto('/admin/employees');
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
});

test('status change from the top bar updates instantly', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  await page.getByRole('button', { name: 'Your status', exact: true }).click();
  await page.getByRole('option', { name: /In a Meeting/ }).click();
  await expect(page.getByRole('button', { name: 'Your status', exact: true })).toContainText('In a Meeting');
  // restore
  await page.getByRole('button', { name: 'Your status', exact: true }).click();
  await page.getByRole('option', { name: /Focus Mode/ }).click();
});

test('real-time direct messaging between two employees', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await signIn(a, 'employee@futuristglobal.com');
  await signIn(b, 'manager@futuristglobal.com');

  // Both open their DM via the sidebar.
  await a.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: /Rohan Verma/ }).click();
  await b.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: /Ananya Iyer/ }).click();
  await expect(a.getByRole('log', { name: 'Messages' })).toBeVisible();
  await expect(b.getByRole('log', { name: 'Messages' })).toBeVisible();
  await expect(b.locator('header span[title="Live updates connected"]')).toBeVisible();

  const text = `e2e ping ${Date.now()}`;
  const box = a.getByRole('textbox', { name: 'Message' });
  await box.click();
  await box.pressSequentially('typing…', { delay: 20 });
  await expect(b.getByText(/is typing/)).toBeVisible();
  await box.fill(text);
  await box.press('Enter');

  // Delivered to the other user without a reload.
  await expect(b.getByRole('log', { name: 'Messages' }).getByText(text)).toBeVisible();

  // Reaction from B shows up for A.
  const msgB = b.getByTestId('message').filter({ hasText: text });
  await msgB.hover();
  await msgB.getByRole('button', { name: 'React 👍' }).click();
  await expect(a.getByTestId('message').filter({ hasText: text }).getByRole('button', { name: '👍 1' })).toBeVisible();
});

test('admin can invite an employee and see the invite link', async ({ page }) => {
  await signIn(page, 'admin@futuristglobal.com');
  await page.goto('/admin/employees?invite=1');
  const email = `e2e.${Date.now()}@futuristglobal.com`;
  await page.getByLabel('First name').fill('Eetoo');
  await page.getByLabel('Last name').fill('Tester');
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByText('Invitation ready')).toBeVisible();
  const link = await page.getByLabel('Invitation link').inputValue();
  expect(link).toMatch(/\/invite\/[\w-]{30,}/);

  // New hire activates the account from the link.
  const fresh = await (await page.context().browser()!.newContext()).newPage();
  await fresh.goto(link);
  await expect(fresh.getByText(/Welcome, Eetoo/)).toBeVisible();
  await fresh.getByLabel('New password').fill('Welcome-Aboard-2026');
  await fresh.getByLabel('Confirm password').fill('Welcome-Aboard-2026');
  await fresh.getByRole('button', { name: 'Activate my account' }).click();
  await expect(fresh).toHaveURL(/\/home/);
  await expect(fresh.getByRole('heading', { name: /Eetoo/ })).toBeVisible();
});
