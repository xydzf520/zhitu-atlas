// Official DeepSeek API specifications, verified 2026-09-17.
// Context is managed by the provider; it is not a Chat Completions request parameter.
export const DEEPSEEK_CONTEXT_TOKENS = 1048576
export const DEEPSEEK_MAX_OUTPUT_TOKENS = 393216
export const DEEPSEEK_REQUEST_TIMEOUT_MS = 45 * 60 * 1000
export const DEEPSEEK_MAX_JSON_CHARS = 4 * 1024 * 1024
export const deepseekGeneration = {
  thinking: { type: 'enabled' },
  reasoning_effort: 'max',
  max_tokens: DEEPSEEK_MAX_OUTPUT_TOKENS
} as const
