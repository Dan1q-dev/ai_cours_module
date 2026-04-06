import { NextResponse } from 'next/server';
import { Agent } from 'undici';

const LOCAL_TTS_URL = process.env.LOCAL_TTS_URL ?? 'http://127.0.0.1:8002/synthesize';
const LOCAL_AVATAR_URL = process.env.LOCAL_AVATAR_URL ?? 'http://127.0.0.1:8003/render';
const TTS_TIMEOUT_MS = Number(process.env.TTS_TIMEOUT_MS ?? 120000);
const AVATAR_TIMEOUT_MS = Number(process.env.AVATAR_TIMEOUT_MS ?? 3600000);
const MAX_TEXT_LENGTH = 1600;
const UNDICI_LONG_TIMEOUT_MS = Math.max(AVATAR_TIMEOUT_MS + 60000, 360000);
const longFetchAgent = new Agent({
  headersTimeout: UNDICI_LONG_TIMEOUT_MS,
  bodyTimeout: UNDICI_LONG_TIMEOUT_MS,
  connectTimeout: 30000,
});
const RUSSIAN_LANGUAGE = 'ru';

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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      // Avoid Node/undici default 300s headers timeout for long avatar renders.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error undici dispatcher is available in Node runtime.
      dispatcher: longFetchAgent,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text?: string; language?: string };
    const text = String(body?.text ?? '').trim();

    if (!text) {
      return badRequest('Передайте непустой текст.');
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return badRequest(`Текст слишком длинный для аватара. Лимит: ${MAX_TEXT_LENGTH} символов.`);
    }

    if (body?.language && body.language !== RUSSIAN_LANGUAGE) {
      return badRequest('Аватар поддерживает только русский язык (`ru`).');
    }

    const ttsResponse = await fetchWithTimeout(
      LOCAL_TTS_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text, language: RUSSIAN_LANGUAGE }),
      },
      TTS_TIMEOUT_MS,
    );

    if (!ttsResponse.ok) {
      const details = await ttsResponse.text().catch(() => '');
      console.error('Avatar route TTS error:', ttsResponse.status, details);
      return NextResponse.json(
        { error: 'Не удалось получить аудио для аватара из локального TTS.' },
        { status: 502 },
      );
    }

    const wavAudio = await ttsResponse.arrayBuffer();
    const formData = new FormData();
    formData.append('file', new Blob([wavAudio], { type: 'audio/wav' }), 'avatar.wav');
    formData.append('language', RUSSIAN_LANGUAGE);

    const avatarResponse = await fetchWithTimeout(
      LOCAL_AVATAR_URL,
      {
        method: 'POST',
        body: formData,
      },
      AVATAR_TIMEOUT_MS,
    );

    if (!avatarResponse.ok) {
      const details = await avatarResponse.text().catch(() => '');
      console.error('Avatar route render error:', avatarResponse.status, details);
      return NextResponse.json(
        { error: 'Локальный сервис аватара недоступен или вернул ошибку.' },
        { status: 502 },
      );
    }

    const videoBuffer = await avatarResponse.arrayBuffer();
    return new Response(videoBuffer, {
      headers: {
        'Content-Type': avatarResponse.headers.get('Content-Type') ?? 'video/mp4',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Avatar route error:', error);

    const causeCode = getUndiciCauseCode(error);
    if (
      isAbortError(error) ||
      causeCode === 'UND_ERR_HEADERS_TIMEOUT' ||
      causeCode === 'UND_ERR_BODY_TIMEOUT'
    ) {
      return NextResponse.json(
        {
          error:
            'Таймаут рендера аватара: local-avatar не успел завершить задачу. Увеличьте AVATAR_TIMEOUT_MS или сократите текст.',
        },
        { status: 504 },
      );
    }

    if (error instanceof TypeError && error.message.includes('fetch failed')) {
      return NextResponse.json(
        {
          error:
            'Не удалось подключиться к local-avatar. Проверьте LOCAL_AVATAR_URL и что сервис запущен.',
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { error: 'Ошибка рендера аватара. Проверьте локальный сервис avatar-renderer и повторите.' },
      { status: 500 },
    );
  }
}
