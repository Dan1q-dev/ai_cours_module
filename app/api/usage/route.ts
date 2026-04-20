import { getQuotaConfig } from '@/lib/ai/quotas';
import { getUsageSummary, initAiDatabase, maybeRunDbMaintenance } from '@/lib/ai/db';
import { hashApiKey, readApiKeyFromHeaders } from '@/lib/ai/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await initAiDatabase();
    await maybeRunDbMaintenance();
  } catch (error) {
    console.error('AI database init error:', error);
    return Response.json({ error: 'Хранилище AI-модуля недоступно.' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const window = searchParams.get('window') === 'month' ? 'month' : 'day';
  const apiKeyHash = hashApiKey(readApiKeyFromHeaders(req.headers));
  const summary = await getUsageSummary(apiKeyHash, window);

  return Response.json({
    window,
    api_key_hash: apiKeyHash,
    usage: summary,
    limits: getQuotaConfig(),
  });
}

