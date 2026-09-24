import { randomUUID } from "node:crypto";
import { z } from "zod";
export const lessonSchema = z.object({
  mode: z.enum(["personal", "hard"]).default("hard"),
  questions: z
    .array(
      z.object({
        prompt: z.string().trim().min(1).max(1000),
        blocks: z.array(z.string().trim().min(1).max(36)).min(2).max(40),
        item_ids: z.array(z.string().uuid()).min(1).max(5),
        topic: z.string().trim().max(80).default("Personal practice"),
      }),
    )
    .length(5),
});
export const sessionActionSchema = z.object({
  session_id: z.string().uuid(),
  question_id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  request_id: z.string().uuid(),
  action: z.enum(["draft", "check", "next"]),
  block_ids: z.array(z.string().uuid()).max(40).default([]),
});
export interface SentenceQuestion {
  id: string;
  prompt: string;
  topic: string;
  item_ids: string[];
  blocks: { id: string; text: string }[];
  expected: string[];
  draft: string[];
  attempts: number;
  correct: boolean;
}
export interface SentenceSession {
  id: string;
  mode: "personal" | "hard";
  created_at: string;
  revision: number;
  index: number;
  questions: SentenceQuestion[];
  last_request?: { id: string; payload: string };
}
export function makeSession(
  input: z.output<typeof lessonSchema>,
  now: Date,
): SentenceSession {
  return {
    id: randomUUID(),
    mode: input.mode,
    created_at: now.toISOString(),
    revision: 0,
    index: 0,
    questions: input.questions.map((q) => {
      const blocks = q.blocks.map((text) => ({ id: randomUUID(), text }));
      const expected = blocks.map((b) => b.id);
      // Shuffle once and persist so reloads never move the word bank.
      for (let i = blocks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!];
      }
      if (blocks.every((b, i) => b.id === expected[i]))
        blocks.push(blocks.shift()!);
      return {
        ...q,
        id: randomUUID(),
        blocks,
        expected,
        draft: [],
        attempts: 0,
        correct: false,
      };
    }),
  };
}
export const sentenceText = (q: SentenceQuestion, ids: string[]) =>
  ids.map((id) => q.blocks.find((b) => b.id === id)!.text).join(" ");
export function sentenceView(s?: SentenceSession) {
  if (!s) return null;
  const q = s.questions[s.index];
  return {
    session_id: s.id,
    revision: s.revision,
    mode: s.mode,
    total: 5,
    completed: !q,
    answered: s.questions.filter((q) => q.correct).length,
    first_try: s.questions.filter((q) => q.correct && q.attempts === 1).length,
    current: q
      ? {
          question_id: q.id,
          number: s.index + 1,
          prompt: q.prompt,
          topic: q.topic,
          item_ids: q.item_ids,
          blocks: q.blocks,
          selected: q.draft,
          attempts: q.attempts,
          correct: q.correct,
          sentence: q.correct ? sentenceText(q, q.expected) : undefined,
          hint:
            q.attempts >= 2 && !q.correct
              ? `Start with “${q.blocks.find((b) => b.id === q.expected[0])!.text}”.`
              : undefined,
        }
      : null,
  };
}
