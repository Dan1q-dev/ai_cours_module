# AI-модуль учебной платформы

API-first AI-модуль для помощи по учебным курсам.

Этот репозиторий содержит только AI-слой интеграции:
- guarded RAG-чат по материалам курса
- ingestion и версионную индексацию курсов
- хранение в `PostgreSQL + pgvector`
- локальные обёртки для `STT / TTS / avatar`
- историю, usage, телеметрию, квоты и защиту от prompt injection

Репозиторий предназначен для последующей интеграции в основной backend/frontend проект через HTTP API.

## Что входит в репозиторий

- `app/api/*` - API-роуты для чата, индексации, health, usage, telemetry, TTS, STT, avatar
- `lib/*` - RAG, ingestion, retrieval, guardrails, persistence, quotas, redaction
- `local-stt/*` - обёртка локального STT-сервиса
- `local-tts/*` - обёртка локального TTS-сервиса
- `local-avatar/*` - обёртка локального avatar-сервиса
- `prisma/schema.prisma` - схема базы данных
- `scripts/*` - setup, bootstrap и smoke-тесты
- `docs/*` - документация по интеграции
- `.env.example` - шаблон переменных окружения

## Основные API endpoint'ы

- `POST /api/chat` - guarded RAG-чат с SSE-событиями: `meta`, `chunk`, `done`, `error`
- `POST /api/course-indexes` - загрузка файлов, извлечение текста/структуры, chunking, embeddings и создание versioned index
- `GET /api/course-indexes?course_id=...` - список версий индекса курса
- `POST /api/course-indexes/activate` - активация готовой версии индекса
- `GET /api/history` - история сессии
- `GET /api/usage` - summary по токенам и стоимости
- `GET /api/telemetry` - redacted telemetry запросов
- `POST /api/transcribe` - STT proxy
- `POST /api/tts` - TTS proxy только для русского языка
- `POST /api/avatar` - avatar render proxy только для русского языка
- `GET /api/health` - readiness/health
- `GET /api/openapi` - машинно-читаемый контракт
- `GET /api/openapi-view` - компактное человекочитаемое представление API

## Поддерживаемые учебные источники

- `PDF`
- `PPTX`
- `DOCX`
- `TXT`
- `MD`
- `CSV`
- `video/audio` через локальный STT

## AI-возможности

- гибридный retrieval: embeddings + keyword scoring
- структурированные citations и source snippets
- потоковая выдача ответа через SSE
- локальные guardrails и moderation
- защита от prompt injection
- retrieval sanitization и output guardrails
- история сессий и телеметрия
- хранение в `PostgreSQL + pgvector`
- версионность индексов курсов

## Локальный запуск

1. Установить Node-зависимости:

```bash
npm install
```

2. Создать `.env.local` из шаблона:

```powershell
Copy-Item .env.example .env.local
```

3. Заполнить минимум:
- `OPENAI_API_KEY`
- `DATABASE_URL`

4. Настроить базу и `pgvector`:

```bash
npm run db:setup
```

Если PostgreSQL ещё не содержит extension `vector`, один раз установите его из PowerShell **от имени администратора**:

```powershell
npm run db:install-pgvector
```

5. Поднять все локальные сервисы:

```bash
npm run start:all
```

6. Прогнать smoke-тесты:

```bash
npm run test:api
```

## Примечание по деплою

Этот репозиторий не является финальным frontend/backend приложением. Это AI-модуль, который должен интегрироваться в большую систему и позже разворачиваться в Google Cloud за основным backend-приложением.

Примеры запросов и детали интеграции смотри в `docs/API_INTEGRATION.md`.
