import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

/** Next weekday at least `ahead` days from today, as YYYY-MM-DD. */
function weekday(ahead: number) {
  const d = new Date();
  d.setDate(d.getDate() + ahead);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA');
}

test('leave: employee requests, manager approves from Approvals, employee sees it approved', async ({ browser }) => {
  const emp = await (await browser.newContext()).newPage();
  await signIn(emp, 'employee@futuristglobal.com');
  await emp.goto('/app/leave');
  await emp.getByRole('button', { name: 'Request time off' }).first().click();
  const day = weekday(21);
  // Scoped to the dialog: the check-in reminder's "Hide for today" button also matches "To".
  await emp.getByRole('dialog').getByLabel('From', { exact: true }).fill(day);
  await emp.getByRole('dialog').getByLabel('To', { exact: true }).fill(day);
  await emp.getByLabel('Reason (optional)').fill('Dentist appointment');
  await expect(emp.getByText(/This uses 1 day/)).toBeVisible();
  await emp.getByRole('button', { name: 'Send request' }).click();
  await expect(emp.getByText('Waiting for approval').first()).toBeVisible();

  const mgr = await (await browser.newContext()).newPage();
  await signIn(mgr, 'manager@futuristglobal.com');
  await mgr.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: /Approvals/ }).click();
  const row = mgr.getByRole('listitem').filter({ hasText: 'Dentist appointment' });
  await row.getByRole('button', { name: 'Approve' }).click();
  await mgr.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(mgr.getByText(/Approved — Ananya has been notified/)).toBeVisible();

  await emp.reload();
  await expect(emp.getByRole('listitem').filter({ hasText: 'Dentist appointment' }).getByText('Approved')).toBeVisible();
});

test('holidays: HR adds a company holiday and employees see it', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'hr@futuristglobal.com');
  await hr.goto('/admin/holidays');
  await hr.getByRole('button', { name: 'Add holiday' }).first().click();
  const name = `Founders day ${Date.now() % 10000}`;
  await hr.getByLabel('Name').fill(name);
  await hr.getByLabel('Date').fill(weekday(30));
  await hr.getByLabel('Kind').selectOption('COMPANY');
  await hr.getByRole('dialog').getByRole('button', { name: 'Add holiday' }).click();
  await expect(hr.getByText('Holiday added')).toBeVisible();

  const emp = await (await browser.newContext()).newPage();
  await signIn(emp, 'employee@futuristglobal.com');
  const d = new Date(`${weekday(30)}T12:00:00`);
  await emp.goto(`/app/holidays?year=${d.getFullYear()}`);
  await expect(emp.getByText(name)).toBeVisible();
});

test('attendance correction: employee asks, manager approves, history updates', async ({ browser }) => {
  const emp = await (await browser.newContext()).newPage();
  await signIn(emp, 'employee@futuristglobal.com');
  await emp.goto('/app/attendance');
  await emp.getByRole('button', { name: 'Request a correction' }).first().click();
  const date = new Date(Date.now() - 3 * 86400_000).toLocaleDateString('en-CA');
  await emp.getByLabel('Day').fill(date);
  await emp.getByLabel('Started at').fill('09:05');
  await emp.getByLabel('Finished at').fill('18:05');
  await emp.getByLabel('What needs fixing?').fill('Phone died, could not check in');
  await emp.getByRole('button', { name: 'Send for review' }).click();
  await expect(emp.getByText('Waiting for review')).toBeVisible();

  const mgr = await (await browser.newContext()).newPage();
  await signIn(mgr, 'manager@futuristglobal.com');
  await mgr.goto('/app/approvals');
  await mgr.getByRole('listitem').filter({ hasText: 'Phone died' }).getByRole('button', { name: 'Approve' }).click();
  await mgr.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(mgr.getByText(/Approved/).first()).toBeVisible();

  await emp.reload();
  await expect(emp.getByText('Applied')).toBeVisible();
});
