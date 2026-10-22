import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { authenticate, signToken, AUTH_COOKIE } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ApiError } from '../utils/ApiError.js';
import { loginSchema } from './schemas.js';

const router = Router();

// Slow down password guessing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new ApiError(429, 'TOO_MANY_REQUESTS', 'Too many login attempts. Please wait a few minutes.')),
});

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProduction,
  path: '/',
};

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, authorId: u.authorId ?? u.author_id ?? null });

router.post('/login', loginLimiter, validate(loginSchema), (req, res, next) => {
  const { email, password } = req.valid.body;
  const user = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);

  // Same message for unknown email and wrong password: don't reveal which accounts exist.
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return next(ApiError.unauthorized('Incorrect email or password.'));
  }

  const token = signToken(user);
  res.cookie(AUTH_COOKIE, token, { ...cookieOptions, maxAge: 12 * 3_600_000 });
  // The token is also returned for API clients (Postman, curl) that use the Authorization header.
  res.json({ token, user: publicUser(user) });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE, cookieOptions);
  res.status(204).end();
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
