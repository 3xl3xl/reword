import { test, expect } from "@playwright/test";
test("ChatGPT bridge displays five modes from live MCP, records a real option and sends a chosen topic to chat", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/test-host");
  const widget = page.frameLocator("iframe");
  await expect(widget.locator(".menu-card")).toHaveCount(5);
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
  await expect(widget.locator("#content")).toContainText("2 /");
  await widget.locator("#home").click();
  await expect(widget.locator('[data-mode="choice"]')).toContainText(
    "続きから",
  );
  await widget.locator('[data-mode="conversation"]').click();
  await widget.locator('input[name="topic"]').fill("海外で続けられる仕事");
  await widget.getByRole("button", { name: "このテーマで会話する →" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.stringify(
          (window as unknown as { sentMessages: unknown[] }).sentMessages,
        ),
      ),
    )
    .toContain("海外で続けられる仕事");
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
