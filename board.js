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

let allDocuments    = [];
let documentsLoaded = false;
let docSortField    = 'created_at';

let allAlterationRequests = [];
let alterationsLoaded     = false;
let altDraftedFormal      = null;
let activeApprovalId      = null;

let allMeetingsList    = [];
let meetingsListLoaded = false;
let overviewLoaded     = false;

let activeTemplate = 'agm';

// ── Element refs ──────────────────────────────────────────────────────────────

const loadingView    = document.getElementById('loading-view');
const accessSection   = document.getElementById('access-section');
const accessMsg       = document.getElementById('access-msg');
const accessUpsell    = document.getElementById('access-upsell');
const accessActions   = document.getElementById('access-actions');
const overviewView    = document.getElementById('overview-view');
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
const exportYear          = document.getElementById('export-year');
const exportCount         = document.getElementById('export-count');
const exportDocxBtn       = document.getElementById('export-docx-btn');
const exportCsvBtn        = document.getElementById('export-csv-btn');
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
const templatesView       = document.getElementById('templates-view');
const templateFormArea    = document.getElementById('template-form-area');
const templateDownloadBtn = document.getElementById('template-download-btn');
const templateError       = document.getElementById('template-error');
const minutesView         = document.getElementById('minutes-view');
const portalLinkInput     = document.getElementById('portal-link-input');
const portalCopyBtn       = document.getElementById('portal-copy-btn');
const portalCopyConfirm   = document.getElementById('portal-copy-confirm');
const portalRegenBtn      = document.getElementById('portal-regen-btn');
const minsList            = document.getElementById('mins-list');
const minsCount           = document.getElementById('mins-count');
const documentsView       = document.getElementById('documents-view');
const docsCount           = document.getElementById('docs-count');
const uploadDocBtn        = document.getElementById('upload-doc-btn');
const docFormPanel        = document.getElementById('doc-form-panel');
const docFileInput        = document.getElementById('doc-file');
const docTitleInput       = document.getElementById('doc-title');
const docCategorySelect   = document.getElementById('doc-category');
const docEffectiveDate    = document.getElementById('doc-effective-date');
const docSupersedesWrap   = document.getElementById('doc-supersedes-wrap');
const docSupersedesSelect = document.getElementById('doc-supersedes');
const docUploadBtn        = document.getElementById('doc-upload-btn');
const docCancelBtn        = document.getElementById('doc-cancel-btn');
const docFormError        = document.getElementById('doc-form-error');
const docList             = document.getElementById('doc-list');
const docsArchivedSection = document.getElementById('docs-archived-section');
const toggleArchivedBtn   = document.getElementById('toggle-archived-docs-btn');
const archivedDocsCount   = document.getElementById('archived-docs-count');
const archivedDocsList    = document.getElementById('archived-docs-list');

const alterationsView        = document.getElementById('alterations-view');
const altOwnerNameInput      = document.getElementById('alt-owner-name');
const altStrataLotInput      = document.getElementById('alt-strata-lot');
const altDescriptionInput    = document.getElementById('alt-description');
const altDraftBtn            = document.getElementById('alt-draft-btn');
const altDraftError          = document.getElementById('alt-draft-error');
const altPreviewSection      = document.getElementById('alt-preview-section');
const altPreviewEl           = document.getElementById('alt-preview');
const altSaveBtn             = document.getElementById('alt-save-btn');
const altDiscardBtn          = document.getElementById('alt-discard-btn');
const altList                = document.getElementById('alt-list');
const altCount               = document.getElementById('alt-count');
const altApprovalSection     = document.getElementById('alt-approval-section');
const altApprovalContext     = document.getElementById('alt-approval-context');
const altDecisionDate        = document.getElementById('alt-decision-date');
const altConditionsInput     = document.getElementById('alt-conditions');
const altNoticeDays          = document.getElementById('alt-notice-days');
const altNonTransfer         = document.getElementById('alt-nontransfer');
const altMotionSelect        = document.getElementById('alt-motion-select');
const altSignerSelect        = document.getElementById('alt-signer-select');
const altGenerateApprovalBtn = document.getElementById('alt-generate-approval-btn');
const altCancelApprovalBtn   = document.getElementById('alt-cancel-approval-btn');
const altApprovalError       = document.getElementById('alt-approval-error');

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
    .select('id, name, org_type, portal_token')
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
  renderPortalLink();

  await Promise.all([loadMotions(), loadActionItems()]);
  loadOverview();
  loadMeetingsList();
}

function showAccess(type) {
  loadingView.classList.add('hidden');
  accessSection.classList.remove('hidden');

  if (type === 'not-signed-in') {
    accessMsg.textContent   = 'Sign in to access your Governance Records.';
    accessActions.innerHTML = `<a href="/app.html" class="btn-primary">Sign in</a>`;

  } else if (type === 'no-plan') {
    accessMsg.innerHTML =
      'Track every motion, action item, and governance document across all your meetings — ' +
      'without re-entering data each time. Included in the ' +
      '<strong>Board Plan</strong> ($75 CAD/year, 30-day refund).';
    accessUpsell?.classList.remove('hidden');
    accessActions.innerHTML =
      `<a href="/app.html?plan=board_plan" class="btn-primary">Get Board Plan — $75 CAD/year</a>` +
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
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.board-tab').forEach((t) => {
      t.classList.remove('board-tab--active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('board-tab--active');
    tab.setAttribute('aria-selected', 'true');

    const active = tab.dataset.tab;
    overviewView.classList.toggle('hidden',    active !== 'overview');
    motionsView.classList.toggle('hidden',     active !== 'motions');
    actionsView.classList.toggle('hidden',     active !== 'actions');
    agendaView.classList.toggle('hidden',      active !== 'agenda');
    searchView.classList.toggle('hidden',      active !== 'search');
    minutesView.classList.toggle('hidden',     active !== 'minutes');
    toolsView.classList.toggle('hidden',       active !== 'tools');
    membersView.classList.toggle('hidden',     active !== 'members');
    documentsView.classList.toggle('hidden',   active !== 'documents');
    templatesView.classList.toggle('hidden',   active !== 'templates');
    alterationsView.classList.toggle('hidden', active !== 'alterations');
    if (active === 'agenda')                               renderAgenda();
    if (active === 'search')                               searchInput.focus();
    if (active === 'tools')                                populateExportYears();
    if (active === 'members'     && !membersLoaded)        loadMembers();
    if (active === 'documents'   && !documentsLoaded)      loadDocuments();
    if (active === 'alterations' && !alterationsLoaded)    loadAlterations();
    if (active === 'templates') {
      if (!membersLoaded) await loadMembers();
      renderTemplateForm(activeTemplate);
    }
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

// ── Overview tab ──────────────────────────────────────────────────────────────

async function loadOverview() {
  // Fetch published/draft minute counts and document count in parallel
  const [meetingsCountRes, docCountRes] = await Promise.all([
    supabaseClient
      .from('meetings')
      .select('id, published', { count: 'exact' })
      .eq('org_id', userOrg.id),
    supabaseClient
      .from('documents')
      .select('id', { count: 'exact' })
      .eq('org_id', userOrg.id)
      .eq('status', 'active'),
  ]);

  const meetings      = meetingsCountRes.data ?? [];
  const published     = meetings.filter((m) => m.published).length;
  const draft         = meetings.filter((m) => !m.published).length;
  const docCount      = docCountRes.count ?? 0;

  overviewLoaded = true;

  renderOverview({ published, draft, docCount });
}

function renderOverview({ published, draft, docCount }) {
  const today = new Date().toLocaleDateString('en-CA');

  // Action items from already-loaded allActionItems
  const openItems    = allActionItems.filter((i) => i.status === 'open' || i.status === 'in_progress');
  const overdueItems = openItems.filter((i) => i.due_date_parsed && i.due_date_parsed < today);

  document.getElementById('ov-open-actions').textContent  = openItems.length;
  document.getElementById('ov-overdue-actions').textContent =
    overdueItems.length > 0 ? `${overdueItems.length} overdue` : 'None overdue';
  document.getElementById('ov-overdue-actions').style.color =
    overdueItems.length > 0 ? 'var(--error)' : '';

  document.getElementById('ov-published-minutes').textContent = published;
  document.getElementById('ov-draft-minutes').textContent     =
    draft > 0 ? `${draft} draft${draft !== 1 ? 's' : ''}` : 'All published';

  // Next agenda date from agendaMeetingDate input (may be empty)
  const agendaDateVal = agendaMeetingDate?.value;
  if (agendaDateVal) {
    const d = new Date(agendaDateVal + 'T12:00:00');
    document.getElementById('ov-agenda-date').textContent =
      d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    document.getElementById('ov-agenda-detail').textContent =
      d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  } else {
    document.getElementById('ov-agenda-date').textContent  = '—';
    document.getElementById('ov-agenda-detail').textContent = 'No date set';
  }

  document.getElementById('ov-doc-count').textContent  = docCount;
  document.getElementById('ov-doc-detail').textContent = 'in document library';

  // Recent motions — last 5 carried
  const recent = allMotions.filter((m) => m.result === 'carried').slice(0, 5);
  const recentList = document.getElementById('ov-recent-motions-list');
  if (recent.length === 0) {
    recentList.innerHTML = '<p class="field-hint">No carried motions yet.</p>';
  } else {
    recentList.innerHTML = recent.map((m) => {
      const dateStr = m.meetings?.meeting_date
        ? new Date(m.meetings.meeting_date + 'T12:00:00').toLocaleDateString('en-CA', {
            year: 'numeric', month: 'short', day: 'numeric',
          })
        : '';
      return `<div class="overview-recent__item">
  <span class="overview-recent__desc">${escHtml(m.description)}</span>
  ${dateStr ? `<span class="overview-recent__date">${dateStr}</span>` : ''}
</div>`;
    }).join('');
  }
}

// Tab links inside overview cards
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab-link]');
  if (!btn) return;
  const target = btn.dataset.tabLink;
  const tabEl = document.querySelector(`.board-tab[data-tab="${target}"]`);
  if (tabEl) tabEl.click();
});

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
  const [meetingRes, docRes] = await Promise.all([
    supabaseClient.rpc('search_meetings',  { p_org_id: userOrg.id, p_query: q }),
    supabaseClient.rpc('search_documents', { p_org_id: userOrg.id, p_query: q }),
  ]);

  // Guard against stale results if the user kept typing
  if (searchInput.value.trim() !== q) return;

  if (meetingRes.error && docRes.error) {
    searchStatus.textContent = '';
    searchResults.innerHTML  = `<p class="error">Search failed: ${escHtml(meetingRes.error.message)}</p>`;
    return;
  }

  const meetings = meetingRes.data ?? [];
  const docs     = docRes.data     ?? [];
  const total    = meetings.length + docs.length;

  if (total === 0) {
    searchStatus.textContent = `No results for "${q}"`;
    searchResults.innerHTML  = `<div class="registry-empty"><p>No results for <em>${escHtml(q)}</em>.</p><p class="field-hint">Try different keywords — search covers all meeting narrative and document library, not just titles.</p></div>`;
    return;
  }

  const parts = [];
  if (meetings.length) parts.push(`${meetings.length} meeting${meetings.length !== 1 ? 's' : ''}`);
  if (docs.length)     parts.push(`${docs.length} document${docs.length !== 1 ? 's' : ''}`);
  searchStatus.textContent = `${total} result${total !== 1 ? 's' : ''} — ${parts.join(', ')}`;

  let html = '';

  // Meeting results
  if (meetings.length > 0) {
    html += `<div class="search-section-heading">Meetings</div>`;
    html += meetings.map((r) => {
      const dateStr = r.meeting_date
        ? new Date(r.meeting_date + 'T12:00:00').toLocaleDateString('en-CA', {
            year: 'numeric', month: 'long', day: 'numeric',
          })
        : 'Date not recorded';
      const titleStr     = r.title ?? 'Meeting';
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

  // Document results
  if (docs.length > 0) {
    html += `<div class="search-section-heading">Documents</div>`;
    html += docs.map((d) => {
      const safeHeadline = escHtml(d.headline ?? '')
        .replace(/&lt;mark&gt;/g,  '<mark>')
        .replace(/&lt;\/mark&gt;/g, '</mark>');
      const effStr = d.effective_date
        ? ' · Effective: ' + new Date(d.effective_date + 'T12:00:00').toLocaleDateString('en-CA', {
            year: 'numeric', month: 'short',
          })
        : '';
      return `<div class="search-result-card search-result-card--doc">
  <div class="search-result-card__header">
    <span class="doc-type-badge doc-type-badge--sm">${fileTypeBadge(d.mime_type)}</span>
    <span class="search-result-card__title">${escHtml(d.title)}</span>
    <span class="search-doc-category">${escHtml(d.category)}${effStr}</span>
    <button class="btn-link search-doc-download"
            data-path="${escHtml(d.storage_path)}"
            data-name="${escHtml(d.file_name)}">
      Download&nbsp;↓
    </button>
  </div>
  <p class="search-result-card__headline">${safeHeadline}</p>
</div>`;
    }).join('');
  }

  searchResults.innerHTML = html;
}

searchResults.addEventListener('click', (e) => {
  const minutes = e.target.closest('.search-view-minutes');
  if (minutes) { openMeetingModal(minutes.dataset.meetingId); return; }
  const dl = e.target.closest('.search-doc-download');
  if (dl) downloadDocument(dl.dataset.path, dl.dataset.name);
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

// ── Motions export ───────────────────────────────────────────────────────────

function populateExportYears() {
  const years = new Set();
  allMotions.forEach((m) => {
    const d = m.meetings?.meeting_date;
    if (d) years.add(d.slice(0, 4));
  });
  const sorted = [...years].sort((a, b) => b.localeCompare(a));

  exportYear.innerHTML =
    '<option value="">All years</option>' +
    sorted.map((y) => `<option value="${y}">${y}</option>`).join('');

  const thisYear = new Date().getFullYear().toString();
  if (years.has(thisYear)) exportYear.value = thisYear;

  updateExportCount();
}

function getExportMotions() {
  const year = exportYear.value;
  let rows = year
    ? allMotions.filter((m) => (m.meetings?.meeting_date ?? '').startsWith(year))
    : [...allMotions];

  return rows.sort((a, b) => {
    const da = a.meetings?.meeting_date ?? '';
    const db = b.meetings?.meeting_date ?? '';
    if (da !== db) return da.localeCompare(db);
    return a.sort_order - b.sort_order;
  });
}

function updateExportCount() {
  const n = getExportMotions().length;
  exportCount.textContent = n === 0
    ? 'No motions in selection.'
    : `${n} motion${n !== 1 ? 's' : ''} in selection`;
}

function exportFilename() {
  const year    = exportYear.value || 'all-years';
  const orgSlug = userOrg.name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
  return `${orgSlug}_Motions_${year}`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// CSV -------------------------------------------------------------------------

function csvCell(value) {
  const s = String(value ?? '');
  return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

function downloadMotionsCsv() {
  const motions = getExportMotions();
  if (motions.length === 0) { alert('No motions to export.'); return; }

  const header = ['Meeting Date', 'Meeting', 'Motion', 'Result', 'Moved By', 'Seconded By', 'Vote Tally'];
  const rows   = motions.map((m) => [
    m.meetings?.meeting_date ?? '',
    m.meetings?.title        ?? '',
    m.description,
    m.result,
    m.moved_by    ?? '',
    m.seconded_by ?? '',
    m.vote_tally  ?? '',
  ].map(csvCell).join(','));

  // BOM prefix so Excel on Windows opens UTF-8 correctly without mangling
  const csv  = '﻿' + [header.map(csvCell).join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, exportFilename() + '.csv');
}

// DOCX ------------------------------------------------------------------------

function downloadMotionsDocx() {
  const motions = getExportMotions();
  if (motions.length === 0) { alert('No motions to export.'); return; }

  const year          = exportYear.value || 'All Years';
  const generatedDate = new Date().toLocaleDateString('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const RESULT_COLOUR = {
    carried:   '#1a5c38',
    defeated:  '#8b1a1a',
    tabled:    '#6b4c00',
    withdrawn: '#444',
  };

  const tableRows = motions.map((m) => {
    const dateStr = m.meetings?.meeting_date
      ? new Date(m.meetings.meeting_date + 'T12:00:00').toLocaleDateString('en-CA', {
          year: 'numeric', month: 'short', day: 'numeric',
        })
      : '—';
    const resultLabel = m.result.charAt(0).toUpperCase() + m.result.slice(1);
    const colour      = RESULT_COLOUR[m.result] ?? '#333';

    return `<tr>
      <td style="white-space:nowrap">${escHtml(dateStr)}</td>
      <td>${escHtml(m.meetings?.title ?? '—')}</td>
      <td>${escHtml(m.description)}</td>
      <td style="color:${colour};font-weight:bold;white-space:nowrap">${resultLabel}</td>
      <td style="white-space:nowrap">${escHtml(m.moved_by ?? '—')}</td>
      <td style="white-space:nowrap">${escHtml(m.seconded_by ?? '—')}</td>
      <td style="white-space:nowrap">${escHtml(m.vote_tally ?? '—')}</td>
    </tr>`;
  }).join('');

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body  { font-family: Calibri, Arial, sans-serif; font-size: 9.5pt; margin: 2cm 1.5cm; }
  h1    { font-size: 13pt; margin: 0 0 3pt; }
  .sub  { font-size: 10pt; color: #555; margin: 2pt 0 0; }
  .gen  { font-size: 8.5pt; color: #888; margin: 5pt 0 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 14pt; font-size: 9pt; }
  th    { background: #dce3ec; text-align: left; padding: 5pt 7pt;
          border: 1pt solid #aab; font-weight: bold; }
  td    { padding: 4pt 7pt; border: 1pt solid #ccc; vertical-align: top; }
  tr:nth-child(even) td { background: #f7f8fa; }
</style>
</head><body>
  <h1>${escHtml(userOrg.name)}</h1>
  <p class="sub">Motions &amp; Decisions Register — ${escHtml(year)}</p>
  <p class="gen">Generated ${generatedDate} &nbsp;|&nbsp; ${motions.length} motion${motions.length !== 1 ? 's' : ''}</p>
  <table>
    <thead><tr>
      <th>Date</th><th>Meeting</th><th>Motion</th><th>Result</th>
      <th>Moved By</th><th>Seconded By</th><th>Vote Tally</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</body></html>`;

  const blob = htmlDocx.asBlob(fullHtml, { orientation: 'landscape' });
  triggerDownload(blob, exportFilename() + '.docx');
}

// ── Export event listeners ────────────────────────────────────────────────────

exportYear.addEventListener('change', updateExportCount);
exportDocxBtn.addEventListener('click', downloadMotionsDocx);
exportCsvBtn.addEventListener('click',  downloadMotionsCsv);

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

// ── Document library ──────────────────────────────────────────────────────────

const CATEGORY_ORDER = [
  'Bylaws',
  'Rules & Regulations',
  'AGM Records',
  'Insurance',
  'Depreciation Report',
  'Financial Statements',
  'Alteration Requests',
  'Other',
];

async function loadDocuments() {
  docList.innerHTML = '<div class="loading-row"><div class="spinner"></div><span>Loading documents…</span></div>';

  const { data, error } = await supabaseClient
    .from('documents')
    .select('id, title, category, effective_date, storage_path, file_name, file_size, mime_type, status, supersedes_id, created_at')
    .eq('org_id', userOrg.id)
    .order('created_at', { ascending: false });

  if (error) {
    docList.innerHTML = `<p class="error">Failed to load documents: ${escHtml(error.message)}</p>`;
    return;
  }

  allDocuments    = data ?? [];
  documentsLoaded = true;
  renderDocuments();
}

function sortedDocs(docs) {
  if (docSortField === 'effective_date') {
    return [...docs].sort((a, b) => {
      if (!a.effective_date && !b.effective_date)
        return b.created_at.localeCompare(a.created_at);
      if (!a.effective_date) return 1;
      if (!b.effective_date) return -1;
      return b.effective_date.localeCompare(a.effective_date);
    });
  }
  return [...docs].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// Walk supersedes_id links to build a chain: [current, prev, prev-prev, …]
function buildVersionChain(doc) {
  const chain   = [doc];
  const visited = new Set([doc.id]);
  let cur = doc;
  while (cur.supersedes_id) {
    if (visited.has(cur.supersedes_id)) break;  // guard against circular refs
    const prev = allDocuments.find((d) => d.id === cur.supersedes_id);
    if (!prev) break;
    chain.push(prev);
    visited.add(prev.id);
    cur = prev;
  }
  return chain;
}

// Renders active docs with version chain expanders when applicable.
function renderActiveDocItems(docs) {
  return docs.map((d) => {
    const chain      = buildVersionChain(d);
    const versionNum = chain.length;
    const hasHistory = versionNum > 1;
    const sizStr     = d.file_size ? formatFileSize(d.file_size) : '';
    const dateStr    = new Date(d.created_at).toLocaleDateString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
    const effStr = d.effective_date
      ? ' · Effective: ' + new Date(d.effective_date + 'T12:00:00').toLocaleDateString('en-CA', {
          year: 'numeric', month: 'short',
        })
      : '';
    const vBadge  = hasHistory
      ? `<span class="doc-version-badge">v${versionNum}</span>`
      : '';
    const closedLabel = `Version history (${versionNum})`;
    const openLabel   = 'Hide history';
    const toggleBtn   = hasHistory
      ? `<button class="btn-link doc-version-toggle"
                 data-doc-id="${escHtml(d.id)}"
                 data-label-closed="${escHtml(closedLabel)}"
                 data-label-open="${escHtml(openLabel)}">${closedLabel}</button>`
      : '';

    const itemHtml = `<div class="doc-item" data-id="${escHtml(d.id)}">
  <span class="doc-type-badge">${fileTypeBadge(d.mime_type)}</span>
  <div class="doc-item__info">
    <div class="doc-item__title">${escHtml(d.title)}${vBadge}</div>
    <div class="doc-item__meta">${[sizStr, `Uploaded ${dateStr}`].filter(Boolean).join(' · ')}${effStr}</div>
  </div>
  <div class="doc-item__actions">
    <button class="btn-link doc-download-btn"
            data-path="${escHtml(d.storage_path)}"
            data-name="${escHtml(d.file_name)}">Download ↓</button>
    ${toggleBtn}
    <button class="btn-link doc-archive-btn" data-id="${escHtml(d.id)}">Archive</button>
  </div>
</div>`;

    const chainHtml = hasHistory
      ? renderVersionChainHtml(d.id, chain.slice(1))
      : '';

    return itemHtml + chainHtml;
  }).join('');
}

// Renders the collapsible version history panel beneath a doc item.
// `olderDocs`: chain entries from index 1 onward (prev, prev-prev, …)
function renderVersionChainHtml(parentId, olderDocs) {
  const totalVersions = olderDocs.length + 1;  // parent is current version
  const items = olderDocs.map((d, i) => {
    const vNum   = totalVersions - 1 - i;
    const sizStr = d.file_size ? formatFileSize(d.file_size) : '';
    const dateStr = new Date(d.created_at).toLocaleDateString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
    const effStr = d.effective_date
      ? 'Effective: ' + new Date(d.effective_date + 'T12:00:00').toLocaleDateString('en-CA', {
          year: 'numeric', month: 'short',
        })
      : '';
    return `<div class="doc-version-item">
  <span class="doc-version-badge doc-version-badge--old" title="Version ${vNum}">v${vNum}</span>
  <span class="doc-type-badge doc-type-badge--sm">${fileTypeBadge(d.mime_type)}</span>
  <div class="doc-version-item__info">
    <div class="doc-version-item__title">${escHtml(d.title)}</div>
    <div class="doc-version-item__meta">${[sizStr, `Uploaded ${dateStr}`, effStr].filter(Boolean).join(' · ')}</div>
  </div>
  <button class="btn-link doc-download-btn"
          data-path="${escHtml(d.storage_path)}"
          data-name="${escHtml(d.file_name)}">Download ↓</button>
</div>`;
  }).join('');

  return `<div class="doc-version-chain hidden" id="doc-chain-${escHtml(parentId)}">
  <div class="doc-version-chain__inner">${items}</div>
</div>`;
}

// Renders a flat list without version chains — used for archived section.
function renderDocItems(docs, showRestore) {
  return docs.map((d) => {
    const sizStr  = d.file_size ? formatFileSize(d.file_size) : '';
    const dateStr = new Date(d.created_at).toLocaleDateString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
    const effStr = d.effective_date
      ? ' · Effective: ' + new Date(d.effective_date + 'T12:00:00').toLocaleDateString('en-CA', {
          year: 'numeric', month: 'short',
        })
      : '';
    const badge = fileTypeBadge(d.mime_type);
    const action = showRestore
      ? `<button class="btn-link doc-restore-btn" data-id="${d.id}">Restore</button>`
      : `<button class="btn-link doc-archive-btn" data-id="${d.id}">Archive</button>`;
    return `<div class="doc-item" data-id="${escHtml(d.id)}">
  <span class="doc-type-badge">${badge}</span>
  <div class="doc-item__info">
    <div class="doc-item__title">${escHtml(d.title)}</div>
    <div class="doc-item__meta">${[sizStr, `Uploaded ${dateStr}`].filter(Boolean).join(' · ')}${effStr}</div>
  </div>
  <div class="doc-item__actions">
    <button class="btn-link doc-download-btn"
            data-path="${escHtml(d.storage_path)}"
            data-name="${escHtml(d.file_name)}">Download ↓</button>
    ${action}
  </div>
</div>`;
  }).join('');
}

function renderDocuments() {
  const active   = allDocuments.filter((d) => d.status === 'active');
  const archived = allDocuments.filter((d) => d.status === 'archived');
  // superseded docs are only surfaced via version chains — not counted here

  docsCount.textContent = `${active.length} document${active.length !== 1 ? 's' : ''}`;

  // Group active docs by category in fixed display order
  const byCategory = new Map(CATEGORY_ORDER.map((c) => [c, []]));
  sortedDocs(active).forEach((d) => {
    const bucket = byCategory.get(d.category) ?? byCategory.get('Other');
    bucket.push(d);
  });

  let anyShown = false;
  let html = '';
  for (const [cat, docs] of byCategory) {
    if (docs.length === 0) continue;
    anyShown = true;
    html += `<div class="doc-category-section">
  <h4 class="doc-category-heading">
    ${escHtml(cat)}
    <span class="doc-category-count">${docs.length}</span>
  </h4>
  <div class="doc-category-list">${renderActiveDocItems(docs)}</div>
</div>`;
  }

  docList.innerHTML = anyShown
    ? html
    : `<div class="registry-empty">
         <p>No documents yet.</p>
         <p class="field-hint">Upload governance documents to start your library.</p>
       </div>`;

  // Archived section — superseded docs are NOT included here
  if (archived.length > 0) {
    docsArchivedSection.classList.remove('hidden');
    archivedDocsCount.textContent = String(archived.length);
    if (!archivedDocsList.classList.contains('hidden')) {
      archivedDocsList.innerHTML = renderDocItems(sortedDocs(archived), true);
    }
  } else {
    docsArchivedSection.classList.add('hidden');
    archivedDocsList.classList.add('hidden');
  }
}

// ── Upload ────────────────────────────────────────────────────────────────────

function openDocForm() {
  docFormPanel.classList.remove('hidden');
  docFormError.classList.add('hidden');
  docTitleInput.value        = '';
  docFileInput.value         = '';
  docCategorySelect.value    = 'Bylaws';
  docEffectiveDate.value     = '';
  docUploadBtn.disabled      = false;
  docUploadBtn.textContent   = 'Upload';
  updateSupersedesDropdown('Bylaws');
  docTitleInput.focus();
  docFormPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateSupersedesDropdown(category) {
  const candidates = allDocuments.filter(
    (d) => d.status === 'active' && d.category === category
  );
  if (candidates.length === 0) {
    docSupersedesWrap.classList.add('hidden');
    docSupersedesSelect.value = '';
    return;
  }
  docSupersedesWrap.classList.remove('hidden');
  docSupersedesSelect.innerHTML =
    '<option value="">— Not replacing an existing document —</option>' +
    candidates.map((d) => {
      const eff = d.effective_date
        ? ` (effective ${new Date(d.effective_date + 'T12:00:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'short' })})`
        : '';
      return `<option value="${escHtml(d.id)}">${escHtml(d.title)}${eff}</option>`;
    }).join('');
}

function closeDocForm() {
  docFormPanel.classList.add('hidden');
}

async function uploadDocument() {
  const file        = docFileInput.files[0];
  const title       = docTitleInput.value.trim();
  const category    = docCategorySelect.value;
  const effDate     = docEffectiveDate.value || null;
  const supersedesId = docSupersedesSelect.value || null;

  if (!file)  { showDocFormError('Please select a file.'); return; }
  if (!title) { showDocFormError('Please enter a title for this document.'); return; }

  if (file.size > 20 * 1024 * 1024) {
    showDocFormError('File exceeds the 20 MB limit. Please use a smaller file or split the document.');
    return;
  }

  docUploadBtn.disabled    = true;
  docUploadBtn.textContent = 'Uploading…';
  docFormError.classList.add('hidden');

  // Generate IDs client-side so the storage path and DB row use the same UUID.
  const docId    = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${userOrg.id}/${docId}/${safeName}`;

  const { error: storageError } = await supabaseClient.storage
    .from('governance-documents')
    .upload(storagePath, file, { cacheControl: '3600', upsert: false });

  if (storageError) {
    docUploadBtn.disabled    = false;
    docUploadBtn.textContent = 'Upload';
    showDocFormError('Upload failed: ' + storageError.message);
    return;
  }

  // Single RPC call — insert + supersede happen in one Postgres transaction.
  // If the supersede target is not active or doesn't belong to this org, the
  // function raises an exception and the INSERT is rolled back automatically.
  const { error: dbError } = await supabaseClient.rpc('publish_document_version', {
    p_id:             docId,
    p_org_id:         userOrg.id,
    p_title:          title,
    p_category:       category,
    p_effective_date: effDate,
    p_storage_path:   storagePath,
    p_file_name:      file.name,
    p_file_size:      file.size,
    p_mime_type:      file.type || null,
    p_supersedes_id:  supersedesId,
  });

  docUploadBtn.disabled    = false;
  docUploadBtn.textContent = 'Upload';

  if (dbError) {
    // Storage upload already succeeded — the file is in the bucket. The
    // orphan can be resolved by retrying with a new UUID. Note this to the user.
    showDocFormError('Metadata save failed: ' + dbError.message + ' — please try uploading again.');
    return;
  }

  closeDocForm();
  documentsLoaded = false;
  await loadDocuments();
}

function showDocFormError(msg) {
  docFormError.textContent = msg;
  docFormError.classList.remove('hidden');
}

// ── Archive / restore ─────────────────────────────────────────────────────────

async function archiveDocument(id) {
  const doc = allDocuments.find((d) => d.id === id);
  if (!confirm(`Archive "${doc?.title ?? 'this document'}"?\n\nIt will be hidden from the main list but not deleted. You can restore it at any time.`)) return;

  const { error } = await supabaseClient
    .from('documents')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) { alert('Failed to archive: ' + error.message); return; }
  documentsLoaded = false;
  await loadDocuments();
}

async function restoreDocument(id) {
  const { error } = await supabaseClient
    .from('documents')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) { alert('Failed to restore: ' + error.message); return; }
  documentsLoaded = false;
  await loadDocuments();
}

// ── Download (signed URL, 5-minute expiry) ────────────────────────────────────

async function downloadDocument(storagePath, fileName) {
  const { data, error } = await supabaseClient.storage
    .from('governance-documents')
    .createSignedUrl(storagePath, 300);

  if (error) { alert('Could not generate download link: ' + error.message); return; }

  const a    = document.createElement('a');
  a.href     = data.signedUrl;
  a.download = fileName;
  a.click();
}

// ── Document event listeners ──────────────────────────────────────────────────

uploadDocBtn.addEventListener('click', openDocForm);
docCancelBtn.addEventListener('click', closeDocForm);
docUploadBtn.addEventListener('click', uploadDocument);

docCategorySelect.addEventListener('change', () => {
  updateSupersedesDropdown(docCategorySelect.value);
});

docList.addEventListener('click', (e) => {
  const dl  = e.target.closest('.doc-download-btn');
  if (dl)  { downloadDocument(dl.dataset.path, dl.dataset.name); return; }
  const arc = e.target.closest('.doc-archive-btn');
  if (arc) { archiveDocument(arc.dataset.id); return; }
  const tog = e.target.closest('.doc-version-toggle');
  if (tog) {
    const chainEl = document.getElementById(`doc-chain-${tog.dataset.docId}`);
    if (!chainEl) return;
    const nowHidden = chainEl.classList.toggle('hidden');
    tog.textContent = nowHidden ? tog.dataset.labelClosed : tog.dataset.labelOpen;
  }
});

archivedDocsList.addEventListener('click', (e) => {
  const dl  = e.target.closest('.doc-download-btn');
  if (dl)  { downloadDocument(dl.dataset.path, dl.dataset.name); return; }
  const rst = e.target.closest('.doc-restore-btn');
  if (rst) { restoreDocument(rst.dataset.id); }
});

toggleArchivedBtn.addEventListener('click', () => {
  const hidden = archivedDocsList.classList.toggle('hidden');
  toggleArchivedBtn.textContent = hidden
    ? `Show archived documents (${archivedDocsCount.textContent})`
    : `Hide archived documents`;
  if (!hidden) {
    const archived = allDocuments.filter((d) => d.status === 'archived');
    archivedDocsList.innerHTML = renderDocItems(sortedDocs(archived), true);
  }
});

document.querySelectorAll('.docs-sort-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.docs-sort-btn').forEach((b) => b.classList.remove('docs-sort-btn--active'));
    btn.classList.add('docs-sort-btn--active');
    docSortField = btn.dataset.sort;
    renderDocuments();
  });
});

// ── Document helpers ──────────────────────────────────────────────────────────

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024)    return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fileTypeBadge(mimeType) {
  if (!mimeType) return 'FILE';
  if (mimeType === 'application/pdf')           return 'PDF';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'DOC';
  if (mimeType.startsWith('image/'))            return 'IMG';
  return 'FILE';
}

// ── Minutes tab + owner portal ────────────────────────────────────────────────

function portalUrl(token) {
  return token ? `${location.origin}/portal.html?token=${token}` : '';
}

function renderPortalLink() {
  const token = userOrg?.portal_token;
  if (portalLinkInput) portalLinkInput.value = portalUrl(token) || '(no link yet — reload the page)';
}

async function loadMeetingsList() {
  meetingsListLoaded = true;
  minsList.innerHTML = '<div class="loading-row"><div class="spinner"></div><span>Loading…</span></div>';

  const { data, error } = await supabaseClient
    .from('meetings')
    .select('id, title, meeting_date, template, status, published, published_at, created_at')
    .eq('org_id', userOrg.id)
    .order('meeting_date', { ascending: false, nullsFirst: false });

  if (error) {
    minsList.innerHTML = `<p class="error">Failed to load: ${escHtml(error.message)}</p>`;
    return;
  }

  allMeetingsList = data ?? [];
  minsCount.textContent = `${allMeetingsList.length} meeting${allMeetingsList.length !== 1 ? 's' : ''}`;
  renderMeetingsList();
}

function renderMeetingsList() {
  if (allMeetingsList.length === 0) {
    minsList.innerHTML = `<div class="registry-empty">
      <p>No meetings yet.</p>
      <p class="field-hint">Generate your first set of minutes to start publishing.</p>
    </div>`;
    return;
  }

  minsList.innerHTML = allMeetingsList.map((m) => {
    const dateStr = m.meeting_date
      ? new Date(m.meeting_date + 'T12:00:00').toLocaleDateString('en-CA', {
          year: 'numeric', month: 'long', day: 'numeric',
        })
      : 'Date not recorded';
    const title      = m.title || 'Untitled meeting';
    const isPublished = m.published;
    const pubLabel    = isPublished
      ? `Published ${new Date(m.published_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}`
      : 'Draft — not visible to owners';

    return `<div class="mins-item${isPublished ? ' mins-item--published' : ''}">
  <div class="mins-item__meta">
    <span class="mins-item__date">${escHtml(dateStr)}</span>
    <span class="mins-item__title">${escHtml(title)}</span>
    <span class="mins-item__status${isPublished ? ' mins-item__status--pub' : ''}">${escHtml(pubLabel)}</span>
  </div>
  <div class="mins-item__actions">
    <button class="btn-link mins-view-btn" data-meeting-id="${m.id}"
            title="Preview these minutes">Preview</button>
    ${isPublished
      ? `<button class="btn-ghost btn-sm mins-unpublish-btn" data-meeting-id="${m.id}">Unpublish</button>`
      : `<button class="btn-primary btn-sm mins-publish-btn" data-meeting-id="${m.id}">Publish to portal</button>`
    }
  </div>
</div>`;
  }).join('');
}

async function publishMeeting(id) {
  const now = new Date().toISOString();
  const { error } = await supabaseClient
    .from('meetings')
    .update({ published: true, published_at: now })
    .eq('id', id);

  if (error) { alert(`Failed to publish: ${error.message}`); return; }

  const m = allMeetingsList.find((m) => m.id === id);
  if (m) { m.published = true; m.published_at = now; }
  renderMeetingsList();
}

async function unpublishMeeting(id) {
  const { error } = await supabaseClient
    .from('meetings')
    .update({ published: false, published_at: null })
    .eq('id', id);

  if (error) { alert(`Failed to unpublish: ${error.message}`); return; }

  const m = allMeetingsList.find((m) => m.id === id);
  if (m) { m.published = false; m.published_at = null; }
  renderMeetingsList();
}

async function regeneratePortalToken() {
  const confirmed = confirm(
    'This will immediately invalidate the current owner portal link.\n\n' +
    'Anyone using the old link will get a "no longer valid" message until you share the new one.\n\n' +
    'Continue?'
  );
  if (!confirmed) return;

  const { data: newToken, error } = await supabaseClient.rpc('regenerate_portal_token');
  if (error) { alert(`Failed to regenerate link: ${error.message}`); return; }

  userOrg.portal_token = newToken;
  renderPortalLink();
  portalCopyConfirm.classList.add('hidden');
}

// ── Minutes tab events ────────────────────────────────────────────────────────

portalCopyBtn.addEventListener('click', async () => {
  const url = portalUrl(userOrg?.portal_token);
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    portalCopyConfirm.classList.remove('hidden');
    setTimeout(() => portalCopyConfirm.classList.add('hidden'), 3000);
  } catch {
    portalLinkInput.select();
    document.execCommand('copy');
    portalCopyConfirm.classList.remove('hidden');
    setTimeout(() => portalCopyConfirm.classList.add('hidden'), 3000);
  }
});

portalRegenBtn.addEventListener('click', regeneratePortalToken);

minsList.addEventListener('click', (e) => {
  const publishBtn   = e.target.closest('.mins-publish-btn');
  const unpublishBtn = e.target.closest('.mins-unpublish-btn');
  const previewBtn   = e.target.closest('.mins-view-btn');
  if (publishBtn)   publishMeeting(publishBtn.dataset.meetingId);
  if (unpublishBtn) unpublishMeeting(unpublishBtn.dataset.meetingId);
  if (previewBtn)   openMeetingModal(previewBtn.dataset.meetingId);
});

// ── Governance document templates ─────────────────────────────────────────────
//
// Pure client-side generation — no AI, no API calls. Roster data pulled from
// allMembers (loaded on first visit to Members or Templates tab).

// ── Field schema ──────────────────────────────────────────────────────────────
//
// Each field object:
//   { id, type, label, required?, hint?, placeholder?, default?, fullWidth?,
//     preferRole?: string[], rows?: number }
//
// type: 'date' | 'time' | 'text' | 'textarea' | 'member' | 'member-multi'
//   member      → <select> populated from active roster; preferRole pre-selects
//   member-multi → checkboxes, all active members, all pre-checked

const TEMPLATE_DEFS = {
  agm: {
    label:    'Annual General Meeting Notice',
    filename: (org, v) =>
      `${org.name.replace(/[^a-zA-Z0-9]+/g, '_')}_AGM_Notice_${v.meeting_date || 'draft'}.docx`,
    fields: [
      { id: 'meeting_date',    type: 'date',   label: 'Meeting date',    required: true },
      { id: 'meeting_time',    type: 'time',   label: 'Meeting time',    default: '19:00',
        hint: 'Displayed as local time on the notice.' },
      { id: 'meeting_location', type: 'text',  label: 'Location',        required: true,
        placeholder: 'e.g. Building amenity room, Level 1', fullWidth: true },
      { id: 'proxy_deadline',  type: 'date',   label: 'Proxy deadline',
        hint: 'Typically 2–3 days before the meeting. Leave blank to omit the proxy section.' },
      { id: 'chairperson',     type: 'member', label: 'Chairperson',     preferRole: ['President', 'Chair'] },
      { id: 'secretary',       type: 'member', label: 'Secretary',        preferRole: ['Secretary'] },
      { id: 'extra_business',  type: 'textarea', label: 'Additional agenda items',
        placeholder: 'One item per line (e.g. Discuss building envelope inspection)', rows: 3,
        hint: 'Standard AGM items are included automatically. Add any additional business here.',
        fullWidth: true },
    ],
    generate: generateAgmNotice,
  },

  sgm: {
    label:    'Special General Meeting Notice',
    filename: (org, v) =>
      `${org.name.replace(/[^a-zA-Z0-9]+/g, '_')}_SGM_Notice_${v.meeting_date || 'draft'}.docx`,
    fields: [
      { id: 'meeting_date',    type: 'date',   label: 'Meeting date',    required: true },
      { id: 'meeting_time',    type: 'time',   label: 'Meeting time',    default: '19:00' },
      { id: 'meeting_location', type: 'text',  label: 'Location',        required: true,
        placeholder: 'e.g. Building amenity room, Level 1', fullWidth: true },
      { id: 'resolution_text', type: 'textarea', label: 'Resolution to be considered', required: true,
        placeholder: 'Enter the full text of the proposed resolution',
        hint: 'Include the complete resolution wording as it will appear on the ballot.',
        rows: 5, fullWidth: true },
      { id: 'proxy_deadline',  type: 'date',   label: 'Proxy deadline',
        hint: 'Leave blank to omit the proxy section.' },
      { id: 'chairperson',     type: 'member', label: 'Chairperson',     preferRole: ['President', 'Chair'] },
      { id: 'secretary',       type: 'member', label: 'Secretary',        preferRole: ['Secretary'] },
    ],
    generate: generateSgmNotice,
  },

  resolution: {
    label:    'Council Written Resolution',
    filename: (org, v) => {
      const num  = v.resolution_number ? `_No${v.resolution_number.replace(/\s+/g, '')}` : '';
      const date = v.resolution_date || 'draft';
      return `${org.name.replace(/[^a-zA-Z0-9]+/g, '_')}_Written_Resolution${num}_${date}.docx`;
    },
    fields: [
      { id: 'resolution_date',   type: 'date', label: 'Resolution date', required: true,
        hint: 'The date on which all signatories have signed.' },
      { id: 'resolution_number', type: 'text', label: 'Resolution number',
        placeholder: 'e.g. 2026-03',
        hint: 'Optional reference number for internal filing. Leave blank to omit.' },
      { id: 'resolution_text',   type: 'textarea', label: 'Resolution', required: true,
        placeholder: 'IT IS HEREBY RESOLVED THAT the strata council approves…',
        rows: 6, fullWidth: true },
      { id: 'signing_members',   type: 'member-multi', label: 'Signing members', required: true,
        hint: 'Under s. 26(3) of the Strata Property Act, a majority of all strata council members must sign.',
        fullWidth: true },
    ],
    generate: generateWrittenResolution,
  },
};

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderTemplateForm(templateId) {
  activeTemplate = templateId;

  // Sync selector button states
  document.querySelectorAll('.template-btn').forEach((b) => {
    b.classList.toggle('template-btn--active', b.dataset.template === templateId);
  });

  templateError.classList.add('hidden');
  const def = TEMPLATE_DEFS[templateId];
  if (!def) { templateFormArea.innerHTML = ''; return; }

  templateFormArea.innerHTML = `
    <div class="template-form">
      <h4 class="template-form__heading">${escHtml(def.label)}</h4>
      <div class="member-form__grid">${renderTemplateFields(def.fields)}</div>
    </div>`;
}

function renderTemplateFields(fields) {
  return fields.map((f) => {
    const span    = f.fullWidth ? ' style="grid-column: 1 / -1"' : '';
    const req     = f.required  ? '<span class="required-mark">*</span>' : '<span class="optional">(optional)</span>';
    const hint    = f.hint      ? `<p class="field-hint">${escHtml(f.hint)}</p>` : '';
    let   control = '';

    if (f.type === 'date') {
      control = `<input type="date" id="tpl-${f.id}" data-tpl-field="${f.id}"
                        value="${f.default || ''}">`;

    } else if (f.type === 'time') {
      control = `<input type="time" id="tpl-${f.id}" data-tpl-field="${f.id}"
                        value="${f.default || ''}">`;

    } else if (f.type === 'text') {
      const ph = f.placeholder ? `placeholder="${escHtml(f.placeholder)}"` : '';
      control = `<input type="text" id="tpl-${f.id}" data-tpl-field="${f.id}" ${ph}>`;

    } else if (f.type === 'textarea') {
      const ph   = f.placeholder ? `placeholder="${escHtml(f.placeholder)}"` : '';
      const rows = f.rows ?? 4;
      control = `<textarea id="tpl-${f.id}" data-tpl-field="${f.id}"
                           rows="${rows}" ${ph}></textarea>`;

    } else if (f.type === 'member') {
      const preselect = preferredMemberId(f.preferRole);
      const opts = allMembers
        .filter((m) => m.status === 'active')
        .map((m) => {
          const sel = m.id === preselect ? ' selected' : '';
          return `<option value="${escHtml(m.id)}"${sel}>${escHtml(m.name)}${m.role ? ` — ${escHtml(m.role)}` : ''}</option>`;
        }).join('');
      control = `<select id="tpl-${f.id}" data-tpl-field="${f.id}">
        <option value="">— select —</option>${opts}</select>`;

    } else if (f.type === 'member-multi') {
      const items = allMembers
        .filter((m) => m.status === 'active')
        .map((m) => `<label class="template-member-check">
          <input type="checkbox" data-tpl-field="${f.id}" data-member-id="${escHtml(m.id)}" checked>
          ${escHtml(m.name)}${m.role ? ` <span class="text-muted">— ${escHtml(m.role)}</span>` : ''}
        </label>`).join('');
      control = `<div class="template-member-checks">${items || '<p class="field-hint">No active members in roster. Add members in the Members tab first.</p>'}</div>`;
    }

    return `<div class="form-group"${span}>
      <label for="tpl-${f.id}">${escHtml(f.label)} ${req}</label>
      ${control}
      ${hint}
    </div>`;
  }).join('');
}

function collectTemplateValues(fields) {
  const values = {};
  for (const f of fields) {
    if (f.type === 'member-multi') {
      const checks = templateFormArea.querySelectorAll(`[data-tpl-field="${f.id}"]`);
      values[f.id] = [...checks]
        .filter((c) => c.checked)
        .map((c) => allMembers.find((m) => m.id === c.dataset.memberId))
        .filter(Boolean);
    } else {
      const el = templateFormArea.querySelector(`[data-tpl-field="${f.id}"]`);
      values[f.id] = el ? el.value.trim() : '';
    }
  }
  return values;
}

function preferredMemberId(preferRoles) {
  if (!preferRoles || !preferRoles.length) return '';
  for (const role of preferRoles) {
    const m = allMembers.find(
      (m) => m.status === 'active' && (m.role || '').toLowerCase().includes(role.toLowerCase())
    );
    if (m) return m.id;
  }
  return '';
}

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtDateLong(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-CA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function fmtDateMedium(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function fmtTime12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return m === 0 ? `${h12}:00 ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtToday() {
  return fmtDateMedium(new Date().toLocaleDateString('en-CA'));
}

function memberName(id) {
  const m = allMembers.find((m) => m.id === id);
  return m ? m.name : '';
}

function memberRole(id) {
  const m = allMembers.find((m) => m.id === id);
  return m ? (m.role || 'Council Member') : 'Council Member';
}

// ── Docx wrapper ──────────────────────────────────────────────────────────────

function wrapDocx(bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body  { font-family: "Times New Roman", Times, serif; font-size: 12pt; margin: 0; }
  h1    { font-size: 14pt; text-align: center; text-transform: uppercase; margin: 0 0 18pt; }
  h2    { font-size: 12pt; text-transform: uppercase; margin: 18pt 0 6pt; }
  p     { margin: 0 0 8pt; line-height: 1.45; }
  ol    { margin: 0 0 8pt; padding-left: 22pt; }
  li    { margin-bottom: 5pt; line-height: 1.45; }
  table { border-collapse: collapse; }
  .corp { font-weight: bold; text-align: center; }
  .sig-block table { width: 100%; }
  .sig-block td { width: 50%; padding-top: 36pt; vertical-align: top; padding-right: 24pt; }
  .disclaimer { font-size: 9pt; color: #555; margin-top: 36pt;
                border-top: 1pt solid #bbb; padding-top: 8pt; }
</style>
</head><body>${bodyHtml}</body></html>`;
}

// Two-column signature table; members laid out in pairs
function sigTable(pairs) {
  const rows = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i];
    const b = pairs[i + 1];
    const cellA = `_______________________<br><b>${escHtml(a.name)}</b><br>${escHtml(a.role)}`;
    const cellB = b ? `_______________________<br><b>${escHtml(b.name)}</b><br>${escHtml(b.role)}` : '';
    rows.push(`<tr>
      <td style="width:50%;padding-top:36pt;vertical-align:top;padding-right:24pt">${cellA}</td>
      <td style="width:50%;padding-top:36pt;vertical-align:top">${cellB}</td>
    </tr>`);
  }
  return `<table style="width:100%;border-collapse:collapse">${rows.join('')}</table>`;
}

const DOCX_DISCLAIMER =
  `<p class="disclaimer">This document was generated from a template for administrative
  convenience and has not been reviewed by legal counsel. Verify compliance with the
  Strata Property Act (BC), your corporation&#8217;s bylaws, and all applicable
  legislation before distributing any notice or executing any resolution.</p>`;

// ── Template generators ───────────────────────────────────────────────────────

function generateAgmNotice(org, members, v) {
  const corp     = escHtml(org.name);
  const dateStr  = fmtDateLong(v.meeting_date);
  const timeStr  = fmtTime12h(v.meeting_time);
  const location = escHtml(v.meeting_location);

  const extraItems = (v.extra_business || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `<li>${escHtml(s)}</li>`)
    .join('');

  const proxySection = v.proxy_deadline ? `
    <h2>Proxies</h2>
    <p>Owners who are unable to attend may vote by proxy. Completed proxy forms must be
    received by the Secretary no later than <b>${escHtml(fmtDateMedium(v.proxy_deadline))}</b>.
    A proxy must be in writing, signed by the owner, and submitted before the commencement
    of the meeting.</p>` : '';

  const chairId = v.chairperson;
  const secId   = v.secretary;
  const sigs    = [];
  if (chairId) sigs.push({ name: memberName(chairId), role: memberRole(chairId) });
  if (secId)   sigs.push({ name: memberName(secId),   role: memberRole(secId)   });

  return wrapDocx(`
    <p class="corp">${corp}</p>
    <p style="text-align:center">Notice dated ${fmtToday()}</p>

    <h1>Notice of Annual General Meeting</h1>

    <p>Notice is hereby given that the Annual General Meeting of <b>${corp}</b> will be held:</p>

    <table style="margin-left:28pt;margin-bottom:14pt;border-collapse:collapse">
      <tr><td style="padding-right:14pt"><b>Date:</b></td><td>${escHtml(dateStr)}</td></tr>
      ${timeStr ? `<tr><td style="padding-right:14pt"><b>Time:</b></td><td>${escHtml(timeStr)}</td></tr>` : ''}
      <tr><td style="padding-right:14pt"><b>Location:</b></td><td>${location}</td></tr>
    </table>

    <h2>Agenda</h2>
    <ol>
      <li>Call to order and confirmation of quorum</li>
      <li>Approval of the agenda</li>
      <li>Approval of the minutes of the previous Annual General Meeting</li>
      <li>Report of the Strata Council</li>
      <li>Presentation of financial statements</li>
      <li>Approval of the operating fund and contingency reserve fund budgets</li>
      <li>Election of strata council members for the upcoming term</li>
      ${extraItems}
      <li>Adjournment</li>
    </ol>

    ${proxySection}

    <p style="margin-top:20pt">Dated this ${escHtml(fmtToday())}.</p>
    <p>On behalf of the Strata Council of <b>${corp}</b>:</p>

    ${sigs.length ? sigTable(sigs) : ''}

    ${DOCX_DISCLAIMER}`);
}

function generateSgmNotice(org, members, v) {
  const corp        = escHtml(org.name);
  const dateStr     = fmtDateLong(v.meeting_date);
  const timeStr     = fmtTime12h(v.meeting_time);
  const location    = escHtml(v.meeting_location);
  const resolution  = escHtml(v.resolution_text || '');

  const proxySection = v.proxy_deadline ? `
    <h2>Proxies</h2>
    <p>Owners who are unable to attend may vote by proxy. Completed proxy forms must be
    received by the Secretary no later than <b>${escHtml(fmtDateMedium(v.proxy_deadline))}</b>.</p>` : '';

  const chairId = v.chairperson;
  const secId   = v.secretary;
  const sigs    = [];
  if (chairId) sigs.push({ name: memberName(chairId), role: memberRole(chairId) });
  if (secId)   sigs.push({ name: memberName(secId),   role: memberRole(secId)   });

  return wrapDocx(`
    <p class="corp">${corp}</p>
    <p style="text-align:center">Notice dated ${fmtToday()}</p>

    <h1>Notice of Special General Meeting</h1>

    <p>Notice is hereby given that a Special General Meeting of <b>${corp}</b> will be held:</p>

    <table style="margin-left:28pt;margin-bottom:14pt;border-collapse:collapse">
      <tr><td style="padding-right:14pt"><b>Date:</b></td><td>${escHtml(dateStr)}</td></tr>
      ${timeStr ? `<tr><td style="padding-right:14pt"><b>Time:</b></td><td>${escHtml(timeStr)}</td></tr>` : ''}
      <tr><td style="padding-right:14pt"><b>Location:</b></td><td>${location}</td></tr>
    </table>

    <h2>Business to be Transacted</h2>
    <p>The following resolution will be considered:</p>
    <p style="margin-left:28pt;font-style:italic">${resolution}</p>

    ${proxySection}

    <p style="margin-top:20pt">Dated this ${escHtml(fmtToday())}.</p>
    <p>On behalf of the Strata Council of <b>${corp}</b>:</p>

    ${sigs.length ? sigTable(sigs) : ''}

    ${DOCX_DISCLAIMER}`);
}

function generateWrittenResolution(org, members, v) {
  const corp          = escHtml(org.name);
  const resDate       = escHtml(fmtDateMedium(v.resolution_date));
  const resNum        = v.resolution_number
    ? `<p>Resolution No. <b>${escHtml(v.resolution_number)}</b></p>` : '';
  const resText       = escHtml(v.resolution_text || '');
  const signingMembers = v.signing_members || [];  // array of member objects
  const totalActive    = allMembers.filter((m) => m.status === 'active').length;
  const sigCount       = signingMembers.length;

  const sigPairs = signingMembers.map((m) => ({
    name: m.name,
    role: m.role || 'Council Member',
  }));

  const countLine = totalActive > 0
    ? `<p>This written resolution is signed by <b>${sigCount}</b> of <b>${totalActive}</b> strata council members.</p>`
    : '';

  // Warn in the document body if fewer than all active members signed, since
  // written resolutions typically require all members under standard bylaws.
  const incompleteNote = (totalActive > 0 && sigCount < totalActive)
    ? `<p style="margin-top:6pt;color:#b45309"><b>Note:</b> Not all active council members have signed.
       Confirm whether your corporation&#8217;s bylaws expressly authorize written resolutions
       with fewer than all council members signing before relying on this document.</p>`
    : '';

  return wrapDocx(`
    <p class="corp">${corp}</p>

    <h1>Written Resolution of the Strata Council</h1>

    ${resNum}
    <p>Date: <b>${resDate}</b></p>

    <h2>Resolution</h2>
    <p>IT IS HEREBY RESOLVED THAT:</p>
    <p style="margin-left:28pt">${resText}</p>

    ${countLine}
    ${incompleteNote}

    <p style="margin-top:8pt">The undersigned strata council members hereby consent to and adopt
    the above resolution in lieu of a council meeting, pursuant to the strata
    corporation&#8217;s bylaws.</p>

    ${sigPairs.length ? sigTable(sigPairs) : '<p><em>No signing members selected.</em></p>'}

    ${DOCX_DISCLAIMER}`);
}

// ── Template events ───────────────────────────────────────────────────────────

document.querySelectorAll('.template-btn').forEach((btn) => {
  btn.addEventListener('click', () => renderTemplateForm(btn.dataset.template));
});

templateDownloadBtn.addEventListener('click', () => {
  const def    = TEMPLATE_DEFS[activeTemplate];
  const values = collectTemplateValues(def.fields);
  templateError.classList.add('hidden');

  // Validate required fields
  for (const f of def.fields) {
    if (!f.required) continue;
    if (f.type === 'member-multi') {
      if (!values[f.id] || values[f.id].length === 0) {
        templateError.textContent = `Please select at least one signing member.`;
        templateError.classList.remove('hidden');
        return;
      }
    } else if (!values[f.id]) {
      templateError.textContent = `Please fill in: ${f.label}`;
      templateError.classList.remove('hidden');
      return;
    }
  }

  // Non-blocking warning for written resolutions with partial sign-off
  if (activeTemplate === 'resolution') {
    const totalActive = allMembers.filter((m) => m.status === 'active').length;
    const sigCount    = (values['signing_members'] || []).length;
    if (totalActive > 0 && sigCount < totalActive) {
      templateError.textContent =
        `Warning: ${totalActive - sigCount} active council member(s) not included. ` +
        `Written resolutions typically require all members to sign — check your bylaws.`;
      templateError.style.color = '#b45309';  // amber — advisory, not blocking
      templateError.classList.remove('hidden');
      // Continue to download
    } else {
      templateError.style.color = '';  // reset to default error red for future errors
    }
  } else {
    templateError.style.color = '';
  }

  const html  = def.generate(userOrg, allMembers, values);
  const blob  = htmlDocx.asBlob(html, { orientation: 'portrait' });
  const fname = def.filename(userOrg, values);
  const url   = URL.createObjectURL(blob);
  const a     = Object.assign(document.createElement('a'), { href: url, download: fname });
  a.click();
  URL.revokeObjectURL(url);
});

// ── Alteration Requests ───────────────────────────────────────────────────────

async function callBoardEdgeFunction(name, body) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const resp = await fetch(`${CONFIG.supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey':        CONFIG.supabaseAnonKey,
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || resp.statusText);
  return json;
}

async function loadAlterations() {
  altList.innerHTML = '<div class="loading-row"><div class="spinner"></div><span>Loading requests…</span></div>';

  const { data, error } = await supabaseClient
    .from('alteration_requests')
    .select('id, owner_name, strata_lot, description, formal_request, status, date_submitted, decision_date, conditions, request_doc_path, approval_doc_path')
    .eq('org_id', userOrg.id)
    .order('date_submitted', { ascending: false })
    .order('created_at',     { ascending: false });

  if (error) {
    altList.innerHTML = `<p class="error">Failed to load requests: ${escHtml(error.message)}</p>`;
    return;
  }

  allAlterationRequests = data ?? [];
  alterationsLoaded = true;
  renderAlterations();
}

function renderAlterations() {
  const total = allAlterationRequests.length;
  altCount.textContent = `${total} request${total !== 1 ? 's' : ''}`;

  if (total === 0) {
    altList.innerHTML = `
      <div class="registry-empty">
        <p>No alteration requests yet.</p>
        <p class="field-hint">Use the form above to draft the first request.</p>
      </div>`;
    return;
  }

  altList.innerHTML = allAlterationRequests.map((r) => {
    const dateStr = r.date_submitted
      ? new Date(r.date_submitted + 'T12:00:00').toLocaleDateString('en-CA', {
          year: 'numeric', month: 'long', day: 'numeric',
        })
      : '';
    const decisionStr = r.decision_date
      ? new Date(r.decision_date + 'T12:00:00').toLocaleDateString('en-CA', {
          year: 'numeric', month: 'long', day: 'numeric',
        })
      : '';

    const slug       = r.strata_lot.replace(/\s+/g, '_');
    const reqDlBtn   = r.request_doc_path
      ? `<button class="btn-link alt-dl-btn" data-path="${escHtml(r.request_doc_path)}" data-name="AltRequest_${escHtml(slug)}.docx">Request .docx ↓</button>`
      : '';
    const appDlBtn   = r.approval_doc_path
      ? `<button class="btn-link alt-dl-btn" data-path="${escHtml(r.approval_doc_path)}" data-name="AltDecision_${escHtml(slug)}.docx">Decision letter .docx ↓</button>`
      : '';
    const issueBtn   = r.status === 'pending'
      ? `<button class="btn-link alt-issue-btn" data-id="${r.id}">Issue decision letter →</button>`
      : '';
    const withdrawBtn = r.status === 'pending'
      ? `<button class="btn-link alt-withdraw-btn" data-id="${r.id}">Withdraw</button>`
      : '';

    return `<div class="motion-card">
  <div class="motion-card__header">
    <span class="result-badge result-badge--${r.status}">${r.status}</span>
    <span class="motion-card__date">${dateStr}</span>
    <strong>${escHtml(r.owner_name)}</strong>
    <span class="text-muted">&nbsp;·&nbsp;${escHtml(r.strata_lot)}</span>
  </div>
  <p class="motion-card__description">${escHtml(r.formal_request)}</p>
  ${r.conditions ? `<p class="motion-card__meta"><em>Conditions:</em> ${escHtml(r.conditions)}</p>` : ''}
  ${decisionStr && r.status !== 'pending' ? `<p class="motion-card__meta">Decision: ${decisionStr}</p>` : ''}
  <div style="display:flex;flex-wrap:wrap;gap:1rem;margin-top:0.5rem">
    ${reqDlBtn}${appDlBtn}${issueBtn}${withdrawBtn}
  </div>
</div>`;
  }).join('');
}

async function draftAlterationRequest() {
  const ownerName   = altOwnerNameInput.value.trim();
  const strataLot   = altStrataLotInput.value.trim();
  const description = altDescriptionInput.value.trim();

  altDraftError.classList.add('hidden');

  if (!ownerName || !strataLot || !description) {
    altDraftError.textContent = 'Owner name, strata lot, and description are all required.';
    altDraftError.classList.remove('hidden');
    return;
  }

  altDraftBtn.disabled    = true;
  altDraftBtn.textContent = 'Drafting…';

  try {
    const result = await callBoardEdgeFunction('draft-alteration-request', {
      orgName: userOrg.name,
      ownerName,
      strataLot,
      description,
    });

    altDraftedFormal = result.formalRequest;

    altPreviewEl.innerHTML = buildRequestPreviewHtml({
      ownerName,
      strataLot,
      formalRequest: altDraftedFormal,
      dateSubmitted: new Date().toLocaleDateString('en-CA', {
        year: 'numeric', month: 'long', day: 'numeric',
      }),
    });
    altPreviewSection.classList.remove('hidden');
    altPreviewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    altDraftError.textContent = `Drafting failed: ${err.message}`;
    altDraftError.classList.remove('hidden');
  } finally {
    altDraftBtn.disabled    = false;
    altDraftBtn.textContent = 'Draft formal request';
  }
}

function buildRequestPreviewHtml({ ownerName, strataLot, formalRequest, dateSubmitted }) {
  const paras = formalRequest.split(/\n\n+/).filter(Boolean)
    .map((p) => `<p style="margin:0 0 0.7em">${escHtml(p.trim())}</p>`).join('');

  return `<div class="agenda-doc">
  <div class="agenda-header">
    <h2>${escHtml(userOrg.name)}</h2>
    <p><strong>OWNER ALTERATION REQUEST</strong></p>
  </div>
  <table class="alt-meta-table">
    <tr><td><strong>Date Submitted</strong></td><td>${escHtml(dateSubmitted)}</td></tr>
    <tr><td><strong>Strata Lot</strong></td><td>${escHtml(strataLot)}</td></tr>
    <tr><td><strong>Owner Name</strong></td><td>${escHtml(ownerName)}</td></tr>
  </table>
  <h3 class="alt-section-heading">Proposed Alteration</h3>
  ${paras}
  <h3 class="alt-section-heading">Owner Confirmations</h3>
  <p>The owner confirms that the proposed alteration:</p>
  <ul>
    <li>Will be carried out in a workmanlike manner;</li>
    <li>Will comply with all applicable bylaws and rules of the strata corporation;</li>
    <li>Does not affect the structure of the building, any common property systems, or the interests of any other strata lot; and</li>
    <li>Will be maintained in good condition at the owner's sole expense.</li>
  </ul>
  <h3 class="alt-section-heading">Owner Acknowledgment</h3>
  <p>By signing below, the owner acknowledges that this request requires Strata Council approval before any work commences, and that proceeding without approval may result in a requirement to restore the strata lot and/or common property at the owner's expense.</p>
  <p style="margin-top:1.5rem">Owner Signature: _______________________________&nbsp;&nbsp;&nbsp; Date: _______________</p>
  <p>Printed Name: ${escHtml(ownerName)}</p>
  <p>Strata Lot: ${escHtml(strataLot)}</p>
</div>`;
}

function buildRequestDocHtml({ ownerName, strataLot, formalRequest, dateSubmitted, orgName }) {
  const paras = formalRequest.split(/\n\n+/).filter(Boolean)
    .map((p) => `<p>${escHtml(p.trim())}</p>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body  { font-family: Calibri, Arial, sans-serif; font-size: 11pt; margin: 0; line-height: 1.25; }
  .org  { font-size: 13pt; font-weight: bold; text-align: center; margin: 0; }
  .sub  { text-align: center; color: #333; margin: 0; font-size: 11pt; letter-spacing: 0.04em; }
  hr    { border: none; border-top: 1pt solid #888; margin: 3pt 0; }
  table { border-collapse: collapse; margin: 0; width: 100%; }
  td    { padding: 1pt 10pt 1pt 0; vertical-align: top; }
  td:first-child { font-weight: bold; width: 110pt; }
  h2    { font-size: 11pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.04em; margin: 9pt 0 3pt; }
  p     { margin: 0 0 5pt; }
  ul    { margin: 2pt 0 6pt; padding-left: 16pt; }
  li    { margin-bottom: 2pt; }
  .sig  { margin-top: 16pt; }
</style></head><body>
<p class="org">${escHtml(orgName)}</p>
<p class="sub">OWNER ALTERATION REQUEST</p>
<hr>
<table>
  <tr><td>Date Submitted:</td><td>${escHtml(dateSubmitted)}</td></tr>
  <tr><td>Strata Lot:</td><td>${escHtml(strataLot)}</td></tr>
  <tr><td>Owner Name:</td><td>${escHtml(ownerName)}</td></tr>
</table>
<hr>
<h2>Proposed Alteration</h2>
${paras}
<h2>Owner Confirmations</h2>
<p>The owner confirms that the proposed alteration:</p>
<ul>
  <li>Will be carried out in a workmanlike manner;</li>
  <li>Will comply with all applicable bylaws and rules of the strata corporation;</li>
  <li>Does not affect the structure of the building, any common property systems, or the interests of any other strata lot; and</li>
  <li>Will be maintained in good condition at the owner's sole expense.</li>
</ul>
<h2>Owner Acknowledgment</h2>
<p>By signing below, the owner acknowledges that this request requires Strata Council approval before any work commences, and that proceeding without approval may result in a requirement to restore the strata lot and/or common property at the owner's expense.</p>
<div class="sig">
  <p>Owner Signature: &nbsp;_____________________________&nbsp;&nbsp;&nbsp; Date: _______________</p>
  <p>Printed Name: ${escHtml(ownerName)}</p>
  <p>Strata Lot: ${escHtml(strataLot)}</p>
</div>
</body></html>`;
}

async function saveAlterationRequest() {
  const ownerName   = altOwnerNameInput.value.trim();
  const strataLot   = altStrataLotInput.value.trim();
  const description = altDescriptionInput.value.trim();
  const today       = new Date().toISOString().slice(0, 10);

  if (!altDraftedFormal) return;

  altSaveBtn.disabled    = true;
  altSaveBtn.textContent = 'Saving…';
  altDraftError.classList.add('hidden');

  try {
    const { data: reqRow, error: reqErr } = await supabaseClient
      .from('alteration_requests')
      .insert({
        org_id:         userOrg.id,
        user_id:        currentUser.id,
        owner_name:     ownerName,
        strata_lot:     strataLot,
        description,
        formal_request: altDraftedFormal,
        date_submitted: today,
      })
      .select('id')
      .single();
    if (reqErr) throw reqErr;

    const dateStr   = new Date(today + 'T12:00:00').toLocaleDateString('en-CA', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const docHtml   = buildRequestDocHtml({ ownerName, strataLot, formalRequest: altDraftedFormal, dateSubmitted: dateStr, orgName: userOrg.name });
    const blob      = htmlDocx.asBlob(docHtml, { orientation: 'portrait', margins: { top: 720, right: 720, bottom: 720, left: 720 } });
    const slug      = strataLot.replace(/[^a-zA-Z0-9]+/g, '_');
    const storagePath = `${userOrg.id}/alterations/${reqRow.id}_request.docx`;
    const fileName  = `AltRequest_${slug}_${today}.docx`;

    const { error: uploadErr } = await supabaseClient.storage
      .from('governance-documents')
      .upload(storagePath, blob, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: false,
      });
    if (uploadErr) throw uploadErr;

    const { error: docErr } = await supabaseClient.from('documents').insert({
      org_id:       userOrg.id,
      user_id:      currentUser.id,
      title:        `Alteration Request — ${ownerName} (${strataLot})`,
      category:     'Alteration Requests',
      storage_path: storagePath,
      file_name:    fileName,
      file_size:    blob.size,
      mime_type:    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    if (docErr) throw docErr;

    await supabaseClient
      .from('alteration_requests')
      .update({ request_doc_path: storagePath, updated_at: new Date().toISOString() })
      .eq('id', reqRow.id);

    triggerDownload(blob, fileName);

    altOwnerNameInput.value   = '';
    altStrataLotInput.value   = '';
    altDescriptionInput.value = '';
    altDraftedFormal          = null;
    altPreviewSection.classList.add('hidden');

    alterationsLoaded = false;
    await loadAlterations();
    showToast('Request saved and downloaded.', 'success');
  } catch (err) {
    altDraftError.textContent = `Failed to save: ${err.message}`;
    altDraftError.classList.remove('hidden');
  } finally {
    altSaveBtn.disabled    = false;
    altSaveBtn.textContent = 'Save & Download .docx';
  }
}

async function openApprovalForm(requestId) {
  activeApprovalId = requestId;
  const req = allAlterationRequests.find((r) => r.id === requestId);
  if (!req) return;

  const dateStr = req.date_submitted
    ? new Date(req.date_submitted + 'T12:00:00').toLocaleDateString('en-CA', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : '';

  altApprovalContext.innerHTML = `
    <table class="alt-meta-table" style="margin-bottom:0.75rem">
      <tr><td><strong>Owner</strong></td><td>${escHtml(req.owner_name)}</td></tr>
      <tr><td><strong>Strata Lot</strong></td><td>${escHtml(req.strata_lot)}</td></tr>
      <tr><td><strong>Date Submitted</strong></td><td>${dateStr}</td></tr>
    </table>
    <blockquote class="alt-request-quote">${escHtml(req.description)}</blockquote>`;

  altDecisionDate.value    = new Date().toISOString().slice(0, 10);
  altConditionsInput.value = '';
  altApprovalError.classList.add('hidden');
  document.querySelector('input[name="alt-decision"][value="approved"]').checked = true;

  altMotionSelect.innerHTML = '<option value="">None — not linked to a recorded motion</option>';
  allMotions.forEach((m) => {
    const mtg   = m.meetings ?? {};
    const dStr  = mtg.meeting_date
      ? new Date(mtg.meeting_date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    const label = `${dStr ? dStr + ' — ' : ''}${m.description.slice(0, 60)}${m.description.length > 60 ? '…' : ''}`;
    const opt   = Object.assign(document.createElement('option'), { value: m.id, textContent: label });
    altMotionSelect.appendChild(opt);
  });

  altSignerSelect.innerHTML = '<option value="">Select from roster…</option>';
  if (!membersLoaded) await loadMembers();
  allMembers.filter((m) => m.status === 'active').forEach((m) => {
    const opt = Object.assign(document.createElement('option'), {
      value:       JSON.stringify({ name: m.name, role: m.role }),
      textContent: `${m.name} — ${m.role}`,
    });
    altSignerSelect.appendChild(opt);
  });

  altApprovalSection.classList.remove('hidden');
  altApprovalSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildApprovalLetterHtml({ orgName, ownerName, strataLot, informalDescription, requestDateStr, decision, conditions, decisionDateStr, signerName, signerRole, noticeDays, includeNonTransfer }) {
  const decisionLabel  = decision === 'approved' ? 'APPROVED' : 'DENIED';
  const decisionColour = decision === 'approved' ? '#1a5c38' : '#8b1a1a';

  let conditionsHtml = '';
  if (conditions) {
    const lines = conditions.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 1) {
      conditionsHtml = decision === 'approved'
        ? `<h2>Conditions of Approval</h2><p>${escHtml(lines[0])}</p>`
        : `<h2>Reasons for Denial</h2><p>${escHtml(lines[0])}</p>`;
    } else {
      const listItems = lines.map((l) => `<li>${escHtml(l)}</li>`).join('');
      conditionsHtml = decision === 'approved'
        ? `<h2>Conditions of Approval</h2><p>This authorization is granted subject to the following conditions:</p><ol>${listItems}</ol>`
        : `<h2>Reasons for Denial</h2><ol>${listItems}</ol>`;
    }
  }

  // Standard Term 3 — removal on non-compliance; notice period is a board policy
  // choice set by the secretary in the form (default 30 days, not a fixed SPA requirement).
  const removalClause = decision === 'approved'
    ? `<li>If the owner fails to comply with any condition of this authorization, the Strata Council may, after providing at least ${escHtml(String(noticeDays))} days' written notice, require the owner to remove the alteration and restore the area to its original condition at the owner's expense. If the owner does not comply within the time stated in the notice, the strata corporation may carry out the work and recover the reasonable costs as a strata fee debt in accordance with the <em>Strata Property Act</em>.</li>`
    : '';

  // Standard Term 4 — non-transferability; included by default, removable via UI
  // checkbox for permanent structural alterations that reasonably run with the lot.
  const transferClause = (decision === 'approved' && includeNonTransfer)
    ? `<li>This authorization applies to the current owner of Strata Lot ${escHtml(strataLot)} only. A subsequent owner wishing to maintain the alteration must apply to the Strata Council for new authorization.</li>`
    : '';

  const maintenanceClause = decision === 'approved'
    ? `<li>The owner must maintain the alteration in good repair and in clean and safe condition at all times, in compliance with the strata corporation's bylaws and rules and the <em>Strata Property Act</em>.</li>`
    : '';

  // Standard Term 4 (denial) — non-waiver boilerplate regardless of transferability setting
  const nonWaiverClause = `<li>This ${decision === 'approved' ? 'authorization' : 'decision'} does not constitute an amendment to the strata plan, a change in the designation of any common property, or a waiver of any provision of the strata corporation's bylaws, rules, or the <em>Strata Property Act</em>.</li>`;

  // Denial: always include a reapply note — most useful exactly when the owner
  // knows what to fix. Tailor wording based on whether reasons were given.
  const reapplyNote = decision === 'denied'
    ? `<p>${conditions
        ? 'You may reapply to the Strata Council once the concerns above have been addressed.'
        : 'You may reapply to the Strata Council for reconsideration.'
      }</p>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body  { font-family: Calibri, Arial, sans-serif; font-size: 11pt; margin: 0; line-height: 1.3; }
  .org  { font-size: 13pt; font-weight: bold; margin: 0 0 18pt; }
  h2    { font-size: 11pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.04em; margin: 14pt 0 6pt; }
  p     { margin: 0 0 8pt; }
  ol    { margin: 4pt 0 10pt; padding-left: 18pt; }
  li    { margin-bottom: 6pt; line-height: 1.4; }
  .re   { font-weight: bold; margin: 14pt 0 8pt; }
  .dec  { font-size: 12pt; font-weight: bold; margin: 14pt 0; color: ${decisionColour}; }
  .quo  { border-left: 3pt solid #ccc; padding: 5pt 10pt; margin: 6pt 0 14pt; font-style: italic; color: #444; }
  hr    { border: none; border-top: 1pt solid #ccc; margin: 16pt 0; }
  .sig  { margin-top: 32pt; }
</style></head><body>
<p class="org">${escHtml(orgName)}</p>
<p>${escHtml(decisionDateStr)}</p>
<p style="margin-top:14pt">${escHtml(ownerName)}<br>Strata Lot ${escHtml(strataLot)}<br>${escHtml(orgName)}</p>
<p class="re">RE: OWNER ALTERATION REQUEST — STRATA LOT ${escHtml(strataLot)}</p>
<p>Dear ${escHtml(ownerName)},</p>
<p>The Strata Council of ${escHtml(orgName)} has reviewed your alteration request dated ${escHtml(requestDateStr)}, regarding:</p>
<div class="quo">${escHtml(informalDescription)}</div>
<p class="dec">DECISION: ${decisionLabel}</p>
${conditionsHtml}
${reapplyNote}
<h2>Standard Terms</h2>
<ol>
  <li>The owner assumes full responsibility and liability for any damage to common property, limited common property, or other strata lots arising from the installation, existence, use, or removal of the alteration.</li>
  ${nonWaiverClause}
  ${removalClause}
  ${transferClause}
  ${maintenanceClause}
  <!-- PENDING LEGAL REVIEW — Standard Term: Indemnification
       The scope of this clause (in particular whether to carve out the corporation's
       own negligence) is genuine contract-law nuance that has NOT been reviewed by
       legal counsel. The broad placeholder below must be reviewed by a lawyer before
       this feature is recommended for use by strata corporations other than KAS 1117.
       Do not remove this comment until that review is complete and the clause is
       finalized. -->
  <li>The owner agrees to indemnify and save harmless the Strata Corporation and its council members, officers, and agents from any claims, costs, damages, or liabilities arising from the installation, existence, use, maintenance, or removal of the alteration. [PENDING LEGAL REVIEW]</li>
</ol>
<hr>
<p style="font-size:9.5pt;color:#555">Authorized by the Strata Council of ${escHtml(orgName)}.</p>
<div class="sig">
  <p>_______________________________</p>
  <p>${escHtml(signerName)}${signerRole ? ', ' + escHtml(signerRole) : ''}</p>
  <p>On behalf of the Strata Council<br>${escHtml(orgName)}</p>
  <p style="margin-top:10pt">Date: _______________</p>
</div>
</body></html>`;
}

async function generateDecisionLetter() {
  const req = allAlterationRequests.find((r) => r.id === activeApprovalId);
  if (!req) return;

  const decisionRadio    = document.querySelector('input[name="alt-decision"]:checked');
  const decision         = decisionRadio?.value ?? 'approved';
  const decisionDate     = altDecisionDate.value;
  const conditions       = altConditionsInput.value.trim();
  const motionId         = altMotionSelect.value || null;
  const signerRaw        = altSignerSelect.value;
  const noticeDays       = parseInt(altNoticeDays.value, 10) || 30;
  const includeNonTransfer = altNonTransfer.checked;

  altApprovalError.classList.add('hidden');

  if (!decisionDate) {
    altApprovalError.textContent = 'Decision date is required.';
    altApprovalError.classList.remove('hidden');
    return;
  }
  if (!signerRaw) {
    altApprovalError.textContent = 'Select an authorized signatory from the roster.';
    altApprovalError.classList.remove('hidden');
    return;
  }

  const signer = JSON.parse(signerRaw);

  altGenerateApprovalBtn.disabled    = true;
  altGenerateApprovalBtn.textContent = 'Generating…';

  try {
    const requestDateStr  = req.date_submitted
      ? new Date(req.date_submitted + 'T12:00:00').toLocaleDateString('en-CA', {
          year: 'numeric', month: 'long', day: 'numeric',
        })
      : '';
    const decisionDateStr = new Date(decisionDate + 'T12:00:00').toLocaleDateString('en-CA', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    const letterHtml  = buildApprovalLetterHtml({
      orgName:             userOrg.name,
      ownerName:           req.owner_name,
      strataLot:           req.strata_lot,
      informalDescription: req.description,
      requestDateStr,
      decision,
      conditions,
      decisionDateStr,
      signerName:          signer.name,
      signerRole:          signer.role,
      noticeDays,
      includeNonTransfer,
    });

    const blob        = htmlDocx.asBlob(letterHtml, { orientation: 'portrait', margins: { top: 720, right: 720, bottom: 720, left: 720 } });
    const slug        = req.strata_lot.replace(/[^a-zA-Z0-9]+/g, '_');
    const storagePath = `${userOrg.id}/alterations/${req.id}_decision.docx`;
    const fileName    = `AltDecision_${slug}_${decisionDate}.docx`;

    const { error: uploadErr } = await supabaseClient.storage
      .from('governance-documents')
      .upload(storagePath, blob, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      });
    if (uploadErr) throw uploadErr;

    const { error: docErr } = await supabaseClient.from('documents').insert({
      org_id:       userOrg.id,
      user_id:      currentUser.id,
      title:        `Alteration ${decision === 'approved' ? 'Authorization' : 'Denial'} — ${req.owner_name} (${req.strata_lot})`,
      category:     'Alteration Requests',
      storage_path: storagePath,
      file_name:    fileName,
      file_size:    blob.size,
      mime_type:    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    if (docErr) throw docErr;

    await supabaseClient
      .from('alteration_requests')
      .update({
        status:            decision,
        decision_date:     decisionDate,
        conditions:        conditions || null,
        motion_id:         motionId,
        approval_doc_path: storagePath,
        updated_at:        new Date().toISOString(),
      })
      .eq('id', req.id);

    triggerDownload(blob, fileName);
    altApprovalSection.classList.add('hidden');
    activeApprovalId  = null;
    alterationsLoaded = false;
    await loadAlterations();
    showToast('Decision letter saved and downloaded.', 'success');
  } catch (err) {
    altApprovalError.textContent = `Failed to generate: ${err.message}`;
    altApprovalError.classList.remove('hidden');
  } finally {
    altGenerateApprovalBtn.disabled    = false;
    altGenerateApprovalBtn.textContent = 'Generate decision letter';
  }
}

async function withdrawAlterationRequest(id) {
  if (!confirm('Mark this request as withdrawn? This cannot be undone.')) return;

  const { error } = await supabaseClient
    .from('alteration_requests')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) { alert(`Failed to withdraw: ${error.message}`); return; }
  alterationsLoaded = false;
  await loadAlterations();
}

altDraftBtn.addEventListener('click', draftAlterationRequest);

altSaveBtn.addEventListener('click', saveAlterationRequest);

altDiscardBtn.addEventListener('click', () => {
  altDraftedFormal = null;
  altPreviewSection.classList.add('hidden');
  altOwnerNameInput.focus();
});

altList.addEventListener('click', (e) => {
  const issueBtn    = e.target.closest('.alt-issue-btn');
  const withdrawBtn = e.target.closest('.alt-withdraw-btn');
  const dlBtn       = e.target.closest('.alt-dl-btn');
  if (issueBtn)    openApprovalForm(issueBtn.dataset.id);
  if (withdrawBtn) withdrawAlterationRequest(withdrawBtn.dataset.id);
  if (dlBtn)       downloadDocument(dlBtn.dataset.path, dlBtn.dataset.name);
});

altGenerateApprovalBtn.addEventListener('click', generateDecisionLetter);

altCancelApprovalBtn.addEventListener('click', () => {
  altApprovalSection.classList.add('hidden');
  activeApprovalId = null;
});
