import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const API_TITLE = 'Course AI Gateway API';
const API_VERSION = '1.1.1';
const API_DESCRIPTION =
  'AI gateway for guarded RAG chat, course indexing, transcription, TTS, avatar render, history, usage, and telemetry.';

const ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/health',
    summary: 'Gateway health and dependency checks',
    response: '200 / 503',
  },
  {
    method: 'GET',
    path: '/api/openapi',
    summary: 'Raw OpenAPI JSON schema',
    response: '200',
  },
  {
    method: 'POST',
    path: '/api/chat',
    summary: 'Guarded RAG chat with SSE events: meta, chunk, done, error',
    response: '200 / 400 / 403 / 429 / 500 / 502 / 503',
  },
  {
    method: 'GET',
    path: '/api/history',
    summary: 'Persisted chat history for a session',
    response: '200 / 400 / 403 / 404 / 503',
  },
  {
    method: 'GET',
    path: '/api/usage',
    summary: 'Usage and cost summary for current API key',
    response: '200 / 400 / 503',
  },
  {
    method: 'GET',
    path: '/api/telemetry',
    summary: 'Redacted request telemetry for a session',
    response: '200 / 400 / 403 / 404 / 503',
  },
  {
    method: 'GET',
    path: '/api/course-indexes',
    summary: 'List versioned indexes for a course',
    response: '200 / 400 / 403 / 503',
  },
  {
    method: 'POST',
    path: '/api/course-indexes',
    summary: 'Upload materials, extract, chunk, embed, and build a course index',
    response: '200 / 400 / 403 / 500 / 503',
  },
  {
    method: 'POST',
    path: '/api/course-indexes/activate',
    summary: 'Activate a ready index version for retrieval',
    response: '200 / 403 / 404 / 409 / 503',
  },
  {
    method: 'POST',
    path: '/api/transcribe',
    summary: 'Speech-to-text proxy to local STT service',
    response: '200 / 400 / 502 / 504',
  },
  {
    method: 'POST',
    path: '/api/tts',
    summary: 'Russian-only text-to-speech proxy to local TTS service',
    response: '200 / 400 / 500 / 502',
  },
  {
    method: 'POST',
    path: '/api/avatar',
    summary: 'Russian-only lip-sync avatar render',
    response: '200 / 400 / 500 / 502',
  },
];

function methodClass(method: string) {
  if (method === 'GET') return 'get';
  if (method === 'POST') return 'post';
  return 'other';
}

export async function GET() {
  const rows = ENDPOINTS.map(
    (endpoint) => `
      <tr>
        <td><span class="method ${methodClass(endpoint.method)}">${endpoint.method}</span></td>
        <td><code>${endpoint.path}</code></td>
        <td>${endpoint.summary}</td>
        <td><code>${endpoint.response}</code></td>
      </tr>`,
  ).join('');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${API_TITLE}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #091426;
        --panel: rgba(15, 30, 52, 0.86);
        --panel-2: rgba(11, 23, 41, 0.92);
        --border: rgba(120, 168, 255, 0.18);
        --text: #eaf2ff;
        --muted: #9cb0d1;
        --accent: #32d6ff;
        --get: #1bbf83;
        --post: #37b8ff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", Inter, system-ui, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(50, 214, 255, 0.14), transparent 28%),
          radial-gradient(circle at top right, rgba(80, 160, 255, 0.11), transparent 24%),
          linear-gradient(180deg, #07111f 0%, var(--bg) 100%);
        color: var(--text);
      }
      .wrap {
        max-width: 1280px;
        margin: 0 auto;
        padding: 40px 28px 56px;
      }
      .hero {
        display: grid;
        grid-template-columns: 1.3fr 0.7fr;
        gap: 18px;
        margin-bottom: 20px;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 22px;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);
        backdrop-filter: blur(16px);
      }
      .title-card {
        padding: 28px 30px;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 38px;
        line-height: 1.06;
        letter-spacing: -0.03em;
      }
      .subtitle {
        margin: 0;
        color: var(--muted);
        font-size: 17px;
        line-height: 1.55;
        max-width: 900px;
      }
      .meta-card {
        padding: 22px 24px;
        display: grid;
        gap: 14px;
        align-content: start;
      }
      .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        border: 1px solid rgba(50, 214, 255, 0.28);
        background: rgba(12, 24, 42, 0.75);
        color: #c9f6ff;
        padding: 10px 14px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
        margin-bottom: 18px;
      }
      .stat {
        padding: 18px 20px;
      }
      .stat-label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      .stat-value {
        margin-top: 10px;
        font-size: 30px;
        font-weight: 700;
      }
      .table-card {
        padding: 18px 18px 14px;
      }
      .section-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 14px;
        margin-bottom: 14px;
      }
      .section-title {
        margin: 0;
        font-size: 21px;
        letter-spacing: -0.02em;
      }
      .section-note {
        color: var(--muted);
        font-size: 14px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        overflow: hidden;
        border-radius: 18px;
        background: var(--panel-2);
      }
      thead th {
        text-align: left;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--muted);
        padding: 16px 18px;
        border-bottom: 1px solid var(--border);
      }
      tbody td {
        padding: 16px 18px;
        border-bottom: 1px solid rgba(120, 168, 255, 0.1);
        vertical-align: top;
        font-size: 14px;
        line-height: 1.45;
      }
      tbody tr:last-child td {
        border-bottom: 0;
      }
      code {
        font-family: Consolas, "SFMono-Regular", monospace;
        color: #d7ebff;
        font-size: 13px;
      }
      .method {
        display: inline-flex;
        min-width: 62px;
        justify-content: center;
        border-radius: 999px;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.08em;
      }
      .method.get {
        background: rgba(27, 191, 131, 0.14);
        color: #7ff0c3;
        border: 1px solid rgba(27, 191, 131, 0.24);
      }
      .method.post {
        background: rgba(55, 184, 255, 0.14);
        color: #8fdcff;
        border: 1px solid rgba(55, 184, 255, 0.24);
      }
      .foot {
        margin-top: 14px;
        color: var(--muted);
        font-size: 13px;
      }
      @media (max-width: 920px) {
        .hero, .stats { grid-template-columns: 1fr; }
        h1 { font-size: 30px; }
      }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="hero">
        <div class="card title-card">
          <h1>${API_TITLE}</h1>
          <p class="subtitle">${API_DESCRIPTION}</p>
        </div>
        <div class="card meta-card">
          <div class="chip-row">
            <span class="chip">OpenAPI 3.0.3</span>
            <span class="chip">Version ${API_VERSION}</span>
          </div>
          <div class="chip-row">
            <span class="chip">SSE Chat</span>
            <span class="chip">Course Indexing</span>
            <span class="chip">History & Telemetry</span>
          </div>
          <div class="chip-row">
            <span class="chip">STT</span>
            <span class="chip">TTS (RU)</span>
            <span class="chip">Avatar (RU)</span>
          </div>
        </div>
      </section>

      <section class="stats">
        <div class="card stat">
          <div class="stat-label">Endpoints</div>
          <div class="stat-value">${ENDPOINTS.length}</div>
        </div>
        <div class="card stat">
          <div class="stat-label">Streaming</div>
          <div class="stat-value">SSE</div>
        </div>
        <div class="card stat">
          <div class="stat-label">Server</div>
          <div class="stat-value"><code>http://localhost:3000</code></div>
        </div>
      </section>

      <section class="card table-card">
        <div class="section-head">
          <h2 class="section-title">API Endpoint Summary</h2>
          <div class="section-note">Compact view for documentation screenshots</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>Summary</th>
              <th>Responses</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <div class="foot">
          Optional auth: <code>X-API-Key</code> or <code>Authorization: Bearer &lt;token&gt;</code>.
          Public routes: <code>/api/health</code>, <code>/api/openapi</code>, <code>/api/openapi-view</code>.
        </div>
      </section>
    </main>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
