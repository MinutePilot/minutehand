if (typeof CONFIG === 'undefined') {
  console.error('MinuteHand: config.js not loaded.');
}

// ── Supabase client ───────────────────────────────────────────────────────────

const supabaseClient = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// ── State ─────────────────────────────────────────────────────────────────────

let currentUser  = null;
let userOrg      = null;
let allMotions   = [];
const meetingCache = new Map();

// ── Element refs ──────────────────────────────────────────────────────────────

const loadingView    = document.getElementById('loading-view');
const accessSection  = document.getElementById('access-section');
const accessMsg      = document.getElementById('access-msg');
const boardView      = document.getElementById('board-view');
const orgNameHeading = document.getElementById('org-name-heading');
const orgTypeLabel   = document.getElementById('org-type-label');
const motionSearch   = document.getElementById('motion-search');
const statusFilter   = document.getElementById('status-filter');
const dateFrom       = document.getElementById('date-from');
const dateTo         = document.getElementById('date-to');
const motionCount    = document.getElementById('motion-count');
const motionList     = document.getElementById('motion-list');
const minutesModal   = document.getElementById('minutes-modal');
const modalClose     = document.getElementById('modal-close');
const modalBody      = document.getElementById('modal-body');

// ── Auth + init ───────────────────────────────────────────────────────────────

supabaseClient.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user ?? null;
  await init();
});

async function init() {
  if (!currentUser) {
    showAccess('Sign in to access Governance Records.');
    return;
  }

  const { data: sub } = await supabaseClient
    .from('subscriptions')
    .select('board_plan_active, expires_at')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  const active = sub?.board_plan_active === true &&
                 (!sub.expires_at || new Date(sub.expires_at) > new Date());

  if (!active) {
    showAccess('Governance Records is part of the Board Plan.');
    return;
  }

  const { data: org } = await supabaseClient
    .from('organizations')
    .select('id, name, org_type')
    .eq('owner_id', currentUser.id)
    .maybeSingle();

  if (!org) {
    showAccess('Set up your organization first.');
    return;
  }

  userOrg = org;
  loadingView.classList.add('hidden');
  boardView.classList.remove('hidden');
  orgNameHeading.textContent = org.name;
  orgTypeLabel.textContent   = ORG_TYPE_LABELS[org.org_type] ?? org.org_type;

  await loadMotions();
}

function showAccess(msg) {
  loadingView.classList.add('hidden');
  accessMsg.textContent = msg;
  accessSection.classList.remove('hidden');
}

// ── Load motions ──────────────────────────────────────────────────────────────

async function loadMotions() {
  motionList.innerHTML = '<div class="loading-row"><div class="spinner"></div><span>Loading motions…</span></div>';

  const { data, error } = await supabaseClient
    .from('motions')
    .select(`
      id, description, result, moved_by, seconded_by, vote_tally, sort_order, meeting_id,
      meetings ( id, meeting_date, title, template )
    `)
    .eq('org_id', userOrg.id);

  if (error) {
    motionList.innerHTML = `<p class="error">Failed to load motions: ${escHtml(error.message)}</p>`;
    return;
  }

  // Sort: meeting_date DESC, sort_order ASC within each meeting
  allMotions = (data ?? []).sort((a, b) => {
    const da = a.meetings?.meeting_date ?? '';
    const db = b.meetings?.meeting_date ?? '';
    if (db !== da) return db.localeCompare(da);
    return a.sort_order - b.sort_order;
  });

  renderMotions();
}

// ── Filter + render ───────────────────────────────────────────────────────────

function applyFilters() {
  const q      = motionSearch.value.trim().toLowerCase();
  const status = statusFilter.value;
  const from   = dateFrom.value;
  const to     = dateTo.value;

  return allMotions.filter((m) => {
    if (status && m.result !== status) return false;
    const d = m.meetings?.meeting_date ?? '';
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    if (q && !m.description.toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderMotions() {
  const filtered = applyFilters();

  const total = allMotions.length;
  const shown = filtered.length;
  motionCount.textContent = shown === total
    ? `${total} motion${total !== 1 ? 's' : ''}`
    : `${shown} of ${total}`;

  if (total === 0) {
    motionList.innerHTML = `
      <div class="registry-empty">
        <p>No motions recorded yet.</p>
        <p class="field-hint">Generate your first set of minutes to start building your registry.</p>
      </div>`;
    return;
  }

  if (shown === 0) {
    motionList.innerHTML = `<div class="registry-empty"><p>No motions match your filters.</p></div>`;
    return;
  }

  motionList.innerHTML = filtered.map((m) => {
    const meeting = m.meetings ?? {};
    const dateStr = meeting.meeting_date
      ? new Date(meeting.meeting_date + 'T12:00:00').toLocaleDateString('en-CA', {
          year: 'numeric', month: 'long', day: 'numeric',
        })
      : 'Date not recorded';
    const titleStr   = meeting.title ?? 'Meeting';
    const movedStr   = m.moved_by    ? `Moved by ${escHtml(m.moved_by)}` : '';
    const secStr     = m.seconded_by ? `Seconded by ${escHtml(m.seconded_by)}` : 'Seconder not stated';
    const tallyStr   = m.vote_tally  ? `&nbsp;&nbsp;·&nbsp;&nbsp;${escHtml(m.vote_tally)}` : '';
    const attrParts  = [movedStr, secStr].filter(Boolean).join('&nbsp;&nbsp;·&nbsp;&nbsp;');

    return `<div class="motion-card">
  <div class="motion-card__header">
    <span class="result-badge result-badge--${m.result}">${m.result}</span>
    <span class="motion-card__date">${dateStr}</span>
    <button class="btn-link motion-meeting-link"
            data-meeting-id="${m.meeting_id}"
            title="View source minutes for ${escHtml(titleStr)}">
      ${escHtml(titleStr)}&nbsp;↗
    </button>
  </div>
  <p class="motion-card__description">${escHtml(m.description)}</p>
  <p class="motion-card__meta">${attrParts}${tallyStr}</p>
</div>`;
  }).join('');
}

// ── Filter event listeners ────────────────────────────────────────────────────

motionSearch.addEventListener('input',  renderMotions);
statusFilter.addEventListener('change', renderMotions);
dateFrom.addEventListener('change',     renderMotions);
dateTo.addEventListener('change',       renderMotions);

// ── Motion list click: delegate to "view minutes" buttons ─────────────────────

motionList.addEventListener('click', (e) => {
  const btn = e.target.closest('.motion-meeting-link');
  if (btn) openMeetingModal(btn.dataset.meetingId);
});

// ── Minutes modal ─────────────────────────────────────────────────────────────

async function openMeetingModal(meetingId) {
  modalBody.innerHTML = '<div class="loading-row"><div class="spinner"></div><span>Loading minutes…</span></div>';
  minutesModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  if (!meetingCache.has(meetingId)) {
    const { data } = await supabaseClient
      .from('meetings')
      .select('markdown, title, meeting_date')
      .eq('id', meetingId)
      .single();
    meetingCache.set(meetingId, data ?? null);
  }

  const meeting = meetingCache.get(meetingId);
  if (meeting?.markdown) {
    modalBody.innerHTML = marked.parse(preprocessMarkdown(meeting.markdown));
    modalBody.scrollTop = 0;
  } else {
    modalBody.innerHTML = '<p class="error">Could not load minutes.</p>';
  }
}

function closeModal() {
  minutesModal.classList.add('hidden');
  document.body.style.overflow = '';
}

modalClose.addEventListener('click', closeModal);
minutesModal.addEventListener('click', (e) => { if (e.target === minutesModal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORG_TYPE_LABELS = {
  STRATA:          'Strata Council (BC)',
  HOA_GENERIC:     'HOA Board',
  NONPROFIT_BOARD: 'Nonprofit Board',
  TEAM_INFORMAL:   'Team / Informal Meeting',
};

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function preprocessMarkdown(md) {
  return md.replace(/^(> .+)\n(?=> )/gm, '$1\n\n');
}
