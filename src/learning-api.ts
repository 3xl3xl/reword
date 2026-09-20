import type { LearningService } from "./service.js";
type Method =
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
