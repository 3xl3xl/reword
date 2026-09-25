import {
  practiceMode,
  startPracticeSchema,
  answerPracticeSchema,
} from "../practice/domain.js";
import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { LearningApi } from "../../learning-api.js";
import {
  dailyMode,
  activityMode,
  prepareActivitySchema,
  activityAnswerSchema,
} from "./domain.js";
export const WIDGET_URI = "ui://reword/today-v1.html";
let widget: string | undefined;
export function widgetHtml() {
  return (widget ??= readFileSync(
    new URL("../../../public/generated/today.html", import.meta.url),
    "utf8",
  ));
}
const outputSchema = {
  view: z.enum(["today", "activity", "sentences", "material", "practice"]),
  data: z.record(z.string(), z.unknown()).nullable(),
};
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const write = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
};
const appAccess = {
  ui: { visibility: ["model", "app"] },
  "openai/widgetAccessible": true,
};
const renderMeta = {
  ui: { resourceUri: WIDGET_URI, visibility: ["model", "app"] },
  "openai/outputTemplate": WIDGET_URI,
  "openai/widgetAccessible": true,
};
export const dailyInstructions = `When the user invokes @reword without a more specific request, or asks for today's study/menu, call start_today_learning immediately. Do not ask which website to open. Show four primary modes inside ChatGPT: Flashcard, Multiple Choice, Sentence Blocks, Free Recall. Use start_practice/get_practice/answer_practice with mode=flashcard/multiple_choice/sentence_blocks/free_recall. Existing reading/conversation/writing tools remain available for explicit requests. Use the connected account's authoritative saved words, corrections and history, never local samples or a separate database. Follow an explicit save request instead of showing a menu. For a primary mode, call start_practice first to resume or use saved material. If Sentence Blocks needs new material, call get_learning_material(mode=sentences) before prepare_sentence_blocks. For explicit reading/conversation/writing requests, first call get_learning_material. Resume unfinished work. If none exists, use actual item IDs and context from that result to prepare content, then call show_learning_activity. Sentence Blocks: one to five prompts with ordered short phrase blocks; prepare_sentence_blocks; keep saved expressions in one natural chunk, never split them unnaturally. Multiple Choice: start_practice uses saved meanings first. If it returns no activity, read get_learning_material(mode=choice) and supply generated_distractors to start_practice only for missing candidates; use three distinct, plausible but unequivocally incorrect meanings, never synonyms of the correct meaning. Generated choices are not saved as new items. Flashcard: reveal first, then record the user's Know/Don't know selection. Free Recall: reuse start_quiz/get_quiz/answer_quiz for host-assessed equivalence, or start_practice for the interactive exact-normalized interface. Reading: a 150–250-word passage using saved vocabulary and 3 comprehension questions, each with four distinct plausible options; prepare_learning_activity. Conversation: use the user's chosen theme, or briefly ask for one; prepare 3–5 discussion prompts, adapt your conversational follow-up to actual user answers without inventing personal details. Writing: prepare 3 short personal sentence prompts using saved expressions/corrections. For free answers, get_learning_activity first, wait for the user's own words, then answer_learning_activity with the exact answer, short feedback and only assessed_item_ids actually demonstrated or clearly misused. Use prompted for successful requested usage, recognition for partial demonstrated recognition, incorrect only for clear misuse. An unrelated answer may have assessed_item_ids=[] and must not reward or penalize vocabulary. Do not record_usage again. Never record the model's own examples as user answers. Reading or playback is not proof of pronunciation/speaking. If saved items are missing, say so; do not seed a starter vocabulary. Stay inside ChatGPT; do not send the user to localhost or ask them to paste an access token.`;
export function registerDailyTools(server: McpServer, service: LearningApi) {
  server.registerResource("reword-today", WIDGET_URI, {}, async () => ({
    contents: [
      {
        uri: WIDGET_URI,
        mimeType: "text/html;profile=mcp-app",
        text: widgetHtml(),
        _meta: {
          ui: {
            prefersBorder: true,
            csp: { connectDomains: [], resourceDomains: [] },
          },
          "openai/widgetDescription":
            "Four learning modes using this authenticated RE:WORD account's saved vocabulary and progress.",
        },
      },
    ],
  }));
  const result = async (
    view: z.infer<typeof outputSchema.view>,
    work: () => unknown,
  ) => {
    try {
      const data = await work();
      return {
        structuredContent: { view, data },
        content: [
          { type: "text" as const, text: JSON.stringify({ view, data }) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error:
                error instanceof Error ? error.message : "Learning unavailable",
            }),
          },
        ],
        isError: true,
      };
    }
  };
  server.registerTool(
    "start_practice",
    {
      description:
        "Start or resume Flashcard, Multiple Choice, Sentence Blocks or Free Recall using existing saved items. No items are duplicated. Supply generated distractor meanings only when saved candidates are insufficient; they must be distinct and unambiguously incorrect. Sentence Blocks uses saved examples, otherwise prepare_sentence_blocks with natural chunks. Free Recall preserves the existing quiz slots.",
      inputSchema: startPracticeSchema.shape,
      outputSchema,
      annotations: write,
      _meta: renderMeta,
    },
    (input) => result("practice", () => service.startPractice(input)),
  );
  server.registerTool(
    "get_practice",
    {
      description:
        "Read persisted practice without recording usage; grading answers and unflipped backs are hidden.",
      inputSchema: { mode: practiceMode },
      outputSchema,
      annotations: readOnly,
      _meta: renderMeta,
    },
    (input) => result("practice", () => service.getPractice(input)),
  );
  server.registerTool(
    "answer_practice",
    {
      description:
        "Record the actual learner answer once. Flashcard: reveal, then answer know/dont_know. Multiple Choice: answer with selected option ID after Check. Free Recall: exact typed answer; server grades it. Sentence Blocks: draft/check/next with revision and request_id. Never fabricate responses or call record_usage again.",
      inputSchema: answerPracticeSchema.shape,
      outputSchema,
      annotations: write,
      _meta: appAccess,
    },
    (input) => result("practice", () => service.answerPractice(input)),
  );
  server.registerTool(
    "start_today_learning",
    {
      title: "今日のRE:WORD",
      description:
        "Default entry for @reword or today's study. Show four learning modes and live saved-word/due counts from the authenticated account. Read-only: no sample data, saves or answers are created. Remain inside ChatGPT.",
      inputSchema: {},
      outputSchema,
      annotations: readOnly,
      _meta: renderMeta,
    },
    () => result("today", () => service.todayLearning()),
  );
  server.registerTool(
    "get_learning_material",
    {
      description:
        "Fetch authoritative saved words, contexts, corrections and due/mastery state for a selected daily mode. Use only these owned item IDs to prepare a lesson. Empty means no saved data; never fill with samples.",
      inputSchema: {
        mode: dailyMode,
        topic: z.string().trim().max(200).optional(),
      },
      outputSchema,
      annotations: readOnly,
    },
    (input) => result("material", () => service.learningMaterial(input)),
  );
  server.registerTool(
    "start_choice_quiz",
    {
      description:
        "Start/resume today's 4-option quiz from saved vocabulary, due/weak items first. At least four distinct saved meanings are needed. Returns null rather than fabricated distractors. Call show_learning_activity with choice to render it.",
      inputSchema: {},
      outputSchema,
      annotations: write,
      _meta: appAccess,
    },
    () => result("activity", () => service.startChoice()),
  );
  server.registerTool(
    "prepare_learning_activity",
    {
      description:
        "Prepare a reading passage with four-option comprehension questions, a themed conversation, or sentence-writing prompts using actual saved items. Read get_learning_material first. Use real context or explicitly fictional situations, never invented biographical facts. Completed same-day or unfinished activities are resumed; no learning usage is recorded.",
      inputSchema: prepareActivitySchema,
      outputSchema,
      annotations: write,
    },
    (input) => result("activity", () => service.prepareActivity(input)),
  );
  server.registerTool(
    "get_learning_activity",
    {
      description:
        "Read the latest persisted daily activity before recording an actual answer. Correct options are hidden until answered.",
      inputSchema: { mode: activityMode },
      outputSchema,
      annotations: readOnly,
      _meta: appAccess,
    },
    (input) => result("activity", () => service.getActivity(input.mode)),
  );
  server.registerTool(
    "answer_learning_activity",
    {
      description:
        "Record only the user's actual choice option ID or verbatim free answer. Read latest state first. Choices grade server-side. For conversation/writing, include assessed_item_ids actually demonstrated and an assessed outcome plus concise feedback; [] means no word usage was observed. Never invent an answer or double-record usage. If using chat, render the returned next prompt after brief feedback.",
      inputSchema: activityAnswerSchema.shape,
      outputSchema,
      annotations: write,
      _meta: appAccess,
    },
    (input) => result("activity", () => service.answerActivity(input)),
  );
  server.registerTool(
    "show_learning_activity",
    {
      description:
        "Render an already prepared daily exercise inside ChatGPT. Call after start_choice_quiz / prepare_sentence_blocks / prepare_learning_activity. Never directs the learner to another website. Null means prepare first.",
      inputSchema: { mode: dailyMode },
      outputSchema,
      annotations: readOnly,
      _meta: renderMeta,
    },
    (input) =>
      result(
        input.mode === "free_recall" || input.mode === "flashcard"
          ? "practice"
          : input.mode === "sentences"
            ? "sentences"
            : "activity",
        () =>
          input.mode === "free_recall" || input.mode === "flashcard"
            ? service.getPractice({ mode: input.mode })
            : input.mode === "sentences"
              ? service.getSentences()
              : service.getActivity(input.mode),
      ),
  );
}
