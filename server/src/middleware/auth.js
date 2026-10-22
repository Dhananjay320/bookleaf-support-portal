import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';

export const AUTH_COOKIE = 'bl_session';

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function extractToken(req) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // Browser clients use an httpOnly cookie (also lets EventSource authenticate).
  return req.cookies?.[AUTH_COOKIE] ?? null;
}

/**
 * Verifies the JWT and loads the user fresh from the DB, so a deleted user
 * or changed role takes effect immediately rather than when the token expires.
 */
export function authenticate(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next(ApiError.unauthorized());

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return next(ApiError.unauthorized('Your session has expired. Please log in again.'));
  }

  const user = getDb()
    .prepare('SELECT id, email, name, role, author_id AS authorId FROM users WHERE id = ?')
    .get(Number(payload.sub));
  if (!user) return next(ApiError.unauthorized('Account no longer exists.'));

  req.user = user;
  next();
}

/** Restricts a route to the given roles. Must run after `authenticate`. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user?.role)) return next(ApiError.forbidden());
    next();
  };
}
