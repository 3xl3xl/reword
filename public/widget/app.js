import { PracticeWorkspace } from "../features/practice.js";
import { App } from "@modelcontextprotocol/ext-apps";
import { escape as e } from "../features/api.js";
import { AudioController } from "../features/audio.js";
import { SentenceWorkspace } from "../features/sentences.js";
const bridge = new App({ name: "RE:WORD Today", version: "0.2.0" }, {});
const root = document.querySelector("#content");
const notify = (text) => {
  document.querySelector("#notice").textContent = text;
};
let workspace;
function unpack(result) {
  if (result.isError)
    throw new Error(
      result.content?.find((c) => c.type === "text")?.text ||
        "接続できませんでした。",
    );
  return (
    result.structuredContent ||
    JSON.parse(result.content.find((c) => c.type === "text").text)
  );
}
async function call(name, args = {}) {
  return unpack(await bridge.callServerTool({ name, arguments: args }));
}
async function message(text) {
  const result = await bridge.sendMessage({
    role: "user",
    content: [{ type: "text", text }],
  });
  if (result.isError)
    throw new Error(
      "ChatGPTにメッセージを送れませんでした。チャット欄から続けてください。",
    );
}
const api = {
  async request(path, body) {
    if (path === "/practice/start")
      return (await call("start_practice", body)).data;
    if (path === "/practice/answer")
      return (await call("answer_practice", body)).data;
    if (path === "/sentences") return await call("get_sentence_blocks");
    if (path === "/sentences/action")
      return await call("answer_sentence_blocks", body);
    throw new Error("ChatGPTのメニューから教材を準備してください。");
  },
};
const audio = new AudioController(api, notify);
async function today() {
  render(await call("start_today_learning"));
}
function render(result) {
  workspace?.destroy();
  workspace = undefined;
  audio.cancel();
  notify("");
  if (result.view === "today") renderMenu(result.data);
  else if (result.view === "practice") {
    if (result.data.mode === "sentence_blocks")
      return render({ view: "sentences", data: result.data.data });
    workspace = new PracticeWorkspace(root, api, audio, notify);
    workspace.show(result.data);
  } else if (result.view === "sentences") {
    if (!result.data) {
      notify("並べ替えの教材をChatGPTで準備してください。");
      return;
    }
    workspace = new SentenceWorkspace(root, api, audio, notify, async () => {});
    workspace.session = result.data;
    workspace.selected = result.data.current?.selected || [];
    workspace.render();
    workspace.setup = async () => {
      await message(
        "RE:WORDの今日の学習メニューを表示してください。start_today_learningを呼んでください。",
      );
    };
  } else if (result.view === "activity") {
    if (result.data?.mode === "choice" || result.data?.mode === "flashcard") {
      workspace = new PracticeWorkspace(root, api, audio, notify);
      workspace.show({
        mode: result.data.mode === "choice" ? "multiple_choice" : "flashcard",
        data: result.data,
      });
    } else renderActivity(result.data);
  }
}
function renderMenu(data) {
  root.innerHTML = `<div class="today-heading"><p class="eyebrow">YOUR WORDS. YOUR DAILY PRACTICE.</p><h1>今日、何を<em>話そう。</em></h1><p class="muted">${e(data.date)} · 復習 ${data.stats.due}語 · 保存 ${data.stats.total}語</p></div><div class="today-menu">${data.menu.map((m) => `<button class="menu-card" data-mode="${m.id}" ${m.available ? "" : "disabled"}><span class="menu-icon">${m.icon}</span><span class="menu-copy"><strong>${m.title}</strong><small>${e(m.reason || m.subtitle)}</small><span class="menu-duration">${m.duration} ${m.status === "completed" ? "· 今日の分は完了 ✓" : m.status === "in_progress" ? `· 続きから ${m.answered}/${m.total}` : ""}</span></span><span>↗</span></button>`).join("")}</div><p class="fine">接続中のRE:WORDの保存語彙・学習履歴を使用します。結果も同じ場所に記録されます。</p><div id="topic-picker"></div>`;
  root.querySelectorAll("[data-mode]").forEach(
    (button) =>
      (button.onclick = async () => {
        button.disabled = true;
        const mode = button.dataset.mode;
        try {
          const practice = {
            flashcard: "flashcard",
            choice: "multiple_choice",
            sentences: "sentence_blocks",
            free_recall: "free_recall",
          }[mode];
          const result = await call("start_practice", { mode: practice });
          if (result.data.data) render(result);
          else if (mode === "choice" || mode === "sentences") {
            await askPrepare(mode);
            notify("ChatGPTで保存した表現を使って教材を準備します。");
          } else render(result);
        } catch (error) {
          notify(error.message);
        } finally {
          button.disabled = false;
        }
      }),
  );
}
async function askPrepare(mode, topic) {
  const labels = {
    choice: "4択クイズ",
    sentences: "並べ替え",
    reading: "長文読解",
    conversation: "テーマ会話",
    writing: "英作文",
  };
  if (mode === "choice")
    return message(
      "保存語の4択を準備してください。get_learning_material(mode=choice)で確認し、保存語だけでは不足する誤答候補に限り、正解と意味の重ならない選択肢を生成してstart_practice(mode=multiple_choice, generated_distractors)を呼んでください。新しいlearning itemは保存しないでください。",
    );
  await message(
    `RE:WORDの${labels[mode]}を始めたいです。${topic ? `テーマは「${topic}」です。` : ""}get_learning_materialで接続中の保存データを取得し、未完了なら再開してください。新規なら実際の保存語を使って${mode === "sentences" ? "prepare_sentence_blocksで5問" : "prepare_learning_activityで教材"}を準備し、show_learning_activityでChatGPT内に表示してください。サンプル語の追加や外部Webへの誘導は不要です。`,
  );
}
function renderActivity(data) {
  if (!data) {
    root.innerHTML =
      "<p>まだ教材がありません。今日のメニューから選んでください。</p>";
    return;
  }
  const labels = {
    choice: "4択クイズ",
    reading: "長文読解",
    conversation: "テーマ会話",
    writing: "英作文",
  };
  const last = data.results.at(-1);
  let exercise;
  if (data.completed) {
    exercise = `<div class="completion"><div class="complete-mark">✓</div><h2>今日の練習、完了。</h2><p>${data.answered} / ${data.total} · 結果を保存しました</p><button id="back-today" class="primary full">今日のメニューに戻る →</button></div>`;
  } else {
    const controls = data.current.options
      ? `<div class="choice-options">${data.current.options.map((o, i) => `<button class="choice-option" data-option="${o.id}"><span>${"ABCD"[i]}</span>${e(o.text)}</button>`).join("")}</div>`
      : '<p class="muted">下のChatGPTの入力欄から英語で答えてください。あなたの回答を確認して、短くフィードバックします。</p><button id="continue-chat" class="primary full">会話で答える →</button>';
    exercise = `<p class="muted">${data.current.number} / ${data.total}</p><h2>${e(data.current.prompt)}</h2>${controls}`;
  }
  root.innerHTML = `<p class="eyebrow">${e(labels[data.mode])} · ${e(data.date)}</p><h2>${e(data.topic)}</h2>${data.passage ? `<div class="reading-passage">${e(data.passage)}</div>` : ""}${last ? `<div class="feedback last-result">${e(last.feedback || "")}${last.outcome === "incorrect" && last.expected ? ` 正解：${e(last.expected)}` : ""}</div>` : ""}${exercise}`;

  root
    .querySelector("#back-today")
    ?.addEventListener("click", () =>
      today().catch((err) => notify(err.message)),
    );
  root
    .querySelector("#continue-chat")
    ?.addEventListener("click", () =>
      message(
        `RE:WORDの${labels[data.mode]}を続けます。get_learning_activityでmode=${data.mode}の最新状態を取得し、現在の質問を1問だけ出して私の回答を待ってください。`,
      ).catch((err) => notify(err.message)),
    );
  root.querySelectorAll("[data-option]").forEach(
    (button) =>
      (button.onclick = async () => {
        const buttons = [...root.querySelectorAll("[data-option]")];
        buttons.forEach((b) => (b.disabled = true));
        try {
          const fresh = (
            await call("get_learning_activity", { mode: data.mode })
          ).data;
          if (fresh?.current?.question_id !== data.current.question_id) {
            renderActivity(fresh);
            notify("学習状態を更新しました。");
            return;
          }
          const result = await call("answer_learning_activity", {
            mode: data.mode,
            activity_id: data.activity_id,
            question_id: data.current.question_id,
            answer: button.dataset.option,
          });
          render(result);
        } catch (error) {
          notify(error.message);
          buttons.forEach((b) => (b.disabled = false));
        }
      }),
  );
}
document.querySelector("#home").onclick = () =>
  today().catch((err) => notify(err.message));
document.querySelector("#voice").onclick = (event) => {
  audio.enabled = !audio.enabled;
  audio.cancel();
  event.target.textContent = `Voice ${audio.enabled ? "ON" : "OFF"}`;
  event.target.setAttribute("aria-pressed", String(audio.enabled));
};
bridge.ontoolresult = (result) => {
  try {
    render(unpack(result));
  } catch (error) {
    notify(error.message);
  }
};
bridge.onerror = (error) =>
  notify(error.message || "ChatGPTとの接続を確認してください。");
try {
  await bridge.connect();
} catch {
  notify("この学習画面はChatGPTのRE:WORD内で開いてください。");
}
