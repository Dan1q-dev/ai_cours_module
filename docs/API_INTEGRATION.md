# API Integration Guide

This repository can be used as an API gateway for AI services in a larger platform.
UI pages are optional and intended for local demo/testing.

## Base URL

- Local: `http://localhost:3000`

## Auth (optional)

If `API_SHARED_KEY` is set, include one of:

- `X-API-Key: <key>`
- `Authorization: Bearer <key>`

Public routes (no key required):

- `GET /api/health`
- `GET /api/openapi`

## Endpoints

### Health

`GET /api/health`

Returns gateway status + dependency checks (`stt`, `tts`, `avatar`).
Также показывает состояние:

- `database` - Postgres/Prisma storage
- `quota.cache` - optional Redis runtime cache

### OpenAPI

`GET /api/openapi`

Returns machine-readable OpenAPI schema for all gateway routes.

### Course Indexing

`POST /api/course-indexes`

Multipart fields:

- `course_id` - required
- `course_title` - optional
- `version_label` - optional
- `files` - one or more files

Supported materials:

- `PDF`
- `PPTX`
- `DOCX`
- `TXT`, `MD`, `CSV`
- `video/audio` files via local `STT`

Pipeline:

- text/structure extraction
- chunking by headings/paragraph groups
- embeddings generation
- indexing into versioned vector store metadata in Postgres
- creation of a versioned course index

Response includes:

- `course_id`
- `version_id`
- `version_label`
- `source_count`
- `chunk_count`
- `embedding_model`
- `usage`

`GET /api/course-indexes?course_id=<id>`

Returns all index versions for the course.

`POST /api/course-indexes/activate`

```json
{
  "course_id": "ml-course-01",
  "version_id": "course-version-uuid"
}
```

Marks a ready version as the active default retrieval version for that course.

### Chat (RAG, SSE)

`POST /api/chat`

Request:

```json
{
  "session_id": "session-demo-001",
  "message_id": "msg-001",
  "course_id": "ml-course-01",
  "course_version_id": "course-version-uuid",
  "messages": [
    { "role": "user", "content": "Что такое разметка данных?" }
  ],
  "locateInLecture": true,
  "client_metadata": {
    "surface": "web"
  }
}
```

Response content-type: `text/event-stream`.

Events:

- `meta` - retrieval metadata (`retrieved_count`, `sources_preview`)
- `chunk` - partial text token
- `done` - final metadata (`sources`, `citations`, `locateSnippet`, `usage`, `guardrails`)
- `error` - stream error info

Possible non-streaming responses:

- `400` - validation failure
- `403` - guardrail / moderation / prompt injection block
- `429` - quota exceeded

### History

`GET /api/history?session_id=session-demo-001&limit=50`

Returns persisted redacted history for the current session.

### Usage

`GET /api/usage?window=day`

Returns aggregated usage/cost counters for the current API key.

### Telemetry

`GET /api/telemetry?session_id=session-demo-001&limit=20`

Returns redacted request-level diagnostics:

- guardrail results
- retrieval diagnostics
- prompt/response redacted payloads
- token usage and estimated cost

### STT Proxy

`POST /api/transcribe` (multipart)

Fields:

- `file` - audio blob/file
- `language` - optional: `auto | ru | kk | en` (default `auto`)
- `preferred_language` - optional hint for `auto` mode: `ru | kk | en`

Response:

```json
{
  "text": "распознанный текст",
  "language": "ru"
}
```

### TTS Proxy

`POST /api/tts`

Russian only.

Request:

```json
{
  "text": "Привет!",
  "language": "ru"
}
```

Response: `audio/wav` binary stream.

### Avatar Proxy

`POST /api/avatar`

Russian only.

Request:

```json
{
  "text": "Кратко объясни тему лекции",
  "language": "ru"
}
```

Response: `video/mp4` binary stream.

## Direct local service usage

You can also call services directly (without gateway):

- STT: `http://127.0.0.1:8001/transcribe`
- TTS: `http://127.0.0.1:8002/synthesize`
- Avatar: `http://127.0.0.1:8003/render`

All local services support CORS via:

- `SERVICE_CORS_ORIGINS`
- `SERVICE_CORS_ALLOW_CREDENTIALS`

## Storage runtime

AI gateway ожидает:

- `DATABASE_URL` - PostgreSQL connection string
- optional `REDIS_URL` - Redis fast-path for quota cache / runtime state

Recommended local bootstrap:

```bash
npm run db:setup
```

Redis можно подключить позже. При `AI_REDIS_ENABLED=false` модуль продолжает работать только через PostgreSQL.
