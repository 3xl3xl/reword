import { z } from "zod";
export interface Quiz {
  id: string;
  slot: string;
  created_at: string;
  questions: {
    id: string;
    item_id: string;
    prompt: string;
    expected: string;
    answer?: string;
    outcome?: "prompted" | "incorrect";
    answered_at?: string;
  }[];
}
export const quizAnswerSchema = z.object({
  quiz_id: z.string().uuid(),
  question_id: z.string().uuid(),
  answer: z.string().trim().min(1).max(2000),
  outcome: z.enum(["prompted", "incorrect"]),
});
export function quizView(quiz: Quiz | undefined) {
  if (!quiz) return null;
  const index = quiz.questions.findIndex((q) => q.answer === undefined);
  return {
    quiz_id: quiz.id,
    slot: quiz.slot,
    total: quiz.questions.length,
    answered: quiz.questions.filter((q) => q.answer !== undefined).length,
    completed: index === -1,
    current:
      index === -1
        ? null
        : {
            question_id: quiz.questions[index]!.id,
            number: index + 1,
            prompt: quiz.questions[index]!.prompt,
            expected_answer_for_grading_only: quiz.questions[index]!.expected,
          },
    results: quiz.questions
      .filter((q) => q.answer !== undefined)
      .map((q) => ({
        question_id: q.id,
        answer: q.answer,
        outcome: q.outcome,
        expected: q.expected,
      })),
  };
}
export function quizSlot(now: Date) {
  const local = new Date(now.getTime() + 9 * 3600000);
  const hour = local.getUTCHours();
  if (hour < 8) local.setUTCDate(local.getUTCDate() - 1);
  return (
    local.toISOString().slice(0, 10) +
    (hour >= 8 && hour < 22 ? "T08:00+09:00" : "T22:00+09:00")
  );
}
