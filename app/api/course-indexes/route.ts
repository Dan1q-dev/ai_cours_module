import { randomUUID } from 'node:crypto';
import {
  completeCourseIndexVersion,
  initAiDatabase,
  listCourseIndexVersions,
  maybeRunDbMaintenance,
  upsertCourse,
  createCourseIndexVersion,
} from '@/lib/ai/db';
import { INDEX_EMBEDDING_MODEL, extractMaterial, indexExtractedMaterials } from '@/lib/ai/material-ingestion';
import { estimateUsageCost } from '@/lib/ai/quotas';
import { getOpenAiClient, isOpenAiConfigured } from '@/lib/ai/openai-client';
import { hashApiKey, jsonError, readApiKeyFromHeaders } from '@/lib/ai/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export async function GET(req: Request) {
  try {
    await initAiDatabase();
    await maybeRunDbMaintenance();
  } catch (error) {
    console.error('AI database init error:', error);
    return jsonError('Хранилище AI-модуля недоступно.', 503);
  }

  const { searchParams } = new URL(req.url);
  const courseId = searchParams.get('course_id')?.trim() ?? '';
  if (!courseId) {
    return jsonError('Параметр course_id обязателен.', 400);
  }

  return Response.json({
    course_id: courseId,
    versions: await listCourseIndexVersions(courseId, hashApiKey(readApiKeyFromHeaders(req.headers))),
  });
}

export async function POST(req: Request) {
  try {
    await initAiDatabase();
    await maybeRunDbMaintenance();
  } catch (error) {
    console.error('AI database init error:', error);
    return jsonError('Хранилище AI-модуля недоступно.', 503);
  }

  if (!isOpenAiConfigured()) {
    return jsonError('OPENAI_API_KEY не настроен на сервере.', 500);
  }

  const client = getOpenAiClient();

  const form = await req.formData();
  const courseId = String(form.get('course_id') ?? '').trim();
  const versionLabel = String(form.get('version_label') ?? '').trim() || null;
  const courseTitle = String(form.get('course_title') ?? '').trim() || null;
  const files = form.getAll('files').filter((item): item is File => item instanceof File);

  if (!courseId) {
    return jsonError('Поле course_id обязательно.', 400);
  }
  if (!files.length) {
    return jsonError('Передайте хотя бы один файл в поле files.', 400);
  }

  const apiKeyHash = hashApiKey(readApiKeyFromHeaders(req.headers));
  const versionId = randomUUID();

  try {
    await upsertCourse({
      courseId,
      apiKeyHash,
      title: courseTitle ?? courseId,
    });
    await createCourseIndexVersion({
      id: versionId,
      courseId,
      apiKeyHash,
      versionLabel,
      embeddingModel: INDEX_EMBEDDING_MODEL,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'course ownership mismatch'
        ? 'Курс принадлежит другому API-клиенту.'
        : 'Не удалось создать версию индекса курса.';
    return jsonError(message, error instanceof Error && error.message === 'course ownership mismatch' ? 403 : 503);
  }

  try {
    const extracted = [];
    for (const file of files) {
      extracted.push(await extractMaterial(file));
    }

    const indexing = await indexExtractedMaterials({
      client,
      courseId,
      versionId,
      materials: extracted,
    });

    await completeCourseIndexVersion({
      id: versionId,
      sourceCount: extracted.length,
      chunkCount: indexing.chunkCount,
      status: 'ready',
    });

    return Response.json({
      course_id: courseId,
      version_id: versionId,
      version_label: versionLabel,
      source_count: extracted.length,
      chunk_count: indexing.chunkCount,
      embedding_model: INDEX_EMBEDDING_MODEL,
      usage: estimateUsageCost({
        prompt_tokens: 0,
        completion_tokens: 0,
        embedding_tokens: indexing.embeddingTokens,
        total_tokens: indexing.embeddingTokens,
      }),
      materials: extracted.map((item) => ({
        file_name: item.fileName,
        media_type: item.mediaType,
        source_kind: item.sourceKind,
      })),
    });
  } catch (error) {
    console.error('Course indexing error:', error);
    await completeCourseIndexVersion({
      id: versionId,
      sourceCount: 0,
      chunkCount: 0,
      status: 'failed',
    });
    return jsonError(
      error instanceof Error ? error.message : 'Не удалось обработать загруженные материалы.',
      502,
      { code: 'course_indexing_failed' },
    );
  }
}

