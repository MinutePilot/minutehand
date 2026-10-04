// MinuteHand workspace: what an owner is allowed to see of a meeting.
//
// The council record holds everything. The owner copy is built from it by this one function, so
// there is one place that decides what leaves the council's hands (step 9 turns the result into
// the download and the published page).
//
// The rules, in order of importance:
//   1. An in-camera agenda item contributes ONLY its public title and public summary. Its real
//      title, notes, motions and action items are not copied at all, so there is nothing to hide
//      later and nothing a template change can accidentally show.
//   2. It fails closed. An item counts as public only if is_in_camera is exactly false. A missing,
//      null or unexpected value is treated as in camera.
//   3. A motion or action item that belongs to no known agenda item cannot be shown to be public
//      (its item may have been deleted while in camera), so it is held back and counted.
//   4. Fields are copied by name from a short list. A column added to a table later is not
//      shared until someone adds it here.
//
// Pure: it reads its arguments and returns new objects. It touches no page and no database.

const OwnerCopy = (() => {
  const DEFAULT_TITLE = 'In camera session';
  const text = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
  const isPublic = (item) => item.is_in_camera === false;

  function build({ meeting, agenda, attendance, motions, actions }) {
    const items = [...(agenda ?? [])].sort(byOrder);
    const known = new Set(items.map((a) => a.id));
    const isHeldBack = (row) => !row.agenda_item_id || !known.has(row.agenda_item_id);

    const sections = items.map((item, i) => {
      const number = i + 1;
      if (!isPublic(item)) {
        return { number, inCamera: true, title: text(item.public_title) || DEFAULT_TITLE, summary: text(item.public_summary) };
      }
      return {
        number, inCamera: false, title: item.title, notes: item.notes ?? '',
        motions: (motions ?? []).filter((m) => m.agenda_item_id === item.id).sort(byOrder).map((m) => ({
          description: m.description, moved_by: m.moved_by ?? null, seconded_by: m.seconded_by ?? null,
          result: m.result ?? null, vote_tally: m.vote_tally ?? null,
        })),
        actions: (actions ?? []).filter((a) => a.agenda_item_id === item.id).sort(byOrder).map((a) => ({
          description: a.description, responsible_party: a.responsible_party ?? null,
          due_date_text: a.due_date_text ?? null, due_date_parsed: a.due_date_parsed ?? null,
        })),
      };
    });

    return {
      title: meeting?.title ?? '',
      meeting_date: meeting?.meeting_date ?? null,
      start_time: meeting?.start_time ?? null,
      location: meeting?.location ?? null,
      attendance: (attendance ?? []).map((a) => ({ display_name: a.display_name, status: a.status, proxy_for_lot: a.proxy_for_lot ?? null })),
      sections,
      heldBack: {
        motions: (motions ?? []).filter(isHeldBack).length,
        actions: (actions ?? []).filter(isHeldBack).length,
      },
    };
  }

  return { build, DEFAULT_TITLE };
})();
