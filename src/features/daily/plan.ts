import type { Item, Usage } from "../../domain.js";
import { tokyoDay } from "./domain.js";

type MenuEntry = {
  id: string;
  available: boolean;
  status: string;
  answered: number;
  total: number | null;
};

export function latestAssessment(history: Usage[]) {
  return history
    .filter((event) => event.outcome !== "exposure")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

// A small, transparent heuristic; this is not a proficiency diagnosis.
export function dailyPlan(
  items: Item[],
  history: (id: string) => Usage[],
  menu: MenuEntry[],
  now: Date,
) {
  const today = tokyoDay(now);
  const histories = new Map(items.map((item) => [item.id, history(item.id)]));
  const events = [...histories.values()].flat();
  const todayEvents = events.filter(
    (event) =>
      event.outcome !== "exposure" &&
      tokyoDay(new Date(event.created_at)) === today,
  );
  const count = (outcomes?: Usage["outcome"][]) =>
    new Set(
      todayEvents
        .filter((event) => !outcomes || outcomes.includes(event.outcome))
        .map((event) => event.item_id),
    ).size;
  const due = items.filter(
    (item) =>
      (item.meaning_ja || item.meaning_en) &&
      item.next_review_at <= now.toISOString(),
  );
  const latest = new Map(
    items.map((item) => [item.id, latestAssessment(histories.get(item.id)!)]),
  );
  const mistakes = due.filter(
    (item) => latest.get(item.id)?.outcome === "incorrect",
  );
  const resume = menu.find((entry) => entry.status === "in_progress");
  const ready = (id: string) =>
    menu.find(
      (entry) => entry.id === id && entry.available && entry.status === "ready",
    );
  const recognized = due.some(
    (item) => latest.get(item.id)?.outcome === "recognition",
  );
  const practiced = due.some((item) => item.successful_uses > 0);
  const preferred = mistakes.length
    ? ["sentences", "flashcard", "free_recall", "choice"]
    : recognized || practiced
      ? ["free_recall", "sentences", "flashcard", "choice"]
      : ["flashcard", "free_recall", "sentences", "choice"];
  const next = resume ?? preferred.map(ready).find(Boolean);
  const nextReview =
    items
      .filter(
        (item) =>
          (item.meaning_ja || item.meaning_en) &&
          item.next_review_at > now.toISOString(),
      )
      .map((item) => item.next_review_at)
      .sort()[0] ?? null;
  return {
    target: 5,
    reviewed: count(),
    recognized: count(["recognition"]),
    produced: count(["prompted", "independent"]),
    mistakes_due: mistakes.length,
    due: due.length,
    next_review_at: nextReview,
    next_mode: next?.id ?? null,
    reason: resume
      ? "途中の練習があります。続きから始めましょう。"
      : next && mistakes.length
        ? "前回つまずいた表現を、もう一度確かめましょう。"
        : next && (recognized || practiced)
          ? "意味がわかった表現を、今度は自分で思い出しましょう。"
          : next
            ? "まずは保存した表現の意味を思い出しましょう。"
            : due.length
              ? "この時間帯の練習は完了です。次の復習でまた確かめましょう。"
              : items.length
                ? "今は復習待ちです。次の復習時刻にまた練習しましょう。"
                : "会話で出会った表現を保存すると、今日の練習が始まります。",
  };
}
