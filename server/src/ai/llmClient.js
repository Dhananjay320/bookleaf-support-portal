import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { getDb } from '../db/index.js';

/** Raised whenever the AI layer can't produce a usable result; callers fall back to rules/templates. */
export class AiUnavailableError extends Error {
  constructor(reason, cause) {
    super(reason);
    this.cause = cause;
  }
}

// The API key is read from the server environment only and never reaches the frontend.
const client = config.ai.apiKey ? new Anthropic({ apiKey: config.ai.apiKey }) : null;

// --- circuit breaker --------------------------------------------------------
// If the provider is down, every request would otherwise wait for timeouts + retries.
// After `breakerThreshold` consecutive failures we stop calling for `breakerCooldownMs`.
const breaker = { consecutiveFailures: 0, openUntil: 0 };

function recordSuccess() {
  breaker.consecutiveFailures = 0;
  breaker.openUntil = 0;
}

function recordFailure() {
  breaker.consecutiveFailures += 1;
  if (breaker.consecutiveFailures >= config.ai.breakerThreshold) {
    breaker.openUntil = Date.now() + config.ai.breakerCooldownMs;
  }
}

export function aiStatus() {
  if (!client) return { enabled: false, state: 'disabled', message: 'No ANTHROPIC_API_KEY configured: using rule-based triage and reply templates.' };
  if (Date.now() < breaker.openUntil) return { enabled: true, state: 'degraded', message: 'AI provider is failing; temporarily using rule-based fallbacks.' };
  return { enabled: true, state: 'ok', message: 'AI assistance is active.' };
}

/** Maps SDK errors to a short, loggable reason. Most specific first. */
function describeError(err) {
  if (err instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (err instanceof Anthropic.AuthenticationError) return 'auth_failed';
  if (err instanceof Anthropic.BadRequestError) return `bad_request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (err instanceof Anthropic.APIConnectionError) return 'connection_error';
  if (err instanceof Anthropic.APIError) return `api_error_${err.status ?? 'unknown'}`;
  if (err instanceof AiUnavailableError) return err.message;
  return err?.message ?? 'unknown_error';
}

function logCall({ purpose, ticketId, model, success, usage, latencyMs, error }) {
  getDb()
    .prepare(`INSERT INTO ai_calls (purpose, ticket_id, model, success, input_tokens, output_tokens, cache_read_tokens, latency_ms, error)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      purpose, ticketId ?? null, model, success ? 1 : 0,
      usage?.input_tokens ?? null, usage?.output_tokens ?? null, usage?.cache_read_input_tokens ?? null,
      latencyMs, error ?? null,
    );
}

/** Concatenates the text blocks of a response (skipping thinking blocks). */
function textOf(response) {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

/**
 * Executes one Messages API request with logging, breaker checks and uniform error mapping.
 *
 * @param {object} opts
 * @param {'classify'|'draft'} opts.purpose
 * @param {number} [opts.ticketId]
 * @param {(client: Anthropic) => Promise<Anthropic.Message>} opts.send - performs the SDK call
 * @param {string} opts.model - for logging
 * @returns {Promise<{ text: string, model: string }>}
 */
export async function runCompletion({ purpose, ticketId, model, send }) {
  const status = aiStatus();
  if (status.state !== 'ok') throw new AiUnavailableError(status.state);

  const started = Date.now();
  try {
    const response = await send(client);

    // Check stop_reason before trusting content.
    if (response.stop_reason === 'refusal') throw new AiUnavailableError('refusal');
    if (response.stop_reason === 'max_tokens') throw new AiUnavailableError('truncated');
    const text = textOf(response);
    if (!text) throw new AiUnavailableError('empty_response');

    recordSuccess();
    logCall({ purpose, ticketId, model: response.model ?? model, success: true, usage: response.usage, latencyMs: Date.now() - started });
    return { text, model: response.model ?? model };
  } catch (err) {
    const reason = describeError(err);
    // Content-level problems (refusal, truncation) don't mean the provider is down.
    if (!(err instanceof AiUnavailableError)) recordFailure();
    logCall({ purpose, ticketId, model, success: false, latencyMs: Date.now() - started, error: reason });
    console.warn(`[ai] ${purpose} failed for ticket ${ticketId ?? '-'}: ${reason}`);
    throw err instanceof AiUnavailableError ? err : new AiUnavailableError(reason, err);
  }
}

// Exposed for tests only.
export const __breaker = breaker;
