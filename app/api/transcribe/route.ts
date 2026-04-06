import { NextResponse } from 'next/server';
import { Agent } from 'undici';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const LOCAL_STT_URL = process.env.LOCAL_STT_URL ?? 'http://127.0.0.1:8001/transcribe';
const STT_TIMEOUT_MS = Number(process.env.STT_TIMEOUT_MS ?? 180000);
const UNDICI_TIMEOUT_MS = Math.max(STT_TIMEOUT_MS + 30000, 120000);
const sttFetchAgent = new Agent({
  headersTimeout: UNDICI_TIMEOUT_MS,
  bodyTimeout: UNDICI_TIMEOUT_MS,
  connectTimeout: 15000,
});

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function getUndiciCauseCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return '';
  }
  const maybeCause = (error as Error & { cause?: { code?: string } }).cause;
  return typeof maybeCause?.code === 'string' ? maybeCause.code : '';
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    const languageRaw = formData.get('language');
    const preferredLanguageRaw = formData.get('preferred_language');

    if (!(file instanceof File)) {
      return badRequest('Передайте аудио-файл в поле file.');
    }

    if (file.size === 0) {
      return badRequest('Аудио-файл пустой.');
    }

    if (file.size > MAX_AUDIO_BYTES) {
      return badRequest('Аудио слишком большое. Лимит 10 MB.');
    }

    const allowedBaseTypes = new Set([
      'audio/webm',
      'audio/wav',
      'audio/x-wav',
      'audio/mpeg',
      'audio/mp4',
      'audio/ogg',
      'audio/m4a',
    ]);

    const normalizedType = (file.type || '').split(';')[0].trim().toLowerCase();
    if (normalizedType && !allowedBaseTypes.has(normalizedType)) {
      return badRequest(`Неподдерживаемый формат аудио: ${file.type}`);
    }

    const proxyFormData = new FormData();
    proxyFormData.append('file', file);
    const normalizedLanguage =
      typeof languageRaw === 'string' ? languageRaw.trim().toLowerCase() : 'auto';
    const language = ['auto', 'ru', 'kk', 'en'].includes(normalizedLanguage)
      ? normalizedLanguage
      : 'auto';
    proxyFormData.append('language', language);
    const preferredLanguage =
      typeof preferredLanguageRaw === 'string' ? preferredLanguageRaw.trim().toLowerCase() : '';
    if (['ru', 'kk', 'en'].includes(preferredLanguage)) {
      proxyFormData.append('preferred_language', preferredLanguage);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
    let sttResponse: Response;

    try {
      sttResponse = await fetch(LOCAL_STT_URL, {
        method: 'POST',
        body: proxyFormData,
        signal: controller.signal,
        // Use explicit undici timeouts for long-running local STT calls.
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error dispatcher is available in Node runtime.
        dispatcher: sttFetchAgent,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!sttResponse.ok) {
      const responseText = await sttResponse.text().catch(() => '');
      console.error('Local STT error:', sttResponse.status, responseText);
      return NextResponse.json(
        { error: 'Локальный сервис распознавания недоступен или вернул ошибку.' },
        { status: 502 },
      );
    }

    const data = (await sttResponse.json().catch(() => ({}))) as {
      text?: string;
      transcript?: string;
      transcription?: string;
      language?: string;
    };
    const text = (data.text ?? data.transcript ?? data.transcription ?? '').trim();
    const detectedLanguage = (data.language ?? '').trim().toLowerCase();
    if (!text) {
      return NextResponse.json({ text: '', language: detectedLanguage });
    }

    return NextResponse.json({ text, language: detectedLanguage });
  } catch (error) {
    console.error('Transcribe route error:', error);

    const causeCode = getUndiciCauseCode(error);
    if (
      isAbortError(error) ||
      causeCode === 'UND_ERR_HEADERS_TIMEOUT' ||
      causeCode === 'UND_ERR_BODY_TIMEOUT'
    ) {
      return NextResponse.json(
        {
          error:
            'Таймаут распознавания речи: локальный STT не успел ответить. Проверьте, что local-stt запущен и модель прогрета.',
        },
        { status: 504 },
      );
    }

    if (error instanceof TypeError && error.message.includes('fetch failed')) {
      return NextResponse.json(
        {
          error:
            'Не удалось подключиться к local-stt. Проверьте URL и что сервис запущен на LOCAL_STT_URL.',
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        error: 'Ошибка распознавания речи. Попробуйте снова через несколько секунд.',
      },
      { status: 500 },
    );
  }
}
