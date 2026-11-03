import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, signIn } from './helpers';

/** RFC 6238 code for a base32 secret (what an authenticator app shows). */
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

/** Signs in again from the saved account on this device (the earlier sign-in remembered it). */
async function passwordStep(page: Page, email: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(email) }).first().click();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('two-step verification: turn on, sign in with a code or recovery code, see devices, turn off', async ({ page }) => {
  const email = 'tara.joshi@futuristglobal.com';
  await signIn(page, email);
  await page.goto('/app/settings');
  const security = page.locator('#security');
  await expect(security.getByText('Signed-in devices')).toBeVisible();
  await expect(security.getByText('This device')).toBeVisible();

  await security.getByRole('button', { name: 'Turn on' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByAltText('QR code for your authenticator app')).toBeVisible();
  const secret = (await dialog.locator('code').innerText()).replace(/\s/g, '');
  await dialog.getByLabel('2. Enter the 6-digit code it shows').fill('000000');
  await dialog.getByRole('button', { name: 'Turn on' }).click();
  await expect(dialog.getByText(/not correct/)).toBeVisible();
  await dialog.getByLabel('2. Enter the 6-digit code it shows').fill(totp(secret));
  await dialog.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByRole('dialog', { name: 'Save your recovery codes' })).toBeVisible();
  const codes = (await page.getByRole('list', { name: 'Recovery codes' }).innerText()).split('\n').filter(Boolean);
  expect(codes).toHaveLength(10);
  await page.getByRole('button', { name: 'I have saved them' }).click();
  await expect(security.getByText('On', { exact: true })).toBeVisible();

  // A new sign-in stops at the code step. The enrolment code was just used, so use a recovery code.
  await page.context().clearCookies();
  await passwordStep(page, email);
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await page.getByLabel('Code').fill('111111');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByText(/That code is not correct/)).toBeVisible();
  await page.getByRole('button', { name: 'Use a recovery code' }).click();
  await page.getByLabel('Recovery code').fill(codes[0]!);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/app\/home/);

  // Clean up so the run can repeat: turn it off (fresh sign-in, so no extra confirmation needed).
  await page.goto('/app/settings');
  await expect(security.getByText('9 recovery codes left', { exact: false })).toBeVisible();
  await security.getByRole('button', { name: 'Turn off' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Turn off' }).click();
  await expect(security.getByText('Off', { exact: true })).toBeVisible();
});
