import { assertSessionOwnership, getTelemetry, initAiDatabase, maybeRunDbMaintenance } from '@/lib/ai/db';
import { hashApiKey, jsonError, readApiKeyFromHeaders } from '@/lib/ai/request';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    await initAiDatabase();
    await maybeRunDbMaintenance();
  } catch (error) {
    console.error('AI database init error:', error);
    return jsonError('Хранилище AI-модуля недоступно.', 503);
  }

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('session_id')?.trim() ?? '';
  const limit = Number(searchParams.get('limit') ?? 20);

  if (!sessionId) {
    return jsonError('Параметр session_id обязателен.', 400);
  }

  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    return jsonError('Параметр limit должен быть числом от 1 до 100.', 400);
  }

  try {
    const ownership = await assertSessionOwnership(sessionId, hashApiKey(readApiKeyFromHeaders(req.headers)));
    if (!ownership.exists) {
      return jsonError('Сессия не найдена.', 404);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'session ownership mismatch') {
      return jsonError('Доступ к телеметрии этой сессии запрещен.', 403);
    }
    return jsonError('Не удалось получить телеметрию сессии.', 503);
  }

  return Response.json({
    session_id: sessionId,
    items: await getTelemetry(sessionId, limit),
  });
}

