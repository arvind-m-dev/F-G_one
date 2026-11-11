import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { PASSWORD, signIn } from './helpers';

/**
 * QA flows for chat, announcements, notifications, profile, settings and the phone layout.
 * Every test creates its own channels, messages and announcements (unique names), so the
 * file can run repeatedly against the same seed.
 */
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function as(browser: Browser, email: string, contextOptions: Parameters<Browser['newContext']>[0] = {}) {
  const ctx = await browser.newContext(contextOptions);
  const page = await ctx.newPage();
  await signIn(page, email);
  return page;
}

async function api<T = unknown>(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, data?: unknown): Promise<{ status: number; body: T }> {
  const res = await page.request.fetch(`/api${path}`, { method, data, headers: { 'content-type': 'application/json' } });
  const text = await res.text();
  return { status: res.status(), body: (text ? JSON.parse(text) : null) as T };
}

const meId = async (page: Page) => (await api<{ user: { id: string } }>(page, 'GET', '/auth/me')).body.user.id;

async function openConversation(page: Page, channelId: string) {
  await page.goto(`/app/chat/${channelId}`);
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
}

async function send(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: 'Message' }).last();
  await box.fill(text);
  await box.press('Enter');
}

const message = (page: Page, text: string) => page.getByTestId('message').filter({ hasText: text });

async function messageAction(page: Page, text: string, action: string) {
  const m = message(page, text).first();
  await m.hover();
  await m.getByRole('button', { name: 'Message actions' }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

test.describe('chat', () => {
  test('create a private channel, edit the topic, message, edit, react, thread, delete and leave', async ({ browser }) => {
    const emp = await as(browser, 'employee@futuristglobal.com', { permissions: ['clipboard-read', 'clipboard-write'] });
    const name = `qa-private-${uid()}`;
    await emp.goto('/app/chat');
    await emp.getByRole('button', { name: 'Create channel', exact: true }).first().click();
    const dialog = emp.getByRole('dialog');
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('radio', { name: /Private/ }).click();
    await dialog.getByLabel('Search people').fill('Rohan');
    await dialog.getByRole('option', { name: /Rohan Verma/ }).click();
    // choosing a member must not submit the form
    await expect(dialog.getByRole('button', { name: 'Remove Rohan Verma' })).toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Create channel' }).click();
    await expect(emp.getByRole('heading', { name: `Welcome to #${name}` })).toBeVisible();
    const channelId = emp.url().split('/app/chat/')[1]!.split(/[?#]/)[0]!;

    // topic via the details panel
    await emp.getByRole('button', { name: 'Channel details' }).click();
    await emp.getByRole('button', { name: 'Edit channel' }).click();
    await emp.getByLabel('Topic').fill('Launch planning');
    await emp.getByRole('button', { name: 'Save' }).click();
    await expect(emp.getByText('Launch planning').first()).toBeVisible();
    await emp.getByRole('button', { name: 'Close details' }).click();

    // send, edit
    const text = `first message ${uid()}`;
    await send(emp, text);
    await expect(message(emp, text)).toBeVisible();
    await messageAction(emp, text, 'Edit message');
    const editor = message(emp, text).getByRole('textbox');
    await editor.fill(`${text} (updated)`);
    await editor.press('Enter');
    await expect(message(emp, `${text} (updated)`)).toContainText('(edited)');

    // react, then undo
    await message(emp, text).hover();
    await message(emp, text).getByRole('button', { name: 'Agree' }).click();
    await expect(message(emp, text).getByRole('button', { name: 'Agree 1' })).toHaveAttribute('aria-pressed', 'true');
    await message(emp, text).getByRole('button', { name: 'Agree 1' }).click();
    await expect(message(emp, text).getByRole('button', { name: /Agree 1/ })).toHaveCount(0);

    // thread reply, reply count, link to the reply opens the thread
    await message(emp, text).hover();
    await message(emp, text).getByRole('button', { name: 'Reply in thread' }).click();
    await expect(emp).toHaveURL(/thread=/);
    const reply = `thread reply ${uid()}`;
    await send(emp, reply);
    await expect(emp.getByRole('complementary').getByText(reply)).toBeVisible();
    await expect(message(emp, text).getByRole('button', { name: '1 reply' })).toBeVisible();
    await messageAction(emp, reply, 'Copy link');
    const link = await emp.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain(`/app/chat/${channelId}?thread=`);
    await emp.goto(link);
    await expect(emp.getByRole('complementary').getByText(reply)).toBeVisible();
    await emp.getByRole('button', { name: 'Close thread' }).click();

    // a copied link to a channel message scrolls to it and highlights it
    await messageAction(emp, text, 'Copy link');
    const msgLink = await emp.evaluate(() => navigator.clipboard.readText());
    expect(msgLink).toMatch(new RegExp(`/app/chat/${channelId}#m-`));
    await emp.goto('/app/home');
    await emp.goto(msgLink);
    await expect(message(emp, text)).toHaveAttribute('data-highlight', 'true');

    // delete
    const doomed = `delete me ${uid()}`;
    await send(emp, doomed);
    await expect(message(emp, doomed)).toBeVisible();
    await messageAction(emp, doomed, 'Delete message');
    // deleting asks first
    await emp.getByRole('dialog', { name: 'Delete this message?' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(emp.getByText('This message was deleted.')).toBeVisible();

    // the only admin cannot leave while Rohan is still here
    await emp.getByRole('button', { name: 'Channel details' }).click();
    await emp.getByRole('button', { name: 'Leave channel' }).click();
    await emp.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(emp.getByText('Assign another admin before removing the last one')).toBeVisible();
    await emp.context().close();
  });

  test('realtime between two people: typing, delivery, edits, deletion, and removal ends access', async ({ browser }) => {
    const emp = await as(browser, 'employee@futuristglobal.com');
    const mgr = await as(browser, 'manager@futuristglobal.com');
    const mgrId = await meId(mgr);
    const ch = await api<{ id: string }>(emp, 'POST', '/channels', { name: `qa-rt-${uid()}`, visibility: 'PRIVATE', memberIds: [mgrId] });
    expect(ch.status).toBe(201);
    await openConversation(emp, ch.body.id);
    await openConversation(mgr, ch.body.id);
    await expect(mgr.getByTitle('Live updates connected')).toBeVisible();

    const box = emp.getByRole('textbox', { name: 'Message' });
    await box.click();
    await box.pressSequentially('hel', { delay: 30 });
    await expect(mgr.getByText(/is typing/)).toBeVisible();
    const text = `live ${uid()}`;
    await box.fill(text);
    await box.press('Enter');
    await expect(message(mgr, text)).toBeVisible();

    await messageAction(emp, text, 'Edit message');
    const editor = message(emp, text).getByRole('textbox');
    await editor.fill(`${text} edited`);
    await editor.press('Enter');
    await expect(message(mgr, `${text} edited`)).toContainText('(edited)');

    // the manager can neither edit nor delete someone else's message
    await message(mgr, text).hover();
    await message(mgr, text).getByRole('button', { name: 'Message actions' }).click();
    await expect(mgr.getByRole('menuitem', { name: 'Edit message' })).toHaveCount(0);
    await expect(mgr.getByRole('menuitem', { name: 'Delete message' })).toHaveCount(0);
    await mgr.keyboard.press('Escape');

    await messageAction(emp, text, 'Delete message');
    await emp.getByRole('dialog', { name: 'Delete this message?' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(mgr.getByText('This message was deleted.')).toBeVisible();

    // removal: the manager's open view loses the conversation at once
    expect((await api(emp, 'DELETE', `/channels/${ch.body.id}/members/${mgrId}`)).status).toBe(200);
    await expect(mgr.getByText("This conversation isn't available")).toBeVisible();
    await send(emp, `after removal ${uid()}`);
    await mgr.goto('/app/chat');
    await expect(mgr.getByRole('link', { name: /qa-rt-/ })).toHaveCount(0);
    await emp.context().close();
    await mgr.context().close();
  });

  test('private channels are invisible to non-members, including admins and search', async ({ browser }) => {
    const emp = await as(browser, 'employee@futuristglobal.com');
    const word = `zebra${uid()}`;
    const ch = await api<{ id: string }>(emp, 'POST', '/channels', { name: `qa-hidden-${uid()}`, visibility: 'PRIVATE', memberIds: [] });
    await api(emp, 'POST', `/channels/${ch.body.id}/messages`, { body: `${word} is the secret` });
    for (const email of ['hr@futuristglobal.com', 'admin@futuristglobal.com']) {
      const outsider = await as(browser, email);
      await outsider.goto(`/app/chat/${ch.body.id}`);
      await expect(outsider.getByText("This conversation isn't available")).toBeVisible();
      expect((await api(outsider, 'GET', `/channels/${ch.body.id}/messages`)).status).toBe(404);
      const s = await api<{ messages: unknown[]; channels: unknown[] }>(outsider, 'GET', `/search?q=${word}`);
      expect(s.body.messages).toHaveLength(0);
      await outsider.context().close();
    }
    await emp.context().close();
  });

  test('message text is shown as text, never as HTML; very long text wraps', async ({ browser }) => {
    const emp = await as(browser, 'employee@futuristglobal.com');
    let dialogs = 0;
    emp.on('dialog', (d) => {
      dialogs++;
      void d.dismiss();
    });
    const ch = await api<{ id: string }>(emp, 'POST', '/channels', { name: `qa-xss-${uid()}`, visibility: 'PRIVATE' });
    await openConversation(emp, ch.body.id);
    const payload = `<img src=x onerror=alert(1)> <script>alert(2)</script> ${uid()}`;
    await send(emp, payload);
    await expect(message(emp, payload)).toBeVisible();
    await expect(emp.locator('[data-testid="message"] img[src="x"]')).toHaveCount(0);
    const long = `${'x'.repeat(3000)}${uid()}`;
    await send(emp, long);
    await expect(message(emp, long.slice(-8))).toBeVisible();
    const overflow = await emp.getByRole('log', { name: 'Messages' }).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(dialogs).toBe(0);
    await emp.context().close();
  });

  test('a brand-new colleague can be found and messaged; history pages back', async ({ browser }) => {
    const admin = await as(browser, 'admin@futuristglobal.com');
    const roles = await api<{ roles?: { id: string; key: string }[] } | { id: string; key: string }[]>(admin, 'GET', '/roles');
    const list = Array.isArray(roles.body) ? roles.body : (roles.body.roles ?? []);
    const role = list.find((r) => r.key === 'employee')!;
    const tag = uid();
    const created = await api<{ employee: { id: string } }>(admin, 'POST', '/employees', {
      email: `qa.${tag}@futuristglobal.com`,
      firstName: 'Quinn',
      lastName: `Tester${tag}`,
      roleId: role.id,
      password: PASSWORD || 'Temp-Pass-2026-x',
    });
    expect(created.status).toBe(201);
    await admin.context().close();

    const emp = await as(browser, 'employee@futuristglobal.com');
    await emp.goto('/app/chat');
    await emp.getByRole('button', { name: 'New message' }).first().click();
    await emp.getByRole('dialog').getByLabel('Search people').fill(`Tester${tag}`);
    await emp.getByRole('option', { name: new RegExp(`Quinn Tester${tag}`) }).click();
    await emp.getByRole('button', { name: 'Open conversation' }).click();
    await expect(emp.getByRole('heading', { name: new RegExp(`Quinn Tester${tag}`) }).first()).toBeVisible();

    // 60 messages: the newest 40 load first, older ones on scroll
    const dm = emp.url().split('/app/chat/')[1]!.split(/[?#]/)[0]!;
    for (let i = 0; i < 60; i++) await api(emp, 'POST', `/channels/${dm}/messages`, { body: `page msg ${tag} n${i}.` });
    await emp.reload();
    await expect(message(emp, `page msg ${tag} n59.`)).toBeVisible();
    await expect(message(emp, `page msg ${tag} n5.`)).toHaveCount(0);
    const log = emp.getByRole('log', { name: 'Messages' });
    for (let i = 0; i < 10 && (await message(emp, `page msg ${tag} n0.`).count()) === 0; i++) {
      await log.evaluate((el) => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event('scroll'));
      });
      await emp.waitForTimeout(400);
    }
    await expect(message(emp, `page msg ${tag} n0.`)).toBeVisible();
    await expect(emp.getByText('This is the start of your conversation.')).toBeVisible();
    await emp.context().close();
  });
});

test.describe('announcements', () => {
  test('publish to one department with confirmation; others never see it, even by search', async ({ browser }) => {
    const admin = await as(browser, 'admin@futuristglobal.com');
    const title = `QA engineering notice ${uid()}`;
    await admin.goto('/admin/announcements?compose=1');
    await admin.getByLabel('Title').fill(title);
    await admin.getByLabel('Message').fill('Please read the new release checklist.');
    await admin.getByLabel('Who should see it?').selectOption({ label: 'Engineering only' });
    await admin.getByRole('switch').nth(1).click(); // ask people to confirm
    await admin.getByRole('button', { name: 'Publish' }).click();
    await expect(admin.getByText('Announcement published')).toBeVisible();
    await expect(admin.getByText(title)).toBeVisible();

    // Ananya is in Engineering
    const emp = await as(browser, 'employee@futuristglobal.com');
    await emp.goto(`/app/announcements?q=${encodeURIComponent(title)}`);
    await emp.getByRole('button', { name: new RegExp(title) }).click();
    await emp.getByRole('button', { name: "I've read this" }).click();
    await expect(emp.getByText(/You confirmed you read this/)).toBeVisible();

    // HR (Human Resources) manages announcements and sees it; a non-manager outside Engineering does not
    const outsider = await as(browser, 'meera.nair@futuristglobal.com');
    const dept = (await api<{ user: { department?: { name: string } } }>(outsider, 'GET', '/auth/me')).body.user.department?.name;
    if (dept !== 'Engineering') {
      await outsider.goto(`/app/announcements?q=${encodeURIComponent(title)}`);
      await expect(outsider.getByText('No announcements match')).toBeVisible();
      const list = await api<{ id: string }[]>(outsider, 'GET', `/announcements?q=${encodeURIComponent(title)}`);
      expect(list.body).toHaveLength(0);
    }
    await outsider.context().close();

    await admin.reload();
    const row = admin.getByRole('listitem').filter({ hasText: title });
    await row.getByRole('button', { name: /1 confirmed/ }).click();
    await expect(admin.getByRole('dialog').getByText('Ananya Iyer')).toBeVisible();
    await admin.keyboard.press('Escape');

    // edit then delete; the reader shows a clear message for a removed announcement
    await row.getByRole('button', { name: `Actions for ${title}` }).click();
    await admin.getByRole('menuitem', { name: 'Edit' }).click();
    await admin.getByLabel('Title').fill(`${title} v2`);
    await admin.getByRole('button', { name: 'Save changes' }).click();
    await expect(admin.getByText(`${title} v2`)).toBeVisible();
    const id = (await api<{ id: string; title: string }[]>(admin, 'GET', `/announcements?q=${encodeURIComponent(title)}`)).body[0]!.id;
    await admin.getByRole('listitem').filter({ hasText: `${title} v2` }).getByRole('button', { name: /Actions for/ }).click();
    await admin.getByRole('menuitem', { name: 'Delete' }).click();
    await admin.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).or(admin.getByRole('dialog').getByRole('button', { name: 'Delete' })).first().click();
    await expect(admin.getByText('Announcement deleted')).toBeVisible();
    await emp.goto(`/app/announcements?open=${id}`);
    await expect(emp.getByText("This announcement isn't available")).toBeVisible();
    await admin.context().close();
    await emp.context().close();
  });

  test('category filter and search keep their state in the address', async ({ page }) => {
    await signIn(page, 'employee@futuristglobal.com');
    await page.goto('/app/announcements');
    await page.getByRole('radio', { name: 'Event' }).click();
    await expect(page).toHaveURL(/category=EVENT/);
    await page.getByLabel('Search announcements').fill('nothing-matches-this-qa');
    await expect(page).toHaveURL(/q=nothing-matches-this-qa/);
    await expect(page.getByText('Try another search or category.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Event' })).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('notifications, settings and profile', () => {
  test('a direct message rings the bell; open it, mark all read; a muted type stays silent', async ({ browser }) => {
    const emp = await as(browser, 'employee@futuristglobal.com');
    const mgr = await as(browser, 'manager@futuristglobal.com');
    await api(emp, 'POST', '/notifications/read', { all: true });
    await api(emp, 'PATCH', '/me/preferences', { notifications: { dm: true, mentions: true, threads: true, announcements: true, requests: true } });
    const dm = await api<{ id: string }>(mgr, 'POST', '/dm', { userIds: [await meId(emp)] });
    await emp.goto('/app/home');
    const text = `bell ${uid()}`;
    await api(mgr, 'POST', `/channels/${dm.body.id}/messages`, { body: text });
    const bell = emp.getByRole('button', { name: /Notifications/ }).first();
    await bell.click();
    const inbox = emp.getByRole('dialog');
    await expect(inbox.getByText(text)).toBeVisible();
    await emp.getByRole('tab', { name: /Unread/ }).click();
    await expect(inbox.getByText(text)).toBeVisible();
    await emp.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(inbox.getByText("You're all caught up")).toBeVisible();
    await emp.keyboard.press('Escape');

    // turn direct messages off in Settings: no new notification
    await emp.goto('/app/settings#notifications');
    const sw = emp.getByRole('switch', { name: 'Direct messages' });
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await emp.reload();
    await expect(emp.getByRole('switch', { name: 'Direct messages' })).toHaveAttribute('aria-checked', 'false');
    await expect(emp.getByRole('switch', { name: 'Mentions' })).toHaveAttribute('aria-checked', 'true');
    await api(mgr, 'POST', `/channels/${dm.body.id}/messages`, { body: `silent ${uid()}` });
    await emp.waitForTimeout(500);
    expect((await api<{ unread: number }>(emp, 'GET', '/notifications/unread-count')).body.unread).toBe(0);
    await emp.getByRole('switch', { name: 'Direct messages' }).click();
    await expect(emp.getByRole('switch', { name: 'Direct messages' })).toHaveAttribute('aria-checked', 'true');
    await emp.context().close();
    await mgr.context().close();
  });

  test('profile rejects a non-web photo link and keeps markup as plain text', async ({ page }) => {
    await signIn(page, 'employee@futuristglobal.com');
    await page.goto('/app/profile');
    await page.getByLabel('Photo URL (optional)').fill('javascript:alert(1)');
    await page.getByRole('button', { name: /Save/ }).first().click();
    await expect(page.getByText(/starts with https/)).toBeVisible();
    await page.getByLabel('Photo URL (optional)').fill('');
    const res = await api(page, 'PATCH', '/me/profile', { bio: '<b>bold?</b> plain text' });
    expect(res.status).toBe(200);
    await page.goto(`/app/people/${await meId(page)}`);
    await expect(page.getByText('<b>bold?</b> plain text')).toBeVisible();
    await api(page, 'PATCH', '/me/profile', { bio: null });
  });
});

const { defaultBrowserType: _ignored, ...pixel7 } = devices['Pixel 7'];
test.describe('phone layout', () => {
  test.use(pixel7);

  test('details panel opens over the conversation; tapping a message shows its actions', async ({ page }) => {
    await signIn(page, 'employee@futuristglobal.com');
    const ch = await api<{ id: string }>(page, 'POST', '/channels', { name: `qa-phone-${uid()}`, visibility: 'PRIVATE' });
    await openConversation(page, ch.body.id);
    const text = `tap me ${uid()}`;
    await send(page, text);
    await expect(message(page, text)).toBeVisible();
    await message(page, text).tap();
    await message(page, text).getByRole('button', { name: 'Agree' }).tap();
    await expect(message(page, text).getByRole('button', { name: 'Agree 1' })).toBeVisible();

    await page.getByRole('button', { name: 'Channel details' }).tap();
    const panel = page.getByRole('complementary', { name: 'Conversation details' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Leave channel' })).toBeVisible();
    const box = await panel.boundingBox();
    expect(box!.width).toBeGreaterThan(300);
    await panel.getByRole('button', { name: 'Close details' }).tap();
    await expect(panel).toHaveCount(0);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(scroll).toBeLessThanOrEqual(1);
  });
});
