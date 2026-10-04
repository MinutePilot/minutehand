// MinuteHand workspace: the building blocks of the minutes document.
// A header, an attendance block, agenda sections, and inside each section its
// motions and action items. Each block is shown with dropdowns and buttons and
// carries the id of its database row; saving lives in workspace-minutes.js.
//
// Motions and action items start out UNCONFIRMED. A motion can only be confirmed once
// the wording, mover, seconder and result are all filled in, and an action item once it
// has wording and an owner. Editing a confirmed block so that it becomes incomplete
// takes the confirmation away again.
//
// Text from the database is written with textContent, never as HTML.

const Blocks = (() => {
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const newKey = () => `k:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const STATUS_OPTIONS = [['', 'Not recorded'], ['present', 'Present'], ['regrets', 'Regrets'], ['absent', 'Absent']];
  const RESULT_OPTIONS = [['', 'Not decided'], ['carried', 'Carried'], ['defeated', 'Defeated'], ['tabled', 'Tabled'], ['withdrawn', 'Withdrawn']];

  const MOTION_DEFAULTS = { rowId: null, key: '', mover: '', moverName: '', seconder: '', seconderName: '', result: '', votes: '', confirmed: false };
  const ACTION_DEFAULTS = { rowId: null, key: '', owner: '', ownerName: '', due: '', dueText: '', confirmed: false };

  // What is still missing before a block can be confirmed. A pure function of the block.
  function motionMissing(node) {
    const a = node.attrs;
    const missing = [];
    if (!node.textContent.trim()) missing.push('what was moved');
    if (!a.mover && !a.moverName) missing.push('who moved it');
    if (!a.seconder && !a.seconderName) missing.push('who seconded it');
    if (!a.result) missing.push('the result');
    return missing;
  }
  const motionSamePerson = (node) => Boolean(node.attrs.mover && node.attrs.mover === node.attrs.seconder);

  function actionMissing(node) {
    const missing = [];
    if (!node.textContent.trim()) missing.push('what needs doing');
    if (!node.attrs.owner && !node.attrs.ownerName) missing.push('who will do it');
    return missing;
  }

  const isComplete = (node) => (node.type.name === 'motion'
    ? motionMissing(node).length === 0 && !motionSamePerson(node)
    : actionMissing(node).length === 0);

  function create(env) {
    // env: { canManage(): bool, roster(): [{id, name, role}], entries(): attendance entries }
    const views = new Set();                      // live motion and action views
    const refreshAll = () => views.forEach((v) => v.refresh());

    // ── Header ───────────────────────────────────────────────────────────────

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

    // ── Section: one agenda item, with its notes and its motions and action items ──

    function addBlock(ed, getPos, node, type) {
      const pos = getPos();
      if (typeof pos !== 'number') return;
      const end = pos + node.nodeSize - 1;                         // just inside the section's end
      const attrs = { ...(type === 'motion' ? MOTION_DEFAULTS : ACTION_DEFAULTS), key: newKey() };
      const block = ed.schema.nodes[type].create(attrs);
      const tr = ed.state.tr.insert(end, block).setMeta('allowBlockChange', true).setMeta('addToHistory', false);
      tr.setSelection(TT.TextSelection.near(tr.doc.resolve(end + 1)));
      ed.view.dispatch(tr);
      ed.view.focus();
    }

    const Section = TT.Node.create({
      name: 'section', group: 'block', content: 'paragraph+ (motion | action)*', isolating: true, defining: true,
      addAttributes() {
        return { rowId: { default: null }, number: { default: 1 }, title: { default: '' }, virtual: { default: false } };
      },
      parseHTML() { return [{ tag: 'section[data-type="section"]' }]; },
      renderHTML() { return ['section', { 'data-type': 'section' }, 0]; },
      // Enter in the notes starts a new notes paragraph. Left to itself the editor would pick the
      // first block type that can follow here, which is a motion, so say what we want.
      addKeyboardShortcuts() {
        return {
          Enter: ({ editor: ed }) => {
            const { $from } = ed.state.selection;
            if ($from.parent.type.name !== 'paragraph' || $from.node(-1).type.name !== 'section') return false;
            return ed.chain().command(({ tr, dispatch }) => {
              if (dispatch) {
                tr.deleteSelection();
                tr.split(tr.selection.from, 1, [{ type: ed.schema.nodes.paragraph }]).scrollIntoView();
              }
              return true;
            }).run();
          },
        };
      },
      addNodeView() {
        return ({ node: first, getPos, editor: ed }) => {
          let node = first;
          const dom = el('section', 'doc-section');
          const bar = el('div', 'doc-section-bar');
          bar.contentEditable = 'false';
          const heading = el('h2', 'doc-section-title');
          const buttons = el('div', 'doc-section-buttons');
          buttons.append(
            UI.button('Add a motion', null, () => addBlock(ed, getPos, node, 'motion')),
            UI.button('Add an action item', null, () => addBlock(ed, getPos, node, 'action')),
          );
          bar.append(heading, buttons);
          const body = el('div', 'doc-section-body');
          dom.append(bar, body);

          const paint = () => {
            heading.textContent = node.attrs.virtual ? node.attrs.title : `${node.attrs.number}. ${node.attrs.title}`;
            dom.classList.toggle('is-virtual', Boolean(node.attrs.virtual));
            buttons.classList.toggle('hidden', Boolean(node.attrs.virtual));
          };
          paint();
          return {
            dom,
            contentDOM: body,
            stopEvent: (e) => bar.contains(e.target),
            ignoreMutation: (m) => (m.type === 'selection' ? false : !body.contains(m.target)),
            update(n) {
              if (n.type !== node.type) return false;
              node = n;
              paint();
              return true;
            },
          };
        };
      },
    });

    // ── Attendance ───────────────────────────────────────────────────────────

    const Attendance = TT.Node.create({
      name: 'attendance', group: 'block', atom: true, selectable: false, draggable: false,
      addAttributes() { return { entries: { default: [] } }; },
      parseHTML() { return [{ tag: 'section[data-type="attendance"]' }]; },
      renderHTML() { return ['section', { 'data-type': 'attendance' }]; },
      addNodeView() {
        return ({ node: first, getPos, editor: ed }) => attendanceView(first, getPos, ed);
      },
    });

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
        write([...node.attrs.entries, { k: `g:new-${newKey()}`, id: null, roster_id: null, name, role: '', status: 'present',
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
          const bits = [e.role, e.former && 'former member',
            e.guest && (e.proxy_for_lot ? `guest, proxy for Lot ${e.proxy_for_lot.replace(/^lot\s+/i, '')}` : 'guest')].filter(Boolean);
          if (bits.length) label.append(el('span', 'att-meta', bits.join(' · ')));
          li.appendChild(label);

          if (!e.guest) {
            const select = el('select');
            select.setAttribute('aria-label', `Attendance for ${e.name}`);
            STATUS_OPTIONS.forEach(([value, text]) => {
              // Only an admin can clear a saved record, because only an admin can delete rows.
              if (value === '' && e.id && !env.canManage()) return;
              const opt = el('option', null, text);
              opt.value = value;
              select.appendChild(opt);
            });
            select.value = e.status;
            select.addEventListener('change', () => {
              write(node.attrs.entries.map((x) => (x.k === e.k ? { ...x, status: select.value } : x)));
            });
            li.appendChild(select);
          } else if (env.canManage() || !e.id) {
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

    // ── Motions and action items ─────────────────────────────────────────────

    // The shared frame: a bar of fields above an editable line of wording.
    function blockView(first, getPos, ed, kind) {
      let node = first;
      let asking = false;                         // "Remove this?" is waiting for a second click

      const dom = el('div', `blk blk-${kind}`);
      const bar = el('div', 'blk-bar');
      bar.contentEditable = 'false';
      const label = el('span', 'blk-label', kind === 'motion' ? 'MOTION' : 'ACTION');
      const fields = el('div', 'blk-fields');
      const confirm = UI.button('Confirm', null, () => set({ confirmed: !node.attrs.confirmed }), { primary: true });
      confirm.classList.add('blk-confirm');
      const removeBox = el('span', 'blk-remove');
      const note = el('p', 'blk-note');
      const warn = el('p', 'blk-warn');
      bar.append(label, fields, confirm, removeBox);
      const text = el('div', 'blk-text');
      text.dataset.placeholder = kind === 'motion' ? 'What was moved?' : 'What needs doing?';
      dom.append(bar, note, warn, text);

      const set = (patch) => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }).setMeta('addToHistory', false));
      };

      function makeSelect(caption, options, onChange) {
        const wrap = el('label', 'blk-field');
        wrap.append(el('span', null, caption));
        const select = el('select');
        select.addEventListener('change', () => onChange(select.value));
        wrap.appendChild(select);
        fields.appendChild(wrap);
        return {
          select,
          fill(opts, value) {
            select.replaceChildren(...opts.map(([v, t]) => Object.assign(el('option', null, t), { value: v })));
            select.value = value;
          },
        };
      }

      const people = () => [['', 'Choose…'], ...env.roster().map((m) => [m.id, m.name])];
      const personOptions = (id, name) => {
        const opts = people();
        if (id && !opts.some(([v]) => v === id)) opts.push([id, `${name || 'Former member'} (former member)`]);
        if (!id && name) opts.push(['__text', `${name} (not on the roster)`]);
        return opts;
      };
      const pick = (idKey, nameKey) => (value) => {
        if (value === '__text') return;
        const m = env.roster().find((r) => r.id === value);
        set({ [idKey]: value, [nameKey]: m ? m.name : '' });
      };

      let moverSel, seconderSel, resultSel, votes, ownerSel, due, dueHint;
      if (kind === 'motion') {
        moverSel = makeSelect('Moved by', [], pick('mover', 'moverName'));
        seconderSel = makeSelect('Seconded by', [], pick('seconder', 'seconderName'));
        resultSel = makeSelect('Result', RESULT_OPTIONS, (v) => set({ result: v }));
        const wrap = el('label', 'blk-field');
        wrap.append(el('span', null, 'Votes'));
        votes = el('input');
        votes.type = 'text'; votes.maxLength = 40; votes.size = 8; votes.placeholder = 'e.g. 5-1';
        votes.addEventListener('input', () => set({ votes: votes.value }));
        wrap.appendChild(votes);
        fields.appendChild(wrap);
      } else {
        ownerSel = makeSelect('Who', [], pick('owner', 'ownerName'));
        const wrap = el('label', 'blk-field');
        wrap.append(el('span', null, 'Due'));
        due = el('input');
        due.type = 'date';
        due.addEventListener('change', () => set({ due: due.value, dueText: '' }));
        wrap.appendChild(due);
        dueHint = el('span', 'blk-hint');
        wrap.appendChild(dueHint);
        fields.appendChild(wrap);
      }

      function paintRemove() {
        removeBox.replaceChildren();
        if (!env.canManage() && node.attrs.rowId) return;   // only an admin can delete a saved row
        if (asking) {
          removeBox.append(
            el('span', 'confirm-ask', `Remove this ${kind === 'motion' ? 'motion' : 'action item'}?`),
            UI.button('Yes, remove', `Yes, remove this ${kind}`, remove, { primary: true }),
            UI.button('Keep', `Keep this ${kind}`, () => { asking = false; paintRemove(); }),
          );
        } else {
          removeBox.append(UI.button('Remove', `Remove this ${kind}`, () => { asking = true; paintRemove(); }));
        }
      }

      function remove() {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        ed.view.dispatch(ed.state.tr.delete(pos, pos + node.nodeSize).setMeta('allowBlockChange', true).setMeta('addToHistory', false));
      }

      // People recorded as absent should not be moving or seconding. Say so, but do not block.
      function absenceWarnings() {
        const entries = env.entries();
        const out = [];
        [['mover', 'moverName'], ['seconder', 'seconderName']].forEach(([idKey, nameKey]) => {
          const id = node.attrs[idKey];
          const entry = id && entries.find((e) => e.roster_id === id);
          if (entry && (entry.status === 'absent' || entry.status === 'regrets')) {
            out.push(`${node.attrs[nameKey] || entry.name} is recorded as ${entry.status === 'absent' ? 'absent' : 'sending regrets'}.`);
          }
        });
        return out;
      }

      function paint() {
        const a = node.attrs;
        const missing = kind === 'motion' ? motionMissing(node) : actionMissing(node);
        const same = kind === 'motion' && motionSamePerson(node);
        const complete = missing.length === 0 && !same;

        if (kind === 'motion') {
          moverSel.fill(personOptions(a.mover, a.moverName), a.mover || (a.moverName ? '__text' : ''));
          seconderSel.fill(personOptions(a.seconder, a.seconderName), a.seconder || (a.seconderName ? '__text' : ''));
          resultSel.fill(RESULT_OPTIONS, a.result);
          if (document.activeElement !== votes) votes.value = a.votes;
        } else {
          ownerSel.fill(personOptions(a.owner, a.ownerName), a.owner || (a.ownerName ? '__text' : ''));
          if (document.activeElement !== due) due.value = a.due;
          dueHint.textContent = !a.due && a.dueText ? `Due: ${a.dueText}` : '';
        }

        dom.classList.toggle('is-confirmed', a.confirmed);
        dom.classList.toggle('is-unconfirmed', !a.confirmed);
        confirm.textContent = a.confirmed ? 'Confirmed (click to undo)' : 'Confirm';
        confirm.disabled = !a.confirmed && !complete;
        if (a.confirmed) note.textContent = '';
        else if (missing.length) note.textContent = `Still needed: ${missing.join(', ')}.`;
        else if (same) note.textContent = 'The mover and seconder should be different people.';
        else note.textContent = 'Check it, then confirm.';
        note.classList.toggle('hidden', a.confirmed);

        const warnings = absenceWarnings();
        warn.textContent = warnings.join(' ');
        warn.classList.toggle('hidden', warnings.length === 0);
        paintRemove();
      }
      paint();

      const view = { refresh: paint };
      views.add(view);

      return {
        dom,
        contentDOM: text,
        stopEvent: (e) => bar.contains(e.target),
        // Only changes to the wording belong to the editor; our own bar, notes and styling do not.
        ignoreMutation: (m) => (m.type === 'selection' ? false : !text.contains(m.target)),
        update(n) {
          if (n.type !== node.type) return false;
          node = n;
          paint();
          return true;
        },
        destroy() { views.delete(view); },
      };
    }

    // One line of wording: Enter inside a motion or action item must not split it. (Everywhere else it still works.)
    const noEnter = (typeName) => ({ Enter: ({ editor: ed }) => ed.state.selection.$from.parent.type.name === typeName });

    const Motion = TT.Node.create({
      name: 'motion', group: 'block', content: 'text*', isolating: true, defining: true,
      addAttributes() {
        const attrs = {};
        Object.entries(MOTION_DEFAULTS).forEach(([k, v]) => { attrs[k] = { default: v }; });
        return attrs;
      },
      parseHTML() { return [{ tag: 'div[data-type="motion"]' }]; },
      renderHTML() { return ['div', { 'data-type': 'motion' }, 0]; },
      addKeyboardShortcuts() { return noEnter('motion'); },
      addNodeView() { return ({ node, getPos, editor: ed }) => blockView(node, getPos, ed, 'motion'); },
    });

    const Action = TT.Node.create({
      name: 'action', group: 'block', content: 'text*', isolating: true, defining: true,
      addAttributes() {
        const attrs = {};
        Object.entries(ACTION_DEFAULTS).forEach(([k, v]) => { attrs[k] = { default: v }; });
        return attrs;
      },
      parseHTML() { return [{ tag: 'div[data-type="action"]' }]; },
      renderHTML() { return ['div', { 'data-type': 'action' }, 0]; },
      addKeyboardShortcuts() { return noEnter('action'); },
      addNodeView() { return ({ node, getPos, editor: ed }) => blockView(node, getPos, ed, 'action'); },
    });

    // ── Guard rails ──────────────────────────────────────────────────────────

    const countBlocks = (doc) => {
      const n = { header: 0, attendance: 0, section: 0, motion: 0, action: 0 };
      doc.descendants((child) => { if (child.type.name in n) n[child.type.name]++; });
      return n;
    };

    const Guard = TT.Extension.create({
      name: 'structureGuard',
      addProseMirrorPlugins() {
        return [
          // The header, attendance block and agenda sections can never be added or deleted by
          // typing. Motions and action items only come and go through their own buttons.
          new TT.Plugin({
            key: new TT.PluginKey('structureGuard'),
            filterTransaction(tr, state) {
              if (!tr.docChanged) return true;
              const a = countBlocks(state.doc);
              const b = countBlocks(tr.doc);
              if (a.header !== b.header || a.attendance !== b.attendance || a.section !== b.section) return false;
              if (tr.getMeta('allowBlockChange')) return true;
              return a.motion === b.motion && a.action === b.action;
            },
          }),
          // Editing a confirmed block so it is no longer complete takes the confirmation away.
          new TT.Plugin({
            key: new TT.PluginKey('autoUnconfirm'),
            appendTransaction(transactions, oldState, newState) {
              if (!transactions.some((t) => t.docChanged)) return null;
              let tr = null;
              newState.doc.descendants((node, pos) => {
                if ((node.type.name === 'motion' || node.type.name === 'action') && node.attrs.confirmed && !isComplete(node)) {
                  tr = (tr ?? newState.tr).setNodeMarkup(pos, undefined, { ...node.attrs, confirmed: false });
                }
              });
              return tr ? tr.setMeta('addToHistory', false) : null;
            },
          }),
        ];
      },
    });

    const MinutesDocument = TT.Document.extend({ content: 'header attendance section*' });

    return { extensions: [MinutesDocument, TT.Paragraph, TT.Text, TT.UndoRedo, Header, Attendance, Section, Motion, Action, Guard], refreshAll };
  }

  return { create, newKey, MOTION_DEFAULTS, ACTION_DEFAULTS };
})();
