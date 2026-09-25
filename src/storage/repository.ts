import type { DailyState } from "../features/daily/domain.js";
import type { SentenceSession } from "../features/sentence-blocks/domain.js";
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
  getSentences(): SentenceSession | undefined;
  putSentences(session: SentenceSession): void;
  getDaily(): DailyState | undefined;
  putDaily(state: DailyState): void;
  getQuiz(): Quiz | undefined;
  putQuiz(quiz: Quiz): void;
  healthy(): boolean;
  close(): void;
}
