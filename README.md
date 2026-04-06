# AI Course Module

API-first AI module for educational course assistance.

This repository contains only the AI integration layer:
- guarded RAG chat over indexed course materials
- course ingestion and versioned indexing
- PostgreSQL + pgvector persistence
- local STT / TTS / avatar service wrappers
- history, usage, telemetry, quotas, and prompt-injection protection

The repository is intended to be integrated later into the main backend/frontend project through HTTP API.

## What is included

- `app/api/*` - API routes for chat, ingestion, health, usage, telemetry, TTS, STT, avatar
- `lib/*` - RAG, ingestion, retrieval, guardrails, persistence, quotas, redaction
- `local-stt/*` - local STT microservice wrapper
- `local-tts/*` - local TTS microservice wrapper
- `local-avatar/*` - local avatar microservice wrapper
- `prisma/schema.prisma` - database schema
- `scripts/*` - setup, bootstrap, smoke tests
- `docs/*` - integration documentation
- `.env.example` - environment template

## Main API endpoints

- `POST /api/chat` - guarded RAG chat with SSE events: `meta`, `chunk`, `done`, `error`
- `POST /api/course-indexes` - upload files, extract text/structure, chunk, embed, and create a versioned index
- `GET /api/course-indexes?course_id=...` - list course index versions
- `POST /api/course-indexes/activate` - activate a ready course index version
- `GET /api/history` - session history
- `GET /api/usage` - token/cost summary
- `GET /api/telemetry` - redacted request telemetry
- `POST /api/transcribe` - STT proxy
- `POST /api/tts` - Russian-only TTS proxy
- `POST /api/avatar` - Russian-only avatar render proxy
- `GET /api/health` - readiness/health
- `GET /api/openapi` - machine-readable contract
- `GET /api/openapi-view` - compact human-readable API overview

## Supported educational sources

- `PDF`
- `PPTX`
- `DOCX`
- `TXT`
- `MD`
- `CSV`
- `video/audio` through local STT

## AI capabilities

- hybrid retrieval: embeddings + keyword scoring
- structured citations and source snippets
- SSE response streaming
- local guardrails and moderation
- prompt-injection filtering
- retrieval sanitization and output guardrails
- session history and telemetry
- PostgreSQL + pgvector storage
- versioned course indexes

## Local setup

1. Install Node dependencies:

```bash
npm install
```

2. Copy env template:

```powershell
Copy-Item .env.example .env.local
```

3. Fill at least:
- `OPENAI_API_KEY`
- `DATABASE_URL`

4. Setup database and `pgvector`:

```bash
npm run db:setup
```

If PostgreSQL does not yet contain the `vector` extension, install it once from an elevated PowerShell:

```powershell
npm run db:install-pgvector
```

5. Start all local services:

```bash
npm run start:all
```

6. Run smoke tests:

```bash
npm run test:api
```

## Deployment note

This repository is not the final product frontend/backend. It is the AI module designed to be integrated into the larger system and later deployed in Google Cloud behind the main application backend.

See `docs/API_INTEGRATION.md` for request examples and integration details.
