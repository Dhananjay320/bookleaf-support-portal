// Shared domain vocabulary. Used by validation, the AI layer and the DB CHECK constraints.

export const TICKET_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

export const CATEGORIES = [
  'Royalty & Payments',
  'ISBN & Metadata Issues',
  'Printing & Quality',
  'Distribution & Availability',
  'Book Status & Production Updates',
  'General Inquiry',
];

export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

/** Higher = more urgent. Used for queue ordering. */
export const PRIORITY_RANK = { Critical: 4, High: 3, Medium: 2, Low: 1 };

/**
 * First-response targets per priority (hours). The queue flags tickets that have
 * been waiting longer than this so the ops team can spot breaches at a glance.
 */
export const RESPONSE_TARGET_HOURS = { Critical: 4, High: 24, Medium: 48, Low: 72 };

export const OPEN_STATUSES = ['Open', 'In Progress'];
