// Browser tests for workspace.html (step 1, the shell).
// Run with: cd tests/workspace && npm install && npm test
//
// A real browser opens the real page, served from this repository. The only fakes
// are the network: the Supabase library is served from node_modules instead of the
// CDN, and every request to the Supabase project is answered by this file.
// Set CHROMIUM_PATH to a Chrome or Chromium binary if Playwright has none installed.

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '../..');
const umd = path.resolve(import.meta.dirname, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js');
const SUPABASE_URL = fs.readFileSync(path.join(root, 'config.js'), 'utf8').match(/supabaseUrl:\s*'([^']+)'/)[1];
const SUPABASE_HOST = new URL(SUPABASE_URL).host;
const STORAGE_KEY = `sb-${SUPABASE_HOST.split('.')[0]}-auth-token`;

// ── a tiny static server for the repository ──────────────────────────────────
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ── a pretend Supabase ───────────────────────────────────────────────────────
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};
const json = (route, body, status = 200) =>
  route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });

const user = (email = 'secretary@example.test') => ({
  id: 'user-1', email, aud: 'authenticated', role: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
});
const session = (email) => {
  const now = Math.floor(Date.now() / 1000);
  return { access_token: 'fake.access.token', refresh_token: 'fake-refresh', token_type: 'bearer',
           expires_in: 3600, expires_at: now + 3600, user: user(email) };
};

async function open(browser, scenario = {}, { viewport = { width: 1280, height: 800 }, signedIn = true } = {}) {
  const s = { org: { id: 'org-1', name: 'Parkview Terrace Strata' }, role: 'owner', beta: true,
              password: 'correct-horse', ...scenario };
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const seen = { tokenPosts: 0, orgCalls: 0, errors: [], pageErrors: [] };
  page.on('console', (m) => { if (m.type() === 'error') seen.errors.push(m.text()); });
  page.on('pageerror', (e) => seen.pageErrors.push(String(e)));

  await page.route('https://cdn.jsdelivr.net/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(umd) }));

  await page.route(`https://${SUPABASE_HOST}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

    if (url.pathname === '/auth/v1/token') {
      seen.tokenPosts++;
      const body = JSON.parse(req.postData() ?? '{}');
      if (body.password !== s.password) {
        return json(route, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials' }, 400);
      }
      return json(route, session(body.email));
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/auth/v1/user') return json(route, user());

    if (url.pathname === '/rest/v1/org_members') {
      seen.orgCalls++;
      if (s.failOrg) return route.abort('failed');
      return json(route, s.org ? [{ role: s.role, organizations: s.org }] : []);
    }
    if (url.pathname === '/rest/v1/workspace_beta') {
      return json(route, s.beta ? [{ org_id: s.org.id }] : []);
    }
    return json(route, { message: `unexpected request: ${url.pathname}` }, 500);
  });

  if (signedIn) {
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session())]);
  }
  await page.goto(`${BASE}/workspace.html`);
  return { page, ctx, seen, s };
}

const visible = (page, sel) => page.locator(sel).isVisible();

// ── the tests ────────────────────────────────────────────────────────────────
const exe = process.env.CHROMIUM_PATH
  ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`); await browser.close(); server.close(); process.exit(1); }
}

console.log('Signed out');
await test('a signed-out visitor sees the sign-in form and nothing else', async () => {
  const { page, ctx } = await open(browser, {}, { signedIn: false });
  await page.waitForSelector('#signin-form:visible');
  assert.equal(await visible(page, '#app'), false);
  assert.equal(await page.locator('meta[name=robots]').getAttribute('content'), 'noindex, nofollow');
  await ctx.close();
});

await test('a wrong password gets a plain-language message, not a technical one', async () => {
  const { page, ctx } = await open(browser, {}, { signedIn: false });
  await page.fill('#signin-email', 'secretary@example.test');
  await page.fill('#signin-password', 'nope');
  await page.click('#signin-submit');
  await page.waitForSelector('#signin-error:visible');
  const text = await page.locator('#signin-error').innerText();
  assert.match(text, /email and password do not match/i);
  assert.doesNotMatch(text, /invalid_grant|400|AuthApiError/);
  assert.equal(await visible(page, '#app'), false);
  await ctx.close();
});

await test('an empty form is told what to do, with no request sent', async () => {
  const { page, ctx, seen } = await open(browser, {}, { signedIn: false });
  await page.click('#signin-submit');
  await page.waitForSelector('#signin-error:visible');
  assert.match(await page.locator('#signin-error').innerText(), /Enter your email and password/);
  assert.equal(seen.tokenPosts, 0);
  await ctx.close();
});

await test('double-clicking Sign in sends one request', async () => {
  const { page, ctx, seen } = await open(browser, {}, { signedIn: false });
  await page.fill('#signin-email', 'secretary@example.test');
  await page.fill('#signin-password', 'correct-horse');
  await page.dblclick('#signin-submit');
  await page.waitForSelector('#app:visible');
  assert.equal(seen.tokenPosts, 1);
  await ctx.close();
});

console.log('Signed in');
await test('signing in with the right password opens the workspace', async () => {
  const { page, ctx, seen } = await open(browser, {}, { signedIn: false });
  await page.fill('#signin-email', 'secretary@example.test');
  await page.fill('#signin-password', 'correct-horse');
  await page.click('#signin-submit');
  await page.waitForSelector('#app:visible');
  assert.equal(await page.locator('#org-name').innerText(), 'Parkview Terrace Strata');
  assert.equal(seen.pageErrors.length, 0);
  await ctx.close();
});

await test('an existing session goes straight to the workspace with all three panes', async () => {
  const { page, ctx, seen } = await open(browser);
  await page.waitForSelector('#app:visible');
  for (const sel of ['#pane-menu', '#pane-chat', '#pane-doc']) {
    const box = await page.locator(sel).boundingBox();
    assert.ok(box && box.width > 100 && box.height > 100, `${sel} is on screen`);
  }
  assert.equal(await visible(page, '.pane-tabs'), false, 'no tab bar on a wide screen');
  assert.deepEqual(seen.pageErrors, []);
  assert.deepEqual(seen.errors, []);
  await ctx.close();
});

await test('the minutes pane is a real editor and the chat is switched off for now', async () => {
  const { page, ctx } = await open(browser);
  await page.waitForSelector('#app:visible');
  await page.click('#editor .ProseMirror');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Called to order at 7:00 PM.');
  assert.match(await page.locator('#editor .ProseMirror').innerText(), /Called to order at 7:00 PM\./);
  assert.equal(await page.locator('#chat-input').isDisabled(), true);
  await ctx.close();
});

await test('an owner sees no warning, a plain member is told about deleting', async () => {
  let t = await open(browser, { role: 'owner' });
  await t.page.waitForSelector('#app:visible');
  assert.equal(await visible(t.page, '#role-banner'), false);
  await t.ctx.close();
  t = await open(browser, { role: 'member' });
  await t.page.waitForSelector('#app:visible');
  assert.match(await t.page.locator('#role-banner').innerText(), /only an admin can delete/);
  await t.ctx.close();
  t = await open(browser, { role: 'admin' });
  await t.page.waitForSelector('#app:visible');
  assert.equal(await visible(t.page, '#role-banner'), false);
  await t.ctx.close();
});

await test('signing out returns to the sign-in form and forgets the session', async () => {
  const { page, ctx } = await open(browser);
  await page.waitForSelector('#app:visible');
  await page.click('#signout-btn');
  await page.waitForSelector('#signin-form:visible');
  assert.equal(await visible(page, '#app'), false);
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY), null);
  await ctx.close();
});

console.log('People who should not get in, and things going wrong');
await test('an organization that is not switched on is told so, and does not see the workspace', async () => {
  const { page, ctx } = await open(browser, { beta: false });
  await page.waitForSelector('#state-message:visible');
  assert.match(await page.locator('#message-title').innerText(), /not switched on/);
  assert.match(await page.locator('#message-body').innerText(), /Parkview Terrace Strata/);
  assert.equal(await visible(page, '#app'), false);
  assert.equal(await page.locator('#editor .ProseMirror').count(), 0, 'the editor was never built');
  await ctx.close();
});

await test('an account with no organization is pointed to the main page', async () => {
  const { page, ctx } = await open(browser, { org: null });
  await page.waitForSelector('#state-message:visible');
  assert.match(await page.locator('#message-title').innerText(), /not part of an organization/);
  assert.equal(await page.locator('#message-actions a').first().getAttribute('href'), 'app.html');
  assert.equal(await visible(page, '#app'), false);
  await ctx.close();
});

await test('a dropped connection shows a plain message, and Try again recovers', async () => {
  // The Supabase library retries a failed read a few times by itself, so keep it failing.
  const { page, ctx, s } = await open(browser, { failOrg: true });
  await page.waitForSelector('#state-message:visible');
  const text = await page.locator('#state-message').innerText();
  assert.match(text, /could not load your workspace/i);
  assert.match(text, /connection problem/i);
  assert.doesNotMatch(text, /TypeError|Failed to fetch|NetworkError/);
  s.failOrg = false;                       // the connection comes back
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.waitForSelector('#app:visible');
  await ctx.close();
});

await test('an organization name with HTML in it is shown as text and runs nothing', async () => {
  const name = '<img src=x onerror="window.__xss=1">Evil Strata';
  const { page, ctx } = await open(browser, { org: { id: 'org-1', name }, role: 'member' });
  await page.waitForSelector('#app:visible');
  assert.equal(await page.locator('#org-name').innerText(), name);
  assert.match(await page.locator('#role-banner').innerText(), /<img src=x/);
  assert.equal(await page.locator('#app img[src="x"]').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await ctx.close();
});

console.log('On a phone');
await test('only one pane shows at a time, the tabs switch between them, and nothing scrolls sideways', async () => {
  const { page, ctx } = await open(browser, {}, { viewport: { width: 390, height: 780 } });
  await page.waitForSelector('#app:visible');
  assert.equal(await visible(page, '.pane-tabs'), true);
  const only = async (shown) => {
    for (const p of ['menu', 'chat', 'doc']) {
      assert.equal(await visible(page, `#pane-${p}`), p === shown, `${p} pane ${p === shown ? 'shows' : 'hides'} when ${shown} is selected`);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `no sideways scroll on the ${shown} pane (${overflow}px over)`);
  };
  await only('doc');
  await page.click('.pane-tabs [data-pane=chat]');
  await only('chat');
  await page.click('.pane-tabs [data-pane=menu]');
  await only('menu');
  await page.click('.pane-tabs [data-pane=doc]');
  await only('doc');
  assert.equal(await page.locator('.pane-tabs [data-pane=doc]').getAttribute('aria-selected'), 'true');
  await ctx.close();
});

console.log(`\nALL ${passed} WORKSPACE SHELL CHECKS PASSED`);
await browser.close();
server.close();
