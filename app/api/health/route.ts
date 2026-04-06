import { NextResponse } from 'next/server';
import { getDbHealth, initAiDatabase, maybeRunDbMaintenance } from '@/lib/ai/db';
import { getQuotaConfig } from '@/lib/ai/quotas';
import { getRuntimeCacheHealth } from '@/lib/ai/runtime-cache';

export const runtime = 'nodejs';

const CHECK_TIMEOUT_MS = Number(process.env.API_HEALTHCHECK_TIMEOUT_MS ?? 3000);

type ServiceCheck = {
  name: 'stt' | 'tts' | 'avatar';
  target: string;
  status: 'ok' | 'error';
  httpStatus?: number;
  details?: string;
};

function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    task
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function deriveHealthUrl(rawUrl: string, fallback: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.pathname = '/health';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return fallback;
  }
}

async function checkService(name: ServiceCheck['name'], target: string): Promise<ServiceCheck> {
  try {
    const response = await withTimeout(fetch(target, { method: 'GET' }), CHECK_TIMEOUT_MS);
    if (!response.ok) {
      return {
        name,
        target,
        status: 'error',
        httpStatus: response.status,
        details: `health endpoint returned ${response.status}`,
      };
    }

    return {
      name,
      target,
      status: 'ok',
      httpStatus: response.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return {
      name,
      target,
      status: 'error',
      details: message,
    };
  }
}

export async function GET() {
  await initAiDatabase();
  await maybeRunDbMaintenance();

  const sttHealthUrl = deriveHealthUrl(
    process.env.LOCAL_STT_URL ?? 'http://127.0.0.1:8001/transcribe',
    'http://127.0.0.1:8001/health',
  );
  const ttsHealthUrl = deriveHealthUrl(
    process.env.LOCAL_TTS_URL ?? 'http://127.0.0.1:8002/synthesize',
    'http://127.0.0.1:8002/health',
  );
  const avatarHealthUrl = deriveHealthUrl(
    process.env.LOCAL_AVATAR_URL ?? 'http://127.0.0.1:8003/render',
    'http://127.0.0.1:8003/health',
  );

  const [stt, tts, avatar] = await Promise.all([
    checkService('stt', sttHealthUrl),
    checkService('tts', ttsHealthUrl),
    checkService('avatar', avatarHealthUrl),
  ]);

  const openAiConfigured = Boolean((process.env.OPENAI_API_KEY ?? '').trim());
  const serviceResults = [stt, tts, avatar];
  const allServicesOk = serviceResults.every((item) => item.status === 'ok');
  const db = await getDbHealth();
  const runtimeCache = await getRuntimeCacheHealth();
  const quota = {
    status: db.status === 'ok' ? ('ok' as const) : ('error' as const),
    config: getQuotaConfig(),
    cache: runtimeCache,
  };
  const overallStatus =
    allServicesOk && openAiConfigured && db.status === 'ok' ? 'ok' : 'degraded';

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      gateway: {
        status: 'ok',
        chatModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      },
      openai: {
        configured: openAiConfigured,
      },
      database: db,
      quota,
      services: {
        stt,
        tts,
        avatar,
      },
    },
    { status: overallStatus === 'ok' ? 200 : 503 },
  );
}

