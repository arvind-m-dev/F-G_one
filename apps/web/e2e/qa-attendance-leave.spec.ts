import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PASSWORD, signIn } from './helpers';

/**
 * Attendance, leave, holidays and approvals end to end. Each run creates its own employees (reporting to
 * manager@) and uses a far-future week, so it can run again on the same database.
 */
const RUN = Date.now().toString(36);
// A Monday in 2031 plus a run-specific number of weeks keeps runs apart.
const WEEK = (Date.now() / 1000) % 150 | 0;
const day = (offset: number) => {
  const d = new Date(Date.UTC(2031, 2, 3 + WEEK * 7 + offset));
  return d.toISOString().slice(0, 10);
};
const MON = day(0);
const WED = day(2);
const FRI = day(4);

let hr: Page;
let worker: { id: string; email: string; name: string };
let worker2: { id: string; email: string; name: string };

async function newPage(browser: Browser, email: string, viewport?: { width: number; height: number }) {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await signIn(page, email);
  return page;
}

/** Creates an active employee who reports to manager@ and signs in with the seed password. */
async function createEmployee(label: string) {
  const roles = (await (await hr.request.get('/api/roles')).json()) as { roles: { id: string; key: string }[] };
  const mgr = (await (await hr.request.get('/api/employees', { params: { q: 'manager@futuristglobal.com' } })).json()) as { items: { id: string; email: string }[] };
  const email = `qa-${label}-${RUN}@futuristglobal.com`.toLowerCase();
  const res = await hr.request.post('/api/employees', {
    data: { email, firstName: 'QA', lastName: `${label} ${RUN}`, roleId: roles.roles.find((r) => r.key === 'employee')!.id, managerId: mgr.items.find((m) => m.email === 'manager@futuristglobal.com')!.id, password: PASSWORD },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { employee: { id: string } };
  return { id: body.employee.id, email, name: `QA ${label} ${RUN}` };
}

test.beforeAll(async ({ browser }) => {
  hr = await newPage(browser, 'hr@futuristglobal.com');
  worker = await createEmployee('Worker');
  worker2 = await createEmployee('Helper');
});

test('attendance: check in from home with a note, take a break, check out, and see it in history and on the board', async ({ browser }) => {
  const emp = await newPage(browser, worker.email);
  await emp.goto('/app/attendance');
  await expect(emp.getByText("You haven't checked in yet")).toBeVisible();
  await emp.getByRole('radio', { name: 'Home' }).click();
  await emp.getByLabel('Note for today').fill('=SUM(1,2) client call');
  await emp.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(emp.getByText('Checked in (Home)')).toBeVisible();
  await expect(emp.getByText(/^Working · /)).toBeVisible();

  await emp.getByRole('button', { name: 'Start break' }).click();
  await expect(emp.getByText('On a break', { exact: true })).toBeVisible();
  await emp.getByRole('button', { name: 'End break' }).click();
  await expect(emp.getByText('Welcome back')).toBeVisible();

  await emp.getByRole('button', { name: 'Check out' }).click();
  await expect(emp.getByRole('dialog')).toContainText("You can't check in again until tomorrow");
  await emp.getByRole('dialog').getByRole('button', { name: 'Check out' }).click();
  await expect(emp.getByText(/^Done for today · /)).toBeVisible();
  await expect(emp.getByRole('button', { name: 'Check in', exact: true })).toHaveCount(0);
  const today = emp.getByRole('listitem').filter({ hasText: '=SUM(1,2) client call' });
  await expect(today).toContainText('Home');
  await expect(today.getByRole('button', { name: 'Request correction' })).toBeVisible();

  // The manager sees the report on the team board; the export is formula-safe.
  const mgr = await newPage(browser, 'manager@futuristglobal.com');
  await mgr.goto('/app/attendance?tab=team&show=out');
  await expect(mgr.getByRole('listitem').filter({ hasText: worker.name })).toContainText('Checked out');

  await hr.goto('/admin/attendance');
  const download = hr.waitForEvent('download');
  await hr.getByRole('button', { name: 'Export last 30 days' }).click();
  const file = await download;
  expect(await file.failure()).toBeNull();
  const csv = readFileSync((await file.path())!, 'utf8');
  const line = csv.split('\n').find((l) => l.includes(worker.email))!;
  expect(line).toContain(`"'=SUM(1,2) client call"`);
  expect(line).toContain(',WFH,');
});

test('attendance correction: a past day needs an end time; the manager applies it', async ({ browser }) => {
  const emp = await newPage(browser, worker2.email);
  await emp.goto('/app/attendance');
  await emp.getByRole('button', { name: 'Fix a day' }).click();
  const dialog = emp.getByRole('dialog');
  await dialog.getByLabel('Started at').fill('09:10');
  await dialog.getByLabel('Finished at').fill('');
  await dialog.getByLabel('What needs fixing?').fill('Forgot to check in and out');
  await dialog.getByRole('button', { name: 'Send for review' }).click();
  await expect(dialog.getByText('Add the time you finished')).toBeVisible();
  await dialog.getByLabel('Finished at').fill('18:20');
  await dialog.getByRole('button', { name: 'Send for review' }).click();
  await expect(emp.getByText('Correction sent')).toBeVisible();
  await expect(emp.getByRole('listitem').filter({ hasText: 'Forgot to check in and out' })).toContainText('Waiting for review');

  const mgr = await newPage(browser, 'manager@futuristglobal.com');
  await mgr.goto('/app/approvals');
  await mgr.getByRole('listitem').filter({ hasText: 'Forgot to check in and out' }).getByRole('button', { name: 'Approve' }).click();
  await mgr.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(mgr.getByText(/Approved — QA has been notified/)).toBeVisible();
  await expect(mgr.getByRole('listitem').filter({ hasText: 'Forgot to check in and out' })).toHaveCount(0);

  await emp.reload();
  await expect(emp.getByRole('listitem').filter({ hasText: 'Forgot to check in and out' }).filter({ hasText: 'Applied' })).toBeVisible();
  await expect(emp.getByRole('listitem').filter({ hasText: 'Corrected: Forgot to check in and out' })).toContainText('9h 10m');
});

test('leave: day breakdown with a holiday, approval with a note, overlap refused, cancel', async ({ browser }) => {
  const holiday = `QA holiday ${RUN}`;
  expect((await hr.request.post('/api/holidays', { data: { name: holiday, date: WED, type: 'COMPANY' } })).status()).toBe(201);

  const emp = await newPage(browser, worker.email);
  await emp.goto('/app/leave?request=1');
  const dialog = emp.getByRole('dialog');
  await dialog.getByLabel('From').fill(MON);
  await dialog.getByLabel('To').fill(day(6));
  await expect(dialog.getByText(/This uses 4 days of your 12 days left/)).toBeVisible();
  const breakdown = dialog.getByRole('list', { name: 'How the days add up' });
  await expect(breakdown).toContainText('7 days in total');
  await expect(breakdown).toContainText('2 weekly days off');
  await expect(breakdown).toContainText(holiday);
  await dialog.getByLabel('To').fill(FRI);
  await dialog.getByLabel('Reason (optional)').fill(`Trip ${RUN}`);
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(emp.getByText('Leave requested')).toBeVisible();
  const row = emp.getByRole('listitem').filter({ hasText: `Trip ${RUN}` });
  await expect(row).toContainText('Waiting for approval');
  await expect(row).toContainText('4 days');

  // The same dates again are refused by the server.
  await emp.getByRole('button', { name: 'Request time off' }).first().click();
  await dialog.getByLabel('From').fill(WED);
  await dialog.getByLabel('To').fill(FRI);
  await expect(dialog.getByText(/This uses 2 days of your 8 days left/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(emp.getByText('You already have leave requested for some of these dates')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  const mgr = await newPage(browser, 'manager@futuristglobal.com');
  await mgr.goto('/app/approvals');
  await mgr.getByRole('listitem').filter({ hasText: `Trip ${RUN}` }).getByRole('button', { name: 'Approve' }).click();
  await mgr.getByRole('dialog').getByLabel('Note (optional)').fill('Have a good trip');
  await mgr.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(mgr.getByText(/Approved — QA has been notified/)).toBeVisible();

  await emp.reload();
  await expect(row).toContainText('Approved');
  await expect(row).toContainText('Have a good trip');
  await row.getByRole('button', { name: 'Cancel' }).click();
  await emp.getByRole('dialog').getByRole('button', { name: 'Cancel leave' }).click();
  await expect(emp.getByText('Leave cancelled')).toBeVisible();
  await expect(row).toContainText('Cancelled');
});

test('leave: more days than the balance cannot be sent', async ({ browser }) => {
  const emp = await newPage(browser, worker2.email);
  await emp.goto('/app/leave?request=1');
  const dialog = emp.getByRole('dialog');
  await expect(dialog.getByLabel('Type of leave')).toContainText('Casual leave');
  await dialog.getByLabel('From').fill(MON);
  await dialog.getByLabel('To').fill(day(18)); // three working weeks = 15 days
  await expect(dialog.getByText(/That’s more than you have left/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Send request' })).toBeDisabled();
  // Weekend-only dates need no leave.
  await dialog.getByLabel('From').fill(day(5));
  await dialog.getByLabel('To').fill(day(6));
  await expect(dialog.getByText(/weekends or holidays/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Send request' })).toBeDisabled();
});

test('admin leave: record on behalf, and no approve buttons on your own request', async () => {
  await hr.goto('/admin/leave?record=1');
  const dialog = hr.getByRole('dialog');
  await dialog.getByLabel('Employee').selectOption({ label: worker2.name });
  await dialog.getByLabel('From').fill(day(7));
  await dialog.getByLabel('To').fill(day(8));
  await expect(dialog.getByText(/This uses 2 days of their/)).toBeVisible();
  await dialog.getByLabel('Reason (optional)').fill(`Recorded ${RUN}`);
  await dialog.getByRole('button', { name: 'Record leave' }).click();
  await expect(hr.getByText('Leave recorded')).toBeVisible();
  await hr.goto('/admin/leave?status=APPROVED');
  await expect(hr.getByRole('listitem').filter({ hasText: `Recorded ${RUN}` })).toContainText('Approved');

  // HR's own pending request: someone else decides it.
  const types = (await (await hr.request.get('/api/leave/types')).json()) as { id: string; name: string }[];
  const own = await hr.request.post('/api/leave/requests', { data: { typeId: types.find((t) => t.name === 'Casual leave')!.id, startDate: day(9), endDate: day(9), reason: `Own ${RUN}` } });
  expect(own.status()).toBe(201);
  const ownId = ((await own.json()) as { id: string; status: string }).id;
  await hr.goto('/admin/leave');
  const mine = hr.getByRole('listitem').filter({ hasText: `Own ${RUN}` });
  if ((((await own.json()) as { status: string }).status) === 'PENDING') {
    await expect(mine).toContainText('Another admin or your manager decides this');
    await expect(mine.getByRole('button', { name: /Approve/ })).toHaveCount(0);
  }
  await hr.request.post(`/api/leave/requests/${ownId}/cancel`);

  // An unknown status in the link falls back to the pending list.
  await hr.goto('/admin/leave?status=BOGUS');
  await expect(hr.getByRole('radio', { name: 'Waiting for approval' })).toHaveAttribute('aria-checked', 'true');
});

test('holidays: an edit that collides with another holiday shows an error; a bad year link shows this year', async ({ browser }) => {
  const name = `QA clash ${RUN}`;
  await hr.request.post('/api/holidays', { data: { name, date: day(14), type: 'COMPANY' } });
  const second = await hr.request.post('/api/holidays', { data: { name, date: day(15), type: 'COMPANY' } });
  expect(second.status()).toBe(201);
  await hr.goto(`/admin/holidays?year=${day(15).slice(0, 4)}`);
  const rows = hr.getByRole('listitem').filter({ hasText: name });
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByRole('button', { name: `Actions for ${name}` }).click();
  await hr.getByRole('menuitem', { name: 'Edit' }).click();
  await hr.getByRole('dialog').getByLabel('Date').fill(day(14));
  await hr.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(hr.getByRole('dialog').getByRole('alert')).toContainText('already exists');
  await hr.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  const emp = await newPage(browser, worker.email);
  await emp.goto('/app/holidays?year=abc');
  await expect(emp.getByText(String(new Date().getFullYear()), { exact: true }).first()).toBeVisible();
  await expect(emp.getByText('No holidays added for NaN')).toHaveCount(0);
});

test('settings: work locations use icons, and the last working day or location cannot be removed', async ({ browser }) => {
  const admin = await newPage(browser, 'admin@futuristglobal.com');
  await admin.goto('/admin/settings');
  await admin.getByRole('tab', { name: 'Attendance policy' }).click();
  const office = admin.getByRole('button', { name: 'Work from office' });
  await expect(office).toBeVisible();
  await expect(office.locator('svg')).toHaveCount(1);
  const panel = admin.getByRole('tabpanel');
  expect(await panel.innerText()).not.toMatch(/\p{Extended_Pictographic}/u);
  // Turn off all but one location, then try the last one.
  await admin.getByRole('button', { name: 'Work from home' }).click();
  await admin.getByRole('button', { name: 'On duty / client site' }).click();
  await office.click();
  await expect(admin.getByText('Keep at least one work location')).toBeVisible();
  await expect(office).toHaveAttribute('aria-pressed', 'true');
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu']) await admin.getByRole('button', { name: d, exact: true }).click();
  await admin.getByRole('button', { name: 'Fri', exact: true }).click();
  await expect(admin.getByText('Keep at least one working day')).toBeVisible();
  // Nothing was saved (reloading with unsaved changes asks first).
  admin.on('dialog', (d) => void d.accept());
  await admin.reload();
});

test('phone: attendance, leave and approvals fit the screen', async ({ browser }) => {
  for (const [email, path] of [
    [worker.email, '/app/attendance'],
    [worker.email, '/app/leave'],
    [worker.email, '/app/leave?tab=team'],
    ['manager@futuristglobal.com', '/app/approvals'],
    ['hr@futuristglobal.com', '/admin/leave'],
  ] as const) {
    const page = await newPage(browser, email, { width: 390, height: 844 });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1);
    await page.context().close();
  }
});
