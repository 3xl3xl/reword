import type { Quiz } from "../quiz.js";
import type { Item, Usage } from "../domain.js";
export interface Repository {
  transaction<T>(work: () => T): T;
  find(id: string): Item | undefined;
  findNormalized(text: string, type: Item["type"]): Item | undefined;
  list(): Item[];
  put(item: Item): void;
  event(id: string): Usage | undefined;
  addEvent(event: Usage): void;
  history(id: string): Usage[];
  getQuiz(): Quiz | undefined;
  putQuiz(quiz: Quiz): void;
  healthy(): boolean;
  close(): void;
}
