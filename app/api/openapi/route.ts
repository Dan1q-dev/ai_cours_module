import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const baseUrl = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
  const hasApiKey = Boolean((process.env.API_SHARED_KEY ?? '').trim());

  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'Course AI Gateway API',
      version: '1.1.1',
      description:
        'AI gateway for guarded RAG chat, course indexing, transcription, TTS, avatar render, history, usage, and telemetry.',
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            category: { type: 'string' },
          },
        },
        TranscribeResponse: {
          type: 'object',
          required: ['text', 'language'],
          properties: {
            text: { type: 'string' },
            language: { type: 'string', enum: ['ru', 'kk', 'en', ''] },
          },
        },
        ChatMessage: {
          type: 'object',
          required: ['role', 'content'],
          properties: {
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string' },
          },
        },
        SourceItem: {
          type: 'object',
          required: ['chunk_id', 'label', 'snippet', 'score'],
          properties: {
            chunk_id: { type: 'integer' },
            label: { type: 'string' },
            snippet: { type: 'string' },
            score: { type: 'number' },
          },
        },
        UsageSummary: {
          type: 'object',
          required: [
            'prompt_tokens',
            'completion_tokens',
            'embedding_tokens',
            'total_tokens',
            'estimated_cost_usd',
          ],
          properties: {
            prompt_tokens: { type: 'integer' },
            completion_tokens: { type: 'integer' },
            embedding_tokens: { type: 'integer' },
            total_tokens: { type: 'integer' },
            estimated_cost_usd: { type: 'number' },
          },
        },
        GuardrailState: {
          type: 'object',
          required: ['blocked', 'reasons'],
          properties: {
            blocked: { type: 'boolean' },
            reasons: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        SseMetaEvent: {
          type: 'object',
          required: ['retrieved_count', 'sources_preview'],
          properties: {
            retrieved_count: { type: 'integer' },
            sources_preview: {
              type: 'array',
              items: { $ref: '#/components/schemas/SourceItem' },
            },
          },
        },
        SseDoneEvent: {
          type: 'object',
          required: ['sources', 'citations', 'locateSnippet', 'usage', 'guardrails'],
          properties: {
            sources: {
              type: 'array',
              items: { $ref: '#/components/schemas/SourceItem' },
            },
            citations: {
              type: 'array',
              items: { type: 'integer' },
            },
            locateSnippet: {
              type: 'string',
              nullable: true,
            },
            usage: { $ref: '#/components/schemas/UsageSummary' },
            guardrails: { $ref: '#/components/schemas/GuardrailState' },
          },
        },
        HistoryResponse: {
          type: 'object',
          required: ['items', 'next_cursor'],
          properties: {
            items: {
              type: 'array',
              items: { $ref: '#/components/schemas/HistoryItem' },
            },
            next_cursor: {
              type: 'string',
              nullable: true,
            },
          },
        },
        UsageResponse: {
          type: 'object',
          required: ['window', 'usage', 'limits'],
          properties: {
            window: {
              type: 'string',
              enum: ['day', 'month'],
            },
            usage: {
              type: 'object',
              required: ['requests', 'tokens', 'cost_usd'],
              properties: {
                requests: { type: 'integer' },
                tokens: { type: 'integer' },
                cost_usd: { type: 'number' },
              },
            },
            limits: {
              type: 'object',
              required: [
                'rpm_limit',
                'daily_request_limit',
                'daily_token_limit',
                'monthly_cost_usd_limit',
              ],
              properties: {
                rpm_limit: { type: 'integer' },
                daily_request_limit: { type: 'integer' },
                daily_token_limit: { type: 'integer' },
                monthly_cost_usd_limit: { type: 'number' },
              },
            },
          },
        },
        TelemetryItem: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            route: { type: 'string' },
            status: { type: 'integer' },
            started_at: { type: 'string', format: 'date-time' },
            finished_at: { type: 'string', format: 'date-time', nullable: true },
            latency_ms: { type: 'integer', nullable: true },
            guardrail_blocked: { type: 'boolean' },
            guardrail_reasons: {
              type: 'array',
              items: { type: 'string' },
            },
            injection_score: { type: 'number' },
            blocked_stage: { type: 'string', nullable: true },
            retrieval_query: { type: 'string', nullable: true },
            retrieved_chunk_ids: {
              type: 'array',
              items: { type: 'integer' },
            },
            retrieval_scores: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
            retrieval_fallback_used: { type: 'boolean' },
            prompt_redacted: { type: 'string', nullable: true },
            response_redacted: { type: 'string', nullable: true },
            prompt_tokens: { type: 'integer' },
            completion_tokens: { type: 'integer' },
            embedding_tokens: { type: 'integer' },
            total_tokens: { type: 'integer' },
            estimated_cost_usd: { type: 'number' },
            metadata_json: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
        TelemetryResponse: {
          type: 'object',
          required: ['session_id', 'items'],
          properties: {
            session_id: { type: 'string' },
            items: {
              type: 'array',
              items: { $ref: '#/components/schemas/TelemetryItem' },
            },
          },
        },
        HealthResponse: {
          type: 'object',
          required: ['status', 'timestamp', 'gateway', 'openai', 'database', 'quota', 'services'],
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded'] },
            timestamp: { type: 'string', format: 'date-time' },
            gateway: {
              type: 'object',
              required: ['status', 'chatModel'],
              properties: {
                status: { type: 'string' },
                chatModel: { type: 'string' },
              },
            },
            openai: {
              type: 'object',
              required: ['configured'],
              properties: {
                configured: { type: 'boolean' },
              },
            },
            database: {
              type: 'object',
              additionalProperties: true,
            },
            quota: {
              type: 'object',
              additionalProperties: true,
            },
            services: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
        ChatRequest: {
          type: 'object',
          required: ['session_id', 'messages'],
          properties: {
            session_id: { type: 'string' },
            message_id: { type: 'string' },
            course_id: { type: 'string' },
            course_version_id: { type: 'string' },
            messages: {
              type: 'array',
              items: { $ref: '#/components/schemas/ChatMessage' },
            },
            locateInLecture: { type: 'boolean', default: false },
            client_metadata: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
        HistoryItem: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string' },
            language: { type: 'string', enum: ['ru', 'kk', 'en', ''] },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        TtsRequest: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string', maxLength: 1500 },
            language: { type: 'string', enum: ['ru'], default: 'ru' },
          },
        },
        AvatarRequest: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string', maxLength: 1600 },
            language: { type: 'string', enum: ['ru'], default: 'ru' },
          },
        },
        CourseIndexResponse: {
          type: 'object',
          properties: {
            course_id: { type: 'string' },
            version_id: { type: 'string' },
            version_label: { type: 'string', nullable: true },
            source_count: { type: 'integer' },
            chunk_count: { type: 'integer' },
            embedding_model: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/api/health': {
        get: {
          summary: 'Gateway health and dependency checks',
          responses: {
            '200': {
              description: 'All services are healthy',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                },
              },
            },
            '503': {
              description: 'One or more dependencies are unavailable',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                },
              },
            },
          },
        },
      },
      '/api/openapi': {
        get: {
          summary: 'OpenAPI schema for gateway endpoints',
          responses: {
            '200': { description: 'OpenAPI JSON schema' },
          },
        },
      },
      '/api/chat': {
        post: {
          summary: 'Guarded RAG chat endpoint (SSE streaming response)',
          security: hasApiKey ? [{ ApiKeyAuth: [] }, { BearerAuth: [] }] : [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatRequest' },
              },
            },
          },
          responses: {
            '200': {
              description:
                'Server-Sent Events stream. event: meta -> SseMetaEvent; event: chunk -> { text }; event: done -> SseDoneEvent; event: error -> ErrorResponse',
              content: {
                'text/event-stream': {},
              },
            },
            '400': {
              description: 'Validation error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '403': {
              description: 'Guardrail or moderation block',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '429': {
              description: 'Quota exceeded',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '500': {
              description: 'Server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '502': {
              description: 'Retrieval or downstream AI service failure',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '503': {
              description: 'Persistence layer unavailable',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/history': {
        get: {
          summary: 'Return persisted chat history for a session',
          security: hasApiKey ? [{ ApiKeyAuth: [] }, { BearerAuth: [] }] : [],
          parameters: [
            { name: 'session_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50 } },
          ],
          responses: {
            '200': {
              description: 'History response',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HistoryResponse' },
                },
              },
            },
            '400': {
              description: 'Validation error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '403': {
              description: 'Session ownership mismatch',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '404': {
              description: 'Session not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '503': {
              description: 'Persistence layer unavailable',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
      '/api/course-indexes': {
        get: {
          summary: 'List versioned indexes for a course',
          security: hasApiKey ? [{ ApiKeyAuth: [] }, { BearerAuth: [] }] : [],
          parameters: [
            { name: 'course_id', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Course index versions' },
            '400': {
              description: 'Validation error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '403': {
              description: 'Course ownership mismatch',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '503': {
              description: 'Persistence layer unavailable',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
        post: {
          summary: 'Upload course materials, extract text/structure, chunk, embed, and build a versioned course index',
          security: hasApiKey ? [{ ApiKeyAuth: [] }, { BearerAuth: [] }] : [],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['course_id', 'files'],
                  properties: {
                    course_id: { type: 'string' },
                    course_title: { type: 'string' },
                    version_label: { type: 'string' },
                    files: {
                      type: 'array',
                      items: { type: 'string', format: 'binary' },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Created course index version',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CourseIndexResponse' },
                },
              },
            },
            '400': {
              description: 'Validation error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '403': {
              description: 'Course ownership mismatch',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '500': {
              description: 'Indexing pipeline failed',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '503': {
              description: 'Persistence layer unavailable',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
      '/api/course-indexes/activate': {
        post: {
          summary: 'Activate a ready course index version as the default retrieval version',
          security: hasApiKey ? [{ ApiKeyAuth: [] }, { BearerAuth: [] }] : [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['course_id', 'version_id'],
                  properties: {
                    course_id: { type: 'string' },
                    version_id: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Version activated' },
            '404': {
              description: 'Version not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '409': {
              description: 'Version is not ready',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '403': {
              description: 'Course ownership mismatch',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '503': {
              description: 'Persistence layer unavailable',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
      '/api/usage': {
        get: {
          summary: 'Return usage and cost summary for current API key',
          security: hasApiKey ? [{ ApiKeyAuth: [] }, { BearerAuth: [] }] : [],
          parameters: [
            {
              name: 'window',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['day', 'month'], default: 'day' },
            },
          ],
          responses: {
            '200': {
              description: 'Usage summary',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/UsageResponse' },
                },
              },
            },
            '400': {
              description: 'Validation error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '503': {
              description: 'Persistence layer unavailable',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
      '/api/telemetry': {
        get: {
          summary: 'Return redacted request telemetry for a session',
          security: hasApiKey ? [{ ApiKeyAuth: [] }, { BearerAuth: [] }] : [],
          parameters: [
            { name: 'session_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': {
              description: 'Telemetry response',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TelemetryResponse' },
                },
              },
            },
            '400': {
              description: 'Validation error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '403': {
              description: 'Session ownership mismatch',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '404': {
              description: 'Session not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
            '503': {
              description: 'Persistence layer unavailable',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
      '/api/transcribe': {
        post: {
          summary: 'Speech-to-text proxy to local STT service',
          security: hasApiKey ? [{ ApiKeyAuth: [] }, { BearerAuth: [] }] : [],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: {
                      type: 'string',
                      format: 'binary',
                    },
                    language: {
                      type: 'string',
                      enum: ['auto', 'ru', 'kk', 'en'],
                      default: 'auto',
                    },
                    preferred_language: {
                      type: 'string',
                      enum: ['ru', 'kk', 'en'],
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Recognized text JSON',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TranscribeResponse' },
                },
              },
            },
            '400': {
              description: 'Validation error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '502': {
              description: 'Local STT service unavailable',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '504': {
              description: 'Local STT timed out',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/tts': {
        post: {
          summary: 'Russian-only text-to-speech proxy to local TTS service',
          security: hasApiKey ? [{ ApiKeyAuth: [] }, { BearerAuth: [] }] : [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TtsRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'WAV audio stream',
              content: {
                'audio/wav': {},
              },
            },
            '400': {
              description: 'Validation error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '502': {
              description: 'Local TTS service unavailable',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '500': {
              description: 'Local TTS runtime error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/avatar': {
        post: {
          summary: 'Generate Russian-only lip-sync avatar video (TTS + local avatar render)',
          security: hasApiKey ? [{ ApiKeyAuth: [] }, { BearerAuth: [] }] : [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AvatarRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Generated MP4 video',
              content: {
                'video/mp4': {},
              },
            },
            '400': {
              description: 'Validation error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '502': {
              description: 'Local avatar/TTS service unavailable',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '500': {
              description: 'Local avatar runtime error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
    },
  };

  return NextResponse.json(spec);
}
