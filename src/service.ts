import { randomUUID } from "node:crypto";
import { z } from "zod";
import { normalize, schedule, type Item } from "./domain.js";
import type { Repository } from "./storage/repository.js";
const text = z.string().trim().min(1).max(2000);
export const saveSchema = z.object({
  text: text.max(200),
  type: z.enum(["word", "expression", "correction"]),
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
    return this.repo.transaction(() => {
      const existing = this.repo.findNormalized(
        normalize(data.text),
        data.type,
      );
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
    });
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
