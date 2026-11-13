import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('mobile: bottom tabs and single-view chat', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  const tabs = page.getByRole('navigation', { name: 'Primary' });
  await tabs.getByRole('link', { name: 'Attendance' }).click();
  await expect(page).toHaveURL(/\/app\/attendance/);
  await expect(page.getByRole('heading', { name: 'Attendance', exact: true })).toBeVisible();
  await tabs.getByRole('link', { name: 'Chat' }).click();
  await page.getByRole('link', { name: /general/ }).first().click();
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
  await expect(tabs).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to conversations' }).click();
  await expect(page.getByRole('heading', { name: 'Chat' })).toBeVisible();
});

test('mobile: work fits a phone (plan, tabs, board columns, task panel)', async ({ page }) => {
  await signIn(page, 'employee@futuristglobal.com');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Work' }).click();
  await expect(page.getByRole('region', { name: 'Your next two weeks' })).toBeVisible();
  // Nothing is wider than the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.WORK_SHOTS) await page.screenshot({ path: `${process.env.WORK_SHOTS}/m1-my-work.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(page.getByRole('region', { name: /^To do, / })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.WORK_SHOTS) await page.screenshot({ path: `${process.env.WORK_SHOTS}/m2-board.png` });
  await page.getByRole('region', { name: /^To do, / }).getByRole('button', { name: /^(FG|MOB)-\d+: / }).first().click();
  await expect(page.getByRole('dialog', { name: 'Task', exact: true })).toBeVisible();
  if (process.env.WORK_SHOTS) await page.screenshot({ path: `${process.env.WORK_SHOTS}/m3-task.png` });
  await page.goBack();
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByRole('region', { name: /Timeline/ })).toBeVisible();
  if (process.env.WORK_SHOTS) await page.screenshot({ path: `${process.env.WORK_SHOTS}/m4-timeline.png` });
});
