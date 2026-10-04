// MinuteHand workspace: the draft minutes, review and approval.
//
// The secretary has recorded everything in the minutes. Here the draft-minutes function writes it up
// as sentences, the secretary reads it, fixes any wording, and approves it. The function checks in code
// that every motion and action item is in the draft exactly once, so nothing here can lose one.
//
// Nothing is saved to the database until Approve. Edits are kept in this browser meanwhile, so a
// closed tab loses nothing. All text is written with textContent, never as HTML.

const Draft = (() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  let ctx = null;              // { client, canManage, go(view), openMinutes(id) }
  let meetingId = null;
  let model = null;            // { draft, snapshot, blocking, notes }
  let approved = null;         // { at } once approved
  let busy = false;
  let dirty = false;           // the person has changed the wording
  let seq = 0;                 // lets an answer for an older open() be ignored
  let againArmed = false;
  let againTimer = null;
  let saveTimer = null;
  let wired = false;
  let problems = [];           // problems the function found with the draft when approving

  const key = (id) => `mh-draft:${id}`;
  const status = (text, retry) => UI.setStatus($('draft-status'), text, retry);

  const PROBLEMS = {
    NOT_SIGNED_IN: 'You have been signed out. Sign in again to carry on. Nothing has been lost.',
    NOT_A_MEMBER: 'Your account cannot use this meeting’s minutes.',
    NOT_ALLOWED: 'Only an organization owner or admin can draft and approve minutes.',
    NO_ACCESS: 'The workspace is not switched on for this organization yet.',
    MEETING_NOT_FOUND: 'That meeting is no longer there.',
    LIMIT: 'You have reached today’s limit for drafting. You can keep editing the draft you have, and drafting works again tomorrow.',
    DRAFT_REJECTED: 'I could not write a draft that matched your entries exactly, so I did not show one. Nothing was changed. Please try again.',
    ALREADY_APPROVED: 'These minutes are already approved. Reopen them to draft again.',
    BAD_REQUEST: 'Something went wrong with that request. Please try again.',
  };
  const UNAVAILABLE = 'The drafting service is not available right now. Your minutes are safe. Please try again in a moment.';
  const problem = (code) => PROBLEMS[code] ?? UNAVAILABLE;

  // ── Talking to the function ────────────────────────────────────────────────

  async function invoke(action, id, extra = {}) {
    try {
      const { data, error } = await ctx.client.functions.invoke('draft-minutes', { body: { action, meeting_id: id, ...extra } });
      if (!error) return { ok: true, data };
      let body = null;
      try { body = await error.context?.json?.(); } catch { /* not JSON */ }
      return { ok: false, code: body?.code ?? null, body };
    } catch (err) {
      console.error(err);
      return { ok: false, code: null, body: null };
    }
  }

  // ── Keeping edits in this browser ──────────────────────────────────────────

  function writeLocal(id, value) {
    try { localStorage.setItem(key(id), JSON.stringify({ at: Date.now(), draft: value.draft, snapshot: value.snapshot })); } catch (err) { console.warn(err); }
  }
  function readLocal(id) {
    try { return JSON.parse(localStorage.getItem(key(id)) ?? 'null'); } catch { return null; }
  }
  function removeLocal(id) {
    try { localStorage.removeItem(key(id)); } catch (err) { console.warn(err); }
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (model && meetingId && !approved) writeLocal(meetingId, model); }, 500);
  }

  // ── Drawing the draft ──────────────────────────────────────────────────────

  const hasGap = (text) => /\[MISSING/i.test(text);
  const missingNotes = () => (model ? [...$('draft-doc').querySelectorAll('textarea')].filter((t) => hasGap(t.value)).length : 0);

  function field(label, value, onInput, locked) {
    const wrap = el('label', 'draft-field');
    wrap.append(el('span', null, label));
    const area = el('textarea');
    area.value = value;
    area.rows = 1;
    area.disabled = locked;
    const fit = () => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight + 2}px`; };
    area.addEventListener('input', () => { fit(); area.classList.toggle('is-gap', hasGap(area.value)); onInput(area.value); });
    wrap.append(area);
    // Size it once it is on the page; until then scrollHeight is zero.
    requestAnimationFrame(() => { fit(); area.classList.toggle('is-gap', hasGap(area.value)); });
    return wrap;
  }

  function sectionBox(title, camera, publicTitle) {
    const box = el('section', `draft-section${camera ? ' is-in-camera' : ''}`);
    const head = el('h3', null, title);
    if (camera) head.append(' ', el('span', 'camera-badge', 'In camera'));
    box.append(head);
    if (camera) box.append(el('p', 'camera-note', `Owners will see only “${publicTitle || 'In camera session'}” and its short summary, not this text.`));
    return box;
  }

  function render() {
    const doc = $('draft-doc');
    doc.replaceChildren();
    if (!model) return;
    const locked = Boolean(approved);
    const snap = model.snapshot;
    const touch = () => { dirty = true; scheduleSave(); refresh(); };

    doc.append(el('h3', 'draft-title', snap.meeting.title || 'Meeting'));
    const when = snap.meeting.meeting_date ? new Date(`${snap.meeting.meeting_date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'No date recorded';
    doc.append(el('p', 'draft-meta', [snap.orgName, when, snap.meeting.location].filter(Boolean).join(' · ')));
    const who = (s) => snap.attendance.filter((a) => a.status === s).map((a) => a.display_name + (a.proxy_for_lot ? ` (proxy for ${a.proxy_for_lot})` : ''));
    const lines = [['Present', who('present')], ['Regrets', who('regrets')], ['Absent', who('absent')]].filter(([, names]) => names.length);
    doc.append(el('p', 'draft-meta', lines.length ? lines.map(([k, names]) => `${k}: ${names.join(', ')}`).join('. ') : 'Attendance was not recorded.'));

    const byItem = new Map(model.draft.sections.map((s) => [s.agenda_item_id ?? null, s]));
    [...snap.agenda].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).forEach((item, i) => {
      const s = byItem.get(item.id) ?? { narrative: '', motions: [], actions: [] };
      const camera = item.is_in_camera !== false;
      const box = sectionBox(`${i + 1}. ${item.title}`, camera, item.public_title);
      if (s.narrative || !locked) box.append(field('What was discussed', s.narrative, (v) => { s.narrative = v; touch(); }, locked));
      s.motions.forEach((m) => box.append(field('Motion', m.text, (v) => { m.text = v; touch(); }, locked)));
      s.actions.forEach((a) => box.append(field('Action item', a.text, (v) => { a.text = v; touch(); }, locked)));
      doc.append(box);
    });

    const other = byItem.get(null);
    if (other && (other.motions.length || other.actions.length)) {
      const box = sectionBox('Other items', false);
      box.append(el('p', 'camera-note', 'These entries belong to no agenda item. They are in the council record and are left out of the owner copy.'));
      other.motions.forEach((m) => box.append(field('Motion', m.text, (v) => { m.text = v; touch(); }, locked)));
      other.actions.forEach((a) => box.append(field('Action item', a.text, (v) => { a.text = v; touch(); }, locked)));
      doc.append(box);
    }

    const closing = el('section', 'draft-section');
    closing.append(field('Closing', model.draft.closing, (v) => { model.draft.closing = v; touch(); }, locked));
    doc.append(closing);
    refresh();
  }

  // The list of what stands between the secretary and Approve, and the buttons.
  function refresh() {
    const gapsBox = $('draft-gaps');
    gapsBox.replaceChildren();
    if (model && !approved) {
      const list = (heading, items, cls) => {
        const box = el('div', `draft-gaps-box ${cls}`);
        box.append(el('h3', null, heading));
        const ul = el('ul');
        items.forEach((m) => ul.append(el('li', null, typeof m === 'string' ? m : m.message)));
        box.append(ul);
        return box;
      };
      if (problems.length) {
        const box = list('This draft no longer matches the minutes', problems, 'is-blocking');
        box.append(el('p', null, 'Draft again to write a fresh one from the minutes as they are now.'));
        gapsBox.append(box);
      }
      if (model.blocking.length) {
        const box = list('Before you can approve', model.blocking, 'is-blocking');
        box.append(el('p', null, 'Fix these in the minutes, then draft again.'));
        box.append(UI.button('Go to the minutes', null, () => ctx.openMinutes(meetingId), { small: false }));
        gapsBox.append(box);
      }
      if (model.notes.length) gapsBox.append(list('Worth a look', model.notes, 'is-note'));
    }

    const gapsLeft = missingNotes();
    const reasons = [];
    if (model?.blocking.length) reasons.push(`${model.blocking.length === 1 ? '1 entry' : `${model.blocking.length} entries`} in the minutes still need${model.blocking.length === 1 ? 's' : ''} attention`);
    if (gapsLeft) reasons.push(`${gapsLeft === 1 ? '1 note' : `${gapsLeft} notes`} marked [MISSING …] ${gapsLeft === 1 ? 'is' : 'are'} still in the text`);
    if (problems.length) reasons.push('the draft no longer matches the minutes');

    const locked = Boolean(approved);
    $('draft-approve').disabled = busy || locked || reasons.length > 0;
    $('draft-again').disabled = busy;
    $('draft-approve').classList.toggle('hidden', locked);
    $('draft-again').classList.toggle('hidden', locked);
    $('draft-why').textContent = locked ? '' : (reasons.length ? `To approve: ${reasons.join(', and ')}.` : 'Read it through, change any wording, then approve.');
    $('draft-again').textContent = againArmed ? 'Yes, replace my edits' : 'Draft again';
  }

  function showBody(on) { $('draft-body').classList.toggle('hidden', !on); }

  // ── Approved ───────────────────────────────────────────────────────────────

  function showApproved() {
    const when = approved?.at ? new Date(approved.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
    $('draft-approved-text').textContent = `These minutes were approved${when ? ` on ${when}` : ''}. This is the council’s full record, including any in camera items. Owners see only the owner copy.`;
    $('draft-approved').classList.remove('hidden');
    $('draft-reopen').classList.toggle('hidden', !ctx.canManage);
  }

  async function loadApproved(id) {
    const { data, error } = await ctx.client.from('meeting_versions').select('draft, saved_at').eq('meeting_id', id)
      .order('saved_at', { ascending: false }).limit(1);
    if (error) throw error;
    const v = data?.[0];
    if (!v?.draft || v.draft.kind !== 'workspace-draft') return null;
    return { at: v.saved_at, model: { draft: v.draft.draft, snapshot: v.draft.snapshot, blocking: [], notes: [] } };
  }

  // ── Opening ────────────────────────────────────────────────────────────────

  function reset() {
    model = null; approved = null; busy = false; dirty = false; againArmed = false; problems = [];
    clearTimeout(againTimer); clearTimeout(saveTimer);
    $('draft-recover').classList.add('hidden');
    $('draft-approved').classList.add('hidden');
    showBody(false);
    status('');
    $('draft-doc').replaceChildren();
    $('draft-gaps').replaceChildren();
  }

  async function open(id) {
    const mine = ++seq;
    reset();
    meetingId = id;
    ctx.go('draft');
    status('Saving your latest changes…');

    // The function reads what is saved, so everything typed in the minutes must be saved first.
    try { await Minutes.flushNow(); } catch (err) { console.error(err); }
    if (mine !== seq) return;
    if (!Minutes.isSaved()) {
      status('Your latest changes in the minutes are not saved yet, so I cannot draft from them. Go back to the minutes and check the Saved note at the top.', () => open(id));
      return;
    }

    try {
      const { data, error } = await ctx.client.from('meetings').select('status').eq('id', id).maybeSingle();
      if (error) throw error;
      if (mine !== seq) return;
      if (!data) { status(PROBLEMS.MEETING_NOT_FOUND); return; }
      if (data.status === 'approved') {
        const found = await loadApproved(id);
        if (mine !== seq) return;
        status('');
        if (!found) { status('These minutes were approved, but the approved text is not stored in a form that can be shown here.'); return; }
        approved = { at: found.at };
        model = found.model;
        showApproved();
        showBody(true);
        render();
        return;
      }
    } catch (err) {
      console.error(err);
      if (mine === seq) status('We could not check this meeting. Check that you are online and try again.', () => open(id));
      return;
    }

    const kept = readLocal(id);
    if (kept?.draft && kept?.snapshot) { await offerKept(id, kept, mine); return; }
    await write(id, mine);
  }

  // A draft this browser was holding. It is only offered if it still matches the entries.
  async function offerKept(id, kept, mine) {
    status('Checking the draft you were working on…');
    const r = await invoke('check', id, { draft: kept.draft });
    if (mine !== seq) return;
    status('');
    if (!r.ok) { removeLocal(id); await write(id, mine); return; }
    const when = new Date(kept.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const box = $('draft-recover');
    box.replaceChildren();
    if (r.data.problems.length) {
      box.append(el('p', null, `This browser has a draft you were working on (${when}), but the minutes have changed since, so it no longer matches. Write a new one.`));
      box.append(UI.button('Write a new draft', null, () => { box.classList.add('hidden'); removeLocal(id); write(id, ++seq); }, { primary: true, small: false }));
    } else {
      box.append(el('p', null, `This browser has a draft you were working on (${when}). Do you want to carry on with it?`));
      box.append(UI.button('Carry on with it', null, () => {
        box.classList.add('hidden');
        model = { draft: kept.draft, snapshot: r.data.snapshot, blocking: r.data.blocking, notes: r.data.notes };
        dirty = true;
        showBody(true);
        render();
      }, { primary: true, small: false }));
      box.append(UI.button('Write a new draft', null, () => { box.classList.add('hidden'); removeLocal(id); write(id, ++seq); }, { small: false }));
    }
    box.classList.remove('hidden');
  }

  // Ask the function for a fresh draft.
  async function write(id, mine) {
    busy = true;
    refresh();
    status('Writing the draft. This usually takes under a minute…');
    const r = await invoke('draft', id);
    busy = false;
    if (r.ok) writeLocal(id, r.data);                       // kept even if the person has gone elsewhere
    if (mine !== seq) return;
    if (!r.ok) {
      status(problem(r.code), r.code === 'LIMIT' || r.code === 'ALREADY_APPROVED' ? undefined : () => write(id, ++seq));
      if (model) { showBody(true); refresh(); }
      return;
    }
    status('');
    model = r.data;
    dirty = false;
    problems = [];
    showBody(true);
    render();
  }

  // ── Buttons ────────────────────────────────────────────────────────────────

  async function approve() {
    if (busy || approved || !model) return;
    busy = true;
    problems = [];
    status('');
    refresh();
    const r = await invoke('approve', meetingId, { draft: model.draft });
    busy = false;
    if (r.ok) {
      removeLocal(meetingId);
      approved = { at: new Date().toISOString() };
      status('');
      showApproved();
      render();
      return;
    }
    if (r.code === 'NOT_READY' && Array.isArray(r.body?.blocking)) {
      model.blocking = r.body.blocking;
      status('Some entries in the minutes still need attention. They are listed below.');
    } else if (r.code === 'DRAFT_INVALID' && Array.isArray(r.body?.problems)) {
      problems = r.body.problems.map((p) => p.message).filter((m) => typeof m === 'string').slice(0, 8);
      status('The draft no longer matches the minutes, so it was not approved. Nothing was changed.');
    } else {
      status(problem(r.code), r.code === 'LIMIT' ? undefined : approve);
    }
    refresh();
  }

  function again() {
    if (busy) return;
    if (dirty && !againArmed) {
      againArmed = true;
      refresh();
      clearTimeout(againTimer);
      againTimer = setTimeout(() => { againArmed = false; refresh(); }, 5000);
      return;
    }
    againArmed = false;
    clearTimeout(againTimer);
    removeLocal(meetingId);
    write(meetingId, ++seq);
  }

  // Takes an approved meeting back to review. Used from here and from the locked minutes.
  async function reopen(id) {
    const r = await invoke('reopen', id);
    if (r.ok) { removeLocal(id); return { ok: true }; }
    return { ok: false, message: problem(r.code) };
  }

  function init(context) {
    ctx = context;
    seq++;
    reset();
    meetingId = null;
    if (wired) return;
    wired = true;
    // Closing the tab straight after typing must not lose the typing.
    window.addEventListener('pagehide', () => { if (model && meetingId && !approved && dirty) writeLocal(meetingId, model); });
    $('draft-back').addEventListener('click', () => { if (meetingId) ctx.openMinutes(meetingId); });
    $('draft-approve').addEventListener('click', approve);
    $('draft-again').addEventListener('click', again);
    $('draft-reopen').addEventListener('click', async () => {
      if (busy || !meetingId) return;
      busy = true;
      $('draft-reopen').disabled = true;
      const result = await reopen(meetingId);
      busy = false;
      $('draft-reopen').disabled = false;
      if (result.ok) ctx.openMinutes(meetingId); else status(result.message);
    });
  }

  return { init, open, reopen };
})();
