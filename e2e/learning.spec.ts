import { test, expect } from "@playwright/test";
import { lessons } from "../src/features/sentence-blocks/lessons.js";

test.describe.configure({ mode: "serial" });
test("five real questions, stable slots, drag, resume, hints, audio, mastery and completion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const win = window as unknown as { spoken: string[] };
    win.spoken = [];
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        cancel() {},
        getVoices() {
          return [];
        },
        speak(u: SpeechSynthesisUtterance) {
          win.spoken.push(u.text);
          setTimeout(
            () => u.onend?.(new Event("end") as SpeechSynthesisEvent),
            20,
          );
        },
      },
    });
  });
  await page.goto("/learn/");
  await page.locator("#begin").click();
  await expect(page.locator(".counter")).toContainText("1 / 5");
  const first = lessons.hard[0]![2];
  const bank = page.locator(".word-bank .block");
  const original = await bank.evaluateAll((elements) =>
    elements.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: (el as HTMLElement).dataset.bank,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
    }),
  );
  await page
    .locator(".word-bank button")
    .filter({ hasText: /^I want$/ })
    .click();
  await expect(page.locator(".answer-area .block")).toHaveCount(1);
  const after = await bank.evaluateAll((elements) =>
    elements.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: (el as HTMLElement).dataset.bank,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
    }),
  );
  expect(after).toEqual(original);
  expect(
    await page.evaluate(
      () => (window as unknown as { spoken: string[] }).spoken,
    ),
  ).toContain("I want");
  await page.locator(".answer-area .block").click();
  await expect(page.locator(".word-bank .used")).toHaveCount(0);
  await page.locator("#voice").click();
  for (const text of first)
    await page
      .locator(".word-bank button")
      .filter({
        hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
      })
      .click();
  await expect(page.locator("#check")).toBeEnabled();
  const initialAnswer = await page
    .locator(".answer-area button")
    .allTextContents();
  const firstBox = (await page
    .locator(".answer-area button")
    .first()
    .boundingBox())!;
  const lastBox = (await page
    .locator(".answer-area button")
    .last()
    .boundingBox())!;
  await page.mouse.move(firstBox.x + 20, firstBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(lastBox.x + lastBox.width - 2, lastBox.y + 26, {
    steps: 15,
  });
  await expect(page.locator(".drop-gap")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".answer-area button").last()).toHaveText(
    first[0]!,
  );
  await page.locator(".answer-area button").last().focus();
  for (let i = 1; i < first.length; i++)
    await page.keyboard.press("Alt+ArrowLeft");
  expect(await page.locator(".answer-area button").allTextContents()).toEqual(
    initialAnswer,
  );
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/sentences")).json()).current
          .selected.length,
    )
    .toBe(first.length);
  await page.screenshot({
    path: "test-results/sentence-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".answer-area button")).toHaveCount(first.length);
  expect(await page.locator(".answer-area button").allTextContents()).toEqual(
    initialAnswer,
  );
  await page.locator("#check").click();
  await expect(page.locator("#next")).toBeVisible();
  await expect(page.locator("#reset")).toHaveCount(0);
  const next = (await page.locator("#next").boundingBox())!;
  const actions = (await page.locator(".sentence-actions").boundingBox())!;
  expect(next.width).toBe(actions.width);
  expect(
    await page.evaluate(
      () => (window as unknown as { spoken: string[] }).spoken,
    ),
  ).toContain(first.join(" "));
  await page.locator("#voice").click(); // silence remaining exercises
  await page.locator("#next").click();
  for (let index = 1; index < 5; index++) {
    await expect(page.locator(".counter")).toContainText(`${index + 1} / 5`);
    const sentence = lessons.hard[index]![2];
    if (index === 1) {
      for (const text of [...sentence].reverse())
        await page
          .locator(".word-bank button")
          .getByText(text, { exact: true })
          .click();
      await page.locator("#check").click();
      await expect(page.locator(".wrong-feedback")).toContainText("Almost.");
      await expect(page.locator(".wrong-feedback")).not.toContainText(
        "Start with",
      );
      await page.locator("#check").click();
      await expect(page.locator(".wrong-feedback")).toContainText("Start with");
      await page.locator("#reset").click();
    }
    for (const text of sentence)
      await page
        .locator(".word-bank button")
        .getByText(text, { exact: true })
        .click();
    await page.locator("#check").click();
    await expect(page.locator("#next")).toBeVisible();
    await page.locator("#next").click();
  }
  await expect(page.locator(".completion")).toContainText("5 / 5 completed");
  const stats = await (await page.request.get("/api/stats")).json();
  expect(stats.total).toBe(5);
  expect(stats.successful_uses).toBe(4);
  expect(stats.failed_uses).toBe(1);
  await page
    .getByRole("button", { name: "≡ Saved Words Your words, your context." })
    .click();
  await expect(page.locator(".word-card")).toHaveCount(5);
  await page.locator(".word-card").first().click();
  await expect(page.locator("#word-history")).toContainText("Sentence Blocks");
  expect(errors).toEqual([]);
});

test("mobile multi-row layout and keyboard/pointer order remain stable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/learn/");
  await page.locator("#again").click();
  await page.locator("#begin").click();
  await page.locator("#voice").click();
  for (const text of lessons.hard[0]![2])
    await page
      .locator(".word-bank button")
      .getByText(text, { exact: true })
      .click();
  const boxes = await page
    .locator(".answer-area button")
    .evaluateAll((elements) =>
      elements.map((el) => {
        const r = el.getBoundingClientRect();
        return { height: r.height, top: r.top };
      }),
    );
  expect(new Set(boxes.map((b) => b.height)).size).toBe(1);
  expect(boxes[0]!.height).toBe(54);
  expect(new Set(boxes.map((b) => b.top)).size).toBeGreaterThan(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/sentence-mobile.png",
    fullPage: true,
  });
  const first = (await page
    .locator(".answer-area button")
    .first()
    .boundingBox())!;
  const last = (await page
    .locator(".answer-area button")
    .last()
    .boundingBox())!;
  await page.mouse.move(first.x + 20, first.y + 20);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 2, last.y + 27, { steps: 15 });
  await expect(page.locator(".drop-gap")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".answer-area button").last()).toHaveText("I want");
});
