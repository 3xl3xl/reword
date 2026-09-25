import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const result = await build({
  entryPoints: ["public/widget/app.js"],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2022",
  minify: true,
});
const css =
  (await readFile("public/style.css", "utf8")).replace(/@import[^;]+;/g, "") +
  (await readFile("public/widget/style.css", "utf8"));
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div class="widget-header"><span class="logo">RE:WORD</span><div><button id="home" class="quiet">今日のメニュー</button><button id="voice" class="quiet" aria-pressed="true">Voice ON</button></div></div><div id="notice" role="status" aria-live="polite"></div><section id="content" aria-label="今日の学習">保存した語彙を確認しています…</section><p class="fine">音声は端末による合成音声です。</p><script type="module">${result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
await mkdir("public/generated", { recursive: true });
await writeFile("public/generated/today.html", html);
console.log("Built self-contained ChatGPT learning widget.");
