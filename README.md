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

### Cloud Run health behavior

В Cloud Run ядро gateway считается healthy, когда жив сам gateway, настроен `OPENAI_API_KEY`, доступна database и готов `pgvector`/vector слой.

Локальные media-зависимости `STT`, `TTS` и `avatar` по умолчанию optional и не валят `/api/health`, если не развернуты рядом с gateway:

```env
OPENAI_MODEL=gpt-5.4-mini
API_HEALTH_REQUIRE_LOCAL_SERVICES=false
```

Чтобы сделать `STT`/`TTS`/`avatar` обязательными для readiness:

```env
API_HEALTH_REQUIRE_LOCAL_SERVICES=true
```

Проверка health:

```bash
curl -i "$BASE_URL/api/health"
```

Проверка chat canonical request shape:

```bash
curl -N -i "$BASE_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "test-session-1",
    "messages": [
      {
        "role": "user",
        "content": "Привет, кратко представься"
      }
    ]
  }'
```

### Deploy avatar renderer to Cloud Run GPU

`ai-gateway` остаётся обычным Cloud Run service без GPU. Видео-рендер аватара разворачивается отдельно как `local-avatar` на Cloud Run GPU, а gateway отправляет туда WAV-аудио. Для Cloud Run режима gateway используйте `AVATAR_TTS_PROVIDER=openai`, чтобы `/api/avatar` генерировал WAV через OpenAI TTS API и передавал его в `LOCAL_AVATAR_URL=/render`.

Перед build убедитесь, что `MuseTalk/` и нужные checkpoint/model файлы доступны в Docker build context. Dockerfile установит `MuseTalk/requirements.txt`, если файл присутствует.

```bash
PROJECT_ID=project-f3d2b277-4ce4-4023-8c6
REGION=europe-west4
REPO=ai-module
IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/local-avatar:latest
```

Создать Artifact Registry repository, если его ещё нет:

```bash
gcloud artifacts repositories create $REPO \
  --project=$PROJECT_ID \
  --repository-format=docker \
  --location=$REGION \
  --description="AI module containers"
```

Собрать и опубликовать image:

```bash
gcloud builds submit . \
  --project=$PROJECT_ID \
  --region=$REGION \
  --config=cloudbuild.avatar.yaml \
  --substitutions=_IMAGE=$IMAGE
```

Развернуть GPU service:

```bash
gcloud run deploy local-avatar \
  --project=$PROJECT_ID \
  --region=$REGION \
  --image=$IMAGE \
  --allow-unauthenticated \
  --execution-environment=gen2 \
  --gpu=1 \
  --gpu-type=nvidia-l4 \
  --cpu=4 \
  --memory=16Gi \
  --no-cpu-throttling \
  --no-gpu-zonal-redundancy \
  --timeout=3600 \
  --concurrency=1 \
  --max-instances=1 \
  --set-env-vars=AVATAR_ENGINE=musetalk,MUSE_TALK_ROOT=/app/MuseTalk,MUSE_TALK_PYTHON=python,AVATAR_RESULTS_DIR=/tmp/avatar-runs,AVATAR_TIMEOUT_SEC=3600
```

Проверить avatar service:

```bash
AVATAR_URL=$(gcloud run services describe local-avatar \
  --project=$PROJECT_ID \
  --region=$REGION \
  --format='value(status.url)')

curl "$AVATAR_URL/health"
```

Обновить `ai-gateway`, чтобы `/api/avatar` использовал OpenAI TTS и Cloud Run avatar renderer:

```bash
gcloud run services update ai-gateway \
  --project=$PROJECT_ID \
  --region=$REGION \
  --update-env-vars=AVATAR_TTS_PROVIDER=openai,OPENAI_TTS_MODEL=gpt-4o-mini-tts,OPENAI_TTS_VOICE=alloy,LOCAL_AVATAR_URL=$AVATAR_URL/render,AVATAR_TIMEOUT_SEC=3600
```

Проверить gateway avatar endpoint:

```bash
BASE_URL=https://ai-gateway-443288396214.europe-west4.run.app

curl -X POST "$BASE_URL/api/avatar" \
  -H "Content-Type: application/json" \
  -d '{"text":"Здравствуйте. Я AI-аватар учебного модуля. Сейчас демонстрируется генерация видеоответа в Google Cloud.","language":"ru"}' \
  --output avatar-demo.mp4
```

Примеры запросов и детали интеграции смотри в `docs/API_INTEGRATION.md`.
