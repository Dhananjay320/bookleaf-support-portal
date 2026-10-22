import { GoogleGenAI, ApiError } from '@google/genai';

// Gemini 2.5 models take a thinking token budget; Gemini 3+ models take a thinking level.
// Our "effort" maps onto whichever the model supports.
const THINKING_BUDGET = { low: 0, medium: 1024 };
const THINKING_LEVEL = { low: 'LOW', medium: 'LOW' };

function thinkingConfigFor(model, effort) {
  if (/^gemini-2\.5/.test(model)) {
    // 2.5 Pro cannot disable thinking entirely; give it the smallest budget it accepts.
    const budget = THINKING_BUDGET[effort] ?? 0;
    return { thinkingBudget: model.includes('pro') ? Math.max(budget, 128) : budget };
  }
  if (/^gemini-[3-9]/.test(model)) return { thinkingLevel: THINKING_LEVEL[effort] ?? 'LOW' };
  return undefined;
}

// Finish reasons that mean the model declined or was blocked.
const BLOCKED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);

/**
 * Google Gemini adapter. Same interface as the Anthropic adapter, so the
 * classifier, drafter and fallbacks don't know which provider is active.
 */
export function createGeminiProvider({ apiKey, models }) {
  const client = new GoogleGenAI({ apiKey });

  return {
    name: 'gemini',
    models,

    async complete({ model, system, user, maxTokens, effort, jsonSchema, timeoutMs, maxRetries }) {
      const response = await client.models.generateContent({
        model,
        contents: user,
        config: {
          systemInstruction: system,
          maxOutputTokens: maxTokens,
          thinkingConfig: thinkingConfigFor(model, effort),
          ...(jsonSchema && { responseMimeType: 'application/json', responseJsonSchema: jsonSchema }),
          httpOptions: {
            timeout: timeoutMs,
            // Retry transient failures (rate limits, overload, server errors) with backoff.
            retryOptions: { attempts: maxRetries + 1, httpStatusCodes: [408, 429, 500, 502, 503, 504] },
          },
        },
      });

      const reason = response.candidates?.[0]?.finishReason;
      let finish = 'end';
      if (response.promptFeedback?.blockReason || BLOCKED.has(reason)) finish = 'refusal';
      else if (reason === 'MAX_TOKENS') finish = 'truncated';

      const usage = response.usageMetadata ?? {};
      return {
        text: (response.text ?? '').trim(),
        finish,
        model: response.modelVersion ?? model,
        usage: {
          inputTokens: usage.promptTokenCount ?? null,
          // thinking tokens are billed as output, so count them
          outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) || null,
          cacheReadTokens: usage.cachedContentTokenCount ?? null,
        },
      };
    },

    describeError(err) {
      if (err instanceof ApiError) {
        if (err.status === 429) return 'rate_limited';
        if (err.status === 401 || err.status === 403) return 'auth_failed';
        if (err.status === 400) return `bad_request: ${err.message.slice(0, 200)}`;
        return `api_error_${err.status}`;
      }
      if (err?.name === 'AbortError' || /timed? ?out/i.test(err?.message ?? '')) return 'timeout';
      if (err instanceof TypeError && /fetch/i.test(err.message)) return 'connection_error';
      return null;
    },
  };
}
