import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import {
  buildPrompt,
  buildSourceItems,
  buildSourcesPreview,
  defaultIdentityMessage,
  isComparisonQuery,
  pickLocateSnippet,
  sanitizeAssistantText,
} from '@/lib/ai/chat-pipeline';
import { initAiDatabase, insertMessage, maybeRunDbMaintenance, upsertSession, createRequestEvent, finalizeRequestEvent } from '@/lib/ai/db';
import { evaluateAssistantOutput, evaluateGuardrails } from '@/lib/ai/guardrails';
import { detectSupportedLanguage, isIdentityQuestion, noAnswerText } from '@/lib/ai/language';
import { consumeQuota, estimateUsageCost, checkQuotaBudget, reserveQuotaRequest } from '@/lib/ai/quotas';
import { estimateTokens, hashApiKey, jsonError, readApiKeyFromHeaders } from '@/lib/ai/request';
import { retrieveRelevantChunksDetailed } from '@/lib/rag';
import { retrieveIndexedCourseChunks } from '@/lib/ai/index-search';
import type { InputMessage, SupportedLanguage, UsageSummary } from '@/lib/ai/types';

export const runtime = 'nodejs';

const CHAT_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const MAX_HISTORY_MESSAGES = Number(process.env.AI_MAX_HISTORY_MESSAGES ?? 12);

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const encoder = new TextEncoder();

type ChatRequestBody = {
  session_id?: string;
  message_id?: string;
  client_metadata?: Record<string, unknown>;
  messages?: InputMessage[];
  locateInLecture?: boolean;
  course_id?: string;
  course_version_id?: string;
};

function validateMessages(messages: InputMessage[] | undefined) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      ok: false as const,
      response: jsonError('Передайте непустой массив messages.', 400),
    };
  }

  const sanitizedMessages = messages
    .filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant'))
    .map((msg) => ({
      role: msg.role,
      content: String(msg.content ?? '').trim(),
    }))
    .filter((msg) => msg.content.length > 0)
    .slice(-MAX_HISTORY_MESSAGES);

  if (!sanitizedMessages.length) {
    return {
      ok: false as const,
      response: jsonError('Не найдено валидных сообщений.', 400),
    };
  }

  return {
    ok: true as const,
    sanitizedMessages,
  };
}

function makeNoAnswerUsage(embeddingTokens: number): UsageSummary {
  return estimateUsageCost({
    prompt_tokens: 0,
    completion_tokens: 0,
    embedding_tokens: embeddingTokens,
    total_tokens: embeddingTokens,
  });
}

function sendSseEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: Record<string, unknown>,
) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

export async function POST(req: Request) {
  try {
    await initAiDatabase();
    await maybeRunDbMaintenance();
  } catch (error) {
    console.error('AI database init error:', error);
    return jsonError('Хранилище AI-модуля недоступно.', 503);
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonError('OPENAI_API_KEY не настроен на сервере.', 500);
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return jsonError('Тело запроса должно быть корректным JSON.', 400);
  }

  const sessionId = String(body.session_id ?? '').trim();
  if (!sessionId) {
    return jsonError('Поле session_id обязательно.', 400);
  }

  const validated = validateMessages(body.messages);
  if (!validated.ok) {
    return validated.response;
  }

  const sanitizedMessages = validated.sanitizedMessages;
  const latestUserMessage = [...sanitizedMessages].reverse().find((msg) => msg.role === 'user');
  if (!latestUserMessage) {
    return jsonError('Последнее сообщение пользователя не найдено.', 400);
  }

  const answerLanguage = detectSupportedLanguage(latestUserMessage.content);
  const apiKeyHash = hashApiKey(readApiKeyFromHeaders(req.headers));
  const requestEventId = randomUUID();
  const userMessageId = String(body.message_id ?? '').trim() || randomUUID();
  const locateInLecture = Boolean(body.locateInLecture);
  const courseId = String(body.course_id ?? '').trim() || null;
  const courseVersionId = String(body.course_version_id ?? '').trim() || null;
  const priorUserMessages = sanitizedMessages
    .filter((msg) => msg.role === 'user')
    .slice(0, -1)
    .map((msg) => msg.content);
  const historyChainGuardrail =
    priorUserMessages.some((message) =>
      /игнориру(й|йте)|раскрой\s+(системн[а-яёәіңғүұқөһ]*\s+)?(промпт|инструкц)|ignore\s+previous\s+instructions|reveal\s+(the\s+)?system\s+prompt/i.test(
        message,
      ),
    ) &&
    /(предыдущ[а-яёәіңғүұқөһ]*|прошл[а-яёәіңғүұқөһ]*|раньше|above|earlier|previous|that task|ту\s+задач[а-яёәіңғүұқөһ]*)/i.test(
      latestUserMessage.content,
    );
  const evaluatedGuardrails = evaluateGuardrails(latestUserMessage.content, {
    history: priorUserMessages,
  });
  const guardrails = historyChainGuardrail
    ? {
        blocked: true,
        reasons: ['history_prompt_injection_chain'],
        category: 'prompt_injection' as const,
        code: 'prompt_injection' as const,
        message: 'Запрос отклонен: обнаружена попытка продолжить ранее заданную инъекционную инструкцию.',
        injection_score: 0.95,
        blocked_stage: 'moderation' as const,
      }
    : evaluatedGuardrails;

  try {
    await upsertSession(sessionId, apiKeyHash, latestUserMessage.content.slice(0, 80));
    await createRequestEvent({
      id: requestEventId,
      sessionId,
      apiKeyHash,
      route: '/api/chat',
      metadata: {
        client_metadata: body.client_metadata ?? {},
        locateInLecture,
        model: CHAT_MODEL,
        course_id: courseId,
        course_version_id: courseVersionId,
      },
    });

    await insertMessage({
      id: userMessageId,
      sessionId,
      role: 'user',
      content: latestUserMessage.content,
      language: answerLanguage,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'session ownership mismatch'
        ? 'Сессия принадлежит другому API-клиенту.'
        : 'Не удалось сохранить состояние диалога.';
    return jsonError(message, error instanceof Error && error.message === 'session ownership mismatch' ? 403 : 503);
  }

  if (guardrails.blocked) {
    await finalizeRequestEvent({
      id: requestEventId,
      status: guardrails.category === 'validation' ? 400 : 403,
      guardrailBlocked: true,
      guardrailReasons: guardrails.reasons,
      injectionScore: guardrails.injection_score,
      blockedStage: guardrails.blocked_stage,
      prompt: JSON.stringify(body),
      response: guardrails.message,
      usage: makeNoAnswerUsage(0),
    });

    return jsonError(guardrails.message, guardrails.category === 'validation' ? 400 : 403, {
      code: guardrails.code,
      category: guardrails.category,
      guardrails: {
        blocked: true,
        reasons: guardrails.reasons,
      },
    });
  }

  const earlyQuotaCheck = await checkQuotaBudget(apiKeyHash, estimateTokens(latestUserMessage.content));
  if (!earlyQuotaCheck.allowed) {
    await finalizeRequestEvent({
      id: requestEventId,
      status: earlyQuotaCheck.status,
      guardrailBlocked: false,
      guardrailReasons: [earlyQuotaCheck.code],
      injectionScore: 0,
      blockedStage: 'validation',
      prompt: JSON.stringify(body),
      response: earlyQuotaCheck.message,
      usage: makeNoAnswerUsage(0),
    });

    return jsonError(earlyQuotaCheck.message, earlyQuotaCheck.status, { code: earlyQuotaCheck.code });
  }

  await reserveQuotaRequest(apiKeyHash, requestEventId, estimateTokens(latestUserMessage.content));

  let retrieval: Awaited<ReturnType<typeof retrieveRelevantChunksDetailed>> | NonNullable<Awaited<ReturnType<typeof retrieveIndexedCourseChunks>>>;
  let sources: ReturnType<typeof buildSourceItems>;
  try {
    const userMessagesOnly = sanitizedMessages.filter((msg) => msg.role === 'user');
    const previousUser =
      userMessagesOnly.length > 1 ? userMessagesOnly[userMessagesOnly.length - 2]?.content : '';
    const retrievalQuery = previousUser
      ? `${previousUser}\n${latestUserMessage.content}`
      : latestUserMessage.content;

    retrieval =
      (await retrieveIndexedCourseChunks({
        client,
        apiKeyHash,
        query: retrievalQuery,
        courseId,
        courseVersionId,
        topK: 6,
      })) ?? (await retrieveRelevantChunksDetailed(client, retrievalQuery, 6));
    sources = buildSourceItems(
      retrieval.chunks.map((chunk) => ({
        chunk_id: chunk.id,
        label: chunk.label,
        text: chunk.text,
        score: chunk.score,
      })),
    );

    const estimatedPromptTokens = estimateTokens(
      JSON.stringify({
        messages: sanitizedMessages,
        query: retrievalQuery,
        chunks: retrieval.chunks.map((chunk) => chunk.text),
      }),
    );

    const quotaCheck = await checkQuotaBudget(apiKeyHash, estimatedPromptTokens + retrieval.embeddingTokens);
    if (!quotaCheck.allowed) {
      await finalizeRequestEvent({
        id: requestEventId,
        status: quotaCheck.status,
        guardrailBlocked: false,
        guardrailReasons: [quotaCheck.code],
        injectionScore: 0,
        blockedStage: 'validation',
        retrievalQuery: retrieval.diagnostics.retrieval_query,
        retrievedChunkIds: retrieval.chunks.map((chunk) => chunk.id),
        retrievalScores: retrieval.diagnostics.scores,
        retrievalFallbackUsed: retrieval.diagnostics.fallback_used,
        prompt: JSON.stringify(body),
        response: quotaCheck.message,
        usage: makeNoAnswerUsage(retrieval.embeddingTokens),
      });

      return jsonError(quotaCheck.message, quotaCheck.status, { code: quotaCheck.code });
    }
  } catch (error) {
    console.error('Chat retrieval error:', error);
    await finalizeRequestEvent({
      id: requestEventId,
      status: 502,
      guardrailBlocked: false,
      guardrailReasons: [],
      injectionScore: 0,
      blockedStage: null,
      prompt: JSON.stringify(body),
      response: error instanceof Error ? error.message : 'retrieval_failed',
      usage: makeNoAnswerUsage(0),
    });
    return jsonError('Не удалось выполнить retrieval для текущего запроса.', 502, {
      code: 'retrieval_failed',
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const guardrailInfo = {
        blocked: false,
        reasons: [] as string[],
      };

      try {
        if (isIdentityQuestion(latestUserMessage.content)) {
          const text = defaultIdentityMessage(answerLanguage);
          const usage = makeNoAnswerUsage(retrieval.embeddingTokens);
          const assistantMessageId = `${requestEventId}:assistant`;
          await insertMessage({
            id: assistantMessageId,
            sessionId,
            role: 'assistant',
            content: text,
            language: answerLanguage,
          });
          await consumeQuota(apiKeyHash, usage);
          sendSseEvent(controller, 'chunk', { text });
          sendSseEvent(controller, 'done', {
            sources: [],
            citations: [],
            locateSnippet: null,
            usage,
            guardrails: guardrailInfo,
          });
          await finalizeRequestEvent({
            id: requestEventId,
            status: 200,
            guardrailBlocked: false,
            guardrailReasons: [],
            injectionScore: 0,
            blockedStage: null,
            retrievalQuery: retrieval.diagnostics.retrieval_query,
            retrievedChunkIds: [],
            retrievalScores: [],
            retrievalFallbackUsed: retrieval.diagnostics.fallback_used,
            prompt: JSON.stringify(body),
            response: text,
            usage,
          });
          controller.close();
          return;
        }

        sendSseEvent(controller, 'meta', {
          retrieved_count: retrieval.chunks.length,
          sources_preview: buildSourcesPreview(
            retrieval.chunks.map((chunk) => ({
              chunk_id: chunk.id,
              label: chunk.label,
              text: chunk.text,
              score: chunk.score,
            })),
          ),
        });

        if (!hasRelevantChunks(retrieval.chunks.length)) {
          const text = noAnswerText(answerLanguage);
          const usage = makeNoAnswerUsage(retrieval.embeddingTokens);
          const assistantMessageId = `${requestEventId}:assistant`;
          await insertMessage({
            id: assistantMessageId,
            sessionId,
            role: 'assistant',
            content: text,
            language: answerLanguage,
          });
          await consumeQuota(apiKeyHash, usage);
          sendSseEvent(controller, 'chunk', { text });
          sendSseEvent(controller, 'done', {
            sources: [],
            citations: [],
            locateSnippet: null,
            usage,
            guardrails: guardrailInfo,
          });
          await finalizeRequestEvent({
            id: requestEventId,
            status: 200,
            guardrailBlocked: false,
            guardrailReasons: [],
            injectionScore: 0,
            blockedStage: null,
            retrievalQuery: retrieval.diagnostics.retrieval_query,
            retrievedChunkIds: [],
            retrievalScores: retrieval.diagnostics.scores,
            retrievalFallbackUsed: retrieval.diagnostics.fallback_used,
            prompt: JSON.stringify(body),
            response: text,
            usage,
          });
          controller.close();
          return;
        }

        const prompt = buildPrompt({
          query: latestUserMessage.content,
          history: sanitizedMessages,
          chunks: retrieval.chunks.map((chunk) => ({ label: chunk.label, text: chunk.text })),
          language: answerLanguage,
        });

        const completion = await client.chat.completions.create({
          model: CHAT_MODEL,
          temperature: 0.2,
          stream: true,
          stream_options: { include_usage: true },
          messages: prompt.messages,
        });

        let fullAnswer = '';
        let usageChunk: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        } | null = null;

        for await (const chunk of completion) {
          if (chunk.usage) {
            usageChunk = chunk.usage;
          }
          const token = chunk.choices[0]?.delta?.content;
          if (token) {
            fullAnswer += token;
            sendSseEvent(controller, 'chunk', { text: token });
          }
        }

        const cleanedAnswer = sanitizeAssistantText(fullAnswer);
        const outputGuardrail = evaluateAssistantOutput(cleanedAnswer || fullAnswer);
        const finalAnswer = outputGuardrail.blocked
          ? outputGuardrail.safeText
          : cleanedAnswer || fullAnswer || noAnswerText(answerLanguage);
        if (outputGuardrail.blocked) {
          guardrailInfo.blocked = true;
          guardrailInfo.reasons = outputGuardrail.reasons;
        }
        const hasNoAnswerPhrase =
          /в материалах лекции этого нет|дәріс материалдарында.*жоқ|not covered in the lecture materials/i.test(
            finalAnswer,
          );
        const locateQuery = `${latestUserMessage.content}\n${cleanedAnswer}`;
        const locateSnippet =
          locateInLecture && !hasNoAnswerPhrase && !outputGuardrail.blocked
            ? pickLocateSnippet(
                locateQuery,
                retrieval.chunks.map((chunk) => ({ text: chunk.text })),
                { preferTable: isComparisonQuery(latestUserMessage.content) },
              )
            : null;

        const usage = estimateUsageCost({
          prompt_tokens: usageChunk?.prompt_tokens ?? estimateTokens(JSON.stringify(prompt.messages)),
          completion_tokens: usageChunk?.completion_tokens ?? estimateTokens(finalAnswer),
          embedding_tokens: retrieval.embeddingTokens,
          total_tokens:
            usageChunk?.total_tokens ??
            (usageChunk?.prompt_tokens ?? estimateTokens(JSON.stringify(prompt.messages))) +
              (usageChunk?.completion_tokens ?? estimateTokens(finalAnswer)) +
              retrieval.embeddingTokens,
        });

        const assistantMessageId = `${requestEventId}:assistant`;
        await insertMessage({
          id: assistantMessageId,
          sessionId,
          role: 'assistant',
          content: finalAnswer,
          language: answerLanguage,
        });
        await consumeQuota(apiKeyHash, usage);

        sendSseEvent(controller, 'done', {
          sources: hasNoAnswerPhrase || outputGuardrail.blocked ? [] : sources,
          citations: hasNoAnswerPhrase || outputGuardrail.blocked ? [] : retrieval.chunks.map((chunk) => chunk.id),
          locateSnippet,
          usage,
          guardrails: guardrailInfo,
        });

        await finalizeRequestEvent({
          id: requestEventId,
          status: 200,
          guardrailBlocked: outputGuardrail.blocked,
          guardrailReasons: outputGuardrail.reasons,
          injectionScore: outputGuardrail.score,
          blockedStage: outputGuardrail.blocked ? 'generation' : null,
          retrievalQuery: retrieval.diagnostics.retrieval_query,
          retrievedChunkIds: retrieval.chunks.map((chunk) => chunk.id),
          retrievalScores: retrieval.diagnostics.scores,
          retrievalFallbackUsed: retrieval.diagnostics.fallback_used,
          prompt: JSON.stringify(prompt.messages),
          response: finalAnswer,
          usage,
        });

        controller.close();
      } catch (error) {
        console.error('Chat stream error:', error);
        const errorMessage =
          'Ошибка при обращении к модели. Проверьте ключ, лимиты API и повторите запрос.';
        sendSseEvent(controller, 'error', {
          code: 'chat_stream_failed',
          message: errorMessage,
          retryable: true,
        });
        await finalizeRequestEvent({
          id: requestEventId,
          status: 500,
          guardrailBlocked: false,
          guardrailReasons: [],
          injectionScore: 0,
          blockedStage: null,
          retrievalQuery: retrieval.diagnostics.retrieval_query,
          retrievedChunkIds: retrieval.chunks.map((chunk) => chunk.id),
          retrievalScores: retrieval.diagnostics.scores,
          retrievalFallbackUsed: retrieval.diagnostics.fallback_used,
          prompt: JSON.stringify(body),
          response: error instanceof Error ? error.message : errorMessage,
          usage: makeNoAnswerUsage(retrieval.embeddingTokens),
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function hasRelevantChunks(count: number) {
  return count > 0;
}

