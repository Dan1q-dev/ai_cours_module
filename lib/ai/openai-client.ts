import OpenAI from 'openai';

let cachedClient: OpenAI | null = null;
let cachedApiKey: string | null = null;

export function isOpenAiConfigured(): boolean {
  return Boolean((process.env.OPENAI_API_KEY ?? '').trim());
}

export function getOpenAiClient(): OpenAI {
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new OpenAI({ apiKey });
    cachedApiKey = apiKey;
  }

  return cachedClient;
}
