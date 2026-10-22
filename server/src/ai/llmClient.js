import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { createGeminiProvider } from './providers/gemini.js';

/** Raised whenever the AI layer can't produce a usable result; callers fall back to rules/templates. */
export class AiUnavailableError extends Error {
  constructor(reason, cause) {
    super(reason);
    this.cause = cause;
  }
}

/**
 * The active LLM provider (or null when no key is configured).
 * Each provider exposes the same small interface, `complete(request)` and
 * `describeError(err)`, so switching vendors is a config change, not a code change.
 */
function createProvider() {
  const { provider, gemini, anthropic } = config.ai;
  if (provider === 'gemini' && gemini.apiKey) {
    return createGeminiProvider({ apiKey: gemini.apiKey, models: { classify: gemini.classifyModel, draft: gemini.draftModel } });
  }
  if (provider === 'anthropic' && anthropic.apiKey) {
    return createAnthropicProvider({ apiKey: anthropic.apiKey, models: { classify: anthropic.classifyModel, draft: anthropic.draftModel } });
  }
  return null;
}

const provider = createProvider();

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
  if (!provider) {
    return { enabled: false, state: 'disabled', provider: null, message: 'No AI API key configured: using rule-based triage and reply templates.' };
  }
  const base = { enabled: true, provider: provider.name, models: provider.models };
  if (Date.now() < breaker.openUntil) {
    return { ...base, state: 'degraded', message: 'AI provider is failing; temporarily using rule-based fallbacks.' };
  }
  return { ...base, state: 'ok', message: `AI assistance is active (${provider.name}).` };
}

function logCall({ purpose, ticketId, model, success, usage, latencyMs, error }) {
  getDb()
    .prepare(`INSERT INTO ai_calls (purpose, ticket_id, model, success, input_tokens, output_tokens, cache_read_tokens, latency_ms, error)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      purpose, ticketId ?? null, model, success ? 1 : 0,
      usage?.inputTokens ?? null, usage?.outputTokens ?? null, usage?.cacheReadTokens ?? null,
      latencyMs, error ?? null,
    );
}

/**
 * Executes one completion with logging, breaker checks and uniform error mapping.
 *
 * @param {object} opts
 * @param {'classify'|'draft'} opts.purpose - also selects the model configured for that task
 * @param {number} [opts.ticketId]
 * @param {object} opts.request - provider-neutral request:
 *   { system, user, maxTokens, effort: 'low'|'medium', jsonSchema?, refusalFallback?, timeoutMs, maxRetries }
 * @returns {Promise<{ text: string, model: string }>}
 */
export async function runCompletion({ purpose, ticketId, request }) {
  const status = aiStatus();
  if (status.state !== 'ok') throw new AiUnavailableError(status.state);

  const model = provider.models[purpose];
  const started = Date.now();
  try {
    const result = await provider.complete({ ...request, model });

    // Check why generation stopped before trusting the content.
    if (result.finish === 'refusal') throw new AiUnavailableError('refusal');
    if (result.finish === 'truncated') throw new AiUnavailableError('truncated');
    if (!result.text) throw new AiUnavailableError('empty_response');

    recordSuccess();
    logCall({ purpose, ticketId, model: result.model, success: true, usage: result.usage, latencyMs: Date.now() - started });
    return { text: result.text, model: result.model };
  } catch (err) {
    const reason = err instanceof AiUnavailableError ? err.message : (provider.describeError(err) ?? err?.message ?? 'unknown_error');
    // Content-level problems (refusal, truncation) don't mean the provider is down.
    if (!(err instanceof AiUnavailableError)) recordFailure();
    logCall({ purpose, ticketId, model, success: false, latencyMs: Date.now() - started, error: reason });
    console.warn(`[ai] ${purpose} failed for ticket ${ticketId ?? '-'}: ${reason}`);
    throw err instanceof AiUnavailableError ? err : new AiUnavailableError(reason, err);
  }
}
