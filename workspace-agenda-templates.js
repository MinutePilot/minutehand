// MinuteHand workspace: the standard agenda for each kind of organization.
// Deliberately generic: no province, state or legal wording, so one set works
// everywhere. The secretary can rename, reorder, add and remove any item.

const AGENDA_TEMPLATES = {
  STRATA: {
    meetingTitle: 'Council Meeting',
    items: [
      'Call to order',
      'Approval of the agenda',
      'Approval of the previous minutes',
      'Business arising from the previous minutes',
      'Financial report',
      "Manager's report",
      'Correspondence',
      'New business',
      'Next meeting',
      'Adjournment',
    ],
  },
  HOA_GENERIC: {
    meetingTitle: 'Board Meeting',
    items: [
      'Call to order',
      'Approval of the agenda',
      'Approval of the previous minutes',
      'Business arising from the previous minutes',
      'Financial report',
      "Manager's report",
      'Correspondence',
      'New business',
      'Next meeting',
      'Adjournment',
    ],
  },
  NONPROFIT_BOARD: {
    meetingTitle: 'Board Meeting',
    items: [
      'Call to order',
      'Approval of the agenda',
      'Approval of the previous minutes',
      'Business arising from the previous minutes',
      "Chair's report",
      "Treasurer's report",
      'Committee reports',
      'New business',
      'Next meeting',
      'Adjournment',
    ],
  },
  TEAM_INFORMAL: {
    meetingTitle: 'Team Meeting',
    items: [
      'Welcome',
      'Review of last meeting',
      'Updates',
      'Decisions needed',
      'Any other business',
      'Action items and next steps',
    ],
  },
};

// An organization type we do not know about still gets a sensible agenda.
function agendaTemplateFor(orgType) {
  return AGENDA_TEMPLATES[orgType] ?? AGENDA_TEMPLATES.STRATA;
}
