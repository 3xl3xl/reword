import {
  lessonSchema,
  sessionActionSchema,
} from "./features/sentence-blocks/domain.js";
import { quizAnswerSchema } from "./quiz.js";
import type { LearningApi } from "./learning-api.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  LearningService,
  saveSchema,
  usageSchema,
  updateSchema,
  correctionQuerySchema,
} from "./service.js";
const savedReplyInstructions = `After this save succeeds, especially when the user says "save that", reply with exactly these four lines and no extra commentary:
**Saved:** [word/expression]
**Meaning:** [natural meaning in the user's original language]
**類語:** [2–4 natural English synonyms or similar expressions]
**Example:** [one natural English sentence based on the user's actual daily-life context]
Use the saved item's text. Keep every line concise. Infer the user's original language from the conversation; do not assume Japanese just because the label is 類語. Prioritize the current conversation context over a generic dictionary example. Use only context the user actually supplied; do not invent personal details. If no daily-life context is available, use a neutral everyday sentence without claiming it is a fact about the user. Never announce a save until the tool succeeds, and never use this success format for a failed save.`;
export const instructions = `RE:WORD helps users learn English through ordinary conversation. Conversation comes first. Save only on request; resolve "save that" from conversation context, asking briefly if ambiguous. Supply meanings, synonyms, a contextual example, and the original context; never invent context. Occasionally retrieve at most three relevant due items. It is fine to use none. Reuse them naturally, never force unrelated words or turn every conversation into a quiz. Avoid teaching interruptions during emotional, serious, or important discussions. Record exposure only after actually showing an item. Record independent success only for the user's own clearly correct usage, not your wording, quotations, recognition, or prompted repetition. Record clear mistakes with a lightweight correction when helpful; do not penalize uncertain judgments. Store personal corrections with consent. Use a fresh UUID event_id for each observed event and reuse it on retries. Text transcripts cannot establish pronunciation quality. ${savedReplyInstructions}`;
export function createMcp(service: LearningApi) {
  const server = new McpServer(
    { name: "reword", version: "0.1.0" },
    { instructions },
  );
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  const write = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const response = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  });
  const safe = async (work: () => unknown, successGuidance?: string) => {
    try {
      const result = response(await work());
      if (successGuidance) {
        result.content.push({ type: "text", text: successGuidance });
      }
      return result;
    } catch (error) {
      return {
        ...response({
          error: error instanceof Error ? error.message : "Operation failed",
        }),
        isError: true,
      };
    }
  };
  for (const type of ["word", "expression"] as const) {
    server.registerTool(
      `save_${type}`,
      {
        description: `Save a requested English ${type}; repeated saves preserve existing progress. ${savedReplyInstructions}`,
        inputSchema: saveSchema.omit({ type: true, category: true }).shape,
        annotations: write,
      },
      (input) =>
        safe(() => service.save({ ...input, type }), savedReplyInstructions),
    );
  }
  server.registerTool(
    "save_correction",
    {
      description:
        "Save a personal correction: text is the natural version, original_sentence is the mistake, meaning_en explains it. Ask consent before saving.",
      inputSchema: saveSchema.omit({ type: true }).shape,
      annotations: write,
    },
    (input) =>
      safe(
        () => service.save({ ...input, type: "correction" }),
        savedReplyInstructions,
      ),
  );
  server.registerTool(
    "update_learning_item",
    {
      description:
        "Edit requested wording, meanings, context, notes, or correction category. Preserves mastery, schedule and usage history. Use only for corrections to the same learning item; save a new item for a different concept.",
      inputSchema: updateSchema.shape,
      annotations: { ...write, destructiveHint: true },
    },
    (input) => safe(() => service.update(input)),
  );
  server.registerTool(
    "get_corrections",
    {
      description:
        "Browse personal corrections by category, text, due status, or recurring difficulty (at least two recorded incorrect uses). Results include totals and pagination; retrieval does not record practice.",
      inputSchema: correctionQuerySchema.shape,
      annotations: readOnly,
    },
    (input) => safe(() => service.corrections(input)),
  );
  const limit = z.number().int().min(1).max(50).default(20);
  server.registerTool(
    "get_learning_words",
    {
      description:
        "Browse My Words, expressions, and personal corrections, with pagination.",
      inputSchema: { limit, offset: z.number().int().min(0).default(0) },
      annotations: readOnly,
    },
    (input) => safe(() => service.list(input.limit, input.offset)),
  );
  server.registerTool(
    "get_due_words",
    {
      description:
        "Retrieve due items for explicitly requested practice. Retrieval does not record exposure.",
      inputSchema: { limit },
      annotations: readOnly,
    },
    (input) => safe(() => service.due(input.limit)),
  );
  server.registerTool(
    "get_words_for_conversation",
    {
      description:
        "Return up to three due, relevant items using topic/context keyword overlap. May return none. Do not force suggestions into conversation.",
      inputSchema: {
        topic: z.string().trim().min(1).max(2000),
        limit: z.number().int().min(1).max(3).default(3),
      },
      annotations: readOnly,
    },
    (input) => safe(() => service.conversation(input.topic, input.limit)),
  );
  server.registerTool(
    "record_usage",
    {
      description:
        "Record actual exposure or assessed user usage; provide observed context and a stable UUID for retry safety. This also schedules the next review.",
      inputSchema: usageSchema.shape,
      annotations: write,
    },
    (input) => safe(() => service.record(input)),
  );
  server.registerTool(
    "review_words",
    {
      description:
        "Inspect one saved item and its most recent 100 usage events; this does not change progress.",
      inputSchema: { item_id: z.string().uuid() },
      annotations: readOnly,
    },
    (input) => safe(() => service.review(input.item_id)),
  );
  server.registerTool(
    "get_stats",
    {
      description: "Get learning totals and due counts.",
      inputSchema: {},
      annotations: readOnly,
    },
    () => safe(() => service.stats()),
  );
  server.registerTool(
    "get_learning_profile",
    {
      description: "Get learning progress and conversation preferences.",
      inputSchema: {},
      annotations: readOnly,
    },
    () =>
      safe(async () => ({
        ...(await service.stats()),
        approach: "conversation-first",
        max_conversation_items: 3,
        pronunciation_evaluation: false,
      })),
  );
  server.registerTool(
    "start_quiz",
    {
      description:
        "Start or resume the user's persisted quiz (up to 3 due items). Scheduled runs at 08:00 and 22:00 Asia/Tokyo should call this. Repeated calls resume the same unfinished quiz; completed slots are not repeated. Show only current.prompt, never expected_answer_for_grading_only before an answer. If null, no eligible due words. Do not invent questions or claim notifications were delivered.",
      inputSchema: {},
      annotations: write,
    },
    () => safe(() => service.startQuiz()),
  );
  server.registerTool(
    "get_quiz",
    {
      description:
        "Resume quiz state from any chat. Show only the current question; expected_answer_for_grading_only is private grading guidance, not a hint to display. Completed quiz results may be shown.",
      inputSchema: {},
      annotations: readOnly,
    },
    () => safe(() => service.getQuiz()),
  );
  server.registerTool(
    "answer_quiz",
    {
      description:
        "Save the user's actual answer to the current question atomically with progress. Assess against expected answer: prompted for correct or a valid equivalent, incorrect for a clear mistake. Never fabricate answers or assess uncertain answers. Do not separately call record_usage. Explain the result briefly then show only the returned next prompt, without its expected answer. Retry identical input safely.",
      inputSchema: quizAnswerSchema.shape,
      annotations: write,
    },
    (input) => safe(() => service.answerQuiz(input)),
  );
  server.registerTool(
    "prepare_sentence_blocks",
    {
      description:
        "Prepare 5 Japanese-prompt sentence ordering questions from real saved items and user-supplied topics. Each question links existing item_ids. Supply blocks in correct order; never invent personal facts. Resume an unfinished session. This does not record usage. Open /learn to practice.",
      inputSchema: lessonSchema.shape,
      annotations: write,
    },
    (input) => safe(() => service.prepareSentences(input)),
  );
  server.registerTool(
    "get_sentence_blocks",
    {
      description:
        "Read persisted Sentence Blocks state. No solution is returned before success.",
      inputSchema: {},
      annotations: readOnly,
    },
    () => safe(() => service.getSentences()),
  );
  server.registerTool(
    "answer_sentence_blocks",
    {
      description:
        "Persist the user's actual selected block IDs, check their order, or advance a solved sentence. Read latest state first. Never supply an answer for the user. Learning events are recorded atomically; do not also record_usage.",
      inputSchema: sessionActionSchema.shape,
      annotations: write,
    },
    (input) => safe(() => service.sentenceAction(input)),
  );
  return server;
}
