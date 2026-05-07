import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const LOCAL_TTS_URL = process.env.LOCAL_TTS_URL ?? 'http://127.0.0.1:8002/synthesize';
const LOCAL_AVATAR_URL = (process.env.LOCAL_AVATAR_URL ?? '').trim();
const AVATAR_TTS_PROVIDER = (process.env.AVATAR_TTS_PROVIDER ?? 'local').trim().toLowerCase();
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts';
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE ?? 'alloy';
const TTS_TIMEOUT_MS = Number(process.env.TTS_TIMEOUT_MS ?? 120000);
const AVATAR_TIMEOUT_MS = Number(
  process.env.AVATAR_TIMEOUT_MS ?? Number(process.env.AVATAR_TIMEOUT_SEC ?? 3600) * 1000,
);
const MAX_TEXT_LENGTH = 1600;
const RUSSIAN_LANGUAGE = 'ru';

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function serverError(message: string, status: number, details?: string) {
  return NextResponse.json(
    {
      error: message,
      ...(details ? { details } : {}),
    },
    { status },
  );
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
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesizeWithLocalTts(text: string): Promise<ArrayBuffer> {
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
    console.error('Avatar route local TTS error:', ttsResponse.status, details);
    throw new Error(`local_tts_failed:${ttsResponse.status}:${details}`);
  }

  return ttsResponse.arrayBuffer();
}

async function synthesizeWithOpenAiTts(text: string): Promise<ArrayBuffer> {
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('openai_tts_not_configured');
  }

  const client = new OpenAI({ apiKey });
  const speechResponse = await client.audio.speech.create(
    {
      model: OPENAI_TTS_MODEL as OpenAI.Audio.SpeechModel,
      voice: OPENAI_TTS_VOICE as OpenAI.Audio.SpeechCreateParams['voice'],
      input: text,
      response_format: 'wav',
    },
    { timeout: TTS_TIMEOUT_MS },
  );

  return speechResponse.arrayBuffer();
}

function extractServiceError(error: Error, prefix: string) {
  if (!error.message.startsWith(prefix)) {
    return null;
  }

  const [, status, ...details] = error.message.split(':');
  return {
    status: Number(status) || 502,
    details: details.join(':'),
  };
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

    if (!LOCAL_AVATAR_URL) {
      return serverError('LOCAL_AVATAR_URL не настроен. Укажите полный endpoint /render для avatar service.', 500);
    }

    let wavAudio: ArrayBuffer;
    try {
      wavAudio =
        AVATAR_TTS_PROVIDER === 'openai'
          ? await synthesizeWithOpenAiTts(text)
          : await synthesizeWithLocalTts(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown TTS error';
      console.error('Avatar route TTS error:', message);

      if (message === 'openai_tts_not_configured') {
        return serverError('OPENAI_API_KEY не настроен для AVATAR_TTS_PROVIDER=openai.', 500);
      }

      const localTtsError = error instanceof Error ? extractServiceError(error, 'local_tts_failed:') : null;
      if (localTtsError) {
        return serverError(
          'Не удалось получить аудио для аватара из локального TTS.',
          502,
          localTtsError.details,
        );
      }

      const providerLabel = AVATAR_TTS_PROVIDER === 'openai' ? 'OpenAI TTS' : 'локального TTS';
      return serverError(`Не удалось получить WAV-аудио через ${providerLabel}.`, 502, message);
    }

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
      return serverError(
        'Avatar service вернул ошибку при render.',
        avatarResponse.status,
        details,
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
