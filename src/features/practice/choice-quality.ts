import { normalize } from "../../domain.js";

// Display equivalence only: do not strip internal punctuation or negation,
// stem words, or pretend that lexical overlap establishes semantic equivalence.
export const meaningKey = (meaning: string) =>
  normalize(meaning.normalize("NFKC"))
    .replace(/[.!?。！？]+$/u, "")
    .trim();
