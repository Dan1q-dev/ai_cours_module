# AI Module GitHub Guide

## What should go to GitHub

Upload only the AI module and its integration contract:

- `app/api/*` - all AI API routes
- `lib/*` - RAG, ingestion, guardrails, telemetry, quotas, persistence
- `local-stt/*` - local STT microservice wrapper code
- `local-tts/*` - local TTS microservice wrapper code
- `local-avatar/*` - local avatar microservice wrapper code
- `prisma/schema.prisma` - DB schema
- `scripts/*` - setup, smoke tests, bootstrap scripts
- `docs/*` - integration docs
- `.env.example` - environment template only
- `README.md` - project overview
- `middleware.ts` - API auth/CORS gateway layer
- `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.js`

Optional, only if you want to keep the demo stand in the same repo:

- `app/page.tsx`
- `components/*`
- `public/avatars/*`
- `assets/avatar/teacher.png`

## What must NOT go to GitHub

- `.env.local`
- any real API keys, DB passwords, internal tokens
- `node_modules`
- `.next`, `.next-build`
- `.venv` folders inside local services
- `MuseTalk/` and downloaded model weights
- generated `runs/`, `tmp/`, `data/`
- generated audio/video artifacts
- local reports and course documents

## Recommended GitHub structure

### Option A: AI-only repo
Best option for your case.

Keep only:
- API routes
- AI libraries
- local service wrappers
- Prisma schema
- scripts
- docs

Do not keep:
- frontend demo page
- lecture rendering components
- local experiment artifacts

### Option B: AI repo with demo stand
Use only if you want to show the module in isolation.

Keep:
- everything from Option A
- minimal demo UI (`app/page.tsx`, `components/*`, `public/avatars/*`)

## Fastest safe workflow

1. Export a clean AI-only folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/export-ai-module.ps1 -InitGit
```

2. Export AI module together with demo UI:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/export-ai-module.ps1 -IncludeDemoUI -InitGit
```

3. Go to the exported folder:

```powershell
cd ai-module-export
```

4. Add remote and push:

```powershell
git remote add origin <YOUR_GITHUB_REPO_URL>
git add .
git commit -m "Initial AI module export"
git branch -M main
git push -u origin main
```

## My recommendation

For team integration, upload **AI-only repo**.

Reason:
- your responsibility is the API-first AI module
- backend and frontend teams do not need your demo page to integrate
- this keeps the repository smaller, cleaner, and easier to deploy later in Google Cloud
