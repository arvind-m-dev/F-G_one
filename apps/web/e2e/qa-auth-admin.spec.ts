import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { PASSWORD, signIn } from './helpers';

/**
 * QA pass over sign-in, Settings → Security, the top bar, the command palette and the admin portal
 * (overview, departments, roles, system settings, audit logs), as each role and at phone width.
 * Every test creates its own data and puts back anything it changes.
 */

function totp(secret: string, offsetSteps = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/\s/g, '')) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offsetSteps));
  const h = createHmac('sha1', key).update(counter).digest();
  const off = h[h.length - 1]! & 15;
  return ((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

async function newSignedIn(browser: Browser, email: string, password = PASSWORD) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email, password);
  return page;
}

/** Creates an employee through the admin API (what the Employees screen does) and returns their sign-in. */
async function createEmployee(api: APIRequestContext, first: string) {
  const roles = (await (await api.get('/api/roles')).json()) as { roles: { id: string; key: string }[] };
  const email = `qa.${first.toLowerCase()}.${Date.now()}@futuristglobal.com`;
  const password = 'Qa-Temp-Pass-2026';
  const res = await api.post('/api/employees', { data: { email, firstName: first, lastName: 'Tester', roleId: roles.roles.find((r) => r.key === 'employee')!.id, password } });
  expect(res.status()).toBe(201);
  return { email, password, id: ((await res.json()) as { employee: { id: string } }).employee.id };
}

const accountMenu = (page: Page) => page.getByRole('button', { name: 'Your account' }).first();

/** Opens the command palette with the keyboard shortcut (retrying until the page is listening). */
async function openPalette(page: Page) {
  const palette = page.getByRole('dialog', { name: 'Search FG One' });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible({ timeout: 1000 });
  }).toPass();
  return palette;
}

test.describe('sign-in', () => {
  test('email step validates; wrong passwords get one generic message; footer and help page match the policy', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('No account yet? Your administrator creates one for you.')).toBeVisible();
    await page.getByLabel('Work email').fill('not-an-email');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();

    await page.getByLabel('Work email').fill('nobody.here@futuristglobal.com');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Password', { exact: true }).fill('Wrong-Password-1');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password' })).toBeVisible();

    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
    await expect(page.getByText(/Ask your HR team or administrator/)).toBeVisible();
    await expect(page.getByText(/choose your own/)).toHaveCount(0);
    await page.getByRole('link', { name: 'Back to sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('after signing in you only ever land on this site', async ({ browser }) => {
    for (const next of ['/\\example.org/phish', '//example.org', 'https://example.org']) {
      const ctx = await browser.newContext(); // no saved accounts: starts at the email step
      const page = await ctx.newPage();
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await page.getByLabel('Work email').fill('employee@futuristglobal.com');
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(/localhost:\d+\/app\/home/);
      await ctx.close();
    }
  });

  test('a signed-out deep link comes back to the same page and filters', async ({ page }) => {
    await page.goto('/admin/audit?entity=department');
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel('Work email').fill('admin@futuristglobal.com');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/audit\?entity=department/);
    await expect(page.getByRole('combobox', { name: 'What it is about' })).toHaveValue('department');
  });

  test('sign out from the account menu, then pick the saved account', async ({ page }) => {
    await signIn(page, 'manager@futuristglobal.com');
    await accountMenu(page).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByText('manager@futuristglobal.com')).toBeVisible();
    await expect(menu.getByText('Role:')).toContainText('Manager');
    await menu.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Choose an account' })).toBeVisible();
    // The old session is gone on the server.
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    await page.getByRole('button', { name: /manager@futuristglobal\.com/ }).first().click();
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/app\/home/);
  });

  test('when the server cannot be reached, the workspace says so and recovers', async ({ browser }) => {
    const signedIn = await newSignedIn(browser, 'employee@futuristglobal.com');
    // A new tab of the same browser: signed in, but nothing cached in this tab yet.
    const page = await (await browser.newContext({ storageState: await signedIn.context().storageState() })).newPage();
    await page.route('**/api/auth/me', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ statusCode: 503, message: 'Service unavailable' }) }));
    await page.goto('/app/settings');
    await expect(page.getByText("FG One can't be reached right now")).toBeVisible({ timeout: 20_000 });
    await page.unroute('**/api/auth/me');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  });
});

test.describe('Settings → Security', () => {
  test('a new employee turns on two-step verification, signs in with a code, confirms it is them, manages devices and turns it off', async ({ browser }) => {
    const admin = await newSignedIn(browser, 'admin@futuristglobal.com');
    const person = await createEmployee(admin.request, 'Secure');

    const page = await newSignedIn(browser, person.email, person.password);
    await page.goto('/app/settings#security');
    const security = page.locator('#security');
    await expect(security.getByText('Off', { exact: true })).toBeVisible();
    await expect(security.getByText('This device')).toBeVisible();

    await security.getByRole('button', { name: 'Turn on' }).click();
    const dialog = page.getByRole('dialog', { name: 'Turn on two-step verification' });
    const secret = (await dialog.locator('code').innerText()).replace(/\s/g, '');
    await dialog.getByRole('button', { name: 'Turn on' }).click();
    await expect(dialog.getByText(/6-digit|code/i).first()).toBeVisible();
    await dialog.getByLabel('2. Enter the 6-digit code it shows').fill(totp(secret));
    await dialog.getByRole('button', { name: 'Turn on' }).click();
    const saved = page.getByRole('dialog', { name: 'Save your recovery codes' });
    await expect(saved).toBeVisible();
    const codes = (await page.getByRole('list', { name: 'Recovery codes' }).innerText()).split('\n').filter(Boolean);
    expect(codes).toHaveLength(10);
    await saved.getByRole('button', { name: 'I have saved them' }).click();
    await expect(security.getByText('On', { exact: true })).toBeVisible();
    await expect(security.getByText('10 recovery codes left', { exact: false })).toBeVisible();

    // A second device has to enter a code; the recovery code works once.
    const second = await (await browser.newContext()).newPage();
    await second.goto('/login');
    await second.getByLabel('Work email').fill(person.email);
    await second.getByRole('button', { name: 'Continue' }).click();
    await second.getByLabel('Password', { exact: true }).fill(person.password);
    await second.getByRole('button', { name: 'Sign in' }).click();
    await expect(second.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    await second.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(second.getByText('Enter the 6-digit code', { exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Use a recovery code' }).click();
    await second.getByLabel('Recovery code').fill(codes[0]!);
    await second.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(second).toHaveURL(/\/app\/home/);

    // Devices: both are listed; signing out the others ends the second one.
    await page.reload();
    await expect(page.getByRole('list', { name: 'Signed-in devices' }).getByRole('listitem')).toHaveCount(2);
    await security.getByRole('button', { name: 'Sign out all other devices' }).click();
    await expect(page.getByText('Signed out of 1 other device')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Signed-in devices' }).getByRole('listitem')).toHaveCount(1);
    await second.goto('/app/settings');
    await expect(second).toHaveURL(/\/login/);

    // Sensitive change after the confirmation window: the confirm-it-is-you dialog asks for the password and a code.
    let first = true;
    await page.route('**/api/auth/mfa/recovery-codes', async (route) => {
      if (!first) return route.continue();
      first = false;
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ statusCode: 403, code: 'REAUTH_REQUIRED', message: 'For your security, confirm it is you to continue' }) });
    });
    await security.getByRole('button', { name: 'New recovery codes' }).click();
    const reauth = page.getByRole('dialog', { name: 'Confirm it is you' });
    await expect(reauth).toBeVisible();
    await reauth.getByLabel('Your password').fill('Wrong-Password-1');
    await reauth.getByLabel('Code from your authenticator app').fill(codes[1]!);
    await reauth.getByRole('button', { name: 'Confirm' }).click();
    await expect(reauth.getByText('That password is not correct')).toBeVisible();
    await reauth.getByLabel('Your password').fill(person.password);
    await reauth.getByRole('button', { name: 'Confirm' }).click();
    const fresh = page.getByRole('dialog', { name: 'Your new recovery codes' });
    await expect(fresh).toBeVisible();
    await fresh.getByRole('button', { name: 'I have saved them' }).click();
    await page.unroute('**/api/auth/mfa/recovery-codes');
    await expect(security.getByText('10 recovery codes left', { exact: false })).toBeVisible();

    // Turn it off again (clean up).
    await security.getByRole('button', { name: 'Turn off' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Turn off' }).click();
    await expect(security.getByText('Off', { exact: true })).toBeVisible();

    // The admin's audit log shows it in plain words.
    await admin.goto('/admin/audit?q=auth.mfa');
    await expect(admin.getByText('turned on two-step verification').first()).toBeVisible();
    await expect(admin.getByText('turned off two-step verification').first()).toBeVisible();
    await admin.request.post(`/api/employees/${person.id}/deactivate`);
  });

  test('a Super Admin without two-step verification is told their authority is paused', async ({ page }) => {
    await signIn(page, 'admin@futuristglobal.com');
    await page.goto('/app/settings');
    await expect(page.getByText('Your Super Admin authority is paused.')).toBeVisible();
    expect((await page.request.get('/api/super-admins')).status()).toBe(403);
  });
});

test.describe('top bar and command palette', () => {
  test('admin: portal switch, notifications, theme that sticks, account menu', async ({ page }) => {
    await signIn(page, 'admin@futuristglobal.com');
    await page.getByRole('banner').getByRole('link', { name: 'Admin portal' }).click();
    await expect(page.getByRole('heading', { name: /at a glance/ })).toBeVisible();
    await page.getByRole('banner').getByRole('link', { name: 'Back to workspace' }).click();
    await expect(page).toHaveURL(/\/app\/home/);

    await page.getByRole('button', { name: /^Notifications/ }).first().click();
    await expect(page.getByRole('tablist', { name: 'Filter notifications' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitem', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitem', { name: 'Light' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    await accountMenu(page).click();
    await expect(page.getByRole('menu').getByText('Administrator')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Admin portal' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    // Restore the default theme preference.
    await page.request.patch('/api/me/preferences', { data: { theme: 'system' } });
  });

  test('employee: no admin entry points, and the admin portal explains why', async ({ page }) => {
    await signIn(page, 'employee@futuristglobal.com');
    await expect(page.getByRole('banner').getByRole('link', { name: 'Admin portal' })).toHaveCount(0);
    await accountMenu(page).click();
    await expect(page.getByRole('menuitem', { name: 'Admin portal' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto('/admin/settings');
    await expect(page.getByText("The admin portal isn't available to your role")).toBeVisible();
    for (const path of ['/api/admin/overview', '/api/audit-logs']) expect((await page.request.get(path)).status()).toBe(403);
    expect((await page.request.patch('/api/organization', { data: { name: 'Hacked' } })).status()).toBe(403);
  });

  test('command palette: shows only what you can use, searches, and its theme switch is saved', async ({ page }) => {
    await signIn(page, 'employee@futuristglobal.com');
    const palette = await openPalette(page);
    await expect(palette.getByRole('option', { name: 'Directory' })).toBeVisible();
    await expect(palette.getByRole('option', { name: 'Admin portal' })).toHaveCount(0);
    await expect(palette.getByRole('option', { name: 'System settings' })).toHaveCount(0);
    await expect(palette.getByRole('option', { name: 'Approvals' })).toHaveCount(0);

    await palette.getByRole('combobox').fill('Rohan');
    await expect(palette.getByRole('option', { name: /Rohan Verma/ })).toBeVisible();
    await palette.getByRole('combobox').fill('zzqx-nothing');
    await expect(palette.getByText(/No results for/)).toBeVisible();
    await palette.getByRole('combobox').fill('');

    const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    await palette.getByRole('option', { name: /Switch to (dark|light) mode/ }).click();
    await expect(palette).toHaveCount(0);
    await expect.poll(async () => ((await (await page.request.get('/api/auth/me')).json()) as { preferences: { theme?: string } }).preferences.theme).toBe(dark ? 'light' : 'dark');
    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!dark);
    await page.request.patch('/api/me/preferences', { data: { theme: 'system' } });

    // Managers see Approvals; admins see the admin shortcuts.
    const mgr = await newSignedIn(page.context().browser()!, 'manager@futuristglobal.com');
    await expect((await openPalette(mgr)).getByRole('option', { name: 'Approvals' })).toBeVisible();
    const adm = await newSignedIn(page.context().browser()!, 'admin@futuristglobal.com');
    await (await openPalette(adm)).getByRole('option', { name: 'System settings' }).click();
    await expect(adm).toHaveURL(/\/admin\/settings/);
  });
});

test.describe('admin portal', () => {
  test('overview: live numbers for admins and HR, a clear error and retry when it fails', async ({ browser }) => {
    const hr = await newSignedIn(browser, 'hr@futuristglobal.com');
    await hr.goto('/admin');
    await expect(hr.getByRole('heading', { name: /at a glance/ })).toBeVisible();
    await expect(hr.getByText('Active team')).toBeVisible();
    await expect(hr.getByRole('link', { name: 'Branding' })).toHaveCount(0); // HR cannot change settings
    await expect(hr.getByRole('navigation', { name: 'Admin portal' }).getByRole('link', { name: 'System settings' })).toHaveCount(0);
    await hr.goto('/admin/settings');
    await expect(hr.getByText("You don't have access to this page")).toBeVisible();

    const admin = await newSignedIn(browser, 'admin@futuristglobal.com');
    await admin.route('**/api/admin/overview', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, message: 'Internal server error' }) }));
    await admin.goto('/admin');
    await expect(admin.getByText("We couldn't load the overview.")).toBeVisible({ timeout: 20_000 });
    await admin.unroute('**/api/admin/overview');
    await admin.getByRole('button', { name: 'Try again' }).click();
    await expect(admin.getByText('Active team')).toBeVisible();
    await expect(admin.getByRole('link', { name: 'Branding' })).toHaveAttribute('href', '/admin/settings?tab=branding');
  });

  test('departments: create, edit, guarded delete, and the audit trail', async ({ page }) => {
    await signIn(page, 'hr@futuristglobal.com');
    const name = `QA Dept ${Date.now()}`;
    await page.goto('/admin/departments');
    await page.getByRole('button', { name: 'New department' }).click();
    const dialog = page.getByRole('dialog', { name: 'New department' });
    await dialog.getByLabel('Name').fill('Q');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog.getByText('Enter a name of 2 to 60 characters')).toBeVisible();
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Description').fill('Made by the QA run');
    await dialog.getByRole('button', { name: 'Emerald' }).click();
    await expect(dialog.getByRole('button', { name: 'Emerald' })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Department created')).toBeVisible();
    await expect(page.getByRole('heading', { name })).toBeVisible();

    // Same name again is refused with a clear message.
    await page.getByRole('button', { name: 'New department' }).click();
    await page.getByRole('dialog', { name: 'New department' }).getByLabel('Name').fill(name);
    await page.getByRole('dialog', { name: 'New department' }).getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('A department with this name already exists')).toBeVisible();
    await page.getByRole('dialog', { name: 'New department' }).getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: `Edit ${name}` }).click();
    const edit = page.getByRole('dialog', { name: `Edit ${name}` });
    await edit.getByLabel('Description').fill('Edited by the QA run');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('main').getByText('Edited by the QA run')).toBeVisible();

    // An announcement addressed to the department blocks deleting it.
    const depts = (await (await page.request.get('/api/departments')).json()) as { id: string; name: string }[];
    const dept = depts.find((d) => d.name === name)!;
    const ann = await page.request.post('/api/announcements', { data: { title: 'QA team note', body: 'Only for this team', departmentId: dept.id } });
    expect(ann.status()).toBe(201);
    const annId = ((await ann.json()) as { id: string }).id;
    await page.reload();
    await page.getByRole('button', { name: `Delete ${name}` }).click();
    // The dialog explains what to do first and offers no Delete button that could only fail.
    await expect(page.getByRole('dialog').getByText('1 announcement is addressed to this department.')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Delete' })).toHaveCount(0);
    expect((await page.request.delete(`/api/departments/${dept.id}`)).status()).toBe(409);
    await page.getByRole('dialog').getByRole('button', { name: 'Got it' }).click();
    expect((await page.request.delete(`/api/announcements/${annId}`)).status()).toBe(200);

    await page.reload();
    await page.getByRole('button', { name: `Delete ${name}` }).click();
    await expect(page.getByRole('dialog').getByText(/people will be left without a department/)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Department deleted')).toBeVisible();
    await expect(page.getByRole('heading', { name })).toHaveCount(0);

    await page.goto('/admin/audit?entity=department');
    await expect(page.getByText('created a department').first()).toBeVisible();
    await expect(page.getByText(`deleted a department · ${name}`)).toBeVisible();
  });

  test('roles and permissions matrix', async ({ browser }) => {
    const admin = await newSignedIn(browser, 'admin@futuristglobal.com');
    await admin.goto('/admin/roles');
    await expect(admin.getByRole('heading', { name: 'Roles & permissions' })).toBeVisible();
    const table = admin.getByRole('table');
    for (const role of ['Administrator', 'Admin / HR', 'Manager', 'Employee']) await expect(table.getByRole('columnheader', { name: role })).toBeVisible();
    await expect(table.getByRole('row').filter({ hasText: 'Manage company settings and branding' }).getByLabel('Granted', { exact: true })).toHaveCount(1);
    // Features that do not exist yet have no row.
    await expect(table.getByRole('row').filter({ hasText: /Ask FG One|AI providers|document library|campaigns|daily updates/i })).toHaveCount(0);

    const mgr = await newSignedIn(browser, 'manager@futuristglobal.com');
    await mgr.goto('/admin/roles');
    await expect(mgr.getByText("The admin portal isn't available to your role")).toBeVisible();
  });

  test('system settings: tabs in the address bar, no emoji, validation, and the password policy switch', async ({ page }) => {
    await signIn(page, 'admin@futuristglobal.com');
    await page.goto('/admin/settings?tab=attendance');
    await expect(page.getByRole('tab', { name: 'Attendance policy' })).toHaveAttribute('data-state', 'active');
    const locations = page.getByRole('button', { name: /Work from office|Work from home|client site/ });
    await expect(locations).toHaveCount(3);
    for (const text of await locations.allInnerTexts()) expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    await page.getByRole('tab', { name: 'Leave policy' }).click();
    await expect(page).toHaveURL(/tab=leave/);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Leave policy' })).toHaveAttribute('data-state', 'active');
    await page.getByRole('tab', { name: 'Modules' }).click();
    const leaveRow = page.getByRole('tabpanel').locator('div').filter({ has: page.getByRole('switch', { name: 'Leave management' }) }).first();
    await expect(leaveRow.getByText('upcoming')).toHaveCount(0);
    // Only features that exist today can be switched on or off.
    await expect(page.getByRole('tabpanel').getByText('upcoming')).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Documents' })).toHaveCount(0);

    // A logo that is not a web address is refused, with the reason.
    await page.getByRole('tab', { name: 'Branding' }).click();
    await page.getByLabel('Link to your logo').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Enter a full web address starting with https://')).toBeVisible();
    await page.getByLabel('Link to your logo').fill('');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled(); // nothing left to save

    // People choose their own passwords: on, saved, then off again.
    await page.getByRole('tab', { name: 'Sign-in & security' }).click();
    const sw = page.getByRole('switch', { name: 'People choose their own passwords' });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('System settings saved')).toBeVisible();
    const org = async () => ((await (await page.request.get('/api/organization')).json()) as { settings: { auth: { selfServicePassword: boolean } } }).settings.auth.selfServicePassword;
    expect(await org()).toBe(true);
    await page.reload();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('System settings saved').last()).toBeVisible();
    expect(await org()).toBe(false);

    // Unsaved colour previews do not leak into the rest of the portal.
    await page.getByRole('tab', { name: 'Branding' }).click();
    const brand = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--brand').toLowerCase());
    const before = await brand();
    await page.getByRole('textbox', { name: 'Primary colour', exact: true }).fill('#ff0000');
    expect(await brand()).toBe('#ff0000');
    // Leaving with unsaved changes asks first.
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('navigation', { name: 'Admin portal' }).getByRole('link', { name: 'Audit logs' }).click();
    await expect(page).toHaveURL(/\/admin\/audit/);
    expect(await brand()).toBe(before);
  });

  test('audit logs: filters stay in the address bar, plain labels, empty and error states', async ({ page }) => {
    await signIn(page, 'admin@futuristglobal.com');
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit logs' })).toBeVisible();
    await expect(page.getByText('signed in').first()).toBeVisible();
    await page.getByRole('combobox', { name: 'What it is about' }).selectOption({ label: 'System settings' });
    await expect(page).toHaveURL(/entity=organization/);
    await page.getByRole('textbox', { name: 'Filter audit logs' }).fill('auth.login');
    await expect(page).toHaveURL(/q=auth\.login/);
    await expect(page.getByText('No matching events')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Filter audit logs' })).toHaveValue('auth.login');
    await page.getByRole('combobox', { name: 'What it is about' }).selectOption({ label: 'Everything' });
    await expect(page.getByText('signed in').first()).toBeVisible();

    await page.route('**/api/audit-logs**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, message: 'Internal server error' }) }));
    await page.goto('/admin/audit?q=nothing-cached-here');
    await expect(page.getByText("We couldn't load the audit logs.")).toBeVisible({ timeout: 20_000 });
  });

  test('phone: admin navigation drawer, visible department actions, no sideways scrolling', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await signIn(page, 'admin@futuristglobal.com');
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('navigation', { name: 'Admin portal' }).getByRole('link', { name: 'Departments' }).click();
    await expect(page).toHaveURL(/\/admin\/departments/);
    await expect(page.getByRole('button', { name: /^Edit / }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Delete / }).first()).toBeVisible();
    for (const path of ['/admin', '/admin/departments', '/admin/roles', '/admin/settings', '/admin/audit', '/app/settings']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }
    // The account menu carries the portal switch on phones.
    await accountMenu(page).click();
    await page.getByRole('menuitem', { name: 'Admin portal' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await accountMenu(page).click();
    await page.getByRole('menuitem', { name: 'Back to workspace' }).click();
    await expect(page).toHaveURL(/\/app\/home/);
    await ctx.close();
  });
});
