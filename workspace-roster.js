// MinuteHand workspace: step 3, the roster.
// Reads and writes the existing `roster` table. Later steps read Roster.active()
// to fill the dropdowns for who moved, who seconded and who attended.
// Everything from the database is written with textContent, never as HTML.

const Roster = (() => {
  const $ = (id) => document.getElementById(id);

  let ctx = null;            // { client, orgId, canManage }
  let rows = [];             // every roster row for this organization
  let editingId = null;      // the row open in the form, or null when adding
  let confirmingId = null;   // the former member whose "Remove" is awaiting a second click
  let busy = false;
  let wired = false;

  // ── Plain-language messages ────────────────────────────────────────────────

  const MSG = {
    load:  'We could not load the roster. Check that you are online and try again.',
    save:  'We could not save that. Check that you are online and try again.',
    perm:  'You do not have permission to change the roster. Ask an admin.',
  };

  function friendly(error) {
    return error && (error.code === '42501' || error.status === 403) ? MSG.perm : MSG.save;
  }

  function setStatus(text, retry) {
    const box = $('roster-status');
    box.replaceChildren();
    if (!text) { box.classList.add('hidden'); return; }
    const p = document.createElement('p');
    p.textContent = text;
    box.appendChild(p);
    if (retry) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-ghost';
      b.textContent = 'Try again';
      b.addEventListener('click', retry);
      box.appendChild(b);
    }
    box.classList.remove('hidden');
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  async function load() {
    const { data, error } = await ctx.client
      .from('roster')
      .select('id, name, role, strata_lot, email, term_start, term_end, status, sort_order')
      .eq('org_id', ctx.orgId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    rows = data ?? [];
  }

  const active = () => rows.filter((m) => m.status === 'active');
  const former = () => rows.filter((m) => m.status === 'former');

  // Run a change, then reload so the screen always shows what is really saved.
  // Returns { ok, message }; message is the plain sentence to show when it failed.
  async function change(work, doneText, { failureInForm = false } = {}) {
    if (busy) return { ok: false, message: '' };
    busy = true;
    setButtons();
    setStatus('');
    let failure = '';
    try {
      await work();
    } catch (err) {
      console.error(err);
      failure = friendly(err);
      if (!failureInForm) setStatus(failure);
    }
    try { await load(); } catch (err) { console.error(err); setStatus(MSG.load, refresh); }
    busy = false;
    render();
    if (!failure && doneText) setStatus(doneText);
    return { ok: !failure, message: failure };
  }

  // ── The list ───────────────────────────────────────────────────────────────

  function termText(m) {
    if (m.term_start && m.term_end) return `Term ${m.term_start} to ${m.term_end}`;
    if (m.term_start) return `Since ${m.term_start}`;
    if (m.term_end)   return `Until ${m.term_end}`;
    return '';
  }

  function button(label, aria, onClick, { primary = false, disabled = false } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'btn-primary btn-small' : 'btn-ghost btn-small';
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    b.disabled = disabled || busy;
    b.addEventListener('click', onClick);
    return b;
  }

  function item(m, index, count, isFormer) {
    const li = document.createElement('li');
    li.className = 'roster-item';
    li.dataset.id = m.id;

    const info = document.createElement('div');
    info.className = 'roster-info';
    const name = document.createElement('strong');
    name.textContent = m.name;
    info.appendChild(name);
    const bits = [m.role, m.strata_lot && `Lot ${m.strata_lot.replace(/^lot\s+/i, '')}`, m.email, termText(m)].filter(Boolean);
    if (bits.length) {
      const small = document.createElement('span');
      small.className = 'roster-meta';
      small.textContent = bits.join(' · ');
      info.appendChild(small);
    }
    li.appendChild(info);

    if (!ctx.canManage) return li;

    const actions = document.createElement('div');
    actions.className = 'roster-actions';
    if (!isFormer) {
      actions.append(
        button('Edit', `Edit ${m.name}`, () => openForm(m)),
        button('Up', `Move ${m.name} up`, () => move(m.id, -1), { disabled: index === 0 }),
        button('Down', `Move ${m.name} down`, () => move(m.id, 1), { disabled: index === count - 1 }),
        button('Retire', `Retire ${m.name}`, () => setStatusOf(m, 'former')),
      );
    } else if (confirmingId === m.id) {
      const ask = document.createElement('span');
      ask.className = 'roster-ask';
      ask.textContent = `Remove ${m.name} for good?`;
      actions.append(
        ask,
        button('Yes, remove', `Yes, remove ${m.name} permanently`, () => remove(m), { primary: true }),
        button('Keep', `Keep ${m.name}`, () => { confirmingId = null; render(); }),
      );
    } else {
      actions.append(
        button('Bring back', `Bring ${m.name} back`, () => setStatusOf(m, 'active')),
        button('Remove', `Remove ${m.name} permanently`, () => { confirmingId = m.id; render(); }),
      );
    }
    li.appendChild(actions);
    return li;
  }

  function render() {
    const now = active();
    const gone = former();
    $('roster-count').textContent = `${now.length} active member${now.length === 1 ? '' : 's'}`;
    $('roster-empty').classList.toggle('hidden', now.length > 0 || !ctx.canManage);
    $('roster-add').classList.toggle('hidden', !ctx.canManage);
    $('roster-readonly').classList.toggle('hidden', ctx.canManage);

    $('roster-list').replaceChildren(...now.map((m, i) => item(m, i, now.length, false)));
    $('roster-former-list').replaceChildren(...gone.map((m, i) => item(m, i, gone.length, true)));
    $('roster-former-count').textContent = String(gone.length);
    $('roster-former').classList.toggle('hidden', gone.length === 0);
    setButtons();
  }

  function setButtons() {
    $('roster-save').disabled = busy;
    $('roster-add').disabled = busy;
    document.querySelectorAll('#view-roster .roster-actions button').forEach((b) => { if (busy) b.disabled = true; });
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function setStatusOf(m, status) {
    if (status === 'active') {
      const twin = active().find((a) => a.name.toLowerCase() === m.name.toLowerCase());
      if (twin) {
        setStatus(`${twin.name} is already on the roster. Change one of their names first so they can be told apart.`);
        return;
      }
    }
    const text = status === 'former'
      ? `${m.name} is now a former member. They stay in past minutes.`
      : `${m.name} is back on the roster.`;
    await change(async () => {
      const { error } = await ctx.client.from('roster')
        .update({ status, updated_at: new Date().toISOString() }).eq('id', m.id);
      if (error) throw error;
    }, text);
  }

  async function remove(m) {
    confirmingId = null;
    await change(async () => {
      const { error } = await ctx.client.from('roster').delete().eq('id', m.id);
      if (error) throw error;
    }, `${m.name} was removed. Past minutes keep their name.`);
  }

  // Order is saved by position, so members who share a sort_order are tidied up too.
  async function move(id, step) {
    const list = active();
    const from = list.findIndex((m) => m.id === id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= list.length) return;
    const next = list.slice();
    [next[from], next[to]] = [next[to], next[from]];
    await change(async () => {
      for (let i = 0; i < next.length; i++) {
        if (next[i].sort_order === i) continue;
        const { error } = await ctx.client.from('roster').update({ sort_order: i }).eq('id', next[i].id);
        if (error) throw error;
      }
    });
  }

  // ── The form ───────────────────────────────────────────────────────────────

  const FIELDS = ['name', 'role', 'lot', 'email', 'term-start', 'term-end'];
  const field = (n) => $(`rf-${n}`);

  function formError(text) {
    const el = $('roster-form-error');
    el.textContent = text ?? '';
    el.classList.toggle('hidden', !text);
  }

  function openForm(member = null) {
    editingId = member?.id ?? null;
    $('roster-form-title').textContent = member ? `Edit ${member.name}` : 'Add a member';
    field('name').value = member?.name ?? '';
    field('role').value = member?.role ?? '';
    field('lot').value = member?.strata_lot ?? '';
    field('email').value = member?.email ?? '';
    field('term-start').value = member?.term_start ?? '';
    field('term-end').value = member?.term_end ?? '';
    formError('');
    $('roster-form').classList.remove('hidden');
    field('name').focus();
  }

  function closeForm() {
    editingId = null;
    $('roster-form').classList.add('hidden');
    formError('');
  }

  // Returns the cleaned values, or throws a plain sentence for the person to read.
  function readForm() {
    const name = field('name').value.trim().replace(/\s+/g, ' ');
    const email = field('email').value.trim();
    const start = field('term-start').value;
    const end = field('term-end').value;
    if (!name) throw new Error('Enter a name.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That email address does not look right.');
    if (start && end && end < start) throw new Error('The term end date is before the start date.');
    const twin = active().find((m) => m.id !== editingId && m.name.toLowerCase() === name.toLowerCase());
    if (twin) throw new Error(`${twin.name} is already on the roster. Add a last name or an initial so they can be told apart.`);
    return {
      name,
      role: field('role').value.trim() || 'Director',
      strata_lot: field('lot').value.trim() || null,
      email: email || null,
      term_start: start || null,
      term_end: end || null,
    };
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    let values;
    try { values = readForm(); } catch (err) { formError(err.message); return; }
    formError('');

    const editing = editingId;
    const nextOrder = rows.length ? Math.max(...rows.map((m) => m.sort_order)) + 1 : 0;
    const result = await change(async () => {
      const query = editing
        ? ctx.client.from('roster').update({ ...values, updated_at: new Date().toISOString() }).eq('id', editing)
        : ctx.client.from('roster').insert({ ...values, org_id: ctx.orgId, sort_order: nextOrder });
      const { error } = await query;
      if (error) throw error;
    }, editing ? `Saved ${values.name}.` : `Added ${values.name}.`, { failureInForm: true });

    if (result.ok) closeForm();
    else formError(result.message);
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  async function refresh() {
    setStatus('');
    try { await load(); render(); }
    catch (err) { console.error(err); rows = []; render(); setStatus(MSG.load, refresh); }
  }

  function init(context) {
    ctx = context;
    rows = [];
    editingId = null;
    confirmingId = null;
    busy = false;
    closeForm();
    setStatus('');
    render();
    if (wired) return;
    wired = true;
    $('roster-add').addEventListener('click', () => openForm());
    $('roster-cancel').addEventListener('click', closeForm);
    $('roster-form').addEventListener('submit', submit);
  }

  return { init, open: refresh, active: () => active().map((m) => ({ ...m })) };
})();
