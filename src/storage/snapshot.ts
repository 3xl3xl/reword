import type { Quiz } from "../quiz.js";
import type { Item, Usage } from "../domain.js";
import type { Repository } from "./repository.js";
export interface Snapshot {
  quiz?: Quiz;
  version: 1;
  items: Item[];
  events: Usage[];
}
export class SnapshotRepository implements Repository {
  private state: Snapshot;
  constructor(state: Snapshot = { version: 1, items: [], events: [] }) {
    if (state.version !== 1)
      throw new Error("Unsupported learning-state version");
    this.state = structuredClone(state);
  }
  snapshot() {
    return structuredClone(this.state);
  }
  transaction<T>(work: () => T): T {
    const before = this.snapshot();
    try {
      return work();
    } catch (error) {
      this.state = before;
      throw error;
    }
  }
  find(id: string) {
    return structuredClone(this.state.items.find((i) => i.id === id));
  }
  findNormalized(text: string, type: Item["type"]) {
    return structuredClone(
      this.state.items.find(
        (i) => i.normalized_text === text && i.type === type,
      ),
    );
  }
  list() {
    return structuredClone(this.state.items);
  }
  put(item: Item) {
    const duplicate = this.findNormalized(item.normalized_text, item.type);
    if (duplicate && duplicate.id !== item.id)
      throw new Error("Duplicate learning item");
    const index = this.state.items.findIndex((i) => i.id === item.id);
    if (index < 0) this.state.items.push(structuredClone(item));
    else this.state.items[index] = structuredClone(item);
  }
  event(id: string) {
    return structuredClone(this.state.events.find((e) => e.event_id === id));
  }
  addEvent(event: Usage) {
    if (!this.find(event.item_id) || this.event(event.event_id))
      throw new Error("Invalid usage event");
    this.state.events.push(structuredClone(event));
  }
  history(id: string) {
    return structuredClone(
      this.state.events
        .filter((e) => e.item_id === id)
        .slice(-100)
        .reverse(),
    );
  }
  getQuiz() {
    return structuredClone(this.state.quiz);
  }
  putQuiz(quiz: Quiz) {
    this.state.quiz = structuredClone(quiz);
  }
  healthy() {
    return true;
  }
  close() {}
}
