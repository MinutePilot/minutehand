// MinuteHand workspace: step 4, meetings and their agendas.
// The list of meetings, the "New meeting" form, and for each meeting its details
// and agenda: built from the standard agenda for the organization's type, then
// changed freely (rename, reorder, add, remove).
// Everything from the database is written with textContent, never as HTML.

const Meetings = (() => {
  const $ = (id) => document.getElementById(id);

  let ctx = null;              // { client, orgId, orgType, userId, canManage, go(view) }
  let defaults = null;         // { time: 'HH:MM' | '', place: '' }, loaded once
  let meetings = [];
  let current = null;          // the meeting open in the detail view
  let agenda = [];
  let renamingId = null;       // agenda item being renamed
  let confirming = null;       // 'delete' or 'remove:<item id>' waiting for a second click
  let busy = false;
  let wired = false;

  const STATUS_LABELS = {
    planned: 'Planned', in_progress: 'In progress', review: 'Ready to review', draft: 'Draft', approved: 'Approved',
  };
  const WORKSPACE_STATUSES = ['planned', 'in_progress', 'review'];

  // ── Dates and times ────────────────────────────────────────────────────────

  const pad = (n) => String(n).padStart(2, '0');
  const todayValue = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  function dateText(value) {                       // 'YYYY-MM-DD' shown in the reader's language
    if (!value) return 'No date yet';
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  function timeText(stamp) {
    const d = stamp ? new Date(stamp) : null;
    return d && !isNaN(d) ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  }
  function timeValue(stamp) {                      // for <input type="time">
    const d = stamp ? new Date(stamp) : null;
    return d && !isNaN(d) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
  }
  const startStamp = (date, time) => (time ? new Date(`${date}T${time}`).toISOString() : null);

  const summary = (m) => [dateText(m.meeting_date), timeText(m.start_time), m.location].filter(Boolean).join(' · ');
  const tidy = (text) => text.trim().replace(/\s+/g, ' ');

  // ── Guarding against double clicks ─────────────────────────────────────────

  const STATIC_BUTTONS = ['meeting-new', 'meeting-create', 'meeting-form-cancel', 'meeting-back', 'meeting-edit',
                          'meeting-edit-save', 'meeting-edit-cancel', 'agenda-standard', 'agenda-add-btn'];

  function setBusy(on) {
    busy = on;
    STATIC_BUTTONS.forEach((id) => { const b = $(id); if (b) b.disabled = on; });
    if (on) document.querySelectorAll('#agenda-list button, #meetings-list button, #meeting-delete-area button')
      .forEach((b) => { b.disabled = true; });
  }

  async function guarded(work) {
    if (busy) return;
    setBusy(true);
    try { await work(); } finally { setBusy(false); renderMeetingsList(); if (current) renderMeeting(); }
  }

  // ── Organization defaults (time and place) ─────────────────────────────────

  async function loadDefaults() {
    if (defaults) return;
    defaults = { time: '', place: '' };
    const { data, error } = await ctx.client.from('organizations')
      .select('default_meeting_time, default_location').eq('id', ctx.orgId).maybeSingle();
    if (error) { console.warn(error); return; }   // not essential: the form just starts blank
    defaults = { time: (data?.default_meeting_time ?? '').slice(0, 5), place: data?.default_location ?? '' };
  }

  // ── The list of meetings ───────────────────────────────────────────────────

  const listStatus = (text, retry) => UI.setStatus($('meetings-status'), text, retry);

  async function openList() {
    listStatus('');
    try {
      await loadDefaults();
      const { data, error } = await ctx.client.from('meetings')
        .select('id, title, meeting_date, start_time, location, status, agenda_items(count)')
        .eq('org_id', ctx.orgId)
        .order('meeting_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      // Only meetings made in the workspace: planned ones, or ones that have an agenda.
      meetings = (data ?? []).filter((m) => WORKSPACE_STATUSES.includes(m.status) || (m.agenda_items?.[0]?.count ?? 0) > 0);
    } catch (err) {
      console.error(err);
      meetings = [];
      listStatus('We could not load your meetings. Check that you are online and try again.', openList);
    }
    renderMeetingsList();
  }

  function renderMeetingsList() {
    $('meetings-count').textContent = `${meetings.length} meeting${meetings.length === 1 ? '' : 's'}`;
    $('meetings-empty').classList.toggle('hidden', meetings.length > 0);
    $('meetings-list').replaceChildren(...meetings.map((m) => {
      const li = document.createElement('li');
      li.className = 'meeting-item';
      const open = UI.button(m.title || 'Untitled meeting', `Open ${m.title || 'untitled meeting'}`, () => openMeeting(m.id), { small: false });
      open.classList.add('meeting-link');
      const meta = document.createElement('span');
      meta.className = 'meeting-meta';
      meta.textContent = summary(m);
      const badge = document.createElement('span');
      badge.className = `badge badge-${m.status}`;
      badge.textContent = STATUS_LABELS[m.status] ?? m.status;
      const text = document.createElement('div');
      text.className = 'meeting-text';
      text.append(open, meta);
      li.append(text, badge);
      return li;
    }));
  }

  // ── New meeting ────────────────────────────────────────────────────────────

  const formError = (text) => { $('meeting-form-error').textContent = text ?? ''; $('meeting-form-error').classList.toggle('hidden', !text); };

  function openNewForm() {
    $('mf-title').value = agendaTemplateFor(ctx.orgType).meetingTitle;
    $('mf-date').value = todayValue();
    $('mf-time').value = defaults?.time ?? '';
    $('mf-place').value = defaults?.place ?? '';
    $('mf-remember').checked = !(defaults?.time || defaults?.place);
    formError('');
    $('meeting-form').classList.remove('hidden');
    $('mf-date').focus();
  }

  function closeNewForm() {
    $('meeting-form').classList.add('hidden');
    formError('');
  }

  function readDetails(prefix, errorFn) {
    const date = $(`${prefix}-date`).value;
    if (!date) { errorFn('Pick a date for the meeting.'); return null; }
    const time = $(`${prefix}-time`).value;
    return {
      title: tidy($(`${prefix}-title`).value) || agendaTemplateFor(ctx.orgType).meetingTitle,
      meeting_date: date,
      start_time: startStamp(date, time),
      location: tidy($(`${prefix}-place`).value) || null,
      time,
    };
  }

  const templateRows = (meetingId) => agendaTemplateFor(ctx.orgType).items.map((title, i) => (
    { meeting_id: meetingId, org_id: ctx.orgId, title, source: 'template', sort_order: i }
  ));

  async function createMeeting(e) {
    e.preventDefault();
    if (busy) return;
    const v = readDetails('mf', formError);
    if (!v) return;
    formError('');
    const remember = $('mf-remember').checked;
    let created = null;
    let notice = '';

    await guarded(async () => {
      const { time, ...fields } = v;
      const made = await ctx.client.from('meetings')
        .insert({ ...fields, org_id: ctx.orgId, user_id: ctx.userId, template: ctx.orgType, status: 'planned' })
        .select('id').single();
      if (made.error) { console.error(made.error); formError(UI.saveFailure(made.error, 'the meeting')); return; }
      created = made.data.id;

      const rows = await ctx.client.from('agenda_items').insert(templateRows(created));
      if (rows.error) {
        console.error(rows.error);
        notice = 'The meeting was created, but the standard agenda could not be added. Press "Use the standard agenda" to try again.';
      }

      if (remember) {
        const saved = await ctx.client.from('organizations')
          .update({ default_meeting_time: time || null, default_location: fields.location }).eq('id', ctx.orgId);
        if (saved.error) console.warn(saved.error);
        else defaults = { time, place: fields.location ?? '' };
      }
    });

    if (created) { closeNewForm(); await openMeeting(created, { notice }); }
  }

  // ── One meeting ────────────────────────────────────────────────────────────

  const meetingStatus = (text, retry) => UI.setStatus($('meeting-status'), text, retry);

  async function openMeeting(id, { notice = '' } = {}) {
    ctx.go('meeting');
    current = null; agenda = []; renamingId = null; confirming = null;
    $('meeting-edit-form').classList.add('hidden');
    $('agenda-error').classList.add('hidden');
    meetingStatus('Loading the meeting…');
    renderMeeting();
    try {
      await loadMeeting(id);
      if (current) meetingStatus(notice);       // otherwise keep the "no longer there" message
    } catch (err) {
      console.error(err);
      meetingStatus('We could not load this meeting. Check that you are online and try again.', () => openMeeting(id));
    }
    renderMeeting();
  }

  async function loadMeeting(id) {
    const found = await ctx.client.from('meetings')
      .select('id, title, meeting_date, start_time, location, status').eq('id', id).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) { current = null; meetingStatus('That meeting is no longer there. It may have been deleted.'); return; }
    current = found.data;
    await loadAgenda();
  }

  async function loadAgenda() {
    const { data, error } = await ctx.client.from('agenda_items')
      .select('id, title, sort_order').eq('meeting_id', current.id)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true });
    if (error) throw error;
    agenda = data ?? [];
  }

  function renderMeeting() {
    const shown = Boolean(current);
    document.querySelectorAll('#view-meeting .meeting-details, #view-meeting .agenda, #view-meeting > .page > .hint')
      .forEach((el) => el.classList.toggle('hidden', !shown));
    if (!shown) { $('meeting-delete-area').replaceChildren(); return; }

    $('meeting-heading').textContent = current.title || 'Untitled meeting';
    $('meeting-summary').textContent = summary(current);
    const badge = $('meeting-badge');
    badge.textContent = STATUS_LABELS[current.status] ?? current.status;
    badge.className = `badge badge-${current.status}`;
    renderAgenda();
    renderDelete();
  }

  // ── Agenda ─────────────────────────────────────────────────────────────────

  const agendaError = (text) => { $('agenda-error').textContent = text ?? ''; $('agenda-error').classList.toggle('hidden', !text); };

  function renderAgenda() {
    $('agenda-empty').classList.toggle('hidden', agenda.length > 0);
    $('agenda-list').replaceChildren(...agenda.map((item, i) => agendaItem(item, i)));
    const renaming = $('agenda-list').querySelector('input');
    if (renaming) renaming.focus();
  }

  function agendaItem(item, index) {
    const li = document.createElement('li');
    li.className = 'agenda-item';
    li.dataset.id = item.id;

    if (renamingId === item.id) {
      const form = document.createElement('form');
      form.className = 'agenda-rename';
      form.noValidate = true;
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 200;
      input.value = item.title;
      input.setAttribute('aria-label', `New name for ${item.title}`);
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { renamingId = null; renderAgenda(); } });
      form.append(
        input,
        Object.assign(UI.button('Save', `Save the new name for ${item.title}`, () => {}, { primary: true }), { type: 'submit' }),
        UI.button('Cancel', 'Cancel renaming', () => { renamingId = null; renderAgenda(); }),
      );
      form.addEventListener('submit', (e) => { e.preventDefault(); renameItem(item, input.value); });
      li.appendChild(form);
      return li;
    }

    const title = document.createElement('span');
    title.className = 'agenda-title';
    title.textContent = item.title;
    li.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'agenda-actions';
    if (confirming === `remove:${item.id}`) {
      const ask = document.createElement('span');
      ask.className = 'confirm-ask';
      ask.textContent = 'Remove this item?';
      actions.append(
        ask,
        UI.button('Yes, remove', `Yes, remove ${item.title}`, () => removeItem(item), { primary: true }),
        UI.button('Keep', `Keep ${item.title}`, () => { confirming = null; renderAgenda(); }),
      );
    } else {
      actions.append(
        UI.button('Rename', `Rename ${item.title}`, () => { renamingId = item.id; confirming = null; renderAgenda(); }),
        UI.button('Up', `Move ${item.title} up`, () => moveItem(item.id, -1), { disabled: index === 0 }),
        UI.button('Down', `Move ${item.title} down`, () => moveItem(item.id, 1), { disabled: index === agenda.length - 1 }),
      );
      if (ctx.canManage) {
        actions.append(UI.button('Remove', `Remove ${item.title}`, () => { confirming = `remove:${item.id}`; renamingId = null; renderAgenda(); }));
      }
    }
    li.appendChild(actions);
    return li;
  }

  // Run an agenda change, then reload so the screen always shows what is really saved.
  async function agendaChange(work, { onFail } = {}) {
    agendaError('');
    await guarded(async () => {
      try { await work(); }
      catch (err) { console.error(err); (onFail ?? agendaError)(UI.saveFailure(err, 'that change')); }
      try { await loadAgenda(); }
      catch (err) { console.error(err); meetingStatus('We could not refresh the agenda. Check that you are online and try again.', () => openMeeting(current.id)); }
    });
  }

  async function addItem(e) {
    e.preventDefault();
    const input = $('agenda-add-input');
    const title = tidy(input.value);
    if (!title) { agendaError('Type the agenda item first.'); return; }
    const next = agenda.length ? Math.max(...agenda.map((a) => a.sort_order)) + 1 : 0;
    await agendaChange(async () => {
      const { error } = await ctx.client.from('agenda_items')
        .insert({ meeting_id: current.id, org_id: ctx.orgId, title, source: 'added', sort_order: next });
      if (error) throw error;
      input.value = '';
    });
    input.focus();
  }

  async function renameItem(item, value) {
    const title = tidy(value);
    if (!title) { agendaError('Type a name for the item.'); return; }
    renamingId = null;
    await agendaChange(async () => {
      const { error } = await ctx.client.from('agenda_items').update({ title }).eq('id', item.id);
      if (error) throw error;
    });
  }

  async function removeItem(item) {
    confirming = null;
    await agendaChange(async () => {
      const { error } = await ctx.client.from('agenda_items').delete().eq('id', item.id);
      if (error) throw error;
    });
  }

  // Order is saved by position, so items that share an order number are tidied up too.
  async function moveItem(id, step) {
    const from = agenda.findIndex((a) => a.id === id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= agenda.length) return;
    const next = agenda.slice();
    [next[from], next[to]] = [next[to], next[from]];
    await agendaChange(async () => {
      for (let i = 0; i < next.length; i++) {
        if (next[i].sort_order === i) continue;
        const { error } = await ctx.client.from('agenda_items').update({ sort_order: i }).eq('id', next[i].id);
        if (error) throw error;
      }
    });
  }

  async function useStandardAgenda() {
    await agendaChange(async () => {
      await loadAgenda();                                  // another tab may have filled it already
      if (agenda.length > 0) return;
      const { error } = await ctx.client.from('agenda_items').insert(templateRows(current.id));
      if (error) throw error;
    });
  }

  // ── Meeting details and deleting ───────────────────────────────────────────

  const editError = (text) => { $('meeting-edit-error').textContent = text ?? ''; $('meeting-edit-error').classList.toggle('hidden', !text); };

  function openEditForm() {
    $('me-title').value = current.title ?? '';
    $('me-date').value = current.meeting_date ?? '';
    $('me-time').value = timeValue(current.start_time);
    $('me-place').value = current.location ?? '';
    editError('');
    $('meeting-edit-form').classList.remove('hidden');
    $('me-title').focus();
  }

  async function saveDetails(e) {
    e.preventDefault();
    if (busy) return;
    const v = readDetails('me', editError);
    if (!v) return;
    editError('');
    const { time, ...fields } = v;
    let ok = false;
    await guarded(async () => {
      const { error } = await ctx.client.from('meetings').update(fields).eq('id', current.id);
      if (error) { console.error(error); editError(UI.saveFailure(error, 'the details')); return; }
      ok = true;
      Object.assign(current, fields);
    });
    if (ok) { $('meeting-edit-form').classList.add('hidden'); meetingStatus('Saved the meeting details.'); }
  }

  function renderDelete() {
    const area = $('meeting-delete-area');
    // Only a meeting that has not been run yet, and only someone allowed to delete.
    if (!ctx.canManage || current.status !== 'planned') { area.replaceChildren(); return; }
    if (confirming === 'delete') {
      const ask = document.createElement('span');
      ask.className = 'confirm-ask';
      ask.textContent = 'Delete this meeting and its agenda for good?';
      area.replaceChildren(
        ask,
        UI.button('Yes, delete', 'Yes, delete this meeting', deleteMeeting, { primary: true }),
        UI.button('Keep', 'Keep this meeting', () => { confirming = null; renderDelete(); }),
      );
    } else {
      area.replaceChildren(UI.button('Delete meeting', 'Delete this meeting', () => { confirming = 'delete'; renderDelete(); }));
    }
  }

  async function deleteMeeting() {
    confirming = null;
    const title = current.title || 'The meeting';
    let ok = false;
    await guarded(async () => {
      const { error } = await ctx.client.from('meetings').delete().eq('id', current.id);
      if (error) { console.error(error); meetingStatus(UI.saveFailure(error, 'that')); return; }
      ok = true;
    });
    if (ok) { current = null; ctx.go('meetings'); listStatus(`${title} was deleted.`); }
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  function init(context) {
    ctx = context;
    defaults = null; meetings = []; current = null; agenda = [];
    renamingId = null; confirming = null; busy = false;
    closeNewForm();
    listStatus('');
    renderMeetingsList();
    if (wired) return;
    wired = true;
    $('meeting-new').addEventListener('click', openNewForm);
    $('meeting-form-cancel').addEventListener('click', closeNewForm);
    $('meeting-form').addEventListener('submit', createMeeting);
    $('meeting-back').addEventListener('click', () => ctx.go('meetings'));
    $('meeting-edit').addEventListener('click', openEditForm);
    $('meeting-edit-cancel').addEventListener('click', () => $('meeting-edit-form').classList.add('hidden'));
    $('meeting-edit-form').addEventListener('submit', saveDetails);
    $('agenda-add-form').addEventListener('submit', addItem);
    $('agenda-standard').addEventListener('click', useStandardAgenda);
  }

  return { init, openList };
})();
