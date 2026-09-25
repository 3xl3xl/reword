import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Outcome } from "../../domain.js";
export const modes = [
  "flashcard",
  "free_recall",
  "choice",
  "sentences",
  "reading",
  "conversation",
  "writing",
] as const;
export const dailyMode = z.enum(modes);
export const activityMode = z.enum([
  "flashcard",
  "choice",
  "reading",
  "conversation",
  "writing",
]);
export const menu = [
  {
    id: "flashcard",
    title: "Flashcard",
    subtitle: "Recognize saved expressions",
    duration: "2-3 min",
    icon: "1",
  },
  {
    id: "choice",
    title: "Multiple Choice",
    subtitle: "Choose from four meanings",
    duration: "2-3 min",
    icon: "2",
  },
  {
    id: "sentences",
    title: "Sentence Blocks",
    subtitle: "Build a sentence with your words",
    duration: "5 min",
    icon: "3",
  },
  {
    id: "free_recall",
    title: "Free Recall",
    subtitle: "Recall the English without hints",
    duration: "3 min",
    icon: "4",
  },
] as const;
export function tokyoDay(date: Date) {
  return new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export interface ActivityQuestion {
  front?: string;
  back?: { meaning: string; example: string; context: string };
  revealed?: boolean;
  example?: string;
  id: string;
  prompt: string;
  item_ids: string[];
  options?: { id: string; text: string }[];
  expected?: string;
  // Free-form grading stays with ChatGPT; the service stores only actual user text plus assessment.
  answer?: string;
  outcome?: Outcome;
  feedback?: string;
  answered_at?: string;
  assessed_item_ids?: string[];
}
export interface Activity {
  id: string;
  mode: z.infer<typeof activityMode>;
  date: string;
  topic: string;
  passage?: string;
  created_at: string;
  questions: ActivityQuestion[];
}
export interface DailyState {
  activities: Partial<Record<z.infer<typeof activityMode>, Activity>>;
}
const nonempty = z.string().trim().min(1);
export const prepareActivitySchema = z
  .object({
    mode: z.enum(["reading", "conversation", "writing"]),
    topic: nonempty.max(200),
    passage: nonempty.max(8000).optional(),
    questions: z
      .array(
        z.object({
          prompt: nonempty.max(2000),
          item_ids: z.array(z.string().uuid()).min(1).max(5),
          options: z.array(nonempty.max(500)).length(4).optional(),
          correct_index: z.number().int().min(0).max(3).optional(),
        }),
      )
      .min(1)
      .max(5),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "reading" && !data.passage)
      ctx.addIssue({ code: "custom", message: "Reading requires a passage." });
    for (const q of data.questions) {
      if (
        data.mode === "reading" &&
        (!q.options ||
          q.correct_index === undefined ||
          new Set(q.options.map((s) => s.toLowerCase())).size !== 4)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Reading requires four distinct options and a correct index.",
        });
      if (
        data.mode !== "reading" &&
        (q.options || q.correct_index !== undefined)
      )
        ctx.addIssue({
          code: "custom",
          message: "Conversation and writing require free answers.",
        });
    }
  });
export const activityAnswerSchema = z.object({
  mode: activityMode,
  activity_id: z.string().uuid(),
  question_id: z.string().uuid(),
  answer: nonempty.max(4000),
  outcome: z.enum(["prompted", "recognition", "incorrect"]).optional(),
  feedback: z.string().trim().max(2000).optional(),
  assessed_item_ids: z.array(z.string().uuid()).max(5).optional(),
});
export function shuffle<T>(input: T[]): T[] {
  const output = [...input];
  for (let i = output.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [output[i], output[j]] = [output[j]!, output[i]!];
  }
  return output;
}
export function makeActivity(
  input: z.infer<typeof prepareActivitySchema>,
  date: Date,
): Activity {
  return {
    id: randomUUID(),
    mode: input.mode,
    topic: input.topic,
    passage: input.passage,
    date: tokyoDay(date),
    created_at: date.toISOString(),
    questions: input.questions.map((q) => {
      const options = q.options?.map((text) => ({ id: randomUUID(), text }));
      return {
        id: randomUUID(),
        prompt: q.prompt,
        item_ids: [...new Set(q.item_ids)],
        options: options ? shuffle(options) : undefined,
        expected: options?.[q.correct_index!]?.id,
      };
    }),
  };
}
export function activityView(activity?: Activity) {
  if (!activity) return null;
  const index = activity.questions.findIndex((q) => q.answer === undefined);
  const q = activity.questions[index];
  return {
    activity_id: activity.id,
    mode: activity.mode,
    date: activity.date,
    topic: activity.topic,
    passage: activity.passage,
    total: activity.questions.length,
    answered: activity.questions.filter((q) => q.answer !== undefined).length,
    completed: index === -1,
    current: q
      ? {
          question_id: q.id,
          number: index + 1,
          prompt: q.prompt,
          item_ids: q.item_ids,
          options: q.options,
          front: q.front,
          revealed: q.revealed,
          back: q.revealed ? q.back : undefined,
        }
      : null,
    results: activity.questions
      .filter((q) => q.answer !== undefined)
      .map((q) => ({
        question_id: q.id,
        answer: q.answer,
        selected_text:
          q.options?.find((o) => o.id === q.answer)?.text ?? q.answer,
        example: q.example ?? q.back?.example,
        front: q.front,
        back: q.back,
        outcome: q.outcome,
        feedback: q.feedback,
        expected: q.options?.find((o) => o.id === q.expected)?.text,
      })),
  };
}
