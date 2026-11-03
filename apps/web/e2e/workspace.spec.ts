import { expect, test } from '@playwright/test';
import { PASSWORD, signIn } from './helpers';

test('unauthenticated visitors are sent to login, legacy routes redirect', async ({ page }) => {
  await page.goto('/app/home');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fhome/);
  await page.goto('/home');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fhome/);
});

test('wrong password shows a generic error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Work email').fill('employee@futuristglobal.com');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password', { exact: true }).fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password' })).toBeVisible();
});

test('recent accounts are remembered on this device only and can be removed', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  await page.context().clearCookies();
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Choose an account' })).toBeVisible();
  await page.getByRole('button', { name: /employee@futuristglobal\.com/ }).first().click();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/home/);
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: 'Remove employee@futuristglobal.com from this device' }).click({ force: true });
  await expect(page.getByRole('heading', { name: 'Sign in to FG One' })).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem('fg.recentAccounts'));
  expect(stored).not.toContain('employee@futuristglobal.com');
});

test('employee home shows live data; admin portal is not available', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  await expect(page.getByRole('heading', { name: /Ananya/ })).toBeVisible();
  await expect(page.getByText('Upcoming holidays')).toBeVisible();
  await expect(page.getByText('Team pulse')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Admin portal' })).toHaveCount(0);
  await page.goto('/admin/employees');
  await expect(page.getByText("The admin portal isn't available to your role")).toBeVisible();
});

test('home layout can be customized and restored', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  await page.getByRole('button', { name: 'Customize Home' }).click();
  await page.getByRole('switch', { name: 'Show Celebrations' }).click();
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByRole('heading', { name: 'Celebrations' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Team pulse' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Celebrations' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Customize Home' }).click();
  await page.getByRole('button', { name: 'Restore default' }).click();
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByRole('heading', { name: 'Celebrations' })).toBeVisible();
});

test('status change updates instantly', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  const rail = page.getByRole('navigation', { name: 'Workspace' });
  await rail.getByRole('button', { name: 'Set your status' }).click();
  await page.getByRole('option', { name: /In a meeting/ }).click();
  await expect(rail.getByRole('button', { name: 'Set your status' })).toContainText('In a meeting');
  await rail.getByRole('button', { name: 'Set your status' }).click();
  await page.getByLabel('Status message').fill('Deep work until 3pm');
  await page.getByRole('option', { name: /Focus time/ }).click();
  await rail.getByRole('button', { name: 'Set your status' }).click();
  await page.getByLabel('Status message').fill('Deep work until 3pm');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(rail.getByRole('button', { name: 'Set your status' })).toContainText('Deep work until 3pm');
});

test('real-time direct messaging between two employees', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await signIn(a, 'employee@futuristglobal.com');
  await signIn(b, 'manager@futuristglobal.com');
  await a.goto('/app/chat');
  await b.goto('/app/chat');
  await a.getByRole('link', { name: /Rohan Verma/ }).click();
  await b.getByRole('link', { name: /Ananya Iyer/ }).click();
  await expect(a.getByRole('log', { name: 'Messages' })).toBeVisible();
  await expect(b.getByRole('log', { name: 'Messages' })).toBeVisible();
  await expect(b.getByTitle('Live updates connected')).toBeVisible();

  const text = `e2e ping ${Date.now()}`;
  const box = a.getByRole('textbox', { name: 'Message' });
  await box.click();
  await box.pressSequentially('typing…', { delay: 20 });
  await expect(b.getByText(/is typing/)).toBeVisible();
  await box.fill(text);
  await box.press('Enter');
  await expect(b.getByRole('log', { name: 'Messages' }).getByText(text)).toBeVisible();

  const msgB = b.getByTestId('message').filter({ hasText: text });
  await msgB.hover();
  await msgB.getByRole('button', { name: 'Agree' }).click();
  await expect(a.getByTestId('message').filter({ hasText: text }).getByRole('button', { name: 'Agree 1' })).toBeVisible();
});

test('admin portal: invite an employee who activates from the link', async ({ page }) => {
  await signIn(page, 'admin@futuristglobal.com');
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Admin portal' }).click();
  await expect(page.getByRole('heading', { name: /at a glance/ })).toBeVisible();
  await page.goto('/admin/employees?invite=1');
  const email = `e2e.${Date.now()}@futuristglobal.com`;
  await page.getByLabel('First name').fill('Eetoo');
  await page.getByLabel('Last name').fill('Tester');
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByText('Invitation ready')).toBeVisible();
  const link = await page.getByLabel('Invitation link').inputValue();
  expect(link).toMatch(/\/invite\/[\w-]{30,}/);

  const fresh = await (await page.context().browser()!.newContext()).newPage();
  await fresh.goto(link);
  await expect(fresh.getByText(/Welcome, Eetoo/)).toBeVisible();
  await fresh.getByLabel('New password').fill('Welcome-Aboard-2026');
  await fresh.getByLabel('Confirm password').fill('Welcome-Aboard-2026');
  await fresh.getByRole('button', { name: 'Activate my account' }).click();
  await expect(fresh).toHaveURL(/\/app\/home/);
  await expect(fresh.getByRole('heading', { name: /Eetoo/ })).toBeVisible();
});

test('personal settings persist (time format, density)', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  await page.goto('/app/settings');
  await page.getByRole('radio', { name: '13:30' }).click();
  await page.getByRole('radio', { name: 'Compact' }).click();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('radio', { name: '13:30' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await page.getByRole('radio', { name: '1:30 PM' }).click();
  await page.getByRole('radio', { name: 'Comfortable' }).click();
});
