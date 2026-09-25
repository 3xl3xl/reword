import { z } from "zod";
import type { Item } from "../../domain.js";
export const practiceMode = z.enum([
  "flashcard",
  "multiple_choice",
  "sentence_blocks",
  "free_recall",
]);
export const startPracticeSchema = z.object({
  mode: practiceMode,
  generated_distractors: z
    .array(
      z.object({
        item_id: z.string().uuid(),
        meanings: z.array(z.string().trim().min(1).max(500)).max(3),
      }),
    )
    .max(5)
    .optional(),
});
export const answerPracticeSchema = z.object({
  mode: practiceMode,
  session_id: z.string().uuid(),
  question_id: z.string().uuid(),
  action: z
    .enum(["reveal", "answer", "draft", "check", "next"])
    .default("answer"),
  answer: z.string().trim().min(1).max(2000).optional(),
  revision: z.number().int().nonnegative().optional(),
  request_id: z.string().uuid().optional(),
  block_ids: z.array(z.string().uuid()).max(40).optional(),
});
// Suggestion only: all modes use the same item mastery and scheduling function.
export function recommendedMode(item: Item): z.infer<typeof practiceMode> {
  return item.mastery_score < 10
    ? "flashcard"
    : item.mastery_score < 35
      ? "multiple_choice"
      : item.mastery_score < 65
        ? "sentence_blocks"
        : "free_recall";
}
// Keep saved multiword expressions and common phrase units intact. No new vocabulary is saved.
export function chunkSentence(sentence: string, expression = ""): string[] {
  const words = sentence.trim().split(/\s+/);
  const clean = (s: string) =>
    s.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const phrases = [
    expression,
    "need to",
    "figure it out",
    "going out",
    "work around it",
    "my options",
    "before I decide",
    "have to",
    "want to",
    "going to",
  ]
    .filter((s) => s.trim().split(/\s+/).length > 1)
    .map((s) => s.trim().split(/\s+/).map(clean))
    .sort((a, b) => b.length - a.length);
  const chunks: string[] = [];
  let pending: string[] = [];
  const flush = () => {
    if (pending.length) chunks.push(pending.join(" "));
    pending = [];
  };
  for (let i = 0; i < words.length;) {
    const phrase = phrases.find((p) =>
      p.every((w, j) => clean(words[i + j] ?? "") === w),
    );
    if (phrase) {
      flush();
      chunks.push(words.slice(i, i + phrase.length).join(" "));
      i += phrase.length;
      continue;
    }
    const word = words[i]!;
    if (
      /^(before|after|because|although|when|while|if|with|without|in|on|at)$/i.test(
        clean(word),
      )
    )
      flush();
    pending.push(word);
    i++;
    if (
      pending.length >= 3 ||
      /[.!?,;:]$/.test(word) ||
      (pending.length === 1 && /^(I|you|he|she|we|they|it)$/i.test(word))
    )
      flush();
  }
  flush();
  return chunks;
}
export function assertExpressionChunks(blocks: string[], items: Item[]) {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const sentence = ` ${clean(blocks.join(" "))} `;
  for (const item of items) {
    if (item.type !== "expression" || !item.text.trim().includes(" ")) continue;
    const phrase = clean(item.text);
    if (
      sentence.includes(` ${phrase} `) &&
      !blocks.some((b) => ` ${clean(b)} `.includes(` ${phrase} `))
    )
      throw new Error("Keep the saved expression together in one block.");
  }
}
