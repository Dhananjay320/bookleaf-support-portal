import { z } from 'zod';
import { CATEGORIES, PRIORITIES, TICKET_STATUSES } from '../domain.js';

const trimmed = (min, max, label) =>
  z.string({ required_error: `${label} is required.` })
    .trim()
    .min(min, `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.').max(200),
});

export const createTicketSchema = z.object({
  // null / '' / 'general' all mean "General / Account level"
  bookId: z.union([z.string().trim().regex(/^BK\d{3,}$/, 'Unknown book.'), z.literal(''), z.null()])
    .optional()
    .transform((v) => v || null),
  subject: trimmed(5, 150, 'Subject'),
  description: trimmed(20, 5000, 'Description'),
  // Attachment upload is UI-only in this version; we record the filename for context.
  attachmentName: z.string().trim().max(255).optional().nullable(),
});

const csvList = (values) =>
  z.string().optional().transform((v, ctx) => {
    if (!v) return undefined;
    const items = v.split(',').map((s) => s.trim()).filter(Boolean);
    const invalid = items.filter((i) => !values.includes(i));
    if (invalid.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid value(s): ${invalid.join(', ')}. Allowed: ${values.join(', ')}.` });
      return z.NEVER;
    }
    return items;
  });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

export const listTicketsQuery = z.object({
  status: csvList(TICKET_STATUSES),
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee: z.enum(['me', 'unassigned']).optional(),
  from: isoDate.optional(),
  // inclusive end date: convert to an exclusive upper bound
  to: isoDate.optional().transform((d) => (d ? new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10) : undefined)),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['urgency', 'newest', 'oldest', 'updated']).default('urgency'),
});

export const ticketIdParams = z.object({
  id: z.coerce.number().int().positive('Ticket id must be a positive integer.'),
});

export const updateTicketSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    category: z.enum(CATEGORIES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assigneeId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Provide at least one of: status, category, priority, assigneeId.');

export const messageSchema = z.object({
  body: trimmed(1, 5000, 'Message'),
  // admin only: set a status in the same action, e.g. "Send & resolve"
  status: z.enum(TICKET_STATUSES).optional(),
  aiAssisted: z.boolean().optional(),
});

export const noteSchema = z.object({
  body: trimmed(1, 3000, 'Note'),
});
