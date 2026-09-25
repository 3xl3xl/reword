import type { LearningService } from "./service.js";
type Method =
  | "startPractice"
  | "getPractice"
  | "answerPractice"
  | "getSentences"
  | "prepareSentences"
  | "startStarterSentences"
  | "sentenceAction"
  | "todayLearning"
  | "learningMaterial"
  | "getActivity"
  | "startChoice"
  | "prepareActivity"
  | "answerActivity"
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
