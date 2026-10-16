// OpenAI-compatible chat for EarlyPay decisions (Groq free tier by default, Ollama locally).
// Same env as the existing AI agent: LLM_BASE_URL, LLM_API_KEYS / LLM_API_KEY, LLM_MODEL.
import type { Llm } from './decide';

const keys = () => (process.env.LLM_API_KEYS ?? process.env.LLM_API_KEY ?? '').split(',').map(k => k.trim()).filter(Boolean);
let next = 0;

export function llmFromEnv(): Llm | undefined {
  if (!keys().length && !process.env.LLM_BASE_URL) return undefined;
  const base = process.env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1';
  const model = process.env.LLM_MODEL ?? 'openai/gpt-oss-120b';
  return async (system, user) => {
    const ks = keys();
    for (let attempt = 0; attempt < Math.max(1, ks.length); attempt++) {
      const key = ks.length ? ks[next++ % ks.length] : undefined;
      const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model, temperature: 0.1, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }), signal: AbortSignal.timeout(20_000) });
      if (res.ok) { const body = await res.json() as { choices: { message: { content: string } }[] }; return { text: body.choices[0].message.content, model }; }
      if (![401, 403, 429].includes(res.status)) throw new Error(`LLM API ${res.status}`);
    }
    throw new Error('All LLM keys are rate-limited or rejected');
  };
}
