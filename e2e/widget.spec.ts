import { test, expect } from "@playwright/test";
test("ChatGPT bridge displays four modes, explicit Check/Next, flashcard reveal and recall through live MCP", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/test-host");
  const widget = page.frameLocator("iframe");
  await expect(widget.locator(".menu-card")).toHaveCount(4);
  await expect(widget.locator(".today-heading")).toContainText("今日、何を");
  // Seed ONLY the isolated test backend through the real MCP save tools.
  await page.evaluate(async () => {
    const host = window as unknown as {
      callTestTool: (n: string, a: object) => Promise<unknown>;
      deliverTool: (n: string, a: object) => Promise<unknown>;
    };
    for (const [text, meaning_ja] of [
      ["intense", "強烈な"],
      ["scatter", "散らばる"],
      ["reliable", "頼りになる"],
      ["scarce", "不足した"],
      ["improvement", "改善"],
    ])
      await host.callTestTool("save_word", { text, meaning_ja });
    await host.deliverTool("start_today_learning", {});
  });
  await expect(widget.locator('[data-mode="choice"]')).toBeEnabled();
  await page.screenshot({
    path: "test-results/chatgpt-today.png",
    fullPage: true,
  });
  await widget.locator('[data-mode="choice"]').click();
  await expect(widget.locator(".choice-option")).toHaveCount(4);
  await widget.locator(".choice-option").first().click();
  await expect(widget.locator(".choice-option").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(widget.locator("#practice-next")).toHaveCount(0);
  await widget.locator("#practice-check").click();
  await expect(widget.locator("#practice-feedback")).toContainText("正解");
  const next = widget.locator("#practice-next");
  await expect(next).toBeVisible();
  const widths = await next.evaluate((el) => ({
    button: el.getBoundingClientRect().width,
    parent: el.parentElement!.getBoundingClientRect().width,
  }));
  expect(Math.abs(widths.button - widths.parent)).toBeLessThan(2);
  await next.click();
  await expect(widget.locator("#content")).toContainText("2 /");
  await widget.locator("#home").click();
  await expect(widget.locator('[data-mode="choice"]')).toContainText(
    "続きから",
  );
  await widget.locator('[data-mode="flashcard"]').click();
  await expect(widget.locator("#flip")).toContainText("Tap to flip");
  await expect(widget.locator("#know")).toHaveCount(0);
  await widget.locator("#flip").click();
  await expect(widget.locator("#know")).toBeVisible();
  await widget.locator("#know").click();
  await expect(widget.locator("#practice-next")).toBeVisible();
  await widget.locator("#practice-next").click();
  await expect(widget.locator("#flip")).toContainText("Tap to flip");
  await widget.locator("#flip").click();
  await widget.locator("#dont-know").click();
  await expect(widget.locator("#practice-next")).toBeVisible();
  await widget.locator("#home").click();
  await widget.locator('[data-mode="free_recall"]').click();
  await expect(widget.locator('input[name="answer"]')).toBeVisible();
  await widget.locator('input[name="answer"]').fill("test wrong answer");
  await widget.locator("#recall-form button").click();
  await expect(widget.locator("#practice-feedback")).toContainText("正解");
  const data = await page.evaluate(async () => {
    const host = window as unknown as {
      callTestTool: (
        n: string,
        a: object,
      ) => Promise<{
        structuredContent: {
          data: {
            stats: { total: number };
            menu: { id: string; answered: number }[];
          };
        };
      }>;
    };
    return (await host.callTestTool("start_today_learning", {}))
      .structuredContent.data;
  });
  expect(data.menu.find((m) => m.id === "choice")?.answered).toBe(1);
  expect(errors).toEqual([]);
});

test("long expression blocks wrap without clipping and retain drag targets on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/test-host?isolated=1");
  const phrase =
    "take all of the available possibilities into careful consideration";
  await page.evaluate(async (phrase) => {
    const host = window as unknown as {
      callTestTool: (
        name: string,
        args: object,
      ) => Promise<{ content: { text: string }[] }>;
      deliverTool: (name: string, args: object) => Promise<void>;
    };
    const saved = await host.callTestTool("save_expression", {
      text: phrase,
      meaning_en: "consider every option",
    });
    const item = JSON.parse(saved.content[0]!.text);
    await host.callTestTool("prepare_sentence_blocks", {
      questions: [
        {
          prompt: "Consider all possibilities",
          blocks: ["I need to", phrase, "before deciding."],
          item_ids: [item.id],
        },
      ],
    });
    await host.deliverTool("show_learning_activity", { mode: "sentences" });
  }, phrase);
  const widget = page.frameLocator("iframe");
  const long = widget.locator(".bank-block").filter({ hasText: phrase });
  await expect(long).toBeVisible();
  const size = await long.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    client: el.clientHeight,
    scroll: el.scrollHeight,
  }));
  expect(size.height).toBeGreaterThan(54);
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
  await long.click();
  await expect(widget.locator(".answer-block")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/long-block-mobile.png",
    fullPage: true,
  });
});
