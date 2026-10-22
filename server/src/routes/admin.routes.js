import { Router } from 'express';
import { getDb } from '../db/index.js';
import { getQueueStats } from '../services/ticket.service.js';
import { aiStatus } from '../ai/llmClient.js';

const router = Router();

/** Admin team members, for the "assign to" dropdown. */
router.get('/users', (_req, res) => {
  const users = getDb().prepare("SELECT id, name, email FROM users WHERE role = 'admin' ORDER BY name").all();
  res.json({ data: users });
});

/** Queue health + AI usage numbers for the dashboard header. */
router.get('/stats', (_req, res) => {
  res.json({ data: { ...getQueueStats(), aiStatus: aiStatus() } });
});

export default router;
