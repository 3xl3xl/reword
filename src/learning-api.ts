import type { LearningService } from "./service.js";
type Method =
  | "getSentences"
  | "prepareSentences"
  | "startStarterSentences"
  | "sentenceAction"
  | "getQuiz"
  | "startQuiz"
  | "answerQuiz"
  | "save"
  | "update"
  | "corrections"
  | "list"
  | "due"
  | "conversation"
  | "record"
  | "stats"
  | "review"
  | "healthy";
export type LearningApi = {
  [K in Method]: (
    ...args: Parameters<LearningService[K]>
  ) => ReturnType<LearningService[K]> | Promise<ReturnType<LearningService[K]>>;
};
