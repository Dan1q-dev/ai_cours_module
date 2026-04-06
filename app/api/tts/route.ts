import { NextResponse } from 'next/server';

const LOCAL_TTS_URL = process.env.LOCAL_TTS_URL ?? 'http://127.0.0.1:8002/synthesize';
const TTS_TIMEOUT_MS = Number(process.env.TTS_TIMEOUT_MS ?? 120000);
const MAX_TEXT_LENGTH = 1500;
const RUSSIAN_LANGUAGE = 'ru';

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text?: string; language?: string };
    const text = String(body?.text ?? '').trim();

    if (!text) {
      return badRequest('Передайте непустой текст.');
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return badRequest(`Текст слишком длинный для TTS. Лимит: ${MAX_TEXT_LENGTH} символов.`);
    }

    if (body?.language && body.language !== RUSSIAN_LANGUAGE) {
      return badRequest('Озвучка поддерживает только русский язык (`ru`).');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    let ttsResponse: Response;
    try {
      ttsResponse = await fetch(LOCAL_TTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text, language: RUSSIAN_LANGUAGE }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!ttsResponse.ok) {
      const responseText = await ttsResponse.text().catch(() => '');
      console.error('Local TTS error:', ttsResponse.status, responseText);
      return NextResponse.json(
        { error: 'Локальный сервис синтеза речи недоступен или вернул ошибку.' },
        { status: 502 },
      );
    }

    const audioBuffer = await ttsResponse.arrayBuffer();
    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('TTS route error:', error);
    return NextResponse.json(
      { error: 'Ошибка синтеза речи. Попробуйте снова через несколько секунд.' },
      { status: 500 },
    );
  }
}
