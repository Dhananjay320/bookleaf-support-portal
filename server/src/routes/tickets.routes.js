import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import * as tickets from '../services/ticket.service.js';
import {
  createTicketSchema, listTicketsQuery, ticketIdParams, updateTicketSchema, messageSchema, noteSchema,
} from './schemas.js';

const router = Router();
const withId = validate(ticketIdParams, 'params');
const adminOnly = requireRole('admin');

// Each new ticket triggers an AI call, so cap creation per user to protect the AI budget.
const createLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  keyGenerator: (req) => `user:${req.user.id}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new ApiError(429, 'TOO_MANY_REQUESTS', 'You have raised a lot of tickets recently. Please wait before creating another.')),
});

router.get('/', validate(listTicketsQuery, 'query'), (req, res) => {
  res.json({ data: tickets.listTickets(req.user, req.valid.query) });
});

router.post('/', requireRole('author'), createLimiter, validate(createTicketSchema), (req, res) => {
  const ticket = tickets.createTicket(req.user, req.valid.body);
  res.status(201).location(`/api/v1/tickets/${ticket.id}`).json({ data: ticket });
});

router.get('/:id', withId, (req, res) => {
  res.json({ data: tickets.getTicket(req.user, req.valid.params.id) });
});

router.patch('/:id', adminOnly, withId, validate(updateTicketSchema), (req, res) => {
  res.json({ data: tickets.updateTicket(req.user, req.valid.params.id, req.valid.body) });
});

// Authors post follow-ups; admins post replies. Both are visible to the author.
router.post('/:id/messages', withId, validate(messageSchema), (req, res) => {
  res.status(201).json({ data: tickets.addMessage(req.user, req.valid.params.id, req.valid.body) });
});

router.post('/:id/notes', adminOnly, withId, validate(noteSchema), (req, res) => {
  res.status(201).json({ data: tickets.addInternalNote(req.user, req.valid.params.id, req.valid.body) });
});

// AI draft: GET returns the cached draft (or generates one); POST forces a fresh one.
router.get('/:id/draft', adminOnly, withId, asyncHandler(async (req, res) => {
  res.json({ data: await tickets.getDraft(req.user, req.valid.params.id) });
}));

router.post('/:id/draft', adminOnly, withId, asyncHandler(async (req, res) => {
  res.status(201).json({ data: await tickets.getDraft(req.user, req.valid.params.id, { regenerate: true }) });
}));

// Re-run AI triage (e.g. after an outage left the ticket rule-classified).
router.post('/:id/triage', adminOnly, withId, asyncHandler(async (req, res) => {
  tickets.getTicket(req.user, req.valid.params.id); // 404 check
  await tickets.triageTicket(req.valid.params.id);
  res.json({ data: tickets.getTicket(req.user, req.valid.params.id) });
}));

export default router;
