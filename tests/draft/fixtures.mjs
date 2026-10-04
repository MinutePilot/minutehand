// A made-up meeting used by the draft tests: a public budget item, a legal item held in camera,
// an empty adjournment, and an in-camera item with secrets planted in every field.
export const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const MEETING_ID = ID(1);
export const ORG_ID = ID(2);

export const roster = () => [
  { id: 'r1', name: 'Alice Adams' }, { id: 'r2', name: 'Ben Brooks' }, { id: 'r3', name: 'Cara Chen' }, { id: 'r4', name: 'Dan Olds' },
];

export const rows = () => ({
  meeting: { id: MEETING_ID, org_id: ORG_ID, title: 'October Council Meeting', meeting_date: '2026-10-21', location: 'Amenity room', status: 'in_progress', published: false, edited_html: null },
  orgName: 'Parkview Terrace Strata', orgType: 'STRATA',
  roster: roster(),
  agenda: [
    { id: 'a1', title: 'Call to order', notes: 'Called to order at 7:02.', sort_order: 0, is_in_camera: false, public_title: null, public_summary: null },
    { id: 'a2', title: 'Budget', notes: 'Reviewed the draft budget.', sort_order: 1, is_in_camera: false, public_title: null, public_summary: null },
    { id: 'a3', title: 'SECRET-TITLE dispute with Lot 12', notes: 'SECRET-NOTES the lawyer expects we will lose', sort_order: 2, is_in_camera: true, public_title: 'Legal matter', public_summary: 'Advice was received.' },
    { id: 'a4', title: 'Adjournment', notes: '', sort_order: 3, is_in_camera: false, public_title: null, public_summary: null },
  ],
  attendance: [
    { id: 't1', roster_id: 'r1', display_name: 'Alice Adams', proxy_for_lot: null, status: 'present' },
    { id: 't2', roster_id: 'r2', display_name: 'Ben Brooks', proxy_for_lot: null, status: 'present' },
    { id: 't3', roster_id: 'r3', display_name: 'Cara Chen', proxy_for_lot: null, status: 'absent' },
    { id: 't4', roster_id: null, display_name: 'Guest Person', proxy_for_lot: 'Lot 14', status: 'present' },
  ],
  motions: [
    { id: 'm1', agenda_item_id: 'a2', description: 'Approve the 2027 budget', moved_by: 'Alice Adams', seconded_by: 'Ben Brooks', mover_roster_id: 'r1', seconder_roster_id: 'r2', result: 'carried', vote_tally: '5-1', confirmed: true, sort_order: 0 },
    { id: 'm2', agenda_item_id: 'a3', description: 'SECRET-MOTION settle the claim for $40,000', moved_by: 'Cara Chen', seconded_by: 'Alice Adams', mover_roster_id: 'r3', seconder_roster_id: 'r1', result: 'carried', vote_tally: 'SECRET-VOTES', confirmed: true, sort_order: 2 },
  ],
  actions: [
    { id: 'c1', agenda_item_id: 'a2', description: 'Get three roof quotes', responsible_party: 'Ben Brooks', owner_roster_id: 'r2', due_date_text: null, due_date_parsed: '2026-10-23', confirmed: true, sort_order: 1 },
    { id: 'c2', agenda_item_id: 'a3', description: 'SECRET-ACTION call the lawyer', responsible_party: 'Alice Adams', owner_roster_id: 'r1', due_date_text: null, due_date_parsed: null, confirmed: true, sort_order: 3 },
  ],
});

// A draft the model could plausibly write for rows(): every entry once, in its own item, naming
// the people and the result.
export const goodDraft = () => ({
  sections: [
    { agenda_item_id: 'a1', narrative: 'The meeting was called to order at 7:02.', motions: [], actions: [] },
    { agenda_item_id: 'a2', narrative: 'The council reviewed the draft budget.',
      motions: [{ id: 'm1', text: 'MOVED by Alice Adams, SECONDED by Ben Brooks: that the 2027 budget be approved. CARRIED 5-1.' }],
      actions: [{ id: 'c1', text: 'Ben Brooks to get three roof quotes by 2026-10-23.' }] },
    { agenda_item_id: 'a3', narrative: 'SECRET-NARRATIVE the lawyer gave advice on the claim.',
      motions: [{ id: 'm2', text: 'MOVED by Cara Chen, SECONDED by Alice Adams: SECRET-MOTION settle the claim. CARRIED.' }],
      actions: [{ id: 'c2', text: 'Alice Adams to call the lawyer. SECRET-ACTION' }] },
    { agenda_item_id: 'a4', narrative: '', motions: [], actions: [] },
  ],
  closing: 'The meeting was adjourned.',
});
export const clone = (v) => JSON.parse(JSON.stringify(v));
