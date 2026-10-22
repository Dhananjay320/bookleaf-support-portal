import Anthropic from '@anthropic-ai/sdk';

/**
 * Anthropic Claude adapter. Translates the provider-neutral request used by the
 * classifier/drafter into a Messages API call and normalises the response.
 */
export function createAnthropicProvider({ apiKey, models }) {
  const client = new Anthropic({ apiKey });

  return {
    name: 'anthropic',
    models,

    async complete({ model, system, user, maxTokens, effort, jsonSchema, refusalFallback, timeoutMs, maxRetries }) {
      const params = {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: {
          effort,
          ...(jsonSchema && { format: { type: 'json_schema', schema: jsonSchema } }),
        },
      };
      const options = { timeout: timeoutMs, maxRetries };

      // Drafts opt into server-side refusal fallback: if the model declines (e.g. a
      // safety-classifier false positive on an angry ticket) the API retries on a
      // fallback model inside the same call.
      const response = refusalFallback
        ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, options)
        : await client.messages.create(params, options);

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();

      const finish = { end_turn: 'end', refusal: 'refusal', max_tokens: 'truncated' }[response.stop_reason] ?? 'end';

      return {
        text,
        finish,
        model: response.model ?? model,
        usage: {
          inputTokens: response.usage?.input_tokens ?? null,
          outputTokens: response.usage?.output_tokens ?? null,
          cacheReadTokens: response.usage?.cache_read_input_tokens ?? null,
        },
      };
    },

    /** Maps SDK errors to a short, loggable reason. Most specific first. */
    describeError(err) {
      if (err instanceof Anthropic.RateLimitError) return 'rate_limited';
      if (err instanceof Anthropic.AuthenticationError) return 'auth_failed';
      if (err instanceof Anthropic.BadRequestError) return `bad_request: ${err.message}`;
      if (err instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
      if (err instanceof Anthropic.APIConnectionError) return 'connection_error';
      if (err instanceof Anthropic.APIError) return `api_error_${err.status ?? 'unknown'}`;
      return null;
    },
  };
}
