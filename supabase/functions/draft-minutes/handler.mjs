// draft-minutes: the request handling, with its database and model passed in so tests can
// drive it with fakes. index.ts wires in the real ones.
//
// Four actions, all for organization owners and admins (the secretary):
//   check    reports the gaps, and whether a draft the browser kept still matches the entries
//   draft    asks the model to write the sentences, checks the result in code, and returns it
//   approve  re-checks the (possibly edited) draft against the saved entries, then saves a version
//   reopen   takes an approved meeting back to review (and unpublishes it if it was published)

import { TOOL, systemPrompt, userPrompt, checkRequest, gaps, checkDraft, normalizeDraft, render } from './logic.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const MODEL = 'claude-sonnet-5-5';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (code, status, extra = {}) => json({ code, ...extra }, status);

// What the review screen (and a later rendering of the record) needs besides the draft itself.
export const snapshotOf = (rows) => ({
  orgName: rows.orgName,
  meeting: { title: rows.meeting.title ?? null, meeting_date: rows.meeting.meeting_date ?? null, location: rows.meeting.location ?? null },
  agenda: rows.agenda, attendance: rows.attendance,
});

export function makeHandler({ admin, anthropic, env = {} }) {
  const cap = Number(env.DRAFT_DAILY_CAP ?? 20);

  async function loadRows(meeting) {
    const [agenda, attendance, motions, actions, roster, org] = await Promise.all([
      admin.from('agenda_items').select('id, title, notes, sort_order, is_in_camera, public_title, public_summary').eq('meeting_id', meeting.id),
      admin.from('attendance').select('id, roster_id, display_name, proxy_for_lot, status').eq('meeting_id', meeting.id),
      admin.from('motions').select('id, agenda_item_id, description, moved_by, seconded_by, mover_roster_id, seconder_roster_id, result, vote_tally, confirmed, sort_order').eq('meeting_id', meeting.id),
      admin.from('action_items').select('id, agenda_item_id, description, responsible_party, owner_roster_id, due_date_text, due_date_parsed, confirmed, sort_order').eq('meeting_id', meeting.id),
      admin.from('roster').select('id, name').eq('org_id', meeting.org_id),
      admin.from('organizations').select('name, org_type').eq('id', meeting.org_id).maybeSingle(),
    ]);
    for (const r of [agenda, attendance, motions, actions, roster, org]) if (r.error) throw r.error;
    return {
      meeting, agenda: agenda.data ?? [], attendance: attendance.data ?? [], motions: motions.data ?? [],
      actions: actions.data ?? [], roster: roster.data ?? [], orgName: org.data?.name ?? '', orgType: org.data?.org_type ?? 'STRATA',
    };
  }

  async function askModel(rows, feedback) {
    const content = userPrompt(rows) + (feedback ? `\n\nYour previous draft had these problems. Write it again and fix every one:\n${feedback.map((p) => `- ${p.message}`).join('\n')}` : '');
    const msg = await anthropic.messages.create({
      model: MODEL, max_tokens: 8192, system: systemPrompt(rows.orgType), tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name }, messages: [{ role: 'user', content }],
    });
    return msg.content.find((b) => b.type === 'tool_use')?.input ?? null;
  }

  async function draft(rows) {
    if (rows.meeting.status === 'approved') return fail('ALREADY_APPROVED', 409);

    const { data: allowed, error: capError } = await admin.rpc('take_draft_slot', { p_org: rows.meeting.org_id, p_cap: cap });
    if (capError) { console.error(capError); return fail('UNAVAILABLE', 502); }
    if (!allowed) return fail('LIMIT', 429);

    const found = gaps(rows);
    const nothingToWrite = !rows.motions.length && !rows.actions.length && !rows.agenda.some((a) => (a.notes ?? '').trim());
    let result = normalizeDraft({ sections: [], closing: '' }, rows);

    if (!nothingToWrite) {
      let problems = [];
      let ok = false;
      let feedback = null;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        let raw;
        try { raw = await askModel(rows, feedback); } catch (err) { console.error('Anthropic error:', err); return fail('UNAVAILABLE', 502); }
        result = normalizeDraft(raw, rows);
        problems = checkDraft(result, rows, { strict: true });
        ok = problems.length === 0;
        feedback = problems;
      }
      if (!ok) { console.error('Draft rejected:', JSON.stringify(problems)); return fail('DRAFT_REJECTED', 502); }
    }

    if (['planned', 'in_progress'].includes(rows.meeting.status)) {
      const { error } = await admin.from('meetings').update({ status: 'review' }).eq('id', rows.meeting.id);
      if (error) console.error('Could not move the meeting to review:', error);
    }
    return json({ draft: result, snapshot: snapshotOf(rows), blocking: found.blocking, notes: found.notes });
  }

  // The gaps now, and whether a draft held by the browser still matches the entries. No model, no cap.
  function check(rows, incoming) {
    const found = gaps(rows);
    const problems = incoming ? checkDraft(incoming, rows) : [];
    return json({ blocking: found.blocking, notes: found.notes, snapshot: snapshotOf(rows), problems });
  }

  async function approve(rows, userId, incoming) {
    const found = gaps(rows);
    if (found.blocking.length) return fail('NOT_READY', 409, { blocking: found.blocking });

    const problems = checkDraft(incoming, rows, { approving: true });
    if (problems.length) return fail('DRAFT_INVALID', 422, { problems });

    const result = normalizeDraft(incoming, rows);
    const owner = render(result, rows, 'owner', rows.orgName);
    const previous = rows.meeting.status;

    // Claim the approval first, so two clicks (or two tabs) save one version.
    const claim = await admin.from('meetings').update({ status: 'approved' }).eq('id', rows.meeting.id).neq('status', 'approved').select('id');
    if (claim.error) { console.error(claim.error); return fail('UNAVAILABLE', 502); }
    if (!claim.data?.length) return json({ approved: true, already: true });

    const undo = () => admin.from('meetings').update({ status: previous }).eq('id', rows.meeting.id);
    const snapshot = snapshotOf(rows);
    const version = await admin.from('meeting_versions').insert({
      meeting_id: rows.meeting.id, org_id: rows.meeting.org_id, html_content: owner.html, markdown_content: owner.markdown,
      draft: { kind: 'workspace-draft', draft: result, snapshot }, saved_by: userId,
    });
    if (version.error) { console.error(version.error); await undo(); return fail('UNAVAILABLE', 502); }

    // The old dashboard publishes meetings.markdown, so it only ever holds the owner-safe text.
    const saved = await admin.from('meetings').update({ markdown: owner.markdown, edited_html: null }).eq('id', rows.meeting.id);
    if (saved.error) { console.error(saved.error); await undo(); return fail('UNAVAILABLE', 502); }
    return json({ approved: true });
  }

  async function reopen(rows, userId) {
    const claim = await admin.from('meetings').update({ status: 'review' }).eq('id', rows.meeting.id).eq('status', 'approved').select('id');
    if (claim.error) { console.error(claim.error); return fail('UNAVAILABLE', 502); }
    if (!claim.data?.length) return json({ reopened: true, already: true });

    let unpublished = false;
    if (rows.meeting.published) {
      const off = await admin.from('meetings').update({ published: false }).eq('id', rows.meeting.id);
      if (off.error) { console.error(off.error); return fail('UNAVAILABLE', 502); }
      const log = await admin.from('meeting_publish_log').insert({
        meeting_id: rows.meeting.id, org_id: rows.meeting.org_id, action: 'auto_unpublished',
        html_snapshot: rows.meeting.edited_html ?? null, actor_id: userId,
      });
      if (log.error) console.error('auto_unpublish audit log failed:', log.error);
      unpublished = true;
    }
    return json({ reopened: true, unpublished });
  }

  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'POST') return fail('BAD_REQUEST', 405);

    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return fail('NOT_SIGNED_IN', 401);
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth?.user) return fail('NOT_SIGNED_IN', 401);
    const userId = auth.user.id;

    let body;
    try { body = await req.json(); } catch { return fail('BAD_REQUEST', 400); }
    const asked = checkRequest(body);
    if (asked.error) return fail(asked.error, 400);

    try {
      const { data: meeting } = await admin.from('meetings')
        .select('id, org_id, title, meeting_date, location, status, published, edited_html').eq('id', asked.meetingId).maybeSingle();
      if (!meeting) return fail('MEETING_NOT_FOUND', 404);

      const { data: member } = await admin.from('org_members').select('role').eq('org_id', meeting.org_id).eq('user_id', userId).maybeSingle();
      if (!member) return fail('NOT_A_MEMBER', 403);
      if (!['owner', 'admin'].includes(member.role)) return fail('NOT_ALLOWED', 403);

      const { data: beta } = await admin.from('workspace_beta').select('org_id').eq('org_id', meeting.org_id).maybeSingle();
      if (!beta) return fail('NO_ACCESS', 403);

      const rows = await loadRows(meeting);
      if (asked.action === 'draft') return await draft(rows);
      if (asked.action === 'check') return check(rows, asked.draft);
      if (asked.action === 'approve') return await approve(rows, userId, asked.draft);
      return await reopen(rows, userId);
    } catch (err) {
      console.error(err);
      return fail('UNAVAILABLE', 502);
    }
  };
}
