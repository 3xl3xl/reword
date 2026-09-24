export type Outcome =
  "exposure" | "recognition" | "prompted" | "independent" | "incorrect";
export interface Item {
  id: string;
  text: string;
  normalized_text: string;
  type: "word" | "expression" | "correction";
  synonyms?: string[];
  example?: string;
  meaning_en: string;
  meaning_ja: string;
  original_context: string;
  original_sentence: string;
  notes: string;
  category: string;
  mastery_score: number;
  successful_uses: number;
  failed_uses: number;
  interval_hours: number;
  status: "learning" | "learned";
  last_seen_at: string | null;
  last_used_at: string | null;
  next_review_at: string;
  created_at: string;
  updated_at: string;
}
export interface Usage {
  event_id: string;
  item_id: string;
  outcome: Outcome;
  context: string;
  created_at: string;
}
export const normalize = (text: string) =>
  text.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
export function schedule(item: Item, outcome: Outcome, now: Date): Item {
  const next = {
    ...item,
    updated_at: now.toISOString(),
    last_seen_at: now.toISOString(),
  };
  const gains = {
    exposure: 0,
    recognition: 3,
    prompted: 10,
    independent: 20,
    incorrect: -25,
  };
  next.mastery_score = Math.max(
    0,
    Math.min(100, item.mastery_score + gains[outcome]),
  );
  if (outcome === "independent" || outcome === "prompted") {
    next.successful_uses++;
    next.last_used_at = now.toISOString();
  }
  if (outcome === "incorrect") {
    next.failed_uses++;
    next.last_used_at = now.toISOString();
    next.interval_hours = Math.max(1, Math.min(6, item.interval_hours / 4));
  } else if (outcome === "independent") {
    next.interval_hours = Math.min(
      24 * 90,
      Math.max(24, item.interval_hours * 2.5),
    );
  } else if (outcome === "prompted") {
    next.interval_hours = Math.min(
      24 * 30,
      Math.max(12, item.interval_hours * 1.5),
    );
  } else if (outcome === "recognition") {
    next.interval_hours = Math.max(6, item.interval_hours);
  }
  // Exposure records a sighting without rewarding mastery or postponing an overdue review.
  if (outcome !== "exposure")
    next.next_review_at = new Date(
      now.getTime() + next.interval_hours * 3600000,
    ).toISOString();
  next.status =
    next.mastery_score >= 80 && next.successful_uses >= 5
      ? "learned"
      : "learning";
  return next;
}
