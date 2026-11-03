import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('attendance: check in from Home, take a break, check out; history and team board update', async ({ browser }) => {
  // employee@ is seeded without a record today
  const page = await (await browser.newContext()).newPage();
  await signIn(page, 'employee@futuristglobal.com');
  const att = page.getByRole('region', { name: 'Attendance' });
  await att.getByRole('radio', { name: 'Home' }).click();
  await att.getByRole('button', { name: 'Check in' }).click();
  await expect(att.getByText(/Working ·/)).toBeVisible();
  await page.goto('/app/attendance');
  await page.getByRole('button', { name: 'Start break' }).click();
  await expect(page.getByText('On a break', { exact: true }).first()).toBeVisible();
  await page.reload(); // state survives refresh (comes from the server)
  await expect(page.getByText('On a break', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'End break' }).click();
  await page.getByRole('button', { name: 'Check out' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Check out' }).click();
  await expect(page.getByText(/Done for today/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check in' })).toHaveCount(0);

  // Manager sees their report on the team board
  const mgr = await (await browser.newContext()).newPage();
  await signIn(mgr, 'manager@futuristglobal.com');
  await mgr.goto('/app/attendance?tab=team');
  await mgr.getByRole('radio', { name: /Checked out/ }).click();
  await expect(mgr.getByText('Ananya Iyer')).toBeVisible();
  await mgr.reload();
  await expect(mgr.getByRole('radio', { name: /Checked out/ })).toHaveAttribute('aria-checked', 'true');
});

test('announcements: HR publishes with read confirmation; employee is notified and confirms', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'hr@futuristglobal.com');
  await hr.goto('/admin/announcements');
  await hr.getByRole('button', { name: 'New announcement' }).click();
  const title = `Fire drill ${Date.now()}`;
  await hr.getByLabel('Title').fill(title);
  await hr.getByLabel('Message').fill('We will run a fire drill at 3 PM. Please follow the wardens.');
  await hr.getByRole('switch').nth(1).click(); // ask people to confirm
  await hr.getByRole('button', { name: 'Publish' }).click();
  await expect(hr.getByText(title)).toBeVisible();

  const emp = await (await browser.newContext()).newPage();
  await signIn(emp, 'employee@futuristglobal.com');
  await emp.getByRole('button', { name: /Notifications \(\d+ unread\)/ }).click();
  await emp.getByRole('button', { name: new RegExp(`Please read: ${title}`) }).click();
  await expect(emp).toHaveURL(/\/app\/announcements\?open=/);
  await emp.getByRole('button', { name: "I've read this" }).click();
  await expect(emp.getByText(/You confirmed you read this/)).toBeVisible();

  await hr.reload();
  await expect(hr.getByRole('listitem').filter({ hasText: title }).getByText('1 confirmed')).toBeVisible();
});

test('refresh keeps context: chat thread, directory filters, page titles, breadcrumbs', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  await page.goto('/app/chat');
  await page.getByRole('link', { name: /general/ }).first().click();
  const msg = page.getByTestId('message').first();
  await msg.hover();
  await msg.getByRole('button', { name: 'Reply in thread' }).click();
  await expect(page).toHaveURL(/thread=/);
  await page.reload();
  await expect(page.getByText('Thread', { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/#general · FG One/);

  await page.goto('/app/people');
  await page.getByRole('radio', { name: /Engineering/ }).click();
  await page.getByRole('radio', { name: 'grid view' }).click();
  await page.reload();
  await expect(page.getByRole('radio', { name: /Engineering/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('link', { name: /Kabir Singh/ }).first().click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Directory');
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Directory' }).click();
  await expect(page).toHaveURL(/\/app\/people/);
});

test('unknown pages show a friendly not-found screen', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  await page.goto('/app/this-does-not-exist');
  await expect(page.getByText("We couldn't find that page")).toBeVisible();
  await page.getByRole('link', { name: 'Go to Home' }).click();
  await expect(page).toHaveURL(/\/app\/home/);
});
