# Course + AI Tutor Demo

Мини-проект на `Next.js + TypeScript + Tailwind CSS` для демонстрации учебной страницы с AI-тьютором и базовым RAG по тексту лекции.

## Что внутри

- Левая панель: лекция (источник знаний).
- Правая панель: чат с AI (выезжает по кнопке, можно скрыть).
- Потоковый вывод ответа (streaming) в чате.
- Голосовой MVP:
  - запись аудио с микрофона в браузере,
  - распознавание речи через локальный `faster-whisper` сервис (проксируется через `/api/transcribe`),
  - озвучка ответов через локальный русскоязычный `piper` сервис (проксируется через `/api/tts`).
- Основной визуальный аватар: browser-side `TalkingHead (3D)` с быстрой realtime-ish анимацией поверх локального `TTS`.
- Локальный AI-аватар (legacy MVP): асинхронная генерация видео lip-sync через `MuseTalk 1.5` (проксируется через `/api/avatar`).
- RAG на сервере:
  - разбиение лекции на чанки,
  - retrieval через OpenAI embeddings + hybrid scoring (`cosine * 0.82 + keyword * 0.18`),
  - structured sources/citations,
  - guardrails, prompt-injection защита, retrieval sanitization, output guardrails, квоты и telemetry.

## Архитектура

- `app/page.tsx` - серверная загрузка лекции из `.docx` и рендер клиентской оболочки.
- `middleware.ts` - API gateway слой: CORS, preflight (`OPTIONS`), optional API key auth.
- `app/api/chat/route.ts` - guarded RAG pipeline: validation -> guardrails -> retrieval -> prompt -> SSE generation -> persistence.
- `app/api/history/route.ts` - история сообщений по `session_id`.
- `app/api/usage/route.ts` - usage/cost summary по текущему API key.
- `app/api/telemetry/route.ts` - redacted request telemetry по `session_id`.
- `app/api/transcribe/route.ts` - проксирование аудио в локальный STT (`faster-whisper`).
- `app/api/tts/route.ts` - проксирование текста в локальный TTS (`sherpa-onnx`).
- `app/api/avatar/route.ts` - legacy проксирование текста в локальный сервис аватара (через TTS + MuseTalk).
- `app/api/health/route.ts` - агрегированный healthcheck gateway + локальных сервисов.
- `app/api/openapi/route.ts` - OpenAPI JSON контракт для интеграции с другими командами.
- `lib/lecture.ts` - загрузка лекции из Word.
- `lib/rag.ts` - чанкинг, embeddings, hybrid retrieval, diagnostics, top-k.
- `lib/ai/*` - Postgres/Prisma persistence, `pgvector` retrieval storage, optional Redis runtime cache, guardrails, quotas, redaction, prompt builder.
  - guardrails включают входной фильтр, history-aware detection для multi-turn атак, sanitization извлечённого контекста и output guardrails против утечки внутренних инструкций.
- `components/*` - UI приложения.
- `public/avatars/talkinghead.glb` - локальная 3D-модель для browser-side `TalkingHead`.

## API-first для командной интеграции

Веб-страница в этом репозитории используется как демо-стенд. Для интеграции в большой проект используйте API:

- `POST /api/chat` - RAG-чат (SSE stream: `meta`, `chunk`, `done`, `error`).
- `GET /api/history` - история сообщений по `session_id`.
- `GET /api/usage` - usage/cost summary по API key.
- `GET /api/telemetry` - redacted telemetry по `session_id`.
- `POST /api/course-indexes` - обработка учебных материалов (`PDF`, `PPTX`, `DOCX`, `TXT/MD`, `video/audio`) с извлечением текста, chunking, embeddings и построением versioned index в `Postgres + pgvector`.
- `GET /api/course-indexes?course_id=...` - список версий индекса курса.
- `POST /api/course-indexes/activate` - активация готовой версии индекса курса как основной.
- `POST /api/transcribe` - STT proxy (multipart `file`).
- `POST /api/tts` - TTS proxy, только `ru`.
- `POST /api/avatar` - генерация видео-аватара, только `ru`.
- `GET /api/health` - readiness/health gateway + dependencies.
- `GET /api/openapi` - машинно-читаемая схема контрактов API.

Хранение AI-метаданных:
- `PostgreSQL + Prisma + pgvector` — authoritative storage для history, telemetry, quotas, versioned course indexes и vector retrieval.
- `Redis` — optional fast-path для quota cache и runtime job state. При недоступности Redis модуль продолжает работать через PostgreSQL.

Подробные примеры запросов: `docs/API_INTEGRATION.md`.

Опциональная защита API ключом:

```env
API_SHARED_KEY=your_internal_key
```

Поддерживается заголовок `X-API-Key` или `Authorization: Bearer <key>`.
Публичные без ключа: `/api/health`, `/api/openapi`.

CORS для gateway:

```env
API_CORS_ORIGINS=*
API_CORS_ALLOW_CREDENTIALS=false
```

## Smoke-тесты API

Быстрая проверка доступности и контрактов API gateway:

```bash
npm run test:api
```

Строгая проверка (падает, если что-то недоступно; включает avatar):

```bash
npm run test:api:strict
```

Полезные переменные окружения для тестов:

```env
API_TEST_BASE_URL=http://127.0.0.1:3000
API_TEST_KEY=your_internal_key
API_TEST_STRICT=false
API_TEST_INCLUDE_AVATAR=false
API_TEST_TIMEOUT_MS=30000
API_TEST_CHAT_TIMEOUT_MS=120000
API_TEST_AVATAR_TIMEOUT_MS=300000
```

Что проверяет скрипт:
- `GET /api/openapi`
- `GET /api/health`
- `POST /api/chat` (SSE + direct/obfuscated/history-aware guardrail scenarios)
- `POST /api/course-indexes`
- `GET /api/history`
- `GET /api/usage`
- `GET /api/telemetry`
- `POST /api/transcribe` (multipart)
- `POST /api/tts` (audio/wav)
- `POST /api/avatar` (опционально, так как долгий/ресурсный)

## Как подключать API в проект команды

1. Поднимите gateway (`npm run dev`) и нужные локальные сервисы (`local-stt`, `local-tts`, `local-avatar`).
2. Проверьте здоровье:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

3. Если включён `API_SHARED_KEY`, передавайте `X-API-Key` (или `Authorization: Bearer ...`) в каждый приватный запрос.
4. Забирайте контракт из:

```powershell
Invoke-RestMethod http://localhost:3000/api/openapi
```

5. Интегрируйте по endpoint'ам:
- `POST /api/chat` -> `text/event-stream` (event'ы: `meta`, `chunk`, `done`, `error`)
- `POST /api/course-indexes` -> multipart upload and index build
- `GET /api/course-indexes?course_id=...` -> version list
- `GET /api/history?session_id=...` -> persisted history
- `GET /api/usage?window=day|month` -> aggregated request/token/cost summary
- `GET /api/telemetry?session_id=...` -> redacted diagnostics
- `POST /api/transcribe` -> JSON `{ text, language }`
- `POST /api/tts` -> `audio/wav`
- `POST /api/avatar` -> `video/mp4`

Пример backend вызова чата (Node.js):

```js
const resp = await fetch("http://localhost:3000/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": process.env.API_SHARED_KEY ?? "",
  },
  body: JSON.stringify({
    session_id: crypto.randomUUID(),
    messages: [{ role: "user", content: "Что такое разметка данных?" }],
    locateInLecture: true,
  }),
});

const sse = await resp.text(); // parse "event: meta|chunk|done|error"
```

`event: done` содержит:
- `sources: [{ chunk_id, label, snippet, score }]`
- `citations: number[]`
- `locateSnippet: string | null`
- `usage: { prompt_tokens, completion_tokens, embedding_tokens, total_tokens, estimated_cost_usd }`
- `guardrails: { blocked, reasons }`

Пример загрузки и индексации материалов курса:

```js
const form = new FormData();
form.append("course_id", "ml-course-01");
form.append("course_title", "Machine Learning");
form.append("version_label", "2026-03-12");
form.append("files", pdfFile, "lecture-1.pdf");
form.append("files", pptxFile, "lecture-2.pptx");
form.append("files", txtFile, "notes.txt");

const indexResp = await fetch("http://localhost:3000/api/course-indexes", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.API_SHARED_KEY ?? "",
  },
  body: form,
});

const indexVersion = await indexResp.json();
```

Поддержанные источники:
- `PDF`
- `PPTX`
- `DOCX`
- `TXT`, `MD`, `CSV`
- `video/audio` файлы через локальный `STT`

Что делает ingestion pipeline:
- извлекает текст и базовую структуру файла
- режет материал на смысловые чанки по заголовкам и абзацам
- создает embeddings
- сохраняет чанки и embeddings в `Postgres + pgvector`
- создает versioned index для курса
- поддерживает активацию конкретной версии индекса
- пропускает дубликаты материалов внутри версии по `source_hash`

Чтобы использовать versioned index в чате, передавайте:

```json
{
  "session_id": "session-1",
  "course_id": "ml-course-01",
  "course_version_id": "uuid-of-index-version",
  "messages": [
    { "role": "user", "content": "О чем лекция?" }
  ]
}
```

Пример backend вызова STT (multipart):

```js
const form = new FormData();
form.append("file", new Blob([audioBytes], { type: "audio/wav" }), "voice.wav");
form.append("language", "auto");
form.append("preferred_language", "ru");

const sttResp = await fetch("http://localhost:3000/api/transcribe", {
  method: "POST",
  headers: { "X-API-Key": process.env.API_SHARED_KEY ?? "" },
  body: form,
});
const stt = await sttResp.json();
```

Пример backend вызова TTS:

```js
const ttsResp = await fetch("http://localhost:3000/api/tts", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": process.env.API_SHARED_KEY ?? "",
  },
  body: JSON.stringify({ text: "Привет!", language: "ru" }),
});
const wav = Buffer.from(await ttsResp.arrayBuffer());
```

## Запуск

1. Установить зависимости:

```bash
npm install
```

2. Создать `.env.local` на основе примера:

```powershell
Copy-Item .env.example .env.local
```

3. Заполнить `OPENAI_API_KEY` и `DATABASE_URL` в `.env.local`.
При необходимости уточните параметры vector retrieval:

```env
AI_VECTOR_DIMENSION=1536
AI_VECTOR_TOP_K=6
AI_VECTOR_CANDIDATE_MULTIPLIER=4
```

4. Сгенерировать Prisma client, включить `pgvector` extension и применить схему к локальному Postgres:

```bash
npm run db:setup
```

Скрипт `db:setup` читает `DATABASE_URL` из `.env.local`, при необходимости может создать базу через `psql`, затем включает `CREATE EXTENSION IF NOT EXISTS vector` и выполняет `prisma generate + prisma db push`.

Если PostgreSQL сообщает, что extension `vector` отсутствует в системе, один раз установите его в каталог PostgreSQL из PowerShell **от имени администратора**:

```powershell
npm run db:install-pgvector
```

5. Опционально включить Redis:

```env
AI_REDIS_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379
```

Проверка наличия Redis binary:

```bash
npm run redis:check
```
4. Запустить приложение:

```bash
npm run dev
```

5. Открыть `http://localhost:3000`.

Быстрый запуск всех сервисов в отдельных окнах PowerShell:

```bash
npm run start:all
```

Проверка API-контрактов:

```powershell
Invoke-RestMethod http://localhost:3000/api/openapi
Invoke-RestMethod http://localhost:3000/api/health
```

## Быстрый запуск локального faster-whisper (STT)

1. Откройте отдельный терминал:

```powershell
cd local-stt
.\run.ps1
```

2. Проверка:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health
```

3. Убедитесь, что в `.env.local`:

```env
LOCAL_STT_URL=http://127.0.0.1:8001/transcribe
STT_MODEL_SIZE=small
STT_DEVICE=cuda
STT_COMPUTE_TYPE=float16
STT_CUDA_DLL_DIR=C:\Projects\education_course\program\MuseTalk\.venv311\Lib\site-packages\torch\lib
```

4. CORS для прямого подключения внешнего frontend/backend:

```env
SERVICE_CORS_ORIGINS=*
SERVICE_CORS_ALLOW_CREDENTIALS=false
```

## Быстрый запуск локального piper (TTS)

1. Установите `piper` и русскую модель.
2. Проверьте пути в `.env.local`:

```env
LOCAL_TTS_URL=http://127.0.0.1:8002/synthesize
TTS_DEFAULT_LANGUAGE=ru
PIPER_EXE=C:\piper\piper.exe
PIPER_MODEL_RU=C:\piper\models\ru\denis\ru_RU-denis-medium.onnx
PIPER_LENGTH_SCALE=1.04
PIPER_MODEL_RU_FALLBACKS=C:\piper\models\ru\denis\ru_RU-denis-medium.onnx,C:\piper\models\ru\dmitri\ru_RU-dmitri-medium.onnx,C:\piper\models\ru\ruslan\ru_RU-ruslan-medium.onnx
```

3. Запустите сервис:

```powershell
cd local-tts
.\run.ps1
```

4. Проверка:

```powershell
Invoke-RestMethod http://127.0.0.1:8002/health
```

## Быстрый запуск локального Avatar Engine (MuseTalk)

1. Для `musetalk` подготовьте окружение MuseTalk 1.5 (рекомендуется Linux + CUDA; на Windows возможны ограничения по скорости/стабильности).
2. Проверьте параметры в `.env.local`:

```env
LOCAL_AVATAR_URL=http://127.0.0.1:8003/render
AVATAR_TIMEOUT_MS=3600000

AVATAR_ENGINE=musetalk
AVATAR_SOURCE_ASSET=C:\Projects\education_course\program\assets\avatar\teacher.png
# legacy alias; keep only if old tooling still reads it
AVATAR_SOURCE_VIDEO=C:\Projects\education_course\program\assets\avatar\teacher.png
AVATAR_RESULTS_DIR=runs
AVATAR_TIMEOUT_SEC=1200

MUSE_TALK_ROOT=C:\MuseTalk
MUSE_TALK_PYTHON=C:\MuseTalk\.venv311\Scripts\python.exe
MUSE_TALK_VERSION=v15
MUSE_TALK_UNET_MODEL_PATH=C:\MuseTalk\models\musetalkV15\unet.pth
MUSE_TALK_UNET_CONFIG_PATH=C:\MuseTalk\models\musetalkV15\musetalk.json
MUSE_TALK_FFMPEG_PATH=C:\ffmpeg\bin
```

3. Запустите сервис:

```powershell
cd local-avatar
.\run.ps1
```

4. Проверка:

```powershell
Invoke-RestMethod http://127.0.0.1:8003/health
```

В ответе `health` проверьте поля:
- `engine` - должен быть `musetalk`.
- `source_asset_resolved` / `source_video_resolved` - должен содержать реальный путь до исходника (`.mp4` или изображения).
- `ready` - должно быть `true`.

Если `source_asset_resolved` пустой:
1. Укажите корректный `AVATAR_SOURCE_ASSET` в `.env.local`.
2. Либо оставьте `AVATAR_SOURCE_VIDEO` как legacy alias.
3. Либо положите референс в `assets\avatar` или в директорию выбранного движка.

Примечание для Windows:
- Если есть предупреждение `No module named 'mmcv._ext'`, сервис всё равно может работать в fallback-режиме bbox-only (без DWPose), это ожидаемо для демо.
- Первый запуск может скачать детектор `s3fd` (~86MB) в кэш PyTorch.

5. В интерфейсе чата после ответа нажмите кнопку `Сгенерировать` в блоке аватара.

Опционально:
- вместо стандартной MuseTalk-команды можно задать `MUSE_TALK_COMMAND_TEMPLATE`

Доступные плейсхолдеры:
- `{config_path}`
- `{result_dir}`
- `{output_path}`
- `{source_path}`
- `{video_path}`
- `{audio_path}`
- `{root}`
- `{python}`
- `{version}`

## Ограничения MVP

- История, usage, telemetry и vector retrieval хранятся в `PostgreSQL + pgvector`. Это уже нормальная интеграционная основа, но для крупного production всё равно понадобятся отдельные observability/ops-практики.
- Guardrails и moderation rule-based; это не полнофункциональная content-safety система.
- Качество RAG зависит от структуры лекции и качества retrieval без внешнего vector store.
- Озвучка и генерация аватара в текущей конфигурации работают только на русском языке.

# Local TTS note

`local-tts` в текущем проекте работает только на русском голосе через `piper`.
