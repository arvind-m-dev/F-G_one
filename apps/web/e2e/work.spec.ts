import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

/** Saves a screenshot when WORK_SHOTS names a folder (used for visual review, not for assertions). */
async function shot(page: Page, name: string) {
  if (process.env.WORK_SHOTS) await page.screenshot({ path: `${process.env.WORK_SHOTS}/${name}.png`, fullPage: true });
}
const stamp = Date.now().toString(36).slice(-5);
/** A date `n` days from today as YYYY-MM-DD (local). */
function inDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

test('my work: plan for the next two weeks, quick add, open a task and move it along', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Work', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Work', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your next two weeks' })).toContainText(/of work due in the next two weeks/);
  await expect(page.getByRole('meter').first()).toBeVisible();
  await shot(page, '01-my-work');

  // Quick add creates a personal task owned by the person typing.
  const title = `Book flights ${stamp}`;
  await page.getByLabel('Add a personal task').fill(title);
  await page.getByLabel('Add a personal task').press('Enter');
  const row = page.getByRole('listitem').filter({ hasText: title });
  await expect(row).toBeVisible();

  // One click on the status moves it along.
  await row.getByRole('button', { name: /Change status/ }).click();
  await page.getByRole('menuitem', { name: 'In progress' }).click();
  await expect(row.getByRole('button', { name: /In progress\. Change status/ })).toBeVisible();

  // The panel opens from the URL, so the link can be shared and Back closes it.
  await row.locator('button').filter({ hasText: title }).click();
  await expect(page).toHaveURL(/task=/);
  const panel = page.getByRole('dialog', { name: 'Task', exact: true });
  await expect(panel.getByLabel('Task title')).toHaveValue(title);
  await panel.getByLabel('Write a comment').fill('Checked prices, booking tomorrow.');
  await panel.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(panel.getByText('Checked prices, booking tomorrow.')).toBeVisible();
  await panel.getByRole('button', { name: 'Add a link' }).click();
  await panel.getByLabel('Web address').fill('not a link');
  await panel.getByRole('button', { name: 'Add link' }).click();
  await expect(panel.getByRole('alert')).toContainText(/web address/);
  await panel.getByLabel('Web address').fill('https://github.com/acme/web/pull/7');
  await panel.getByRole('button', { name: 'Add link' }).click();
  await expect(panel.getByRole('link', { name: /Pull request/ })).toBeVisible();
  await shot(page, '02-task-panel');
  await page.goBack();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('asking for more time: the owner asks, the lead approves, the date moves', async ({ browser }) => {
  // A lead gives a task with a date; the owner cannot change that date, only ask.
  const mgr = await (await browser.newContext()).newPage();
  await signIn(mgr, 'manager@futuristglobal.com');
  await mgr.goto('/app/work?new=1');
  const form = mgr.getByRole('dialog');
  const title = `Audit log export ${stamp}`;
  await form.getByLabel('What needs doing?').fill(title);
  await form.getByLabel('Project').selectOption({ label: 'FG · FG One web app' });
  await form.getByRole('button', { name: /^Owner:/ }).click();
  await mgr.getByPlaceholder('Search by name').fill('Ananya');
  await mgr.getByRole('option', { name: /Ananya Iyer/ }).click();
  await form.getByLabel('Due (optional)').fill(inDays(3));
  await form.getByRole('button', { name: 'Add task' }).click();
  await expect(mgr.getByText(/FG-\d+ added/)).toBeVisible();

  const emp = await (await browser.newContext()).newPage();
  await signIn(emp, 'employee@futuristglobal.com');
  await emp.goto('/app/work');
  await emp.getByRole('listitem').filter({ hasText: title }).locator('button').filter({ hasText: title }).click();
  const panel = emp.getByRole('dialog', { name: 'Task', exact: true });
  await expect(panel.getByRole('heading', { name: title })).toBeVisible();
  // The owner sees the date as text, with a way to ask.
  await expect(panel.getByLabel('Due date')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Ask for more time' }).first().click();
  const ask = emp.getByRole('dialog', { name: 'Ask for more time' });
  await expect(ask.getByRole('radiogroup', { name: 'What would help' })).toBeVisible();
  await shot(emp, '03-ask-for-more-time');
  await ask.getByRole('button', { name: 'Send request' }).click();
  await expect(ask.getByRole('alert')).toContainText(/why/i);
  await ask.getByLabel('New due date').fill(inDays(12));
  await ask.getByLabel('Why?').fill('The export needs a new index first.');
  await ask.getByRole('button', { name: 'Send request' }).click();
  await expect(emp.getByText(/Request sent to Rohan/)).toBeVisible();
  await expect(emp.getByText(/asked to move this to/)).toBeVisible();

  await mgr.goto('/app/approvals?tab=work');
  const req = mgr.getByRole('listitem').filter({ hasText: 'The export needs a new index first.' });
  await expect(req).toContainText(/of work due in the next two weeks/);
  await shot(mgr, '04-approvals-work');
  await req.getByRole('button', { name: 'Approve' }).click();
  await mgr.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(mgr.getByText(/Approved\. Ananya Iyer has been notified/)).toBeVisible();

  await emp.reload();
  await expect(panel.getByText(/approved a new due date/)).toBeVisible();
  await expect(panel.getByText(/asked to move this to/)).toHaveCount(0);
});

test('team load: the lead sees who has too much and hands work to someone with room', async ({ page }) => {
  await signIn(page, 'manager@futuristglobal.com');
  await page.goto('/app/work?view=team');
  await expect(page.getByText(/more work than time|work fits in the next two weeks/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Ananya Iyer/ }).first()).toBeVisible();
  await shot(page, '05-team-load');
  const first = page.getByRole('listitem').filter({ hasText: /^.*(Give|Move) / }).first();
  if (await first.isVisible().catch(() => false)) {
    await first.getByRole('button', { name: /Hand over|Move date/ }).click();
    await expect(page.getByText(/Handed to|Due date moved to/)).toBeVisible();
  }
  // A person's queue opens in place.
  await page.getByRole('button', { name: /Ananya Iyer/ }).first().click();
  await expect(page.getByText(/Free from/)).toBeVisible();
});

test('projects: create one, add a task on the board, see the timeline and the daily report', async ({ page }) => {
  await signIn(page, 'manager@futuristglobal.com');
  await page.goto('/app/work?view=projects');
  await shot(page, '06-projects');
  await page.getByRole('button', { name: 'New project' }).first().click();
  const form = page.getByRole('dialog');
  const key = `Q${stamp.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}`;
  await form.getByLabel('Name').fill(`Client portal ${stamp}`);
  await form.getByLabel('Short code').fill(key);
  await form.getByRole('radio', { name: 'Emerald' }).click();
  await form.getByRole('button', { name: /Add a person to the project/ }).click();
  await page.getByPlaceholder('Search by name').fill('Kabir');
  await page.getByRole('option', { name: /Kabir Singh/ }).click();
  await form.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/app\/work\/projects\//);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Client portal ${stamp}`);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Projects');

  // Add from a board column: the task starts in that column.
  await page.getByRole('button', { name: 'Add a task to In progress' }).click();
  const task = page.getByRole('dialog');
  await task.getByLabel('What needs doing?').fill('Sign-in page');
  await task.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText(`${key}-1 added`)).toBeVisible();
  const column = page.getByRole('region', { name: /^In progress, 1 task/ });
  await expect(column.getByText('Sign-in page')).toBeVisible();
  await shot(page, '07-project-board');
  // Moving without dragging.
  await column.getByRole('button', { name: /Sign-in page: In progress\. Change status/ }).click();
  await page.getByRole('menuitem', { name: 'In review' }).click();
  await expect(page.getByRole('region', { name: /^In review, 1 task/ }).getByText('Sign-in page')).toBeVisible();

  await page.getByRole('tab', { name: 'List' }).click();
  await expect(page.getByRole('heading', { name: /In review · 1/ })).toBeVisible();

  await page.goto('/app/work?view=timeline');
  await expect(page.getByRole('region', { name: /Timeline/ })).toBeVisible();
  await shot(page, '08-timeline');
  await page.goto('/app/work?view=board');
  await expect(page.getByRole('region', { name: /^To do, / })).toBeVisible();
  await shot(page, '09-board');
  await page.goto('/app/work?view=report');
  await expect(page.getByText(/Right now/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy as text' })).toBeVisible();
  await shot(page, '10-report');
});

test('people outside a project cannot see it, and team load is for leads only', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  await page.goto('/app/work?view=team');
  // Falls back to My work: the tab is not offered.
  await expect(page.getByRole('tab', { name: 'Team load' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your next two weeks' })).toBeVisible();
  await page.goto('/app/work/projects/does-not-exist');
  await expect(page.getByText("This project isn't available")).toBeVisible();
});
