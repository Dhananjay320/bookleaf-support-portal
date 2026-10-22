import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { listBooks, getBook, summarizeBooks } from '../services/book.service.js';

const router = Router();

const listQuery = z.object({
  authorId: z.string().trim().regex(/^AUTH\d{3,}$/, 'Invalid author id.').optional(),
});

// Authors: their own books. Admins: all books, optionally ?authorId=AUTH001.
router.get('/', validate(listQuery, 'query'), (req, res) => {
  const books = listBooks(req.user, req.valid.query);
  res.json({ data: books, summary: summarizeBooks(books) });
});

router.get('/:id', (req, res) => {
  res.json({ data: getBook(req.user, req.params.id) });
});

export default router;
