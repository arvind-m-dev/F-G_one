import { createHmac } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { PASSWORD, signIn } from './helpers';

/**
 * Super Admins page and nomination flow.
 *
 * The demo Super Admin (admin@) has no two-step verification, so their authority is paused, and a Super Admin
 * cannot turn it off again once on (other specs sign in as admin@ without a code). So the active Super Admin
 * here is a dedicated account the seed creates only when SEED_E2E_TOTP is set, with that authenticator secret:
 *   SEED_E2E_TOTP=<base32> pnpm db:seed   and   E2E_TOTP_SECRET=<same> pnpm --filter @fg/web test:e2e
 * Everything the test changes is put back (limit, nominations, the nominee's authority and two-step verification).
 */
const SECRET = process.env.E2E_TOTP_SECRET ?? process.env.SEED_E2E_TOTP ?? '';
const SUPER_ADMIN = 'e2e.superadmin@futuristglobal.com';
const NOMINEE = 'zara.khan@futuristglobal.com';

const step = () => Math.floor(Date.now() / 30_000);
function totpAt(secret: string, s: number) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/\s/g, '')) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(s));
  const h = createHmac('sha1', key).update(counter).digest();
  const off = h[h.length - 1]! & 15;
  return ((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

/** Each code works once; wait for the next 30-second step when this one was already used. */
let lastStep = 0;
async function freshCode(page: Page, secret: string) {
  while (step() <= lastStep) await page.waitForTimeout(1000);
  lastStep = step();
  return totpAt(secret, lastStep);
}

async function signInWithCode(page: Page, email: string, secret: string) {
  await page.goto('/login');
  const another = page.getByRole('button', { name: 'Use another email' });
  if (await another.isVisible().catch(() => false)) await another.click();
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByLabel('Code').fill(await freshCode(page, secret));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    // A code from an earlier run in this same 30 seconds is refused (no replay); the next one works.
    const ok = await page.waitForURL(/\/app\/home/, { timeout: 8000 }).then(() => true, () => false);
    if (ok) return;
  }
  await expect(page).toHaveURL(/\/app\/home/);
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

test.describe('Super Admins', () => {
  test('a paused Super Admin is told why, and the Overview flags missing two-step verification', async ({ page }) => {
    await signIn(page, 'admin@futuristglobal.com');
    await page.goto('/admin');
    const access = page.getByRole('region', { name: 'Access and security' });
    await expect(access).toBeVisible();
    await expect(access.getByText(/with admin access do(es)? not use two-step verification/)).toBeVisible();
    await expect(access.getByRole('link', { name: /Aarav Mehta/ })).toBeVisible();
    await access.getByRole('link', { name: /^Waiting for a password/ }).click();
    await expect(page).toHaveURL(/\/admin\/employees\?status=INVITED/);

    await page.getByRole('navigation', { name: 'Admin portal' }).getByRole('link', { name: 'Super Admins' }).click();
    await expect(page).toHaveURL(/\/admin\/super-admins/);
    await expect(page.getByText('Your Super Admin authority is paused')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Turn on two-step verification' })).toHaveAttribute('href', '/app/settings#security');
    await expect(page.getByRole('button', { name: 'Nominate a Super Admin' })).toHaveCount(0);
  });

  test('nominate, accept with two-step verification, remove, withdraw and change the limit', async ({ page, browser }) => {
    test.skip(!SECRET, 'Seed with SEED_E2E_TOTP=<base32 secret> and pass the same value as E2E_TOTP_SECRET');
    test.setTimeout(240_000);
    await signInWithCode(page, SUPER_ADMIN, SECRET);
    await page.goto('/admin');
    await expect(page.getByRole('region', { name: 'Access and security' }).getByText(/2 Super Admins · 2 of 4 places used/)).toBeVisible();
    await page.getByRole('navigation', { name: 'Admin portal' }).getByRole('link', { name: 'Super Admins' }).click();
    await expect(page.getByRole('heading', { name: 'Super Admins', level: 1 })).toBeVisible();
    const list = page.getByRole('list', { name: 'Super Admins' });
    const me = list.getByRole('listitem').filter({ hasText: SUPER_ADMIN });
    await expect(me.getByText('You', { exact: true })).toBeVisible();
    await expect(me.getByRole('button', { name: /Remove/ })).toHaveCount(0);
    await expect(me.getByText(/Only another Super Admin can change your authority/)).toBeVisible();
    const paused = list.getByRole('listitem').filter({ hasText: 'admin@futuristglobal.com' });
    await expect(paused.getByText('Paused', { exact: true })).toBeVisible();
    await expect(paused.getByText('Two-step verification off')).toBeVisible();

    // The limit: lower it to 3 (it cannot go below the 2 Super Admins there are).
    await expect(page.getByText('2 of 4')).toBeVisible();
    await expect(page.getByLabel('Allowed Super Admins').locator('option[value="1"]')).toBeDisabled();
    await page.getByLabel('Allowed Super Admins').selectOption('3');
    await page.getByRole('button', { name: 'Save limit' }).click();
    await expect(page.getByText('Limit saved')).toBeVisible();
    await expect(page.getByText('2 of 3')).toBeVisible();

    // Nominate the nominee; the link is shown once.
    await page.getByRole('button', { name: 'Nominate a Super Admin' }).click();
    await expect(page).toHaveURL(/nominate=1/);
    const dialog = page.getByRole('dialog', { name: 'Nominate a Super Admin' });
    await expect(dialog.getByText('A Super Admin has the highest level of access')).toBeVisible();
    await dialog.getByLabel('Who should become a Super Admin?').fill('Zara');
    await dialog.getByRole('option', { name: /Zara Khan/ }).click();
    await dialog.getByLabel('Your password').fill('not-my-password');
    await dialog.getByRole('button', { name: 'Nominate Zara' }).click();
    await expect(dialog.getByRole('alert')).toContainText('That password is not correct');
    await dialog.getByLabel('Your password').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Nominate Zara' }).click();
    const sent = page.getByRole('dialog', { name: 'Nomination link ready' });
    const link = await sent.getByLabel('Nomination link').inputValue();
    expect(link).toMatch(/\/super-admin\/accept\?token=/);
    await expect(sent.getByText('Turn on two-step verification in Settings, Security')).toBeVisible();
    await sent.getByRole('button', { name: 'Done' }).click();
    await expect(page).not.toHaveURL(/nominate=1/);
    const pending = page.getByRole('list', { name: 'Nominations waiting to be accepted' });
    await expect(pending.getByText('Zara Khan')).toBeVisible();
    await expect(pending.getByText(/need to turn on two-step verification/)).toBeVisible();
    await expect(page.getByText('3 of 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nominate a Super Admin' })).toBeDisabled();

    // The nominee: signed in, asked to turn on two-step verification first, then accepts.
    const zara = await newPage(browser);
    await signIn(zara, NOMINEE);
    const path = new URL(link).pathname + new URL(link).search;
    await zara.goto(path);
    await expect(zara.getByRole('heading', { name: 'You have been nominated as a Super Admin' })).toBeVisible();
    await expect(zara.getByText('First, turn on two-step verification')).toBeVisible();
    await zara.getByRole('link', { name: 'Turn on two-step verification' }).click();
    await expect(zara).toHaveURL(/\/app\/settings#security/);
    const security = zara.locator('#security');
    await security.getByRole('button', { name: 'Turn on' }).click();
    const enrol = zara.getByRole('dialog');
    const zaraSecret = (await enrol.locator('code').innerText()).replace(/\s/g, '');
    await enrol.getByLabel('2. Enter the 6-digit code it shows').fill(totpAt(zaraSecret, step()));
    await enrol.getByRole('button', { name: 'Turn on' }).click();
    await zara.getByRole('button', { name: 'I have saved them' }).click();
    await expect(security.getByText('On', { exact: true })).toBeVisible();

    await zara.goto(path);
    await zara.getByLabel('Your password').fill(PASSWORD);
    await zara.getByRole('button', { name: 'Accept and become a Super Admin' }).click();
    await expect(zara.getByRole('heading', { name: 'You are now a Super Admin' })).toBeVisible();
    await zara.getByRole('link', { name: /Open the admin portal/ }).click();
    await expect(zara.getByRole('list', { name: 'Super Admins' }).getByRole('listitem').filter({ hasText: NOMINEE }).getByText('You', { exact: true })).toBeVisible();
    // The link is single use.
    await zara.goto(path);
    await expect(zara.getByRole('heading', { name: 'You are already a Super Admin' })).toBeVisible();

    // Someone else opening a link that is not theirs gets a plain message.
    const other = await newPage(browser);
    await signIn(other, 'employee@futuristglobal.com');
    await other.goto(path);
    await expect(other.getByRole('heading', { name: 'This nomination link is not valid' })).toBeVisible();
    await other.goto('/super-admin/accept');
    await expect(other.getByRole('heading', { name: 'This link is incomplete' })).toBeVisible();
    await other.context().close();

    // Remove the new Super Admin's authority (password confirmed, clear warning).
    await page.reload();
    const row = page.getByRole('list', { name: 'Super Admins' }).getByRole('listitem').filter({ hasText: NOMINEE });
    await expect(row.getByText('Active', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: /Remove Zara Khan's Super Admin authority/ }).click();
    await expect(page).toHaveURL(/remove=/);
    const remove = page.getByRole('dialog', { name: /Remove Zara Khan's Super Admin authority/ });
    await expect(remove.getByText(/They lose full control straight away/)).toBeVisible();
    await remove.getByLabel('Your password').fill(PASSWORD);
    await remove.getByRole('button', { name: 'Remove authority' }).click();
    await expect(page.getByText('Zara Khan is no longer a Super Admin')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Super Admins' }).getByText(NOMINEE)).toHaveCount(0);

    // Withdraw a nomination.
    await page.getByRole('button', { name: 'Nominate a Super Admin' }).click();
    const again = page.getByRole('dialog', { name: 'Nominate a Super Admin' });
    await again.getByLabel('Who should become a Super Admin?').fill('Rahul');
    await again.getByRole('option', { name: /Rahul Desai/ }).click();
    await again.getByLabel('Your password').fill(PASSWORD);
    await again.getByRole('button', { name: 'Nominate Rahul' }).click();
    await page.getByRole('dialog', { name: 'Nomination link ready' }).getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Withdraw the nomination for Rahul Desai' }).click();
    await page.getByRole('dialog', { name: /Withdraw Rahul Desai's nomination/ }).getByRole('button', { name: 'Withdraw' }).click();
    await expect(page.getByText('Nomination withdrawn. The link no longer works.')).toBeVisible();
    await expect(page.getByText('No nominations waiting')).toBeVisible();

    // Put things back: the limit, and the nominee's two-step verification (allowed now they are not a Super Admin).
    await page.getByLabel('Allowed Super Admins').selectOption('4');
    await page.getByRole('button', { name: 'Save limit' }).click();
    await expect(page.getByText('2 of 4')).toBeVisible();
    await zara.goto('/app/settings');
    await zara.locator('#security').getByRole('button', { name: 'Turn off' }).click();
    await zara.getByRole('dialog').getByRole('button', { name: 'Turn off' }).click();
    await expect(zara.locator('#security').getByText('Off', { exact: true })).toBeVisible();
    await zara.context().close();
  });
});
