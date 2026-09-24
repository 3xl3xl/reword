import {
  menu,
  tokyoDay,
  dailyMode,
  activityMode,
  activityView,
  prepareActivitySchema,
  activityAnswerSchema,
  makeActivity,
  shuffle,
  type Activity,
} from "./features/daily/domain.js";
import {
  lessonSchema,
  sessionActionSchema,
  makeSession,
  sentenceView,
  sentenceText,
} from "./features/sentence-blocks/domain.js";
import { lessons } from "./features/sentence-blocks/lessons.js";
import { quizAnswerSchema, quizSlot, quizView, type Quiz } from "./quiz.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { normalize, schedule, type Item } from "./domain.js";
import type { Repository } from "./storage/repository.js";
const text = z.string().trim().min(1).max(2000);
export const saveSchema = z.object({
  text: text.max(200),
  type: z.enum(["word", "expression", "correction"]),
  synonyms: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  example: z.string().trim().max(2000).default(""),
  meaning_en: z.string().trim().max(2000).default(""),
  meaning_ja: z.string().max(2000).default(""),
  original_context: z.string().max(4000).default(""),
  original_sentence: z.string().max(2000).default(""),
  notes: z.string().max(2000).default(""),
  category: z
    .enum([
      "grammar",
      "vocabulary",
      "naturalness",
      "word choice",
      "sentence structure",
      "",
    ])
    .default(""),
});
export const updateSchema = z.object({
  item_id: z.string().uuid(),
  changes: z
    .object({
      text: saveSchema.shape.text,
      synonyms: saveSchema.shape.synonyms.removeDefault(),
      example: saveSchema.shape.example.removeDefault(),
      meaning_en: z.string().trim().max(2000),
      meaning_ja: saveSchema.shape.meaning_ja.removeDefault(),
      original_context: saveSchema.shape.original_context.removeDefault(),
      original_sentence: saveSchema.shape.original_sentence.removeDefault(),
      notes: saveSchema.shape.notes.removeDefault(),
      category: saveSchema.shape.category.removeDefault(),
    })
    .partial()
    .strict()
    .refine(
      (value) => Object.values(value).some((v) => v !== undefined),
      "Provide at least one field to update.",
    ),
});
export const correctionQuerySchema = z.object({
  category: saveSchema.shape.category.removeDefault().optional(),
  query: z.string().trim().max(200).optional(),
  due_only: z.boolean().default(false),
  recurring_only: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
});
export const usageSchema = z.object({
  item_id: z.string().uuid(),
  event_id: z.string().uuid(),
  outcome: z.enum([
    "exposure",
    "recognition",
    "prompted",
    "independent",
    "incorrect",
  ]),
  context: text,
});
export class LearningService {
  constructor(
    readonly repo: Repository,
    private clock: () => Date = () => new Date(),
  ) {}
  save(input: z.input<typeof saveSchema>): Item {
    const data = saveSchema.parse(input);
    if (data.type === "correction" && !data.original_sentence.trim())
      throw new Error("Corrections require the original sentence.");
    return this.repo.transaction(() => this.saveItem(data));
  }
  private saveItem(data: z.output<typeof saveSchema>): Item {
    const existing = this.repo.findNormalized(normalize(data.text), data.type);
    if (existing) return existing;
    const now = this.clock().toISOString();
    const item: Item = {
      ...data,
      id: randomUUID(),
      normalized_text: normalize(data.text),
      mastery_score: 0,
      successful_uses: 0,
      failed_uses: 0,
      interval_hours: 0,
      status: "learning",
      last_seen_at: null,
      last_used_at: null,
      next_review_at: now,
      created_at: now,
      updated_at: now,
    };
    this.repo.put(item);
    return item;
  }
  update(input: z.input<typeof updateSchema>): Item {
    const { item_id, changes } = updateSchema.parse(input);
    return this.repo.transaction(() => {
      const item = this.repo.find(item_id);
      if (!item) throw new Error("Learning item not found.");
      const supplied = Object.fromEntries(
        Object.entries(changes).filter(([, v]) => v !== undefined),
      );
      const updated = { ...item, ...supplied } as Item;
      if (updated.type === "correction" && !updated.original_sentence.trim())
        throw new Error("Corrections require the original sentence.");
      if (updated.type !== "correction" && updated.category)
        throw new Error("Categories apply only to corrections.");
      updated.normalized_text = normalize(updated.text);
      const duplicate = this.repo.findNormalized(
        updated.normalized_text,
        updated.type,
      );
      if (duplicate && duplicate.id !== item.id)
        throw new Error("Another item already has this text.");
      if (
        Object.entries(supplied).every(
          ([key, value]) => item[key as keyof Item] === value,
        )
      )
        return item;
      updated.updated_at = this.clock().toISOString();
      this.repo.put(updated);
      return updated;
    });
  }
  corrections(input: z.input<typeof correctionQuerySchema> = {}) {
    const query = correctionQuerySchema.parse(input);
    const now = this.clock().toISOString();
    const items = this.repo
      .list()
      .filter(
        (item) =>
          item.type === "correction" &&
          (query.category === undefined || item.category === query.category) &&
          (!query.due_only || item.next_review_at <= now) &&
          (!query.recurring_only || item.failed_uses >= 2) &&
          (!query.query ||
            normalize(
              [
                item.text,
                item.original_sentence,
                item.meaning_en,
                item.meaning_ja,
                item.notes,
              ].join(" "),
            ).includes(normalize(query.query))),
      )
      .sort(
        (a, b) =>
          b.failed_uses - a.failed_uses ||
          a.next_review_at.localeCompare(b.next_review_at) ||
          a.id.localeCompare(b.id),
      );
    return {
      items: items.slice(query.offset, query.offset + query.limit),
      total: items.length,
      next_offset:
        query.offset + query.limit < items.length
          ? query.offset + query.limit
          : null,
    };
  }
  list(limit = 20, offset = 0) {
    return this.repo
      .list()
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
      )
      .slice(offset, offset + limit);
  }
  due(limit = 10) {
    const now = this.clock().toISOString();
    return this.repo
      .list()
      .filter((item) => item.next_review_at <= now)
      .sort(
        (a, b) =>
          a.next_review_at.localeCompare(b.next_review_at) ||
          a.mastery_score - b.mastery_score,
      )
      .slice(0, limit);
  }
  conversation(topic: string, limit = 3) {
    const tokens = new Set(
      normalize(topic)
        .match(/[\p{L}\p{N}]+/gu)
        ?.filter((t) => t.length > 2) ?? [],
    );
    const cutoff = this.clock().getTime() - 6 * 3600000;
    return this.due(Number.MAX_SAFE_INTEGER)
      .filter(
        (item) => !item.last_seen_at || Date.parse(item.last_seen_at) <= cutoff,
      )
      .map((item) => {
        const words = new Set(
          normalize(
            [
              item.text,
              item.meaning_en,
              item.meaning_ja,
              item.original_context,
              item.original_sentence,
              item.notes,
            ].join(" "),
          ).match(/[\p{L}\p{N}]+/gu) ?? [],
        );
        return {
          item,
          relevance: [...tokens].filter((token) => words.has(token)).length,
        };
      })
      .filter((result) => result.relevance > 0)
      .sort(
        (a, b) =>
          b.relevance - a.relevance ||
          a.item.mastery_score - b.item.mastery_score,
      )
      .slice(0, Math.min(3, limit))
      .map((result) => result.item);
  }
  record(input: z.input<typeof usageSchema>) {
    const data = usageSchema.parse(input);
    return this.repo.transaction(() => {
      const item = this.repo.find(data.item_id);
      if (!item) throw new Error("Learning item not found.");
      const existing = this.repo.event(data.event_id);
      if (existing) {
        if (
          existing.item_id !== data.item_id ||
          existing.outcome !== data.outcome ||
          existing.context !== data.context
        )
          throw new Error("event_id already used for a different event.");
        return item;
      }
      const now = this.clock();
      const updated = schedule(item, data.outcome, now);
      this.repo.put(updated);
      this.repo.addEvent({ ...data, created_at: now.toISOString() });
      return updated;
    });
  }
  getQuiz() {
    return quizView(this.repo.getQuiz());
  }
  startQuiz() {
    return this.repo.transaction(() => {
      const now = this.clock();
      const previous = this.repo.getQuiz();
      const slot = quizSlot(now);
      if (
        previous &&
        (previous.questions.some((q) => q.answer === undefined) ||
          previous.slot === slot)
      )
        return quizView(previous);
      const items = this.due(50)
        .filter((i) => i.meaning_ja || i.meaning_en)
        .slice(0, 3);
      if (!items.length) return null;
      const quiz: Quiz = {
        id: randomUUID(),
        slot,
        created_at: now.toISOString(),
        questions: items.map((item) => ({
          id: randomUUID(),
          item_id: item.id,
          prompt: `「${item.meaning_ja || item.meaning_en}」を表す、保存した英語は？`,
          expected: item.text,
        })),
      };
      this.repo.putQuiz(quiz);
      return quizView(quiz);
    });
  }
  answerQuiz(input: z.input<typeof quizAnswerSchema>) {
    const data = quizAnswerSchema.parse(input);
    return this.repo.transaction(() => {
      const quiz = this.repo.getQuiz();
      if (!quiz || quiz.id !== data.quiz_id) throw new Error("Quiz not found.");
      const question = quiz.questions.find((q) => q.id === data.question_id);
      if (!question) throw new Error("Question not found.");
      if (question.answer !== undefined) {
        if (
          question.answer !== data.answer ||
          question.outcome !== data.outcome
        )
          throw new Error("Question already answered differently.");
        return quizView(quiz);
      }
      if (
        quiz.questions.find((q) => q.answer === undefined)?.id !== question.id
      )
        throw new Error("Answer the current question first.");
      const item = this.repo.find(question.item_id);
      if (!item) throw new Error("Learning item not found.");
      const now = this.clock();
      this.repo.put(schedule(item, data.outcome, now));
      this.repo.addEvent({
        event_id: question.id,
        item_id: item.id,
        outcome: data.outcome,
        context: data.answer,
        created_at: now.toISOString(),
      });
      question.answer = data.answer;
      question.outcome = data.outcome;
      question.answered_at = now.toISOString();
      this.repo.putQuiz(quiz);
      return quizView(quiz);
    });
  }
  getSentences() {
    return sentenceView(this.repo.getSentences());
  }
  prepareSentences(input: z.input<typeof lessonSchema>) {
    const data = lessonSchema.parse(input);
    return this.repo.transaction(() => {
      const previous = this.repo.getSentences();
      if (previous && previous.index < 5) return sentenceView(previous);
      for (const question of data.questions)
        for (const id of question.item_ids)
          if (!this.repo.find(id)) throw new Error("Learning item not found.");
      const session = makeSession(data, this.clock());
      this.repo.putSentences(session);
      return sentenceView(session);
    });
  }
  startStarterSentences(mode: "personal" | "hard") {
    z.enum(["personal", "hard"]).parse(mode);
    return this.repo.transaction(() => {
      const previous = this.repo.getSentences();
      if (previous && previous.index < 5) return sentenceView(previous);
      const questions = lessons[mode].map(([topic, prompt, blocks]) => {
        const sentence = blocks.join(" ");
        const expression = this.saveItem(
          saveSchema.parse({
            text: sentence,
            type: "expression",
            meaning_ja: prompt,
            example: sentence,
            original_context: "User-selected practice theme: " + topic,
          }),
        );
        // Link only actual saved words occurring in this sentence (including scatter/scattered).
        const related = this.repo.list().filter(
          (i) =>
            i.id !== expression.id &&
            i.type === "word" &&
            i.text.length > 2 &&
            sentence
              .toLowerCase()
              .split(/[^a-z]+/)
              .some(
                (w) =>
                  w === i.normalized_text ||
                  w === i.normalized_text + "ed" ||
                  w === i.normalized_text + "s",
              ),
        );
        return {
          topic,
          prompt,
          blocks,
          item_ids: [expression.id, ...related.slice(0, 4).map((i) => i.id)],
        };
      });
      const session = makeSession({ mode, questions }, this.clock());
      this.repo.putSentences(session);
      return sentenceView(session);
    });
  }
  sentenceAction(input: z.input<typeof sessionActionSchema>) {
    const data = sessionActionSchema.parse(input);
    return this.repo.transaction(() => {
      const session = this.repo.getSentences();
      if (!session || session.id !== data.session_id)
        throw new Error("Session not found.");
      const payload = JSON.stringify(data);
      if (session.last_request?.id === data.request_id) {
        if (session.last_request.payload !== payload)
          throw new Error("Request already used differently.");
        return sentenceView(session);
      }
      if (session.revision !== data.revision)
        throw new Error("Session changed. Reload to continue.");
      const q = session.questions[session.index];
      if (!q || q.id !== data.question_id)
        throw new Error("Answer the current question first.");
      if (data.action === "next") {
        if (!q.correct) throw new Error("Complete this sentence first.");
        session.index++;
      } else {
        if (q.correct) throw new Error("Sentence already completed.");
        if (
          new Set(data.block_ids).size !== data.block_ids.length ||
          data.block_ids.some((id) => !q.blocks.some((b) => b.id === id))
        )
          throw new Error("Invalid blocks.");
        if (
          data.action === "check" &&
          data.block_ids.length !== q.blocks.length
        )
          throw new Error("Use every block before checking.");
        q.draft = data.block_ids;
        if (data.action === "check") {
          q.attempts++;
          const answer = sentenceText(q, q.draft);
          q.correct = answer === sentenceText(q, q.expected);
          // Wrong first attempts and eventual recovery are both observable. Repeated wrong checks do not repeatedly penalize.
          if (q.attempts === 1 || q.correct) {
            const outcome = q.correct
              ? q.attempts === 1
                ? "prompted"
                : "recognition"
              : "incorrect";
            const now = this.clock();
            for (const id of new Set(q.item_ids)) {
              const item = this.repo.find(id);
              if (!item) throw new Error("Learning item not found.");
              this.repo.put(schedule(item, outcome, now));
              this.repo.addEvent({
                event_id: randomUUID(),
                item_id: id,
                outcome,
                context: `Sentence Blocks (${session.id}, ${q.id}): ${answer}`,
                created_at: now.toISOString(),
              });
            }
          }
        }
      }
      session.revision++;
      session.last_request = { id: data.request_id, payload };
      this.repo.putSentences(session);
      return sentenceView(session);
    });
  }
  todayLearning() {
    const today = tokyoDay(this.clock());
    const state = this.repo.getDaily();
    const sentences = this.getSentences();
    const items = this.repo.list();
    const eligible = items.filter((i) => i.meaning_ja || i.meaning_en);
    const distinct = new Set(eligible.map((i) => normalize(i.text))).size;
    return {
      date: today,
      timezone: "Asia/Tokyo",
      source: "connected_reword_account",
      stats: this.stats(),
      menu: menu.map((entry) => {
        const activity =
          entry.id === "sentences"
            ? null
            : activityView(state?.activities[entry.id]);
        const sentenceDate = this.repo.getSentences()?.created_at.slice(0, 10);
        const view = entry.id === "sentences" ? sentences : activity;
        const active =
          view &&
          (!view.completed ||
            (activity?.date ??
              (sentenceDate
                ? tokyoDay(new Date(this.repo.getSentences()!.created_at))
                : null)) === today);
        const available =
          items.length > 0 && (entry.id !== "choice" || distinct >= 4);
        return {
          ...entry,
          available: Boolean(active) || available,
          status: active
            ? view!.completed
              ? "completed"
              : "in_progress"
            : available
              ? "ready"
              : "needs_words",
          answered: active ? view!.answered : 0,
          total: active ? view!.total : null,
          reason:
            items.length === 0
              ? "保存語がありません。会話で出会った語を保存すると始められます。"
              : entry.id === "choice" && distinct < 4
                ? "4択には、意味付きの異なる保存語が4つ必要です。"
                : null,
        };
      }),
    };
  }
  learningMaterial(input: { mode: z.infer<typeof dailyMode>; topic?: string }) {
    const mode = dailyMode.parse(input.mode);
    const topic = z.string().trim().max(200).optional().parse(input.topic);
    const now = this.clock().toISOString();
    const items = this.repo
      .list()
      .sort(
        (a, b) =>
          Number(b.next_review_at <= now) - Number(a.next_review_at <= now) ||
          b.failed_uses - a.failed_uses ||
          a.mastery_score - b.mastery_score,
      )
      .slice(0, 20);
    const existing =
      mode === "sentences" ? this.getSentences() : this.getActivity(mode);
    return {
      mode,
      topic: topic || null,
      date: tokyoDay(this.clock()),
      items,
      existing,
      empty: items.length === 0,
      instruction:
        "Use these real saved items and user-supplied context only. Do not add sample words, invent personal facts, or record any answer before the user responds. Prepare a lesson, then show_learning_activity. Stay inside ChatGPT.",
    };
  }
  getActivity(mode: z.infer<typeof activityMode>) {
    activityMode.parse(mode);
    return activityView(this.repo.getDaily()?.activities[mode]);
  }
  startChoice() {
    return this.repo.transaction(() => {
      const state = this.repo.getDaily() ?? { activities: {} };
      const now = this.clock();
      const date = tokyoDay(now);
      const previous = state.activities.choice;
      if (
        previous &&
        (previous.questions.some((q) => q.answer === undefined) ||
          previous.date === date)
      )
        return activityView(previous);
      const unique = new Map<string, import("./domain.js").Item>();
      for (const item of this.repo.list())
        if (item.meaning_ja || item.meaning_en)
          unique.set(normalize(item.text), item);
      const pool = [...unique.values()];
      if (pool.length < 4) return null;
      const ordered = pool.sort(
        (a, b) =>
          Number(b.next_review_at <= now.toISOString()) -
            Number(a.next_review_at <= now.toISOString()) ||
          b.failed_uses - a.failed_uses ||
          a.mastery_score - b.mastery_score,
      );
      const questions = ordered
        .slice(0, 5)
        .map((item) => {
          const meanings = new Set([
            normalize(item.meaning_ja || item.meaning_en),
          ]);
          const distractors = shuffle(
            pool.filter(
              (i) =>
                i.id !== item.id &&
                !(item.synonyms ?? [])
                  .map(normalize)
                  .includes(i.normalized_text),
            ),
          )
            .filter((i) => {
              const meaning = normalize(i.meaning_ja || i.meaning_en);
              if (meanings.has(meaning)) return false;
              meanings.add(meaning);
              return true;
            })
            .slice(0, 3);
          if (distractors.length !== 3) return null;
          const correct = { id: randomUUID(), text: item.text };
          return {
            id: randomUUID(),
            item_ids: [item.id],
            prompt: `「${item.meaning_ja || item.meaning_en}」を表す英語は？`,
            options: shuffle([
              correct,
              ...distractors.map((i) => ({ id: randomUUID(), text: i.text })),
            ]),
            expected: correct.id,
          };
        })
        .filter((q) => q !== null);
      if (!questions.length) return null;
      const activity: Activity = {
        id: randomUUID(),
        date,
        created_at: now.toISOString(),
        mode: "choice",
        topic: "保存した語彙",
        questions,
      };
      state.activities.choice = activity;
      this.repo.putDaily(state);
      return activityView(activity);
    });
  }
  prepareActivity(input: z.input<typeof prepareActivitySchema>) {
    const data = prepareActivitySchema.parse(input);
    return this.repo.transaction(() => {
      const state = this.repo.getDaily() ?? { activities: {} };
      const previous = state.activities[data.mode];
      const now = this.clock();
      if (
        previous &&
        (previous.questions.some((q) => q.answer === undefined) ||
          previous.date === tokyoDay(now))
      )
        return activityView(previous);
      for (const q of data.questions)
        for (const id of q.item_ids)
          if (!this.repo.find(id)) throw new Error("Learning item not found.");
      const activity = makeActivity(data, now);
      state.activities[data.mode] = activity;
      this.repo.putDaily(state);
      return activityView(activity);
    });
  }
  answerActivity(input: z.input<typeof activityAnswerSchema>) {
    const data = activityAnswerSchema.parse(input);
    return this.repo.transaction(() => {
      const state = this.repo.getDaily();
      const activity = state?.activities[data.mode];
      if (!state || !activity || activity.id !== data.activity_id)
        throw new Error("Activity not found.");
      const q = activity.questions.find((q) => q.id === data.question_id);
      if (!q) throw new Error("Question not found.");
      const choice = activity.mode === "choice" || activity.mode === "reading";
      if (!choice && (!data.outcome || data.assessed_item_ids === undefined))
        throw new Error(
          "Assess the actual user answer and specify the observed item IDs (empty if none).",
        );
      if (choice && !q.options?.some((o) => o.id === data.answer))
        throw new Error("Choose a displayed option.");
      const outcome = choice
        ? data.answer === q.expected
          ? "recognition"
          : "incorrect"
        : data.outcome!;
      const assessed = choice
        ? q.item_ids
        : [...new Set(data.assessed_item_ids!)];
      if (assessed.some((id) => !q.item_ids.includes(id)))
        throw new Error("Assessment item is not part of this question.");
      if (q.answer !== undefined) {
        if (
          q.answer !== data.answer ||
          q.outcome !== outcome ||
          JSON.stringify(q.assessed_item_ids) !== JSON.stringify(assessed)
        )
          throw new Error("Question already answered differently.");
        return activityView(activity);
      }
      if (activity.questions.find((q) => q.answer === undefined)?.id !== q.id)
        throw new Error("Answer the current question first.");
      const now = this.clock();
      for (const id of assessed) {
        const item = this.repo.find(id);
        if (!item) throw new Error("Learning item not found.");
        this.repo.put(schedule(item, outcome, now));
        this.repo.addEvent({
          event_id: randomUUID(),
          item_id: id,
          outcome,
          context: `${activity.mode} (${activity.id}): ${choice ? q.options!.find((o) => o.id === data.answer)!.text : data.answer}`,
          created_at: now.toISOString(),
        });
      }
      q.answer = data.answer;
      q.outcome = outcome;
      q.assessed_item_ids = assessed;
      q.answered_at = now.toISOString();
      q.feedback = choice
        ? outcome === "incorrect"
          ? "Not quite."
          : "Correct."
        : data.feedback;
      this.repo.putDaily(state);
      return activityView(activity);
    });
  }
  healthy() {
    return this.repo.healthy();
  }
  review(id: string) {
    const item = this.repo.find(id);
    if (!item) throw new Error("Learning item not found.");
    return { item, history: this.repo.history(id) };
  }
  stats() {
    const items = this.repo.list();
    return {
      total: items.length,
      learned: items.filter((i) => i.status === "learned").length,
      due: this.due(Number.MAX_SAFE_INTEGER).length,
      successful_uses: items.reduce((s, i) => s + i.successful_uses, 0),
      failed_uses: items.reduce((s, i) => s + i.failed_uses, 0),
    };
  }
}
