import { Router } from "express";
import { z } from "zod";
import type { LearningApi } from "./learning-api.js";
import { normalize } from "./domain.js";
import { saveSchema } from "./service.js";
import { lessons } from "./features/sentence-blocks/lessons.js";
import type { SpeechProvider } from "./features/audio/speech.js";
const modeSchema = z.object({
  mode: z.enum(["personal", "hard"]),
  confirm_save: z.literal(true),
});
const browserAnswer = z.object({
  quiz_id: z.string().uuid(),
  question_id: z.string().uuid(),
  answer: z.string().trim().min(1).max(2000),
});
function publicQuiz(quiz: Awaited<ReturnType<LearningApi["getQuiz"]>>) {
  if (!quiz) return null;
  const { current, ...rest } = quiz;
  return {
    ...rest,
    current: current
      ? {
          question_id: current.question_id,
          number: current.number,
          prompt: current.prompt,
        }
      : null,
  };
}
export function learningRouter(
  select: (owner?: string) => LearningApi,
  speech?: SpeechProvider,
) {
  const router = Router();
  // Bounded per-owner speech budget; no client-supplied arbitrary TTS text.
  const budgets = new Map<string, { start: number; count: number }>();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/config", (_req, res) => res.json({ speech: Boolean(speech) }));
  router.get("/lessons", (_req, res) => res.json(lessons));
  router.use(async (req, res, next) => {
    const owner = req.auth?.extra?.owner;
    const service = select(typeof owner === "string" ? owner : undefined);
    try {
      if (req.method === "GET") {
        if (req.path === "/words") {
          const offset = z.coerce
            .number()
            .int()
            .min(0)
            .parse(req.query.offset ?? 0);
          res.json(await service.list(50, offset));
          return;
        }
        if (req.path === "/stats") {
          res.json(await service.stats());
          return;
        }
        if (req.path === "/history") {
          res.json(await service.review(z.string().uuid().parse(req.query.id)));
          return;
        }
        if (req.path === "/sentences") {
          res.json(await service.getSentences());
          return;
        }
        if (req.path === "/quiz") {
          res.json(publicQuiz(await service.getQuiz()));
          return;
        }
      }
      if (req.method !== "POST") {
        next();
        return;
      }
      if (req.path === "/words") {
        res.json(await service.save(saveSchema.parse(req.body)));
        return;
      }
      if (req.path === "/sentences/start") {
        const data = modeSchema.parse(req.body);
        res.json(await service.startStarterSentences(data.mode));
        return;
      }
      if (req.path === "/sentences/action") {
        res.json(await service.sentenceAction(req.body));
        return;
      }
      if (req.path === "/quiz/start") {
        res.json(publicQuiz(await service.startQuiz()));
        return;
      }
      if (req.path === "/quiz/answer") {
        const data = browserAnswer.parse(req.body);
        const quiz = await service.getQuiz();
        if (!quiz || quiz.quiz_id !== data.quiz_id)
          throw new Error("Quiz changed. Reload to continue.");
        const previous = quiz.results.find(
          (q) => q.question_id === data.question_id,
        );
        if (previous) {
          if (previous.answer !== data.answer)
            throw new Error("Question already answered differently.");
          res.json(publicQuiz(quiz));
          return;
        }
        if (quiz.current?.question_id !== data.question_id)
          throw new Error("Quiz changed. Reload to continue.");
        const clean = (s: string) => normalize(s).replace(/[.!?]+$/, "");
        const correct =
          clean(data.answer) ===
          clean(quiz.current.expected_answer_for_grading_only);
        res.json(
          publicQuiz(
            await service.answerQuiz({
              ...data,
              outcome: correct ? "prompted" : "incorrect",
            }),
          ),
        );
        return;
      }
      if (req.path === "/speech") {
        if (!speech) {
          res.status(503).json({ error: "Device voice will be used." });
          return;
        }
        const input = z
          .object({
            session_id: z.string().uuid(),
            question_id: z.string().uuid(),
            block_id: z.string().uuid().optional(),
            kind: z.enum(["word", "sentence"]),
          })
          .parse(req.body);
        const session = await service.getSentences();
        const q = session?.current;
        if (
          !q ||
          session?.session_id !== input.session_id ||
          q.question_id !== input.question_id
        )
          throw new Error("Sentence changed.");
        const text =
          input.kind === "word"
            ? q.blocks.find((b) => b.id === input.block_id)?.text
            : q.sentence;
        if (!text)
          throw new Error("Speech is not available for this selection.");
        const key = typeof owner === "string" ? owner : "local";
        const now = Date.now();
        for (const [id, value] of budgets)
          if (now - value.start >= 60000) budgets.delete(id);
        const budget = budgets.get(key) ?? { start: now, count: 0 };
        if (budget.count >= 60 || (!budgets.has(key) && budgets.size >= 1000)) {
          res
            .status(429)
            .json({ error: "Speech limit reached. Use device voice." });
          return;
        }
        budget.count++;
        budgets.set(key, budget);
        try {
          res
            .type("audio/mpeg")
            .send(Buffer.from(await speech.synthesize(text, input.kind)));
        } catch {
          res
            .status(503)
            .json({ error: "Speech unavailable. Use device voice." });
        }
        return;
      }
      next();
    } catch (error) {
      res.status(error instanceof z.ZodError ? 400 : 409).json({
        error:
          error instanceof z.ZodError
            ? "Invalid request."
            : error instanceof Error
              ? error.message
              : "Request failed.",
      });
    }
  });
  return router;
}
