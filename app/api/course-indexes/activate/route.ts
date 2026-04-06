import { activateCourseIndexVersion, initAiDatabase, maybeRunDbMaintenance } from '@/lib/ai/db';
import { hashApiKey, jsonError, readApiKeyFromHeaders } from '@/lib/ai/request';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    await initAiDatabase();
    await maybeRunDbMaintenance();
  } catch (error) {
    console.error('AI database init error:', error);
    return jsonError('Хранилище AI-модуля недоступно.', 503);
  }

  let body: { course_id?: string; version_id?: string };
  try {
    body = (await req.json()) as { course_id?: string; version_id?: string };
  } catch {
    return jsonError('Тело запроса должно быть корректным JSON.', 400);
  }

  const courseId = String(body.course_id ?? '').trim();
  const versionId = String(body.version_id ?? '').trim();
  if (!courseId || !versionId) {
    return jsonError('Поля course_id и version_id обязательны.', 400);
  }

  try {
    await activateCourseIndexVersion({
      courseId,
      versionId,
      apiKeyHash: hashApiKey(readApiKeyFromHeaders(req.headers)),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'course version not found') {
      return jsonError('Версия индекса курса не найдена.', 404);
    }
    if (error instanceof Error && error.message === 'course version is not ready') {
      return jsonError('Нельзя активировать неготовую версию индекса.', 409);
    }
    return jsonError('Не удалось активировать версию индекса курса.', 503);
  }

  return Response.json({
    course_id: courseId,
    version_id: versionId,
    status: 'activated',
  });
}

