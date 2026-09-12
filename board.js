if (typeof CONFIG === 'undefined') {
  console.error('MinuteHand: config.js not loaded.');
}

// ── Supabase client ───────────────────────────────────────────────────────────

const supabaseClient = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// ── State ─────────────────────────────────────────────────────────────────────

let currentUser    = null;
let userOrg        = null;
let allMotions     = [];
let allActionItems = [];
let agendaNewItems = [];
const meetingCache = new Map();

// ── Element refs ──────────────────────────────────────────────────────────────

const loadingView    = document.getElementById('loading-view');
const accessSection   = document.getElementById('access-section');
const accessMsg       = document.getElementById('access-msg');
const accessActions   = document.getElementById('access-actions');
const boardView      = document.getElementById('board-view');
const orgNameHeading = document.getElementById('org-name-heading');
const orgTypeLabel   = document.getElementById('org-type-label');
const motionSearch   = document.getElementById('motion-search');
const statusFilter   = document.getElementById('status-filter');
const dateFrom       = document.getElementById('date-from');
const dateTo         = document.getElementById('date-to');
const motionCount    = document.getElementById('motion-count');
const motionList     = document.getElementById('motion-list');
const motionsView    = document.getElementById('motions-view');
const actionsView    = document.getElementById('actions-view');
const overdueBanner  = document.getElementById('overdue-banner');
const overdueCount   = document.getElementById('overdue-count');
const overduePlural  = document.getElementById('overdue-plural');
const aiStatusFilter = document.getElementById('ai-status-filter');
const aiSearch       = document.getElementById('ai-search');
const aiCount        = document.getElementById('ai-count');
const actionItemList      = document.getElementById('action-item-list');
const agendaView          = document.getElementById('agenda-view');
const agendaMeetingDate   = document.getElementById('agenda-meeting-date');
const agendaPreview       = document.getElementById('agenda-preview');
const agendaDownloadBtn   = document.getElementById('agenda-download-btn');
const agendaNewItemInput  = document.getElementById('agenda-new-item-input');
const agendaAddItemBtn    = document.getElementById('agenda-add-item-btn');
const agendaNewItemList   = document.getElementById('agenda-new-item-list');
const minutesModal        = document.getElementById('minutes-modal');
const modalClose     = document.getElementById('modal-close');
const modalBody      = document.getElementById('modal-body');

// ── Auth + init ───────────────────────────────────────────────────────────────

supabaseClient.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user ?? null;
  await init();
});

async function init() {
  if (!currentUser) {
    showAccess('not-signed-in');
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
    showAccess('no-plan');
    return;
  }

  const { data: org } = await supabaseClient
    .from('organizations')
    .select('id, name, org_type')
    .eq('owner_id', currentUser.id)
    .maybeSingle();

  if (!org) {
    showAccess('no-org');
    return;
  }

  userOrg = org;
  loadingView.classList.add('hidden');
  boardView.classList.remove('hidden');
  orgNameHeading.textContent = org.name;
  orgTypeLabel.textContent   = ORG_TYPE_LABELS[org.org_type] ?? org.org_type;

  await Promise.all([loadMotions(), loadActionItems()]);
}

function showAccess(type) {
  loadingView.classList.add('hidden');
  accessSection.classList.remove('hidden');

  if (type === 'not-signed-in') {
    accessMsg.textContent   = 'Sign in to access your Governance Records.';
    accessActions.innerHTML = `<a href="/app.html" class="btn-primary">Sign in</a>`;

  } else if (type === 'no-plan') {
    accessMsg.innerHTML =
      'Track every motion, action item, and document across all your meetings — ' +
      'without re-entering data each time. Included in the ' +
      '<strong>Board Plan</strong> ($75 CAD/year).';
    accessActions.innerHTML =
      `<a href="/#pricing" class="btn-primary">See Board Plan pricing</a>` +
      `<a href="/app.html" class="btn-ghost">← Back to app</a>`;

  } else if (type === 'no-org') {
    accessMsg.textContent   = 'Set up your organization in the app to start using Governance Records.';
    accessActions.innerHTML = `<a href="/app.html" class="btn-primary">Go to app</a>`;
  }
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

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll('.board-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.board-tab').forEach((t) => {
      t.classList.remove('board-tab--active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('board-tab--active');
    tab.setAttribute('aria-selected', 'true');

    const active = tab.dataset.tab;
    motionsView.classList.toggle('hidden', active !== 'motions');
    actionsView.classList.toggle('hidden', active !== 'actions');
    agendaView.classList.toggle('hidden',  active !== 'agenda');
    if (active === 'agenda') renderAgenda();
  });
});

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

// ── Load action items ─────────────────────────────────────────────────────────

async function loadActionItems() {
  actionItemList.innerHTML = '<div class="loading-row"><div class="spinner"></div><span>Loading action items…</span></div>';

  const { data, error } = await supabaseClient
    .from('action_items')
    .select(`
      id, description, responsible_party, due_date_text, due_date_parsed,
      status, completed_at, sort_order, meeting_id,
      meetings ( id, meeting_date, title )
    `)
    .eq('org_id', userOrg.id);

  if (error) {
    actionItemList.innerHTML = `<p class="error">Failed to load action items: ${escHtml(error.message)}</p>`;
    return;
  }

  allActionItems = data ?? [];
  renderActionItems();
}

function applyActionFilters() {
  const q          = aiSearch.value.trim().toLowerCase();
  const statusVal  = aiStatusFilter.value; // comma-separated or ''
  const statuses   = statusVal ? statusVal.split(',') : null;

  return allActionItems.filter((item) => {
    if (statuses && !statuses.includes(item.status)) return false;
    if (q && !item.description.toLowerCase().includes(q) &&
        !(item.responsible_party ?? '').toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderActionItems() {
  const today    = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local timezone
  const filtered = applyActionFilters();

  // Overdue: any non-completed item with due_date_parsed < today (across all, not just filtered)
  const overdueItems = allActionItems.filter(
    (item) => item.status !== 'completed' && item.due_date_parsed && item.due_date_parsed < today
  );
  if (overdueItems.length > 0) {
    overdueBanner.classList.remove('hidden');
    overdueCount.textContent = String(overdueItems.length);
    overduePlural.textContent = overdueItems.length === 1 ? '' : 's';
  } else {
    overdueBanner.classList.add('hidden');
  }

  const total = allActionItems.length;
  const shown = filtered.length;
  aiCount.textContent = shown === total
    ? `${total} item${total !== 1 ? 's' : ''}`
    : `${shown} of ${total}`;

  if (total === 0) {
    actionItemList.innerHTML = `
      <div class="registry-empty">
        <p>No action items recorded yet.</p>
        <p class="field-hint">Generate minutes with the Board Plan to start tracking action items.</p>
      </div>`;
    return;
  }

  if (shown === 0) {
    actionItemList.innerHTML = `<div class="registry-empty"><p>No action items match your filters.</p></div>`;
    return;
  }

  // Sort: open/in-progress by due_date_parsed ASC (nulls last), completed at bottom
  const sorted = [...filtered].sort((a, b) => {
    const aComp = a.status === 'completed';
    const bComp = b.status === 'completed';
    if (aComp !== bComp) return aComp ? 1 : -1;
    if (!aComp) {
      if (!a.due_date_parsed && !b.due_date_parsed) return 0;
      if (!a.due_date_parsed) return 1;
      if (!b.due_date_parsed) return -1;
      return a.due_date_parsed.localeCompare(b.due_date_parsed);
    }
    // Both completed: most recent completed_at first
    return (b.completed_at ?? '').localeCompare(a.completed_at ?? '');
  });

  actionItemList.innerHTML = sorted.map((item) => {
    const meeting  = item.meetings ?? {};
    const dateStr  = meeting.meeting_date
      ? new Date(meeting.meeting_date + 'T12:00:00').toLocaleDateString('en-CA', {
          year: 'numeric', month: 'long', day: 'numeric',
        })
      : 'Date not recorded';
    const titleStr   = meeting.title ?? 'Meeting';
    const isOverdue  = item.status !== 'completed' && item.due_date_parsed && item.due_date_parsed < today;
    const dueCls     = isOverdue ? ' ai-due--overdue' : '';
    const dueLabel   = item.due_date_text
      ? `Due: ${escHtml(item.due_date_text)}`
      : 'No due date';

    return `<div class="action-item-card${isOverdue ? ' action-item-card--overdue' : ''}">
  <div class="action-item-card__header">
    <span class="ai-owner">${item.responsible_party ? escHtml(item.responsible_party) : '<em>Owner not stated</em>'}</span>
    <span class="ai-due${dueCls}">${isOverdue ? '⚠ ' : ''}${dueLabel}</span>
    <button class="btn-link ai-meeting-link"
            data-meeting-id="${item.meeting_id}"
            title="View source minutes for ${escHtml(titleStr)}">
      ${escHtml(dateStr)}&nbsp;↗
    </button>
  </div>
  <p class="action-item-card__description">${escHtml(item.description)}</p>
  <div class="action-item-card__footer">
    <select class="ai-status-select" data-item-id="${item.id}" aria-label="Status">
      <option value="open"        ${item.status === 'open'        ? 'selected' : ''}>Open</option>
      <option value="in_progress" ${item.status === 'in_progress' ? 'selected' : ''}>In progress</option>
      <option value="completed"   ${item.status === 'completed'   ? 'selected' : ''}>Completed</option>
    </select>
  </div>
</div>`;
  }).join('');
}

async function handleStatusChange(itemId, newStatus) {
  const updates = { status: newStatus };
  if (newStatus === 'completed') {
    updates.completed_at = new Date().toISOString();
  } else {
    updates.completed_at = null;
  }

  const { error } = await supabaseClient
    .from('action_items')
    .update(updates)
    .eq('id', itemId);

  if (error) {
    alert(`Failed to update status: ${error.message}`);
    // Re-render to reset the select to the stored value
    renderActionItems();
    return;
  }

  // Update local state without a full reload
  const item = allActionItems.find((i) => i.id === itemId);
  if (item) {
    item.status       = newStatus;
    item.completed_at = updates.completed_at ?? null;
  }
  renderActionItems();
}

// ── Agenda ────────────────────────────────────────────────────────────────────

function latestMeeting() {
  const seen = new Map();
  [...allMotions, ...allActionItems].forEach((row) => {
    if (row.meetings?.id && !seen.has(row.meetings.id)) {
      seen.set(row.meetings.id, row.meetings);
    }
  });
  return [...seen.values()].sort((a, b) => b.meeting_date.localeCompare(a.meeting_date))[0] ?? null;
}

function renderAgenda() {
  const last         = latestMeeting();
  const openItems    = allActionItems.filter((i) => i.status === 'open' || i.status === 'in_progress');
  const tabledMots   = allMotions.filter((m) => m.result === 'tabled');
  const nextDateStr  = agendaMeetingDate.value
    ? new Date(agendaMeetingDate.value + 'T12:00:00').toLocaleDateString('en-CA', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
    : '[Date TBD]';

  agendaPreview.innerHTML = buildAgendaHtml({ last, openItems, tabledMots, nextDateStr });
  renderAgendaNewItemList();
}

function buildAgendaHtml({ last, openItems, tabledMots, nextDateStr, forExport = false }) {
  const orgType = ORG_TYPE_LABELS[userOrg.org_type] ?? userOrg.org_type;
  const lastRef = last
    ? new Date(last.meeting_date + 'T12:00:00').toLocaleDateString('en-CA', {
        year: 'numeric', month: 'long', day: 'numeric',
      }) + (last.title ? ' — ' + last.title : '')
    : null;

  const sub  = (text) => `<span class="${forExport ? '' : 'agenda-sub'}">${text}</span>`;
  const none = (text) => `<span class="${forExport ? '' : 'agenda-sub agenda-none'}">${text}</span>`;
  const meta = (text) => `<span class="${forExport ? '' : 'agenda-meta'}">${text}</span>`;

  let html = `<div class="agenda-doc">
  <div class="agenda-header">
    <h2>${escHtml(userOrg.name)}</h2>
    <p>${escHtml(orgType)}</p>
    <p><strong>Agenda — ${escHtml(nextDateStr)}</strong></p>
  </div>
  <ol class="agenda-items">
    <li><strong>Call to Order</strong></li>
    <li><strong>Adoption of Agenda</strong></li>
    <li><strong>Approval of Previous Minutes</strong>` +
    (lastRef ? `<br>${sub(escHtml(lastRef))}` : '') +
    `</li>`;

  // Action item updates
  html += `<li><strong>Action Item Updates</strong>`;
  if (openItems.length === 0) {
    html += `<br>${none('No open action items.')}`;
  } else {
    html += `<ul class="agenda-sublist">`;
    openItems.forEach((item) => {
      const owner = item.responsible_party ? escHtml(item.responsible_party) : 'Owner not stated';
      const due   = item.due_date_text ? ` — Due: ${escHtml(item.due_date_text)}` : '';
      html += `<li>${escHtml(item.description)} ${meta(`(${owner}${due})`)}</li>`;
    });
    html += `</ul>`;
  }
  html += `</li>`;

  // Tabled motions
  html += `<li><strong>Tabled Motions</strong>`;
  if (tabledMots.length === 0) {
    html += `<br>${none('None.')}`;
  } else {
    html += `<ul class="agenda-sublist">`;
    tabledMots.forEach((m) => {
      const d = m.meetings?.meeting_date
        ? new Date(m.meetings.meeting_date + 'T12:00:00').toLocaleDateString('en-CA', {
            month: 'long', day: 'numeric', year: 'numeric',
          })
        : 'date unknown';
      html += `<li>${escHtml(m.description)} ${meta(`(tabled ${d})`)}</li>`;
    });
    html += `</ul>`;
  }
  html += `</li>`;

  // New business
  html += `<li><strong>New Business</strong>`;
  if (agendaNewItems.length === 0) {
    html += `<br>${none('No items added.')}`;
  } else {
    html += `<ul class="agenda-sublist">`;
    agendaNewItems.forEach((text) => { html += `<li>${escHtml(text)}</li>`; });
    html += `</ul>`;
  }
  html += `</li>`;

  html += `<li><strong>Adjournment</strong></li>
  </ol>
</div>`;
  return html;
}

function renderAgendaNewItemList() {
  if (agendaNewItems.length === 0) {
    agendaNewItemList.innerHTML = '';
    return;
  }
  agendaNewItemList.innerHTML = agendaNewItems.map((text, i) =>
    `<li>${escHtml(text)}<button class="btn-link agenda-remove-item" data-index="${i}" aria-label="Remove">&#x2715;</button></li>`
  ).join('');
}

function addAgendaItem() {
  const text = agendaNewItemInput.value.trim();
  if (!text) return;
  agendaNewItems.push(text);
  agendaNewItemInput.value = '';
  renderAgenda();
}

function downloadAgendaDocx() {
  const last        = latestMeeting();
  const openItems   = allActionItems.filter((i) => i.status === 'open' || i.status === 'in_progress');
  const tabledMots  = allMotions.filter((m) => m.result === 'tabled');
  const nextDateStr = agendaMeetingDate.value
    ? new Date(agendaMeetingDate.value + 'T12:00:00').toLocaleDateString('en-CA', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
    : 'TBD';

  const bodyHtml = buildAgendaHtml({ last, openItems, tabledMots, nextDateStr, forExport: true });

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; margin: 2cm; }
  h2 { font-size: 14pt; margin: 0 0 2pt; }
  p { margin: 2pt 0; }
  ol { margin: 12pt 0 0; padding-left: 18pt; }
  ol li { margin-bottom: 8pt; }
  ul { margin: 4pt 0 0; padding-left: 18pt; }
  ul li { margin-bottom: 3pt; }
  .agenda-header { margin-bottom: 16pt; border-bottom: 1pt solid #888; padding-bottom: 8pt; }
</style>
</head><body>${bodyHtml}</body></html>`;

  const blob = htmlDocx.asBlob(fullHtml, { orientation: 'portrait' });
  const slug = agendaMeetingDate.value || 'agenda';
  const name = userOrg.name.replace(/[^a-zA-Z0-9]+/g, '_');
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${name}_Agenda_${slug}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Agenda event listeners ────────────────────────────────────────────────────

agendaMeetingDate.addEventListener('change', renderAgenda);

agendaAddItemBtn.addEventListener('click', addAgendaItem);

agendaNewItemInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addAgendaItem(); }
});

agendaNewItemList.addEventListener('click', (e) => {
  const btn = e.target.closest('.agenda-remove-item');
  if (btn) {
    agendaNewItems.splice(Number(btn.dataset.index), 1);
    renderAgenda();
  }
});

agendaDownloadBtn.addEventListener('click', downloadAgendaDocx);

// ── Action item event listeners ───────────────────────────────────────────────

aiStatusFilter.addEventListener('change', renderActionItems);
aiSearch.addEventListener('input',        renderActionItems);

actionItemList.addEventListener('change', (e) => {
  const sel = e.target.closest('.ai-status-select');
  if (sel) handleStatusChange(sel.dataset.itemId, sel.value);
});

actionItemList.addEventListener('click', (e) => {
  const btn = e.target.closest('.ai-meeting-link');
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
