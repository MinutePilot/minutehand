// MinuteHand workspace: step 5, the minutes document.
// One document per meeting, built from the database rows: a header, an attendance
// block, and for each agenda item a notes area with its motions and action items
// (see workspace-blocks.js for the blocks themselves). Edits save by themselves, and
// anything not yet saved is also kept in this browser.
//
// The rows in the database are the source of truth. The document only carries the
// row ids it needs. Text from the database is written with textContent, never as HTML.

const Minutes = (() => {
  const $ = (id) => document.getElementById(id);

  let ctx = null;              // { client, orgId, canManage, go(view), openMeeting(id) }
  let editor = null;
  let blocks = null;           // the block definitions for the open editor
  let meeting = null;
  let roster = [];
  let saved = null;            // what the database holds
  let loadSeq = 0;             // lets a late answer from an older open() be ignored

  let version = 0;             // counts edits made by the person
  let flushedVersion = 0;      // the edit count that has reached the database
  let flushing = false;
  let again = false;           // an edit arrived while saving
  let blocked = false;         // the database refused (no permission): stop retrying
  let saveTimer = null;
  let draftTimer = null;
  let retryTimer = null;
  let retryDelay = 5000;
  let wired = false;

  const DEBOUNCE_MS = 800;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // ── The save indicator ─────────────────────────────────────────────────────

  const SAVE_TEXT = {
    saved: '✓ Saved',
    saving: 'Saving…',
    dirty: 'Changes not saved yet',
    error: 'Not saved yet. Trying again. Your changes are kept in this browser.',
    blocked: 'Not saved: you do not have permission to change this meeting. Ask an admin. Your changes are kept in this browser.',
  };

  function setSaveState(state) {
    const box = $('minutes-saved');
    box.textContent = SAVE_TEXT[state];
    box.dataset.state = state;
  }

  const status = (text, retry) => UI.setStatus($('minutes-status'), text, retry);

  // ── Attendance entries ─────────────────────────────────────────────────────
  // Each entry is { k, id, roster_id, name, role, status, proxy_for_lot, guest, former }.
  // status is '' until someone records it. id is the database row, or null until saved.

  function buildEntries(members, rows) {
    const byRoster = new Map(rows.filter((r) => r.roster_id).map((r) => [r.roster_id, r]));
    const entries = members.map((m) => {
      const r = byRoster.get(m.id);
      return { k: `r:${m.id}`, id: r?.id ?? null, roster_id: m.id, name: m.name, role: m.role ?? '',
               status: r?.status ?? '', proxy_for_lot: null, guest: false, former: false };
    });
    rows.filter((r) => r.roster_id && !members.some((m) => m.id === r.roster_id)).forEach((r) => {
      entries.push({ k: `r:${r.roster_id}`, id: r.id, roster_id: r.roster_id, name: r.display_name, role: '',
                     status: r.status, proxy_for_lot: null, guest: false, former: true });
    });
    rows.filter((r) => !r.roster_id).forEach((r) => {
      entries.push({ k: `g:${r.id}`, id: r.id, roster_id: null, name: r.display_name, role: '',
                     status: r.status, proxy_for_lot: r.proxy_for_lot, guest: true, former: false });
    });
    return entries;
  }

  // The rows the database should hold for these entries.
  function desiredRows(entries) {
    return entries.filter((e) => e.status !== '' || e.guest).map((e) => (
      e.guest
        ? { key: e.k, id: e.id, roster_id: null, display_name: e.name, proxy_for_lot: e.proxy_for_lot || null, status: 'present' }
        : { key: e.k, id: e.id, roster_id: e.roster_id, display_name: e.name, proxy_for_lot: null, status: e.status }
    ));
  }

  // ── Motions and action items: document nodes <-> database rows ─────────────

  const oneLine = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
  const textNode = (text) => (text ? [{ type: 'text', text }] : []);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const longDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };

  // The comparable shape of a motion, from a database row or from a document node.
  const motionFromRow = (r) => ({
    description: oneLine(r.description), moved_by: r.moved_by || null, seconded_by: r.seconded_by || null,
    mover_roster_id: r.mover_roster_id || null, seconder_roster_id: r.seconder_roster_id || null,
    result: r.result || null, vote_tally: r.vote_tally || null, confirmed: Boolean(r.confirmed), agenda_item_id: r.agenda_item_id ?? null,
  });
  const motionFromNode = (node, agendaId) => {
    const a = node.attrs;
    return {
      description: oneLine(node.textContent), moved_by: a.moverName || null, seconded_by: a.seconderName || null,
      mover_roster_id: a.mover || null, seconder_roster_id: a.seconder || null,
      result: a.result || null, vote_tally: a.votes.trim() || null, confirmed: Boolean(a.confirmed), agenda_item_id: agendaId,
    };
  };
  const actionFromRow = (r) => ({
    description: oneLine(r.description), responsible_party: r.responsible_party || null, owner_roster_id: r.owner_roster_id || null,
    due_date_text: r.due_date_text || null, due_date_parsed: r.due_date_parsed || null,
    confirmed: Boolean(r.confirmed), agenda_item_id: r.agenda_item_id ?? null,
  });
  const actionFromNode = (node, agendaId) => {
    const a = node.attrs;
    return {
      description: oneLine(node.textContent), responsible_party: a.ownerName || null, owner_roster_id: a.owner || null,
      due_date_text: a.due ? longDate(a.due) : (a.dueText || null), due_date_parsed: a.due || null,
      confirmed: Boolean(a.confirmed), agenda_item_id: agendaId,
    };
  };

  const motionNode = (r) => ({
    type: 'motion',
    attrs: { rowId: r.id, key: `m:${r.id}`, mover: r.mover_roster_id ?? '', moverName: r.moved_by ?? '',
             seconder: r.seconder_roster_id ?? '', seconderName: r.seconded_by ?? '', result: r.result ?? '',
             votes: r.vote_tally ?? '', confirmed: Boolean(r.confirmed) },
    content: textNode(oneLine(r.description)),
  });
  const actionNode = (r) => ({
    type: 'action',
    attrs: { rowId: r.id, key: `a:${r.id}`, owner: r.owner_roster_id ?? '', ownerName: r.responsible_party ?? '',
             due: r.due_date_parsed ?? '', dueText: r.due_date_parsed ? '' : (r.due_date_text ?? ''), confirmed: Boolean(r.confirmed) },
    content: textNode(oneLine(r.description)),
  });

  // ── Building the document ──────────────────────────────────────────────────

  const paragraphs = (text) => (text ?? '').split('\n').map((line) => (
    line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }
  ));

  // The motions and action items for one agenda item, in the order they were added.
  function blocksFor(agendaId, motions, actions) {
    return [
      ...motions.filter((m) => (m.agenda_item_id ?? null) === agendaId).map((r) => ({ order: r.sort_order, node: motionNode(r) })),
      ...actions.filter((a) => (a.agenda_item_id ?? null) === agendaId).map((r) => ({ order: r.sort_order, node: actionNode(r) })),
    ].sort((x, y) => x.order - y.order).map((b) => b.node);
  }

  function buildDoc(mtg, agenda, entries, motions, actions) {
    const ids = new Set(agenda.map((a) => a.id));
    const sections = agenda.map((a, i) => ({
      type: 'section',
      attrs: { rowId: a.id, number: i + 1, title: a.title, inCamera: Boolean(a.is_in_camera), publicTitle: a.public_title ?? '', publicSummary: a.public_summary ?? '' },
      content: [...paragraphs(a.notes), ...blocksFor(a.id, motions, actions)],
    }));
    // Anything whose agenda item was removed is still shown, so nothing is ever hidden.
    const stray = (r) => !ids.has(r.agenda_item_id);
    if (motions.some(stray) || actions.some(stray)) {
      sections.push({
        type: 'section', attrs: { rowId: null, number: 0, title: 'Other items', virtual: true },
        content: [{ type: 'paragraph' }, ...blocksFor(null, motions.filter(stray).map((m) => ({ ...m, agenda_item_id: null })),
                                                      actions.filter(stray).map((a) => ({ ...a, agenda_item_id: null })))],
      });
    }
    return {
      type: 'doc',
      content: [
        { type: 'header', attrs: { title: mtg.title || 'Untitled meeting', meta: Meetings.summary(mtg) } },
        { type: 'attendance', attrs: { entries } },
        ...sections,
      ],
    };
  }

  // The in-camera settings of one agenda item, in the shape the database holds them.
  const cameraRow = (inCamera, title, summary) => ({
    is_in_camera: Boolean(inCamera),
    public_title: oneLine(title).slice(0, 120) || null,
    public_summary: oneLine(summary).slice(0, 300) || null,
  });

  // What the document currently says, in the shape the database holds it.
  function derive(doc) {
    const camera = new Map();
    const notes = new Map();
    const motions = [];
    const actions = [];
    let entries = [];
    doc.forEach((node, offset) => {
      if (node.type.name === 'section') {
        const agendaId = node.attrs.rowId;
        const lines = [];
        node.forEach((child, childOffset) => {
          const pos = offset + 1 + childOffset;            // where it sits in the document, to keep new rows in order
          if (child.type.name === 'paragraph') lines.push(child.textContent);
          else if (child.type.name === 'motion') motions.push({ pos, key: child.attrs.key, id: child.attrs.rowId, row: motionFromNode(child, agendaId) });
          else if (child.type.name === 'action') actions.push({ pos, key: child.attrs.key, id: child.attrs.rowId, row: actionFromNode(child, agendaId) });
        });
        if (agendaId) {
          notes.set(agendaId, lines.join('\n'));
          camera.set(agendaId, cameraRow(node.attrs.inCamera, node.attrs.publicTitle, node.attrs.publicSummary));
        }
      } else if (node.type.name === 'attendance') {
        entries = node.attrs.entries;
      }
    });
    return { notes, camera, entries, motions, actions };
  }

  // ── Saving ─────────────────────────────────────────────────────────────────

  const sameRow = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // A block nobody has typed anything into yet is not worth a row.
  const isBlankRow = (r) => !r.description && !r.moved_by && !r.seconded_by && !r.mover_roster_id && !r.seconder_roster_id
    && !r.result && !r.vote_tally && !r.responsible_party && !r.owner_roster_id && !r.due_date_text && !r.due_date_parsed;

  function planBlocks(desired, savedMap) {
    const keep = new Set(desired.filter((d) => d.id).map((d) => d.id));
    return {
      updates: desired.filter((d) => d.id && savedMap.has(d.id) && !sameRow(savedMap.get(d.id), d.row)),
      deletes: [...savedMap.keys()].filter((id) => !keep.has(id)),
      inserts: desired.filter((d) => !d.id && !isBlankRow(d.row)),
    };
  }

  function plan(desired) {
    const noteUpdates = [];
    desired.notes.forEach((text, rowId) => {
      if (saved.notes.has(rowId) && saved.notes.get(rowId) !== text) noteUpdates.push({ rowId, text });
    });

    const cameraUpdates = [];
    desired.camera.forEach((row, rowId) => {
      if (saved.camera.has(rowId) && !sameRow(saved.camera.get(rowId), row)) cameraUpdates.push({ rowId, row });
    });

    const rows = desiredRows(desired.entries);
    const keep = new Set(rows.filter((r) => r.id).map((r) => r.id));
    const updates = [];
    const inserts = [];
    rows.forEach((r) => {
      if (!r.id) { inserts.push(r); return; }
      const was = saved.attendance.get(r.id);
      if (was && (was.display_name !== r.display_name || was.status !== r.status || (was.proxy_for_lot ?? null) !== r.proxy_for_lot)) {
        updates.push(r);
      }
    });
    const deletes = [...saved.attendance.keys()].filter((id) => !keep.has(id));

    const m = planBlocks(desired.motions, saved.motions);
    const a = planBlocks(desired.actions, saved.actions);
    return {
      noteUpdates, cameraUpdates, updates, deletes, inserts, motions: m, actions: a,
      empty: !noteUpdates.length && !cameraUpdates.length && !updates.length && !deletes.length && !inserts.length
        && ![m, a].some((p) => p.updates.length || p.deletes.length || p.inserts.length),
    };
  }

  // Updates, then deletes, then inserts, for one table of blocks.
  async function applyBlocks(table, p, savedMap, rememberFor, order) {
    const db = ctx.client;
    for (const u of p.updates) {
      const { error } = await db.from(table).update(u.row).eq('id', u.id);
      if (error) throw error;
      savedMap.set(u.id, u.row);
    }
    for (const id of p.deletes) {
      const { error } = await db.from(table).delete().eq('id', id);
      if (error) throw error;
      savedMap.delete(id);
    }
    if (p.inserts.length) {
      const { data, error } = await db.from(table)
        .insert(p.inserts.map((d) => ({ ...d.row, meeting_id: meeting.id, org_id: ctx.orgId, sort_order: order.get(d.key) })))
        .select('id');
      if (error) throw error;
      const ids = new Map();
      p.inserts.forEach((d, i) => {
        const id = data?.[i]?.id;
        if (!id) return;
        ids.set(d.key, id);
        savedMap.set(id, d.row);
      });
      rememberFor(ids);
    }
  }

  async function apply(p, desired) {
    const db = ctx.client;
    for (const u of p.updates) {
      const { error } = await db.from('attendance')
        .update({ display_name: u.display_name, status: u.status, proxy_for_lot: u.proxy_for_lot }).eq('id', u.id);
      if (error) throw error;
      saved.attendance.set(u.id, { roster_id: u.roster_id, display_name: u.display_name, status: u.status, proxy_for_lot: u.proxy_for_lot });
    }
    for (const id of p.deletes) {
      const { error } = await db.from('attendance').delete().eq('id', id);
      if (error) throw error;
      saved.attendance.delete(id);
    }
    if (p.inserts.length) {
      const { data, error } = await db.from('attendance')
        .insert(p.inserts.map((r) => ({ meeting_id: meeting.id, org_id: ctx.orgId, roster_id: r.roster_id,
                                        display_name: r.display_name, status: r.status, proxy_for_lot: r.proxy_for_lot })))
        .select('id');
      if (error) throw error;
      const ids = new Map();
      p.inserts.forEach((r, i) => {
        const id = data?.[i]?.id;
        if (!id) return;
        ids.set(r.key, id);
        saved.attendance.set(id, { roster_id: r.roster_id, display_name: r.display_name, status: r.status, proxy_for_lot: r.proxy_for_lot });
      });
      rememberEntryIds(ids);
    }
    for (const n of p.noteUpdates) {
      const { error } = await db.from('agenda_items').update({ notes: n.text }).eq('id', n.rowId);
      if (error) throw error;
      saved.notes.set(n.rowId, n.text);
    }
    for (const c of p.cameraUpdates) {
      const { error } = await db.from('agenda_items').update(c.row).eq('id', c.rowId);
      if (error) throw error;
      saved.camera.set(c.rowId, c.row);
    }

    // New motions and action items take the next order numbers, in the order they appear.
    const order = new Map();
    let next = saved.maxOrder + 1;
    [...p.motions.inserts, ...p.actions.inserts].sort((x, y) => x.pos - y.pos)
      .forEach((d) => { order.set(d.key, next++); });
    await applyBlocks('motions', p.motions, saved.motions, (ids) => rememberBlockIds(ids), order);
    await applyBlocks('action_items', p.actions, saved.actions, (ids) => rememberBlockIds(ids), order);
    saved.maxOrder = Math.max(saved.maxOrder, next - 1);
  }

  // New rows get their ids written back into the document, matched by key so changes made
  // while saving are not overwritten.
  function rememberEntryIds(ids) {
    let target = null;
    editor.state.doc.forEach((node, offset) => { if (node.type.name === 'attendance') target = { node, offset }; });
    if (!target) return;
    const entries = target.node.attrs.entries.map((e) => (ids.has(e.k) ? { ...e, id: ids.get(e.k) } : e));
    editor.view.dispatch(editor.state.tr
      .setNodeMarkup(target.offset, undefined, { ...target.node.attrs, entries })
      .setMeta('addToHistory', false).setMeta('fromSync', true));
  }

  function rememberBlockIds(ids) {
    let tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if ((node.type.name === 'motion' || node.type.name === 'action') && ids.has(node.attrs.key)) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, rowId: ids.get(node.attrs.key) });
      }
    });
    editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta('fromSync', true));
  }

  async function flush() {
    if (!editor || !saved) return;
    if (flushing) { again = true; return; }
    flushing = true;
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    try {
      do {
        again = false;
        const atVersion = version;
        const desired = derive(editor.state.doc);
        const p = plan(desired);
        if (!p.empty) { setSaveState('saving'); await apply(p, desired); }
        flushedVersion = atVersion;
      } while (again || version !== flushedVersion);
      retryDelay = 5000;
      blocked = false;
      setSaveState('saved');
      removeDraft();
    } catch (err) {
      console.error(err);
      if (err && (err.code === '42501' || err.status === 403)) {
        blocked = true;
        setSaveState('blocked');
      } else {
        setSaveState('error');
        retryTimer = setTimeout(flush, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      }
    } finally {
      flushing = false;
    }
  }

  function scheduleFlush() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, DEBOUNCE_MS);
  }

  // Also called by the page before signing out.
  async function flushNow() {
    clearTimeout(saveTimer);
    if (editor && (version !== flushedVersion || flushing)) await flush();
  }

  // ── Keeping unsaved changes in this browser ────────────────────────────────

  const draftKey = () => `mh-workspace-draft:${meeting.id}`;

  function writeDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try { localStorage.setItem(draftKey(), JSON.stringify({ at: Date.now(), doc: editor.getJSON() })); } catch (err) { console.warn(err); }
    }, 300);
  }

  function removeDraft() {
    clearTimeout(draftTimer);
    if (version !== flushedVersion) return;
    try { localStorage.removeItem(draftKey()); } catch (err) { console.warn(err); }
  }

  function readDraft() {
    try { return JSON.parse(localStorage.getItem(draftKey()) ?? 'null'); } catch (err) { return null; }
  }

  function offerDraft(draft, built) {
    const when = new Date(draft.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const box = $('minutes-draft');
    box.replaceChildren(
      Object.assign(el('p'), { textContent: `This browser has changes to these minutes that were not saved (${when}). Do you want them back?` }),
      UI.button('Put them back', null, () => { restoreDraft(draft, built); box.classList.add('hidden'); }, { primary: true, small: false }),
      UI.button('Throw them away', null, () => {
        try { localStorage.removeItem(draftKey()); } catch (err) { console.warn(err); }
        box.classList.add('hidden');
      }, { small: false }),
    );
    box.classList.remove('hidden');
  }

  // Lay the unsaved work over the freshly loaded document, matched by id. Anything that is
  // in the database but not in the draft is kept, so putting a draft back can never delete
  // something that was saved from another tab or device in the meantime.
  function restoreDraft(draft, built) {
    const old = { sections: new Map(), entries: null };
    (draft.doc?.content ?? []).forEach((n) => {
      if (n.type === 'section') old.sections.set(n.attrs?.rowId, { content: n.content ?? [], attrs: n.attrs ?? {} });
      if (n.type === 'attendance') old.entries = n.attrs?.entries;
    });

    const mergeSection = (section) => {
      const draft = old.sections.get(section.attrs.rowId);
      if (!draft) return section;
      const draftContent = draft.content;
      const draftParagraphs = draftContent.filter((c) => c.type === 'paragraph');
      const draftBlocks = draftContent.filter((c) => c.type !== 'paragraph');
      const builtBlocks = section.content.filter((c) => c.type !== 'paragraph');
      const draftIds = new Set(draftBlocks.map((b) => b.attrs?.rowId).filter(Boolean));
      return {
        ...section,
        attrs: { ...section.attrs, inCamera: Boolean(draft.attrs.inCamera), publicTitle: draft.attrs.publicTitle ?? '', publicSummary: draft.attrs.publicSummary ?? '' },
        content: [
          ...(draftParagraphs.length ? draftParagraphs : section.content.filter((c) => c.type === 'paragraph')),
          ...draftBlocks,
          ...builtBlocks.filter((b) => !draftIds.has(b.attrs.rowId)),
        ],
      };
    };

    const mergeEntries = (entries) => {
      if (!Array.isArray(old.entries)) return entries;
      const byKey = new Map(old.entries.map((e) => [e.k, e]));
      const merged = entries.map((e) => byKey.get(e.k) ?? e);
      old.entries.forEach((e) => { if (!entries.some((x) => x.k === e.k)) merged.push(e); });
      return merged;
    };

    const merged = {
      ...built,
      content: built.content.map((n) => {
        if (n.type === 'section' && n.attrs.rowId) return mergeSection(n);
        if (n.type === 'attendance') return { ...n, attrs: { entries: mergeEntries(n.attrs.entries) } };
        return n;
      }),
    };
    const tr = editor.state.tr
      .replaceWith(0, editor.state.doc.content.size, editor.schema.nodeFromJSON(merged).content)
      .setMeta('allowBlockChange', true);
    editor.view.dispatch(tr);
    setSaveState('dirty');
  }

  // ── Opening a meeting ──────────────────────────────────────────────────────

  function destroyEditor() {
    clearTimeout(saveTimer); clearTimeout(draftTimer); clearTimeout(retryTimer);
    if (editor) { editor.destroy(); editor = null; }
    blocks = null; saved = null; meeting = null;
    version = 0; flushedVersion = 0; flushing = false; again = false; blocked = false; retryDelay = 5000;
    $('editor').replaceChildren();
    $('minutes-draft').classList.add('hidden');
    ctx?.onMinutes?.();
  }

  async function load(meetingId) {
    const db = ctx.client;
    const [m, a, att, r, mo, ac] = await Promise.all([
      db.from('meetings').select('id, title, meeting_date, start_time, location, status').eq('id', meetingId).maybeSingle(),
      db.from('agenda_items').select('id, title, notes, sort_order, is_in_camera, public_title, public_summary').eq('meeting_id', meetingId)
        .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      db.from('attendance').select('id, roster_id, display_name, proxy_for_lot, status').eq('meeting_id', meetingId)
        .order('created_at', { ascending: true }),
      db.from('roster').select('id, name, role').eq('org_id', ctx.orgId).eq('status', 'active')
        .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      db.from('motions').select('id, agenda_item_id, description, moved_by, seconded_by, mover_roster_id, seconder_roster_id, result, vote_tally, confirmed, sort_order')
        .eq('meeting_id', meetingId).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      db.from('action_items').select('id, agenda_item_id, description, responsible_party, owner_roster_id, due_date_text, due_date_parsed, confirmed, sort_order')
        .eq('meeting_id', meetingId).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    ]);
    for (const res of [m, a, att, r, mo, ac]) if (res.error) throw res.error;
    return { meeting: m.data, agenda: a.data ?? [], attendance: att.data ?? [], roster: r.data ?? [], motions: mo.data ?? [], actions: ac.data ?? [] };
  }

  const currentEntries = () => {
    let entries = [];
    editor?.state.doc.forEach((n) => { if (n.type.name === 'attendance') entries = n.attrs.entries; });
    return entries;
  };

  async function open(meetingId) {
    const seq = ++loadSeq;
    try { await flushNow(); } catch (err) { console.error(err); }   // save the meeting we are leaving first
    ctx.go('minutes');
    destroyEditor();
    status('Loading the minutes…');
    setSaveState('saved');

    let loaded;
    try {
      loaded = await load(meetingId);
    } catch (err) {
      console.error(err);
      if (seq === loadSeq) status('We could not load the minutes. Check that you are online and try again.', () => open(meetingId));
      return;
    }
    if (seq !== loadSeq) return;

    if (!loaded.meeting) {
      status('That meeting is no longer there. It may have been deleted.');
      return;
    }
    status('');
    meeting = loaded.meeting;
    roster = loaded.roster;

    const entries = buildEntries(roster, loaded.attendance);
    const built = buildDoc(meeting, loaded.agenda, entries, loaded.motions, loaded.actions);
    saved = {
      notes: new Map(loaded.agenda.map((a) => [a.id, a.notes ?? ''])),
      camera: new Map(loaded.agenda.map((a) => [a.id, cameraRow(a.is_in_camera, a.public_title, a.public_summary)])),
      attendance: new Map(loaded.attendance.map((r) => [r.id, { roster_id: r.roster_id, display_name: r.display_name, status: r.status, proxy_for_lot: r.proxy_for_lot ?? null }])),
      motions: new Map(loaded.motions.map((r) => [r.id, motionFromRow(r)])),
      actions: new Map(loaded.actions.map((r) => [r.id, actionFromRow(r)])),
      maxOrder: Math.max(-1, ...loaded.motions.map((r) => r.sort_order), ...loaded.actions.map((r) => r.sort_order)),
    };

    blocks = Blocks.create({ canManage: () => ctx.canManage, roster: () => roster, entries: currentEntries });
    editor = new TT.Editor({
      element: $('editor'),
      extensions: blocks.extensions,
      content: built,
      onTransaction({ transaction }) {
        if (transaction.selectionSet || transaction.docChanged) ctx.onMinutes?.();   // the chat follows the cursor's agenda item
        if (transaction.docChanged) blocks.refreshAll();               // e.g. a warning about someone recorded absent
        if (!transaction.docChanged || transaction.getMeta('fromSync')) return;
        version++;
        blocked = false;
        setSaveState('dirty');
        writeDraft();
        scheduleFlush();
      },
    });

    blocks.refreshAll();                                               // warnings need the attendance block, which now exists
    ctx.onMinutes?.();
    const draft = readDraft();
    if (draft && JSON.stringify(draft.doc) !== JSON.stringify(built)) offerDraft(draft, built);
  }

  // ── The assistant (workspace-chat.js) ───────────────────────────────────────

  // The agenda items the assistant can add to, and the one the cursor is in. Null when no
  // minutes are open on screen.
  function chatContext() {
    if (!editor || !meeting || $('view-minutes').classList.contains('hidden')) return null;
    const items = [];
    let currentId = null;
    const head = editor.state.selection.$from;
    editor.state.doc.forEach((n) => {
      if (n.type.name === 'section' && !n.attrs.virtual && n.attrs.rowId) items.push({ id: n.attrs.rowId, title: n.attrs.title, number: n.attrs.number, inCamera: Boolean(n.attrs.inCamera) });
    });
    for (let d = head.depth; d > 0; d--) {
      const n = head.node(d);
      if (n.type.name === 'section') { currentId = n.attrs.virtual ? null : n.attrs.rowId; break; }
    }
    return { meetingId: meeting.id, items, currentId };
  }

  // Puts what the assistant found into one agenda item, all unconfirmed. Notes go in the notes,
  // motions and action items go at the end of the item. Returns how many of each were added.
  function addEntries(agendaId, entries) {
    const added = { note: 0, motion: 0, action: 0 };
    if (!editor || !meeting) return added;
    let at = null;
    editor.state.doc.forEach((n, offset) => { if (n.type.name === 'section' && n.attrs.rowId === agendaId) at = { node: n, pos: offset }; });
    if (!at) return added;

    const schema = editor.schema;
    const text = (t) => (t ? [{ type: 'text', text: t }] : undefined);
    let tr = editor.state.tr;
    for (const e of entries) {
      // Look the section up again each time: the previous insert moved everything after it.
      let sec = null;
      tr.doc.forEach((n, offset) => { if (n.type.name === 'section' && n.attrs.rowId === agendaId) sec = { node: n, pos: offset }; });
      const end = sec.pos + sec.node.nodeSize - 1;                    // just inside the section's end
      if (e.kind === 'note') {
        let lastNote = sec.pos + 1, lastNode = null;
        sec.node.forEach((c, o) => { if (c.type.name === 'paragraph') { lastNote = sec.pos + 1 + o; lastNode = c; } });
        if (lastNode && lastNode.content.size === 0) tr = tr.insertText(e.text, lastNote + 1);
        else tr = tr.insert(lastNote + (lastNode ? lastNode.nodeSize : 0), schema.nodeFromJSON({ type: 'paragraph', content: text(e.text) }));
        added.note++;
      } else if (e.kind === 'motion') {
        tr = tr.insert(end, schema.nodeFromJSON({
          type: 'motion', content: text(e.text),
          attrs: { ...Blocks.MOTION_DEFAULTS, key: Blocks.newKey(), mover: e.mover ?? '', seconder: e.seconder ?? '', result: e.result ?? '', votes: e.votes ?? '' },
        }));
        added.motion++;
      } else if (e.kind === 'action') {
        tr = tr.insert(end, schema.nodeFromJSON({
          type: 'action', content: text(e.text),
          attrs: { ...Blocks.ACTION_DEFAULTS, key: Blocks.newKey(), owner: e.owner ?? '', due: e.due ?? '' },
        }));
        added.action++;
      }
    }
    editor.view.dispatch(tr.setMeta('allowBlockChange', true).setMeta('addToHistory', false));
    return added;
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  function init(context) {
    ctx = context;
    loadSeq++;
    destroyEditor();
    status('');
    if (wired) return;
    wired = true;
    $('minutes-back').addEventListener('click', () => { if (meeting) ctx.openMeeting(meeting.id); else ctx.go('meetings'); });
    window.addEventListener('online', () => { if (editor && version !== flushedVersion && !blocked) flush(); });
    window.addEventListener('beforeunload', (e) => {
      if (editor && (version !== flushedVersion || flushing)) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  return { init, open, flushNow, chatContext, addEntries };
})();
