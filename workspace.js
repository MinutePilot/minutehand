// MinuteHand workspace: step 1, the shell.
// Signs the user in, finds their organization, checks the beta switch, and shows
// the three panes (menu, chat, and the main area). The chat is a placeholder here.
// All text from the database is written with textContent, never as HTML.

const supabaseClient = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

const $ = (id) => document.getElementById(id);

const states = ['loading', 'signin', 'message'].map((n) => ({ name: n, el: $(`state-${n}`) }));
const appEl = $('app');

let shownForUserId = null;   // stops token refreshes from rebuilding the screen
let busy = false;

// ── Which screen is showing ──────────────────────────────────────────────────

function showState(name) {
  states.forEach((s) => s.el.classList.toggle('hidden', s.name !== name));
  appEl.classList.add('hidden');
}

function showApp() {
  states.forEach((s) => s.el.classList.add('hidden'));
  appEl.classList.remove('hidden');
}

function showMessage(title, body, actions = []) {
  $('message-title').textContent = title;
  $('message-body').textContent = body;
  const box = $('message-actions');
  box.replaceChildren();
  actions.forEach((a) => {
    const el = document.createElement(a.href ? 'a' : 'button');
    el.textContent = a.label;
    el.className = a.primary ? 'btn-primary' : 'btn-ghost';
    if (a.href) el.href = a.href;
    else { el.type = 'button'; el.addEventListener('click', a.onClick); }
    box.appendChild(el);
  });
  showState('message');
}

const TRY_AGAIN = { label: 'Try again', primary: true, onClick: () => start() };
const SIGN_OUT  = { label: 'Sign out', onClick: () => signOut() };

// ── Start up ─────────────────────────────────────────────────────────────────

async function start() {
  if (busy) return;
  busy = true;
  showState('loading');
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (!data.session) { shownForUserId = null; showState('signin'); return; }
    await loadWorkspace(data.session.user);
  } catch (err) {
    console.error(err);
    showMessage(
      'We could not load your workspace',
      'This is usually a connection problem. Check that you are online and try again.',
      [TRY_AGAIN, SIGN_OUT]
    );
  } finally {
    busy = false;
  }
}

async function loadWorkspace(user) {
  // The organization this user belongs to, and their role in it.
  const { data: rows, error: orgError } = await supabaseClient
    .from('org_members')
    .select('role, organizations(id, name, org_type)')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: true })
    .limit(1);
  if (orgError) throw orgError;

  const membership = rows?.[0];
  const org = membership?.organizations;
  if (!org) {
    showMessage(
      'Your account is not part of an organization yet',
      'The workspace needs an organization to put your meetings in. You can set one up from the main page.',
      [{ label: 'Open the main page', href: 'app.html', primary: true }, SIGN_OUT]
    );
    return;
  }

  // The beta switch: nobody can set this from the browser, so only organizations
  // that have been switched on get through.
  const { data: beta, error: betaError } = await supabaseClient
    .from('workspace_beta')
    .select('org_id')
    .eq('org_id', org.id)
    .maybeSingle();
  if (betaError) throw betaError;
  if (!beta) {
    showMessage(
      'The workspace is not switched on for your organization yet',
      `The new workspace is in early testing, and ${org.name} has not been added. Email hello@minutehand.ca and we will switch it on.`,
      [{ label: 'Email us', href: 'mailto:hello@minutehand.ca', primary: true }, SIGN_OUT]
    );
    return;
  }

  renderApp(user, org, membership.role);
}

// ── The workspace itself ─────────────────────────────────────────────────────

function renderApp(user, org, role) {
  $('org-name').textContent = org.name;
  $('user-email').textContent = user.email ?? '';

  const banner = $('role-banner');
  const canManage = role === 'owner' || role === 'admin';
  if (canManage) {
    banner.classList.add('hidden');
  } else {
    banner.textContent = `You are a member of ${org.name}, not an admin. You can add and edit, but only an admin can delete. Ask your organization owner to make you an admin if you are the secretary.`;
    banner.classList.remove('hidden');
  }

  showApp();
  shownForUserId = user.id;
  Roster.init({ client: supabaseClient, orgId: org.id, canManage });
  Meetings.init({
    client: supabaseClient, orgId: org.id, orgType: org.org_type ?? 'STRATA',
    userId: user.id, canManage, go: setView, openMinutes: (id) => Minutes.open(id),
  });
  Minutes.init({
    client: supabaseClient, orgId: org.id, canManage, go: setView, openMeeting: (id) => Meetings.openMeeting(id),
  });
  setView('meetings');
}

// ── Panes (on a phone only one shows at a time) ──────────────────────────────

function setPane(name) {
  appEl.dataset.pane = name;
  document.querySelectorAll('.pane-tabs [role="tab"]').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.pane === name));
  });
}

document.querySelectorAll('.pane-tabs [role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => setPane(tab.dataset.pane));
});

// ── What the main area shows: the meetings, one meeting, or the roster ──────

const VIEW_LABELS = { meetings: 'Meetings', meeting: 'Meeting', minutes: 'Minutes', roster: 'Roster' };
const MENU_FOR = { meetings: 'meetings', meeting: 'meetings', minutes: 'meetings', roster: 'roster' };

function setView(name) {
  Object.keys(VIEW_LABELS).forEach((v) => $(`view-${v}`).classList.toggle('hidden', v !== name));
  document.querySelectorAll('.menu-item[data-view]').forEach((b) => {
    const current = b.dataset.view === MENU_FOR[name];
    b.classList.toggle('is-current', current);
    if (current) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.querySelector('.pane-tabs [data-pane="doc"]').textContent = VIEW_LABELS[name];
  setPane('doc');                       // on a phone, jump to the main area
  if (name === 'meetings') Meetings.openList();
  if (name === 'roster') Roster.open();
}

document.querySelectorAll('.menu-item[data-view]').forEach((b) => {
  b.addEventListener('click', () => setView(b.dataset.view));
});

// ── Sign in and out ──────────────────────────────────────────────────────────

const signinForm = $('signin-form');
const signinError = $('signin-error');
const signinSubmit = $('signin-submit');

function showSigninError(text) {
  signinError.textContent = text;
  signinError.classList.remove('hidden');
}

signinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (signinSubmit.disabled) return;           // a double click sends one request

  const email = $('signin-email').value.trim();
  const password = $('signin-password').value;
  signinError.classList.add('hidden');
  if (!email || !password) {
    showSigninError('Enter your email and password.');
    return;
  }

  signinSubmit.disabled = true;
  signinSubmit.textContent = 'Signing in…';
  try {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      const wrong = error.status === 400 || /invalid login/i.test(error.message ?? '');
      showSigninError(wrong
        ? 'That email and password do not match. Check them and try again.'
        : 'We could not sign you in. Check that you are online and try again.');
      return;
    }
    $('signin-password').value = '';
    // The SIGNED_IN event below loads the workspace.
  } catch (err) {
    console.error(err);
    showSigninError('We could not sign you in. Check that you are online and try again.');
  } finally {
    signinSubmit.disabled = false;
    signinSubmit.textContent = 'Sign in';
  }
});

async function signOut() {
  try { await Minutes.flushNow(); } catch (err) { console.error(err); }   // save what can be saved first
  try { await supabaseClient.auth.signOut(); } catch (err) { console.error(err); }
  shownForUserId = null;
  showState('signin');
}

$('signout-btn').addEventListener('click', signOut);

// Signing out in another tab, or a session that cannot be refreshed, comes back here.
// Token refreshes for the user already on screen are ignored on purpose.
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' && shownForUserId) {
    shownForUserId = null;
    showState('signin');
  } else if (event === 'SIGNED_IN' && session && session.user.id !== shownForUserId && !busy) {
    // Not called directly: the auth library holds a lock while it runs this callback,
    // and start() needs the same lock.
    setTimeout(() => start(), 0);
  }
});

start();
