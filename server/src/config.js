import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

const env = process.env.NODE_ENV ?? 'development';
const isProduction = env === 'production';

function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (isProduction) {
    throw new Error('JWT_SECRET must be set in production.');
  }
  // Dev convenience only: sessions are invalidated on every restart.
  console.warn('[config] JWT_SECRET not set - using a random per-process secret (dev only).');
  return crypto.randomBytes(32).toString('hex');
}

export const config = Object.freeze({
  env,
  isProduction,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  databasePath: process.env.DATABASE_PATH ?? path.join(serverRoot, 'data', 'bookleaf.db'),
  sampleDataPath: path.join(serverRoot, 'data', 'bookleaf_sample_data.json'),
  clientDistPath: path.resolve(serverRoot, '..', 'client', 'dist'),
  corsOrigin: process.env.CORS_ORIGIN ?? null,

  ai: {
    // The key is read from the environment by the server only; it is never sent to the browser.
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
    classifyModel: process.env.AI_CLASSIFY_MODEL ?? 'claude-opus-5-5',
    draftModel: process.env.AI_DRAFT_MODEL ?? 'claude-opus-5-5',
    classifyTimeoutMs: Number(process.env.AI_CLASSIFY_TIMEOUT_MS ?? 20_000),
    draftTimeoutMs: Number(process.env.AI_DRAFT_TIMEOUT_MS ?? 45_000),
    // Circuit breaker: after N consecutive failures, skip AI calls for a cooldown window
    // so a provider outage doesn't add latency to every ticket.
    breakerThreshold: Number(process.env.AI_BREAKER_THRESHOLD ?? 3),
    breakerCooldownMs: Number(process.env.AI_BREAKER_COOLDOWN_MS ?? 60_000),
  },
});
