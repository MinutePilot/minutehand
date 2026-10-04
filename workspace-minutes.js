// MinuteHand workspace: step 5 (first half), the minutes document.
// One document per meeting, built from the database rows: a header, an attendance
// block, and a section for each agenda item with a notes area. Edits save by
// themselves, and anything not yet saved is also kept in this browser.
// Motions and action items join the document in the next pull request.
//
// The rows in the database are the source of truth. The document only carries the
// row ids it needs, and a small guard keeps the header, attendance block and agenda
// sections from being deleted by typing, so a stray Select All and Delete cannot
// remove them. Text from the database is written with textContent, never as HTML.

const Minutes = (() => {
  const $ = (id) => document.getElementById(id);

  let ctx = null;              // { client, orgId, canManage, go(view), openMeeting(id) }
  let editor = null;
  let meeting = null;
  let roster = [];
  let saved = null;            // what the database holds: { notes: Map, attendance: Map }
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

  // ── The blocks ─────────────────────────────────────────────────────────────

  const Header = TT.Node.create({
    name: 'header', group: 'block', atom: true, selectable: false, draggable: false,
    addAttributes() { return { title: { default: '' }, meta: { default: '' } }; },
    parseHTML() { return [{ tag: 'header[data-type="header"]' }]; },
    renderHTML() { return ['header', { 'data-type': 'header' }]; },
    addNodeView() {
      return ({ node }) => {
        const dom = el('header', 'doc-header');
        dom.contentEditable = 'false';
        const h1 = el('h1', null, node.attrs.title);
        const meta = el('p', 'doc-meta', node.attrs.meta);
        dom.append(h1, meta);
        return {
          dom,
          update(n) {
            if (n.type !== node.type) return false;
            h1.textContent = n.attrs.title;
            meta.textContent = n.attrs.meta;
            return true;
          },
        };
      };
    },
  });

  const Section = TT.Node.create({
    name: 'section', group: 'block', content: 'paragraph+', isolating: true, defining: true,
    addAttributes() { return { rowId: { default: null }, number: { default: 1 }, title: { default: '' } }; },
    parseHTML() { return [{ tag: 'section[data-type="section"]' }]; },
    renderHTML() { return ['section', { 'data-type': 'section' }, 0]; },
    addNodeView() {
      return ({ node }) => {
        const dom = el('section', 'doc-section');
        const heading = el('h2', 'doc-section-title', `${node.attrs.number}. ${node.attrs.title}`);
        heading.contentEditable = 'false';
        const notes = el('div', 'doc-notes');
        dom.append(heading, notes);
        return {
          dom,
          contentDOM: notes,
          update(n) {
            if (n.type !== node.type) return false;
            heading.textContent = `${n.attrs.number}. ${n.attrs.title}`;
            return true;
          },
        };
      };
    },
  });

  const Attendance = TT.Node.create({
    name: 'attendance', group: 'block', atom: true, selectable: false, draggable: false,
    addAttributes() { return { entries: { default: [] } }; },
    parseHTML() { return [{ tag: 'section[data-type="attendance"]' }]; },
    renderHTML() { return ['section', { 'data-type': 'attendance' }]; },
    addNodeView() {
      return ({ node: first, getPos, editor: ed }) => attendanceView(first, getPos, ed);
    },
  });

  const STATUS_OPTIONS = [['', 'Not recorded'], ['present', 'Present'], ['regrets', 'Regrets'], ['absent', 'Absent']];

  function attendanceView(first, getPos, ed) {
    let node = first;
    const dom = el('section', 'att');
    dom.contentEditable = 'false';

    const head = el('div', 'att-head');
    const everyone = UI.button('Everyone on the roster is here', null, () => {
      write(node.attrs.entries.map((e) => (!e.guest && e.status === '' ? { ...e, status: 'present' } : e)));
    });
    head.append(el('h2', 'att-title', 'Attendance'), everyone);

    const list = el('ul', 'att-list');

    const form = el('form', 'att-guest');
    form.noValidate = true;
    const guestName = el('input');
    guestName.type = 'text'; guestName.maxLength = 120; guestName.placeholder = 'Guest name';
    guestName.setAttribute('aria-label', 'Guest name');
    const guestLot = el('input');
    guestLot.type = 'text'; guestLot.maxLength = 40; guestLot.placeholder = 'Lot they represent (if a proxy)';
    guestLot.setAttribute('aria-label', 'Lot the guest represents, if they are a proxy');
    const guestAdd = UI.button('Add guest', null, () => {}, { primary: true });
    guestAdd.type = 'submit';
    const guestError = el('p', 'error hidden');
    guestError.setAttribute('role', 'alert');
    form.append(guestName, guestLot, guestAdd);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = guestName.value.trim().replace(/\s+/g, ' ');
      if (!name) { guestError.textContent = 'Type the guest’s name first.'; guestError.classList.remove('hidden'); return; }
      guestError.classList.add('hidden');
      const lot = guestLot.value.trim().replace(/\s+/g, ' ');
      const key = `g:new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      write([...node.attrs.entries, { k: key, id: null, roster_id: null, name, role: '', status: 'present',
                                      proxy_for_lot: lot || null, guest: true, former: false }]);
      guestName.value = ''; guestLot.value = '';
      guestName.focus();
    });

    dom.append(head, list, form, guestError);

    function write(entries) {
      const pos = getPos();
      if (typeof pos !== 'number') return;
      ed.view.dispatch(ed.state.tr
        .setNodeMarkup(pos, undefined, { ...node.attrs, entries })
        .setMeta('addToHistory', false));
    }

    function render() {
      const entries = node.attrs.entries;
      everyone.classList.toggle('hidden', !entries.some((e) => !e.guest && e.status === ''));
      if (entries.length === 0) {
        list.replaceChildren(el('li', 'att-empty', 'No one is on the roster yet. Add members on the Roster screen, or add guests below.'));
        return;
      }
      list.replaceChildren(...entries.map((e) => {
        const li = el('li', 'att-item');
        li.dataset.key = e.k;
        const label = el('span', 'att-name');
        label.append(el('strong', null, e.name));
        const bits = [e.role, e.former && 'former member', e.guest && (e.proxy_for_lot ? `guest, proxy for Lot ${e.proxy_for_lot.replace(/^lot\s+/i, '')}` : 'guest')].filter(Boolean);
        if (bits.length) label.append(el('span', 'att-meta', bits.join(' · ')));
        li.appendChild(label);

        if (!e.guest) {
          const select = el('select');
          select.setAttribute('aria-label', `Attendance for ${e.name}`);
          STATUS_OPTIONS.forEach(([value, text]) => {
            // Only an admin can clear a saved record, because only an admin can delete rows.
            if (value === '' && e.id && !ctx.canManage) return;
            const opt = el('option', null, text);
            opt.value = value;
            select.appendChild(opt);
          });
          select.value = e.status;
          select.addEventListener('change', () => {
            write(node.attrs.entries.map((x) => (x.k === e.k ? { ...x, status: select.value } : x)));
          });
          li.appendChild(select);
        } else if (ctx.canManage || !e.id) {
          li.appendChild(UI.button('Remove', `Remove ${e.name}`, () => write(node.attrs.entries.filter((x) => x.k !== e.k))));
        }
        return li;
      }));
    }
    render();

    return {
      dom,
      stopEvent: () => true,
      ignoreMutation: () => true,
      update(n) {
        if (n.type !== node.type) return false;
        node = n;
        render();
        return true;
      },
    };
  }

  // Header, attendance and sections may be typed in but never deleted or added by typing.
  const Guard = TT.Extension.create({
    name: 'structureGuard',
    addProseMirrorPlugins() {
      const count = (doc) => {
        const n = { header: 0, attendance: 0, section: 0 };
        doc.forEach((child) => { if (child.type.name in n) n[child.type.name]++; });
        return n;
      };
      return [new TT.Plugin({
        key: new TT.PluginKey('structureGuard'),
        filterTransaction(tr, state) {
          if (!tr.docChanged) return true;
          const a = count(state.doc);
          const b = count(tr.doc);
          return a.header === b.header && a.attendance === b.attendance && a.section === b.section;
        },
      })];
    },
  });

  const MinutesDocument = TT.Document.extend({ content: 'header attendance section*' });

  // ── Building and reading the document ──────────────────────────────────────

  const paragraphs = (text) => (text ?? '').split('\n').map((line) => (
    line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }
  ));

  function buildDoc(mtg, agenda, entries) {
    return {
      type: 'doc',
      content: [
        { type: 'header', attrs: { title: mtg.title || 'Untitled meeting', meta: Meetings.summary(mtg) } },
        { type: 'attendance', attrs: { entries } },
        ...agenda.map((a, i) => ({ type: 'section', attrs: { rowId: a.id, number: i + 1, title: a.title }, content: paragraphs(a.notes) })),
      ],
    };
  }

  // What the document currently says, in the shape the database holds it.
  function derive(doc) {
    const notes = new Map();
    let entries = [];
    doc.forEach((node) => {
      if (node.type.name === 'section') {
        const lines = [];
        node.forEach((p) => lines.push(p.textContent));
        notes.set(node.attrs.rowId, lines.join('\n'));
      } else if (node.type.name === 'attendance') {
        entries = node.attrs.entries;
      }
    });
    return { notes, entries };
  }

  // ── Saving ─────────────────────────────────────────────────────────────────

  function plan(desired) {
    const noteUpdates = [];
    desired.notes.forEach((text, rowId) => {
      if (saved.notes.has(rowId) && saved.notes.get(rowId) !== text) noteUpdates.push({ rowId, text });
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
    return { noteUpdates, updates, deletes, inserts, empty: !noteUpdates.length && !updates.length && !deletes.length && !inserts.length };
  }

  async function apply(p) {
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
      rememberIds(ids);
    }
    for (const n of p.noteUpdates) {
      const { error } = await db.from('agenda_items').update({ notes: n.text }).eq('id', n.rowId);
      if (error) throw error;
      saved.notes.set(n.rowId, n.text);
    }
  }

  // New rows get their ids written back into the attendance block, matched by key
  // so changes made while saving are not overwritten.
  function rememberIds(ids) {
    let target = null;
    editor.state.doc.forEach((node, offset) => { if (node.type.name === 'attendance') target = { node, offset }; });
    if (!target) return;
    const entries = target.node.attrs.entries.map((e) => (ids.has(e.k) ? { ...e, id: ids.get(e.k) } : e));
    editor.view.dispatch(editor.state.tr
      .setNodeMarkup(target.offset, undefined, { ...target.node.attrs, entries })
      .setMeta('addToHistory', false).setMeta('fromSync', true));
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
        const p = plan(derive(editor.state.doc));
        if (!p.empty) { setSaveState('saving'); await apply(p); }
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

  // Put the unsaved notes and attendance back onto the freshly loaded document, matched
  // by agenda item, so an agenda that changed in the meantime cannot break anything.
  function restoreDraft(draft, built) {
    const oldSections = new Map();
    let oldEntries = null;
    (draft.doc?.content ?? []).forEach((n) => {
      if (n.type === 'section') oldSections.set(n.attrs?.rowId, n.content);
      if (n.type === 'attendance') oldEntries = n.attrs?.entries;
    });
    const merged = {
      ...built,
      content: built.content.map((n) => {
        if (n.type === 'section' && oldSections.has(n.attrs.rowId)) return { ...n, content: oldSections.get(n.attrs.rowId) };
        if (n.type === 'attendance' && Array.isArray(oldEntries)) return { ...n, attrs: { entries: oldEntries } };
        return n;
      }),
    };
    editor.commands.setContent(merged);
    version++;
    setSaveState('dirty');
    writeDraft();
    scheduleFlush();
  }

  // ── Opening a meeting ──────────────────────────────────────────────────────

  function destroyEditor() {
    clearTimeout(saveTimer); clearTimeout(draftTimer); clearTimeout(retryTimer);
    if (editor) { editor.destroy(); editor = null; }
    saved = null; meeting = null;
    version = 0; flushedVersion = 0; flushing = false; again = false; blocked = false; retryDelay = 5000;
    $('editor').replaceChildren();
    $('minutes-draft').classList.add('hidden');
  }

  async function load(meetingId) {
    const db = ctx.client;
    const [m, a, att, r] = await Promise.all([
      db.from('meetings').select('id, title, meeting_date, start_time, location, status').eq('id', meetingId).maybeSingle(),
      db.from('agenda_items').select('id, title, notes, sort_order').eq('meeting_id', meetingId)
        .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      db.from('attendance').select('id, roster_id, display_name, proxy_for_lot, status').eq('meeting_id', meetingId)
        .order('created_at', { ascending: true }),
      db.from('roster').select('id, name, role').eq('org_id', ctx.orgId).eq('status', 'active')
        .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    ]);
    for (const res of [m, a, att, r]) if (res.error) throw res.error;
    return { meeting: m.data, agenda: a.data ?? [], attendance: att.data ?? [], roster: r.data ?? [] };
  }

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
    const built = buildDoc(meeting, loaded.agenda, entries);
    saved = {
      notes: new Map(loaded.agenda.map((a) => [a.id, a.notes ?? ''])),
      attendance: new Map(loaded.attendance.map((r) => [r.id, { roster_id: r.roster_id, display_name: r.display_name, status: r.status, proxy_for_lot: r.proxy_for_lot ?? null }])),
    };

    editor = new TT.Editor({
      element: $('editor'),
      extensions: [MinutesDocument, TT.Paragraph, TT.Text, TT.UndoRedo, Header, Attendance, Section, Guard],
      content: built,
      onTransaction({ transaction }) {
        if (!transaction.docChanged || transaction.getMeta('fromSync')) return;
        version++;
        blocked = false;
        setSaveState('dirty');
        writeDraft();
        scheduleFlush();
      },
    });

    const draft = readDraft();
    if (draft && JSON.stringify(draft.doc) !== JSON.stringify(built)) offerDraft(draft, built);
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

  return { init, open, flushNow };
})();
