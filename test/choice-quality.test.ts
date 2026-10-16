import { test } from "node:test";
import assert from "node:assert/strict";
import { LearningService } from "../src/service.js";
import { SnapshotRepository } from "../src/storage/snapshot.js";
import { SqliteRepository } from "../src/storage/sqlite.js";
import { meaningKey } from "../src/features/practice/choice-quality.js";

// Human-labelled synthetic probes. residual-risk deliberately documents an
// unsafe accepted option, rather than claiming semantic validation succeeds.
const cases = [
  {
    name: "case/spacing",
    correct: "easy to trust",
    candidate: " EASY   TO TRUST ",
    accepted: false,
  },
  {
    name: "terminal punctuation",
    correct: "easy to trust",
    candidate: "easy to trust!",
    accepted: false,
  },
  {
    name: "Japanese punctuation",
    correct: "頼りになる",
    candidate: "頼りになる。",
    accepted: false,
  },
  {
    name: "Unicode width",
    correct: "easy to trust",
    candidate: "ｅａｓｙ ｔｏ ｔｒｕｓｔ！",
    accepted: false,
  },
  {
    name: "explicit forward synonym",
    correct: "easy to trust",
    candidate: "dependable",
    synonym: "forward",
    accepted: false,
  },
  {
    name: "explicit reverse synonym",
    correct: "easy to trust",
    candidate: "dependable",
    synonym: "reverse",
    accepted: false,
  },
  {
    name: "residual-risk: near synonym",
    correct: "easy to trust",
    candidate: "dependable",
    accepted: true,
  },
  {
    name: "residual-risk: paraphrase",
    correct: "easy to trust",
    candidate: "someone you can count on",
    accepted: true,
  },
  {
    name: "residual-risk: Japanese paraphrase",
    correct: "頼りになる",
    candidate: "信頼できる",
    accepted: true,
  },
  {
    name: "negation must survive",
    correct: "easy to trust",
    candidate: "not easy to trust",
    accepted: true,
  },
  {
    name: "related but distinct",
    correct: "easy to trust",
    candidate: "easy to understand",
    accepted: true,
  },
] as const;

for (const probe of cases) {
  for (const source of ["saved", "generated"] as const) {
    test(`choice evaluation: ${probe.name} (${source})`, () => {
      const repo = new SnapshotRepository();
      const service = new LearningService(repo);
      const synonym = "synonym" in probe ? probe.synonym : undefined;
      const target = service.save({
        type: "word",
        text: "reliable",
        meaning_en: probe.correct,
        synonyms: synonym === "forward" ? ["dependable"] : [],
        original_context: "trust",
      });
      if (source === "saved" || synonym)
        service.save({
          type: "word",
          text: "dependable",
          meaning_en: probe.candidate,
          synonyms: synonym === "reverse" ? ["reliable"] : [],
          original_context: "trust",
        });
      if (source === "saved") {
        for (const [text, meaning_en] of [
          ["depart", "leave a place"],
          ["purchase", "buy an object"],
          ["rest", "stop working"],
        ])
          service.save({ type: "word", text: text!, meaning_en: meaning_en! });
      }
      service.startChoice([
        {
          item_id: target.id,
          meanings: [
            probe.candidate,
            "leave a place",
            "buy an object",
            "stop working",
          ],
        },
      ]);
      const q = repo
        .getDaily()!
        .activities.choice!.questions.find((q) => q.item_ids[0] === target.id)!;
      assert.ok(q);
      assert.equal(q.options!.length, 4);
      assert.equal(new Set(q.options!.map((o) => meaningKey(o.text))).size, 4);
      assert.equal(q.options!.filter((o) => o.id === q.expected).length, 1);
      assert.equal(
        q.options!.some(
          (o) => o.id !== q.expected && o.text === probe.candidate,
        ),
        probe.accepted,
      );
    });
  }
}

test("fallback deduplicates itself and saved options; insufficient valid options leave no session and can retry", () => {
  const repo = new SnapshotRepository();
  const service = new LearningService(repo);
  const target = service.save({
    type: "word",
    text: "reliable",
    meaning_en: "easy to trust",
  });
  const before = repo.snapshot();
  assert.equal(
    service.startChoice([
      {
        item_id: target.id,
        meanings: ["easy to trust!", "leave", "leave!", "!!!"],
      },
    ]),
    null,
  );
  assert.deepEqual(repo.snapshot(), before);
  service.save({ type: "word", text: "depart", meaning_en: "leave" });
  service.startChoice([
    { item_id: target.id, meanings: ["leave!", "buy", "buy!", "rest"] },
  ]);
  const q = repo.getDaily()!.activities.choice!.questions[0]!;
  assert.deepEqual(
    q.options!.map((o) => o.text).sort(),
    ["easy to trust", "leave", "buy", "rest"].sort(),
  );
  assert.equal(service.stats().total, 2);
});

test("filtered choices persist, resume without regeneration and record duplicate answers once", () => {
  const repo = new SqliteRepository(":memory:");
  try {
    const service = new LearningService(repo);
    const target = service.save({
      type: "word",
      text: "reliable",
      meaning_en: "easy to trust",
    });
    const view = service.startChoice([
      {
        item_id: target.id,
        meanings: ["easy to trust!", "leave", "buy", "rest"],
      },
    ])!;
    const resumed = new LearningService(repo);
    assert.deepEqual(
      resumed.startChoice([{ item_id: target.id, meanings: ["different"] }]),
      view,
    );
    assert.equal(JSON.stringify(view).includes('"expected"'), false);
    const q = repo.getDaily()!.activities.choice!.questions[0]!;
    const input = {
      mode: "choice" as const,
      activity_id: view.activity_id,
      question_id: q.id,
      answer: q.expected!,
    };
    const answer = resumed.answerActivity(input);
    assert.deepEqual(resumed.answerActivity(input), answer);
    assert.equal(resumed.review(target.id).history.length, 1);
    assert.throws(
      () =>
        resumed.answerActivity({
          ...input,
          answer: q.options!.find((o) => o.id !== q.expected)!.id,
        }),
      /differently/,
    );
  } finally {
    repo.close();
  }
});
