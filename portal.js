// ── MinuteHand Owner Portal ───────────────────────────────────────────────────
//
// Public read-only view of a strata corporation's published meeting minutes.
// No authentication — access is controlled entirely by the portal_token in the URL.
//
// What this script can access via the Supabase anon key:
//   get_portal_org_name(p_token)  → TEXT or null
//   get_portal_meetings(p_token)  → TABLE of published meetings
//
// Nothing else. Direct table queries are blocked by RLS (anon has no table grants).
// The token is 256 bits of random data — brute force is not practical.

if (typeof CONFIG === 'undefined') {
  console.error('MinuteHand portal: config.js not loaded.');
}

const portalClient = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── DOM refs ──────────────────────────────────────────────────────────────────

const orgNameEl  = document.getElementById('portal-org-name');
const loadingEl  = document.getElementById('portal-loading');
const errorEl    = document.getElementById('portal-error');
const errorMsgEl = document.getElementById('portal-error-msg');
const emptyEl    = document.getElementById('portal-empty');
const listEl     = document.getElementById('portal-list');

// ── In-memory store ───────────────────────────────────────────────────────────
// Keeps markdown out of the DOM until needed; avoids encoding large strings
// as HTML data attributes.

const meetingsData = new Map(); // UUID → meeting object from DB

// ── Token ─────────────────────────────────────────────────────────────────────

const portalToken = new URLSearchParams(location.search).get('token') || '';

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  if (!portalToken || portalToken.length < 32) {
    showError('Invalid or missing access link. Contact your strata council for the correct link.');
    return;
  }

  // One round-trip: parallel fetches for name + meetings
  const [nameRes, meetingsRes] = await Promise.all([
    portalClient.rpc('get_portal_org_name', { p_token: portalToken }),
    portalClient.rpc('get_portal_meetings', { p_token: portalToken }),
  ]);

  loadingEl.classList.add('hidden');

  if (nameRes.error || !nameRes.data) {
    showError(
      'This link is no longer valid or has been regenerated. ' +
      'Contact your strata council for an updated link.'
    );
    return;
  }

  const orgName  = nameRes.data;
  const meetings = meetingsRes.data ?? [];

  orgNameEl.textContent = orgName;
  document.title        = `${orgName} — Meeting Minutes`;

  if (meetings.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }

  // Populate in-memory store before rendering
  meetings.forEach((m) => meetingsData.set(m.id, m));
  renderMeetings(meetings);
})();

// ── Render ────────────────────────────────────────────────────────────────────

function renderMeetings(meetings) {
  listEl.innerHTML = meetings.map((m, i) => {
    const dateStr = m.meeting_date
      ? new Date(m.meeting_date + 'T12:00:00').toLocaleDateString('en-CA', {
          year: 'numeric', month: 'long', day: 'numeric',
        })
      : 'Date not recorded';
    const pubStr = m.published_at
      ? 'Published ' + new Date(m.published_at).toLocaleDateString('en-CA', {
          year: 'numeric', month: 'short', day: 'numeric',
        })
      : '';
    const badge  = meetingTypeBadge(m.template);
    const title  = m.title || 'Meeting Minutes';
    const openCls = i === 0 ? ' portal-meeting--open' : '';

    return `<div class="portal-meeting${openCls}" data-meeting-id="${escHtml(m.id)}">
  <div class="portal-meeting__header" role="button" tabindex="0"
       aria-expanded="${i === 0}"
       onclick="toggleMeeting(this.closest('.portal-meeting'))"
       onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleMeeting(this.closest('.portal-meeting'))}">
    <span class="portal-meeting__date">${escHtml(dateStr)}</span>
    <span class="portal-meeting__title">${escHtml(title)}</span>
    ${badge ? `<span class="portal-meeting__badge">${escHtml(badge)}</span>` : ''}
    <span class="portal-meeting__toggle" aria-hidden="true">&#9660;</span>
  </div>
  <div class="portal-meeting__body">
    <div class="portal-minutes-content"></div>
    <div class="portal-meeting__actions">
      <button class="btn-secondary portal-dl-btn"
              onclick="downloadMinutes('${escHtml(m.id)}')"
              title="Download these minutes as a Word document">
        Download .docx
      </button>
      ${pubStr ? `<span class="portal-v1-note">${escHtml(pubStr)}</span>` : ''}
    </div>
  </div>
</div>`;
  }).join('');

  listEl.classList.remove('hidden');

  // Render the first card immediately (it starts open)
  const firstCard = listEl.querySelector('.portal-meeting');
  if (firstCard) renderCardMarkdown(firstCard);
}

// ── Expand / collapse ─────────────────────────────────────────────────────────

function toggleMeeting(card) {
  const isOpen = card.classList.toggle('portal-meeting--open');
  card.querySelector('.portal-meeting__header').setAttribute('aria-expanded', String(isOpen));
  if (isOpen) renderCardMarkdown(card);
}

function renderCardMarkdown(card) {
  const contentEl = card.querySelector('.portal-minutes-content');
  if (!contentEl || contentEl.dataset.rendered) return;

  const m  = meetingsData.get(card.dataset.meetingId);
  const md = m?.markdown || '';

  // Same blockquote pre-processor as board.js openMeetingModal
  const processed = md.replace(/^(> .+)\n(?=> )/gm, '$1\n\n');
  contentEl.innerHTML     = marked.parse(processed);
  contentEl.dataset.rendered = '1';
}

// ── Download ──────────────────────────────────────────────────────────────────

function downloadMinutes(meetingId) {
  const m = meetingsData.get(meetingId);
  if (!m) return;

  const card      = listEl.querySelector(`[data-meeting-id="${meetingId}"]`);
  const contentEl = card?.querySelector('.portal-minutes-content');

  // Ensure rendered so we can lift the HTML
  if (contentEl && !contentEl.dataset.rendered) renderCardMarkdown(card);
  const bodyHtml = contentEl?.innerHTML || marked.parse(m.markdown || '');

  const orgName = orgNameEl.textContent || 'Strata Corporation';
  const dateStr = m.meeting_date
    ? new Date(m.meeting_date + 'T12:00:00').toLocaleDateString('en-CA', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : '';
  const title = m.title || 'Meeting Minutes';

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body        { font-family: Calibri, Arial, sans-serif; font-size: 11pt; margin: 2cm; }
  h1          { font-size: 14pt; margin: 0 0 4pt; }
  h2          { font-size: 12pt; margin: 14pt 0 4pt; }
  h3          { font-size: 11pt; margin: 10pt 0 3pt; }
  p           { margin: 0 0 6pt; line-height: 1.4; }
  ul, ol      { margin: 0 0 6pt 18pt; }
  li          { margin-bottom: 3pt; }
  blockquote  { margin: 4pt 0 4pt 14pt; padding-left: 8pt;
                border-left: 2pt solid #bbb; color: #555; font-style: italic; }
  .doc-header { border-bottom: 1pt solid #888; padding-bottom: 6pt; margin-bottom: 14pt; }
  .doc-footer { margin-top: 28pt; font-size: 9pt; color: #888;
                border-top: 1pt solid #ccc; padding-top: 6pt; }
</style>
</head><body>
<div class="doc-header">
  <h1>${escHtml(orgName)}</h1>
  <p>${escHtml(title)}${dateStr ? ' — ' + escHtml(dateStr) : ''}</p>
</div>
${bodyHtml}
<div class="doc-footer">
  Downloaded from the MinuteHand owner portal &mdash; read-only copy. Contact your
  strata council with any questions about the content.
</div>
</body></html>`;

  const blob  = htmlDocx.asBlob(fullHtml, { orientation: 'portrait' });
  const slug  = orgName.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30);
  const date  = m.meeting_date || meetingId.slice(0, 8);
  const fname = `${slug}_Minutes_${date}.docx`;
  const url   = URL.createObjectURL(blob);
  const a     = Object.assign(document.createElement('a'), { href: url, download: fname });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showError(msg) {
  loadingEl.classList.add('hidden');
  errorMsgEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function meetingTypeBadge(template) {
  const map = { STRATA_AGM: 'AGM', STRATA_SGM: 'SGM' };
  return map[template] ?? '';
}
