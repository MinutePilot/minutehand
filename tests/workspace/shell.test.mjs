// Browser tests for workspace.html (step 1, the shell).
// Run with: cd tests/workspace && npm install && npm test
import assert from 'node:assert/strict';
import { browser, open, test, finish, visible, STORAGE_KEY } from './harness.mjs';

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

await finish('WORKSPACE SHELL');
