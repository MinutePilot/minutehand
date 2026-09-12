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
let agendaNewItems  = [];
let searchDebounce  = null;
let allMembers      = [];
let membersLoaded   = false;
let editingMemberId = null;
const meetingCache  = new Map();

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
const toolsView           = document.getElementById('tools-view');
const membersView         = document.getElementById('members-view');
const membersCount        = document.getElementById('members-count');
const addMemberBtn        = document.getElementById('add-member-btn');
const memberFormPanel     = document.getElementById('member-form-panel');
const memberFormHeading   = document.getElementById('member-form-heading');
const mfName              = document.getElementById('mf-name');
const mfRole              = document.getElementById('mf-role');
const mfLot               = document.getElementById('mf-lot');
const mfEmail             = document.getElementById('mf-email');
const mfTermStart         = document.getElementById('mf-term-start');
const mfTermEnd           = document.getElementById('mf-term-end');
const memberSaveBtn       = document.getElementById('member-save-btn');
const memberCancelBtn     = document.getElementById('member-cancel-btn');
const memberFormError     = document.getElementById('member-form-error');
const memberList          = document.getElementById('member-list');
const formerSection       = document.getElementById('former-section');
const toggleFormerBtn     = document.getElementById('toggle-former-btn');
const formerCountEl       = document.getElementById('former-count');
const formerList          = document.getElementById('former-list');
const searchView          = document.getElementById('search-view');
const searchInput         = document.getElementById('search-input');
const searchStatus        = document.getElementById('search-status');
const searchResults       = document.getElementById('search-results');
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
    searchView.classList.toggle('hidden',  active !== 'search');
    toolsView.classList.toggle('hidden',   active !== 'tools');
    membersView.classList.toggle('hidden', active !== 'members');
    if (active === 'agenda')  renderAgenda();
    if (active === 'search')  searchInput.focus();
    if (active === 'members' && !membersLoaded) loadMembers();
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
    html += `<br>${none('None.')}`;
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

// ── Full-text search ──────────────────────────────────────────────────────────

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (!q) {
    searchStatus.textContent = '';
    searchResults.innerHTML  = '';
    return;
  }
  searchStatus.textContent = 'Searching…';
  searchResults.innerHTML  = '';
  searchDebounce = setTimeout(() => runSearch(q), 350);
});

async function runSearch(q) {
  const { data, error } = await supabaseClient.rpc('search_meetings', {
    p_org_id: userOrg.id,
    p_query:  q,
  });

  // Guard against stale results if the user kept typing
  if (searchInput.value.trim() !== q) return;

  if (error) {
    searchStatus.textContent = '';
    searchResults.innerHTML  = `<p class="error">Search failed: ${escHtml(error.message)}</p>`;
    return;
  }

  const results = data ?? [];
  searchStatus.textContent = results.length === 0
    ? `No results for "${q}"`
    : `${results.length} meeting${results.length !== 1 ? 's' : ''}`;

  if (results.length === 0) {
    searchResults.innerHTML = `<div class="registry-empty"><p>No results for <em>${escHtml(q)}</em>.</p><p class="field-hint">Try different keywords — search covers all meeting narrative, not just titles.</p></div>`;
    return;
  }

  searchResults.innerHTML = results.map((r) => {
    const dateStr = r.meeting_date
      ? new Date(r.meeting_date + 'T12:00:00').toLocaleDateString('en-CA', {
          year: 'numeric', month: 'long', day: 'numeric',
        })
      : 'Date not recorded';
    const titleStr  = r.title ?? 'Meeting';
    // ts_headline wraps matched terms in <mark>. Escape the full string then
    // restore just the mark tags so other content can't inject HTML.
    const safeHeadline = escHtml(r.headline ?? '')
      .replace(/&lt;mark&gt;/g,  '<mark>')
      .replace(/&lt;\/mark&gt;/g, '</mark>');

    return `<div class="search-result-card">
  <div class="search-result-card__header">
    <span class="search-result-card__date">${dateStr}</span>
    <span class="search-result-card__title">${escHtml(titleStr)}</span>
    <button class="btn-link search-view-minutes"
            data-meeting-id="${r.id}"
            title="View full minutes for ${escHtml(titleStr)}">
      View minutes&nbsp;↗
    </button>
  </div>
  <p class="search-result-card__headline">${safeHeadline}</p>
</div>`;
  }).join('');
}

searchResults.addEventListener('click', (e) => {
  const btn = e.target.closest('.search-view-minutes');
  if (btn) openMeetingModal(btn.dataset.meetingId);
});

// ── Roster ────────────────────────────────────────────────────────────────────

async function loadMembers() {
  memberList.innerHTML = '<div class="loading-row"><div class="spinner"></div><span>Loading members…</span></div>';

  const { data, error } = await supabaseClient
    .from('roster')
    .select('id, name, role, strata_lot, email, term_start, term_end, status, sort_order')
    .eq('org_id', userOrg.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    memberList.innerHTML = `<p class="error">Failed to load members: ${escHtml(error.message)}</p>`;
    return;
  }

  allMembers    = data ?? [];
  membersLoaded = true;
  renderMembers();
}

function renderMembers() {
  const active = allMembers.filter((m) => m.status === 'active');
  const former = allMembers.filter((m) => m.status === 'former');

  membersCount.textContent = `${active.length} active member${active.length !== 1 ? 's' : ''}`;

  if (active.length === 0) {
    memberList.innerHTML = `
      <div class="registry-empty">
        <p>No active members yet.</p>
        <p class="field-hint">Add current board or council members to start your roster.</p>
      </div>`;
  } else {
    memberList.innerHTML = renderMemberTable(active, false);
  }

  if (former.length > 0) {
    formerSection.classList.remove('hidden');
    formerCountEl.textContent = String(former.length);
    if (!formerList.classList.contains('hidden')) {
      formerList.innerHTML = renderMemberTable(former, true);
    }
  } else {
    formerSection.classList.add('hidden');
    formerList.classList.add('hidden');
  }
}

function renderMemberTable(members, isFormer) {
  return `<table class="member-table">
  <thead>
    <tr>
      <th>Name</th>
      <th>Role</th>
      <th>Lot / Unit</th>
      <th>Term</th>
      <th class="member-table__actions-col"></th>
    </tr>
  </thead>
  <tbody>
    ${members.map((m, idx) => {
      const termStart = m.term_start
        ? new Date(m.term_start + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', year: 'numeric' })
        : '';
      const termEnd = m.term_end
        ? new Date(m.term_end + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', year: 'numeric' })
        : 'ongoing';
      const termStr = termStart ? `${termStart} – ${termEnd}` : '';

      const isFirst = idx === 0;
      const isLast  = idx === members.length - 1;

      return `<tr data-member-id="${m.id}">
        <td><strong>${escHtml(m.name)}</strong>${m.email ? `<br><span class="member-email">${escHtml(m.email)}</span>` : ''}</td>
        <td>${escHtml(m.role)}</td>
        <td>${m.strata_lot ? escHtml(m.strata_lot) : '<span class="text-muted">—</span>'}</td>
        <td class="member-term">${termStr || '<span class="text-muted">—</span>'}</td>
        <td class="member-table__actions">
          ${!isFormer ? `
          <button class="btn-icon member-move-up"   data-id="${m.id}" title="Move up"   ${isFirst ? 'disabled' : ''}>↑</button>
          <button class="btn-icon member-move-down" data-id="${m.id}" title="Move down" ${isLast  ? 'disabled' : ''}>↓</button>
          ` : ''}
          <button class="btn-link member-edit-btn"   data-id="${m.id}">Edit</button>
          <button class="btn-link member-status-btn" data-id="${m.id}" data-status="${m.status}">
            ${m.status === 'active' ? 'Mark former' : 'Reactivate'}
          </button>
          <button class="btn-link member-delete-btn" data-id="${m.id}">Remove</button>
        </td>
      </tr>`;
    }).join('')}
  </tbody>
</table>`;
}

function openMemberForm(member = null) {
  editingMemberId = member?.id ?? null;
  memberFormHeading.textContent = member ? 'Edit member' : 'Add member';
  mfName.value      = member?.name       ?? '';
  mfRole.value      = member?.role       ?? '';
  mfLot.value       = member?.strata_lot ?? '';
  mfEmail.value     = member?.email      ?? '';
  mfTermStart.value = member?.term_start ?? '';
  mfTermEnd.value   = member?.term_end   ?? '';
  memberFormError.classList.add('hidden');
  memberFormPanel.classList.remove('hidden');
  mfName.focus();
}

function closeMemberForm() {
  editingMemberId = null;
  memberFormPanel.classList.add('hidden');
  memberFormError.classList.add('hidden');
}

async function saveMember() {
  const name = mfName.value.trim();
  const role = mfRole.value.trim();
  if (!name || !role) {
    memberFormError.textContent = 'Name and role are required.';
    memberFormError.classList.remove('hidden');
    return;
  }

  memberSaveBtn.disabled   = true;
  memberSaveBtn.textContent = 'Saving…';

  const payload = {
    name,
    role,
    strata_lot: mfLot.value.trim()       || null,
    email:      mfEmail.value.trim()      || null,
    term_start: mfTermStart.value         || null,
    term_end:   mfTermEnd.value           || null,
    updated_at: new Date().toISOString(),
  };

  let error;
  if (editingMemberId) {
    ({ error } = await supabaseClient
      .from('roster')
      .update(payload)
      .eq('id', editingMemberId));
  } else {
    const maxOrder = allMembers.length
      ? Math.max(...allMembers.map((m) => m.sort_order)) + 1
      : 0;
    ({ error } = await supabaseClient
      .from('roster')
      .insert({ ...payload, org_id: userOrg.id, sort_order: maxOrder }));
  }

  memberSaveBtn.disabled    = false;
  memberSaveBtn.textContent = 'Save';

  if (error) {
    memberFormError.textContent = error.message;
    memberFormError.classList.remove('hidden');
    return;
  }

  closeMemberForm();
  membersLoaded = false;
  await loadMembers();
}

async function deleteMember(id) {
  const member = allMembers.find((m) => m.id === id);
  if (!confirm(`Remove ${member?.name ?? 'this member'} from the roster? This cannot be undone.`)) return;

  const { error } = await supabaseClient.from('roster').delete().eq('id', id);
  if (error) { alert(`Failed to remove: ${error.message}`); return; }
  membersLoaded = false;
  await loadMembers();
}

async function setMemberStatus(id, newStatus) {
  const { error } = await supabaseClient
    .from('roster')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { alert(`Failed to update status: ${error.message}`); return; }
  membersLoaded = false;
  await loadMembers();
}

async function moveMember(id, direction) {
  const active  = allMembers.filter((m) => m.status === 'active');
  const idx     = active.findIndex((m) => m.id === id);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= active.length) return;

  const a = active[idx];
  const b = active[swapIdx];

  // Swap sort_orders
  const [orderA, orderB] = [a.sort_order, b.sort_order];
  const { error: e1 } = await supabaseClient.from('roster').update({ sort_order: orderB }).eq('id', a.id);
  const { error: e2 } = await supabaseClient.from('roster').update({ sort_order: orderA }).eq('id', b.id);
  if (e1 || e2) { alert('Failed to reorder.'); return; }
  membersLoaded = false;
  await loadMembers();
}

// ── Roster event listeners ────────────────────────────────────────────────────

addMemberBtn.addEventListener('click', () => openMemberForm());
memberCancelBtn.addEventListener('click', closeMemberForm);
memberSaveBtn.addEventListener('click', saveMember);

mfName.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveMember(); });

toggleFormerBtn.addEventListener('click', () => {
  const hidden = formerList.classList.toggle('hidden');
  const former = allMembers.filter((m) => m.status === 'former');
  if (!hidden) formerList.innerHTML = renderMemberTable(former, true);
  toggleFormerBtn.textContent = hidden
    ? `Show former members (${former.length})`
    : `Hide former members`;
});

memberList.addEventListener('click',   handleMemberListClick);
formerList.addEventListener('click',   handleMemberListClick);

function handleMemberListClick(e) {
  const editBtn   = e.target.closest('.member-edit-btn');
  const deleteBtn = e.target.closest('.member-delete-btn');
  const statusBtn = e.target.closest('.member-status-btn');
  const upBtn     = e.target.closest('.member-move-up');
  const downBtn   = e.target.closest('.member-move-down');

  if (editBtn) {
    const member = allMembers.find((m) => m.id === editBtn.dataset.id);
    if (member) openMemberForm(member);
  } else if (deleteBtn) {
    deleteMember(deleteBtn.dataset.id);
  } else if (statusBtn) {
    const newStatus = statusBtn.dataset.status === 'active' ? 'former' : 'active';
    setMemberStatus(statusBtn.dataset.id, newStatus);
  } else if (upBtn) {
    moveMember(upBtn.dataset.id, 'up');
  } else if (downBtn) {
    moveMember(downBtn.dataset.id, 'down');
  }
}

// ── Vote calculator ───────────────────────────────────────────────────────────

const vcBasis      = document.getElementById('vc-basis');
const vcTotalInput = document.getElementById('vc-total');
const vcTotalLabel = document.getElementById('vc-total-label');
const vcInFavour   = document.getElementById('vc-infavour');
const vcThreshold  = document.getElementById('vc-threshold');
const vcCustomWrap = document.getElementById('vc-custom-wrap');
const vcCustomPct  = document.getElementById('vc-custom-pct');
const vcResult     = document.getElementById('vc-result');
const vcBadge      = document.getElementById('vc-badge');
const vcSummary    = document.getElementById('vc-summary');
const vcDetail     = document.getElementById('vc-detail');

function vcRequiredVotes(n, thresholdType, customPct) {
  switch (thresholdType) {
    case 'majority':
      // Strictly more than half. floor(n/2)+1 is exact for all positive integers.
      return Math.floor(n / 2) + 1;
    case 'threequarters':
      return Math.ceil(n * 3 / 4);
    case 'unanimous':
      return n;
    case 'custom':
      return Math.ceil(n * customPct / 100);
  }
}

function vcFormulaString(n, thresholdType, customPct, basisLabel) {
  switch (thresholdType) {
    case 'majority': {
      const required = Math.floor(n / 2) + 1;
      return `⌊${n} ÷ 2⌋ + 1 = ${required} (strictly more than half of ${n} ${basisLabel})`;
    }
    case 'threequarters': {
      const raw      = n * 3 / 4;
      const required = Math.ceil(raw);
      return raw === required
        ? `${n} × 75% = ${required} of ${n} ${basisLabel}`
        : `⌈${n} × 75%⌉ = ${required} (rounded up from ${raw.toFixed(2)}) of ${n} ${basisLabel}`;
    }
    case 'unanimous':
      return `all ${n} ${basisLabel} must vote in favour`;
    case 'custom': {
      const raw      = n * customPct / 100;
      const required = Math.ceil(raw);
      return raw === required
        ? `${n} × ${customPct}% = ${required} of ${n} ${basisLabel}`
        : `⌈${n} × ${customPct}%⌉ = ${required} (rounded up from ${raw.toFixed(2)}) of ${n} ${basisLabel}`;
    }
  }
}

function vcThresholdLabel(thresholdType, customPct) {
  switch (thresholdType) {
    case 'majority':      return 'Simple majority (> 50%)';
    case 'threequarters': return 'Three-quarters (75%)';
    case 'unanimous':     return 'Unanimous (100%)';
    case 'custom':        return `Custom threshold (${customPct}%)`;
  }
}

function calculateVote() {
  const n          = parseInt(vcTotalInput.value, 10);
  const inFavour   = parseInt(vcInFavour.value, 10);
  const threshold  = vcThreshold.value;
  const customPct  = parseFloat(vcCustomPct.value);
  const basisLabel = vcBasis.value === 'cast' ? 'votes cast' : 'eligible voters';

  const hasN      = !isNaN(n) && n >= 1;
  const hasCustom = threshold !== 'custom' || (!isNaN(customPct) && customPct > 0 && customPct <= 100);

  if (!hasN || !hasCustom) {
    vcResult.classList.add('hidden');
    return;
  }

  const required = vcRequiredVotes(n, threshold, customPct);
  const formula  = vcFormulaString(n, threshold, customPct, basisLabel);
  const tLabel   = vcThresholdLabel(threshold, customPct);
  const hasVotes = !isNaN(inFavour) && vcInFavour.value !== '';

  vcResult.classList.remove('hidden');

  if (!hasVotes) {
    vcBadge.className     = 'vc-result__badge vc-badge--info';
    vcBadge.textContent   = `${required} votes required`;
    vcSummary.textContent = '';
    vcDetail.textContent  = `${tLabel}: ${formula}.`;
  } else {
    const passes = inFavour >= required;
    vcBadge.className     = `vc-result__badge vc-badge--${passes ? 'passes' : 'falls-short'}`;
    vcBadge.textContent   = passes ? 'PASSES' : 'FALLS SHORT';
    vcSummary.textContent = `${inFavour} vote${inFavour !== 1 ? 's' : ''} in favour — ` +
      `${passes ? 'meets' : 'does not meet'} the ${required}-vote requirement.`;
    vcDetail.textContent  = `${tLabel}: ${formula}.`;
  }
}

vcBasis.addEventListener('change', () => {
  vcTotalLabel.textContent = vcBasis.value === 'cast'
    ? 'Total votes cast'
    : 'Total eligible voters / strata lots';
  calculateVote();
});

vcThreshold.addEventListener('change', () => {
  vcCustomWrap.classList.toggle('hidden', vcThreshold.value !== 'custom');
  calculateVote();
});

vcTotalInput.addEventListener('input', calculateVote);
vcInFavour.addEventListener('input',   calculateVote);
vcCustomPct.addEventListener('input',  calculateVote);

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
