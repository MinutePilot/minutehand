// MinuteHand workspace: the assistant in the chat pane.
// The secretary types what just happened. The chat-entry function turns it into entries and
// they land in the minutes as UNCONFIRMED blocks, in the agenda item chosen under the chat box.
// Nothing here confirms anything, and nothing is saved except through the minutes' own autosave.
// All text is written with textContent, never as HTML.

const Chat = (() => {
  const $ = (id) => document.getElementById(id);

  let client = null;
  let wired = false;
  let pending = false;
  let meetingId = null;                      // the meeting the chat is currently pointed at
  const logs = new Map();                    // meeting id -> [{ who: 'me' | 'bot' | 'err', text }], kept while the page is open

  const INTRO = [
    'Tell me what happens as it happens, for example “Dana moved to approve the budget, Lee seconded, carried”, and I will add it to the minutes for you to check.',
    'Anything I add stays unconfirmed until you confirm it, and anything you did not say is left blank.',
  ];

  // What each failure code from the function means for the secretary.
  const PROBLEMS = {
    NOT_SIGNED_IN: 'You have been signed out. Sign in again to keep using the assistant. Your minutes are saved.',
    NOT_A_MEMBER: 'Your account cannot use the assistant for this organization.',
    NO_ACCESS: 'The assistant is not switched on for this organization yet.',
    MEETING_NOT_FOUND: 'That meeting is no longer there, so I could not add anything.',
    TOO_LONG: 'That message is too long. Please send it in shorter pieces.',
    EMPTY: 'Type what happened first, then send it.',
    BAD_REQUEST: 'I could not read that message. Please try again.',
    LIMIT: 'You have reached today’s limit for the assistant. You can still type straight into the minutes, and it resets tomorrow.',
  };
  const UNAVAILABLE = 'The assistant is not available right now. Your minutes are fine, and you can type straight into them. Try again in a moment.';

  // ── The log ────────────────────────────────────────────────────────────────

  function bubble(who, text) {
    const p = document.createElement('p');
    p.className = `bubble ${who === 'me' ? 'me' : 'bot'}${who === 'err' ? ' err' : ''}${who === 'wait' ? ' wait' : ''}`;
    p.textContent = text;
    return p;
  }

  function render() {
    const box = $('chat-log');
    box.replaceChildren();
    const mine = meetingId ? (logs.get(meetingId) ?? []) : [];
    if (!meetingId) {
      box.append(bubble('bot', 'Open a meeting’s minutes and I can help you write them as the meeting happens.'));
    } else {
      if (!mine.length) INTRO.forEach((t) => box.append(bubble('bot', t)));
      mine.forEach((m) => box.append(bubble(m.who, m.text)));
      if (pending) box.append(bubble('wait', 'Reading that…'));
    }
    box.scrollTop = box.scrollHeight;
  }

  function say(forMeeting, who, text) {
    if (!logs.has(forMeeting)) logs.set(forMeeting, []);
    logs.get(forMeeting).push({ who, text });
    if (forMeeting === meetingId) render();
  }

  // ── Keeping the box in step with the minutes ───────────────────────────────

  function setEnabled(on, placeholder) {
    $('chat-input').disabled = !on || pending;
    $('chat-send').disabled = !on || pending;
    $('chat-target').disabled = !on || pending;
    $('chat-input').placeholder = placeholder;
  }

  // Called whenever the minutes open or close, the cursor moves, or the view changes.
  function sync() {
    if (!wired) return;
    const c = Minutes.chatContext();
    const select = $('chat-target');
    if (!c) {
      const changed = meetingId !== null;
      meetingId = null;
      select.replaceChildren();
      setEnabled(false, 'Open the minutes to use the assistant');
      if (changed) render();
      return;
    }
    const switched = c.meetingId !== meetingId;
    meetingId = c.meetingId;

    const chosen = select.value;
    const ids = c.items.map((i) => i.id);
    const labels = c.items.map((i) => `${i.number}. ${i.title}${i.inCamera ? ' (in camera)' : ''}`);
    if (switched || select.options.length !== ids.length || [...select.options].some((o, i) => o.value !== ids[i] || o.textContent !== labels[i])) {
      select.replaceChildren(...ids.map((id, i) => {
        const o = document.createElement('option');
        o.value = id;
        o.textContent = labels[i];
        return o;
      }));
    }
    // follow the cursor's agenda item; otherwise keep what was chosen, otherwise the first item
    select.value = c.currentId ?? (ids.includes(chosen) && !switched ? chosen : (ids[0] ?? ''));

    if (!c.items.length) setEnabled(false, 'Add an agenda item to this meeting first');
    else setEnabled(true, 'What just happened?');
    if (switched) render();
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  async function problemFrom(error) {
    try {
      const body = await error?.context?.json?.();
      if (body?.code && PROBLEMS[body.code]) return PROBLEMS[body.code];
    } catch { /* not JSON: fall through */ }
    return UNAVAILABLE;
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function summary(added, title) {
    const parts = [];
    if (added.motion) parts.push(plural(added.motion, 'motion', 'motions'));
    if (added.action) parts.push(plural(added.action, 'action item', 'action items'));
    if (added.note) parts.push(plural(added.note, 'note', 'notes'));
    return `Added to “${title}”: ${parts.join(', ')}. Check each one in the minutes and confirm it when it is right.`;
  }

  async function send(event) {
    event.preventDefault();
    if (pending || !meetingId) return;
    const input = $('chat-input');
    const message = input.value.trim();
    if (!message) return;

    const forMeeting = meetingId;
    const agendaId = $('chat-target').value || null;
    const title = $('chat-target').selectedOptions[0]?.textContent.replace(/^\d+\.\s*/, '').replace(/ \(in camera\)$/, '') ?? 'this item';

    say(forMeeting, 'me', message);
    pending = true;
    setEnabled(true, 'What just happened?');
    render();

    let reply = null;
    let problem = null;
    try {
      const { data, error } = await client.functions.invoke('chat-entry', {
        body: { meeting_id: forMeeting, agenda_item_id: agendaId, message },
      });
      if (error) problem = await problemFrom(error);
      else reply = data;
    } catch (err) {
      console.error(err);
      problem = UNAVAILABLE;
    }

    pending = false;
    const stillHere = Minutes.chatContext()?.meetingId === forMeeting;

    if (problem) {
      say(forMeeting, 'err', problem);                         // the words stay in the box so they can be sent again
    } else if (!stillHere) {
      input.value = '';
      say(forMeeting, 'err', 'That reply came in after you left this meeting, so nothing was added.');
    } else {
      input.value = '';
      const entries = Array.isArray(reply?.entries) ? reply.entries : [];
      if (!entries.length) {
        say(forMeeting, 'bot', 'I did not find anything to add to the minutes in that. Say who did what, for example “Lee will get three quotes by Friday”.');
      } else {
        const added = Minutes.addEntries(agendaId, entries);
        const total = added.note + added.motion + added.action;
        if (!total) say(forMeeting, 'err', 'I could not add that to the minutes. Please try again.');
        else say(forMeeting, 'bot', summary(added, title));
      }
      const names = Array.isArray(reply?.unmatched) ? reply.unmatched : [];
      if (names.length) {
        say(forMeeting, 'bot', `I could not find ${names.map((n) => `“${n}”`).join(' or ')} on the roster, so I left that blank. Pick the right person in the minutes, or add them to the roster.`);
      }
    }
    sync();
    render();
    if (stillHere && !$('chat-input').disabled) $('chat-input').focus();
  }

  function init(context) {
    client = context.client;
    if (!wired) {
      wired = true;
      $('chat-form').addEventListener('submit', send);
    }
    sync();
    render();
  }

  return { init, sync };
})();
