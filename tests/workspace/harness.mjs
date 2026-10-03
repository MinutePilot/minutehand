// Shared set-up for the workspace browser tests.
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

export const root = path.resolve(import.meta.dirname, '../..');
const umd = path.resolve(import.meta.dirname, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js');
const SUPABASE_URL = fs.readFileSync(path.join(root, 'config.js'), 'utf8').match(/supabaseUrl:\s*'([^']+)'/)[1];
const SUPABASE_HOST = new URL(SUPABASE_URL).host;
export const STORAGE_KEY = `sb-${SUPABASE_HOST.split('.')[0]}-auth-token`;

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


// The roster table: reads, inserts, updates and deletes against an in-memory list.
// s.rosterFail = 'network' | 'permission' | 'server' makes WRITES fail; s.rosterReadFail makes reads fail.
function rosterApi(route, req, url, s, seen) {
  const method = req.method();
  const eq = (col) => { const v = url.searchParams.get(col); return v?.startsWith('eq.') ? v.slice(3) : null; };
  if (method === 'GET') {
    if (s.rosterReadFail) return route.abort('failed');
    const rows = s.roster.filter((m) => !eq('org_id') || eq('org_id') === s.org.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    return json(route, rows);
  }
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  seen.rosterWrites.push({ method, id: eq('id'), body });
  if (s.rosterFail === 'network') return route.abort('failed');
  if (s.rosterFail === 'permission') return json(route, { code: '42501', message: 'new row violates row-level security policy for table "roster"' }, 403);
  if (s.rosterFail === 'server') return json(route, { code: 'XX000', message: 'internal error' }, 500);
  if (method === 'POST') {
    const row = { status: 'active', created_at: new Date().toISOString(), ...body, id: `m${s.roster.length + 100}` };
    s.roster.push(row);
    return route.fulfill({ status: 201, headers: cors });
  }
  const target = s.roster.find((m) => m.id === eq('id'));
  if (method === 'PATCH') { if (target) Object.assign(target, body); return route.fulfill({ status: 204, headers: cors }); }
  if (method === 'DELETE') { s.roster = s.roster.filter((m) => m.id !== eq('id')); return route.fulfill({ status: 204, headers: cors }); }
  return json(route, { message: 'unexpected roster call' }, 500);
}

export async function open(browser, scenario = {}, { viewport = { width: 1280, height: 800 }, signedIn = true } = {}) {
  const s = { org: { id: 'org-1', name: 'Parkview Terrace Strata' }, role: 'owner', beta: true,
              password: 'correct-horse', roster: [], ...scenario };
  s.roster = s.roster.map((m, i) => ({ role: 'Director', strata_lot: null, email: null, term_start: null,
                                       term_end: null, status: 'active', sort_order: i, ...m,
                                       id: m.id ?? `m${i + 1}`, created_at: `2026-01-01T00:00:0${i}Z` }));
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const seen = { tokenPosts: 0, orgCalls: 0, errors: [], pageErrors: [], rosterWrites: [] };
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
    if (url.pathname === '/rest/v1/roster') return rosterApi(route, req, url, s, seen);
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



export 
// ── a small test runner ──────────────────────────────────────────────────────
const exe = process.env.CHROMIUM_PATH
  ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
export const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });

let passed = 0;
export async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`); await browser.close(); server.close(); process.exit(1); }
}
export async function finish(label) {
  console.log(`\nALL ${passed} ${label} CHECKS PASSED`);
  await browser.close();
  server.close();
}

export const visible = (page, sel) => page.locator(sel).isVisible();
