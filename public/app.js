import { Api, escape as e } from "./features/api.js";
import { AudioController } from "./features/audio.js";
import { SentenceWorkspace } from "./features/sentences.js";
const api = new Api();
const root = document.querySelector("#content");
const notice = document.querySelector("#notice");
const notify = (text) => {
  notice.textContent = text;
  notice.hidden = !text;
};
const audio = new AudioController(api, notify);
let workspace,
  generation = 0,
  currentTab = "sentences";
async function stats() {
  const s = await api.request("/stats");
  document.querySelector("#stats").innerHTML =
    `<div><strong>${s.total}</strong><span>saved</span></div><div><strong>${s.due}</strong><span>due now</span></div><div><strong>${s.learned}</strong><span>learned</span></div>`;
}
async function refreshStats() {
  try {
    await stats();
  } catch (error) {
    notify(error.message);
  }
}
async function navigate(tab) {
  const version = ++generation;
  currentTab = tab;
  workspace?.destroy();
  workspace = undefined;
  audio.cancel();
  notify("");
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
    b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false");
  });
  root.innerHTML = '<p class="loading">Loading your learning space…</p>';
  try {
    if (tab === "sentences") {
      workspace = new SentenceWorkspace(root, api, audio, notify, refreshStats);
      await workspace.load();
    }
    if (tab === "words") await showWords(version);
    if (tab === "quiz") await showQuiz(version);
    const config = await api.request("/config");
    audio.remote = config.speech;
    document.querySelector("#data-source").textContent =
      config.data_source !== "connected_account"
        ? "開発用プレビュー — ChatGPT版RE:WORDの本番データではありません。"
        : "接続中のRE:WORDアカウントの学習データ";
    await refreshStats();
  } catch (error) {
    if (version !== generation) return;
    notify(error.message);
    root.innerHTML =
      '<div class="practice-card"><h2>学習履歴に接続する</h2><p>右上の「接続」を確認してから、もう一度お試しください。</p><button id="retry" class="primary">再試行</button></div>';
    root.querySelector("#retry").onclick = () => navigate(tab);
  }
}
async function showWords(version) {
  const words = await api.request("/words");
  if (version !== generation) return;
  root.innerHTML = `<div class="page-heading"><p class="eyebrow">YOUR CONVERSATION, COLLECTED</p><h1>Words with <em>meaning.</em></h1><p class="intro">覚えるだけでなく、使っていく言葉。</p></div><details class="practice-card save-panel"><summary>＋ 単語・表現・訂正を保存</summary><form id="save-form" class="save-form"><label>種類<select name="type"><option value="word">Word</option><option value="expression">Expression</option><option value="correction">Correction</option></select></label><label>English<input name="text" required maxlength="200"></label><label>意味・日本語<input name="meaning_ja" maxlength="2000" required></label><label>類語（カンマ区切り）<input name="synonyms" maxlength="2000"></label><label>自分の文脈に合う例文<textarea name="example" maxlength="2000"></textarea></label><label>会話の背景<textarea name="original_context" maxlength="4000"></textarea></label><label>訂正前の文（Correctionの場合）<input name="original_sentence" maxlength="2000"></label><label>訂正の種類<select name="category"><option value="">—</option>${["grammar", "vocabulary", "naturalness", "word choice", "sentence structure"].map((x) => `<option>${x}</option>`).join("")}</select></label><button class="primary">Save</button></form><div id="saved-result" aria-live="polite"></div></details><div id="word-list" class="word-list"></div><button id="more-words" class="secondary" ${words.length < 50 ? "hidden" : ""}>さらに表示</button><div id="word-history" aria-live="polite"></div>`;
  let count = words.length;
  const list = root.querySelector("#word-list");
  const append = (items) => {
    list.insertAdjacentHTML(
      "beforeend",
      items
        .map(
          (item) =>
            `<button class="word-card" data-item="${item.id}"><div><span class="tag">${item.type}</span><span class="muted">${item.mastery_score}% · ${item.status}</span></div><h2>${e(item.text)}</h2><p>${e(item.meaning_ja || item.meaning_en)}</p>${item.example ? `<p class="example">${e(item.example)}</p>` : ""}<div class="word-meter"><span style="width:${item.mastery_score}%"></span></div><p class="fine">${item.successful_uses} uses · 復習 ${e(new Date(item.next_review_at).toLocaleString())}</p></button>`,
        )
        .join(""),
    );
  };
  append(words);
  if (!words.length)
    list.innerHTML =
      '<p class="empty">会話で「save it」と伝えるか、ここで最初の言葉を保存しましょう。</p>';
  root.querySelector("#more-words").onclick = async (event) => {
    event.target.disabled = true;
    try {
      const items = await api.request(`/words?offset=${count}`);
      count += items.length;
      append(items);
      event.target.hidden = items.length < 50;
    } catch (error) {
      notify(error.message);
    } finally {
      event.target.disabled = false;
    }
  };
  list.onclick = async (event) => {
    const item = event.target.closest("[data-item]");
    if (!item) return;
    try {
      const result = await api.request(`/history?id=${item.dataset.item}`);
      if (version !== generation) return;
      root.querySelector("#word-history").innerHTML =
        `<div class="practice-card"><h2>${e(result.item.text)}</h2><h3>Learning history</h3>${result.history.length ? result.history.map((h) => `<div class="history-row"><span class="tag">${e(h.outcome)}</span><p>${e(h.context)}</p><small>${e(new Date(h.created_at).toLocaleString())}</small></div>`).join("") : "<p>まだ学習履歴はありません。</p>"}</div>`;
    } catch (error) {
      notify(error.message);
    }
  };
  root.querySelector("#save-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.target.querySelector("button");
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(event.target));
      data.synonyms = data.synonyms
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (data.type !== "correction") data.category = "";
      const item = await api.request("/words", data);
      root.querySelector("#saved-result").innerHTML =
        `<p><strong>Saved:</strong> ${e(item.text)}<br><strong>Meaning:</strong> ${e(item.meaning_ja || item.meaning_en)}<br><strong>類語:</strong> ${e((item.synonyms || []).join(", ") || "—")}<br><strong>Example:</strong> ${e(item.example || "—")}</p>`;
      event.target.reset();
      if (list.querySelector(".empty")) list.innerHTML = "";
      if (!list.querySelector(`[data-item="${item.id}"]`)) append([item]);
      await refreshStats();
    } catch (error) {
      notify(error.message);
    } finally {
      button.disabled = false;
    }
  };
}
async function showQuiz(version) {
  let quiz = await api.request("/quiz");
  if (version !== generation) return;
  let feedback = "";
  const draw = () => {
    if (version !== generation) return;
    root.innerHTML = `<div class="page-heading"><p class="eyebrow">A MOMENT TO REMEMBER</p><h1>Bring it <em>back.</em></h1><p class="intro">保存した言葉を、ひとつずつ思い出す。</p></div><div class="practice-card quiz-card"><div class="card-top"><span class="tag">DAILY QUIZ</span><span class="muted">08:00 / 22:00 · Tokyo</span></div><p class="quiz-feedback" aria-live="polite">${e(feedback)}</p>${quiz?.current ? `<p class="eyebrow">${quiz.current.number} / ${quiz.total}</p><h2>${e(quiz.current.prompt)}</h2><form id="answer-form"><label>Your answer<input id="quiz-answer" name="answer" required maxlength="2000" autocomplete="off"></label><button class="primary full">Answer →</button></form><p class="fine">この画面は保存された語句との一致で判定します。言い換えを含む会話練習はChatGPTで続けられます。</p>` : quiz?.completed ? `<h2>このクイズは完了しました。</h2><p>${quiz.results.filter((x) => x.outcome === "prompted").length} / ${quiz.total} correct</p><p class="muted">同じ時間帯の問題は再生成しません。次の時間帯に復習対象があれば、新しいクイズを開始できます。</p><button id="start-quiz" class="primary full">現在の復習対象を確認</button>` : `<h2>いま、思い出せるかな。</h2><p class="muted">保存した語彙から最大3問。未完了のクイズは続きから。</p><button id="start-quiz" class="primary full">Start quiz ↗</button>`}</div>`;
    const start = root.querySelector("#start-quiz");
    if (start)
      start.onclick = async () => {
        start.disabled = true;
        try {
          quiz = await api.request("/quiz/start", {});
          if (!quiz) feedback = "今回復習対象の単語はありません";
          draw();
        } catch (error) {
          notify(error.message);
          start.disabled = false;
        }
      };
    const form = root.querySelector("#answer-form");
    if (form)
      form.onsubmit = async (event) => {
        event.preventDefault();
        const button = form.querySelector("button");
        button.disabled = true;
        const answer = new FormData(form).get("answer");
        const id = quiz.current.question_id;
        const quizId = quiz.quiz_id;
        try {
          const fresh = await api.request("/quiz");
          if (fresh?.current?.question_id !== id) {
            quiz = fresh;
            feedback =
              "学習状態が更新されました。現在の問題を確認してください。";
            draw();
            return;
          }
          quiz = await api.request("/quiz/answer", {
            quiz_id: quizId,
            question_id: id,
            answer,
          });
          const result = quiz.results.find((x) => x.question_id === id);
          feedback =
            result.outcome === "prompted"
              ? `Correct. ${result.expected}`
              : `Not quite. The answer is ${result.expected}.`;
          draw();
          await refreshStats();
        } catch (error) {
          notify(error.message);
          button.disabled = false;
        }
      };
  };
  draw();
}
document
  .querySelectorAll("[data-tab]")
  .forEach((button) => (button.onclick = () => navigate(button.dataset.tab)));
document.querySelector("#voice").onclick = (event) => {
  audio.enabled = !audio.enabled;
  audio.cancel();
  event.target.textContent = `◖ Voice ${audio.enabled ? "ON" : "OFF"}`;
  event.target.setAttribute("aria-pressed", String(audio.enabled));
};
const auth = document.querySelector("#auth");
document.querySelector("#connection").onclick = () => auth.showModal();
document.querySelector("#close-auth").onclick = () => auth.close();
document.querySelector("#auth-form").onsubmit = (event) => {
  event.preventDefault();
  api.token = document.querySelector("#token").value.trim();
  document.querySelector("#token").value = "";
  auth.close();
  void navigate(currentTab);
};
document.querySelector("#disconnect").onclick = () => {
  api.token = "";
  auth.close();
  void navigate(currentTab);
};
void navigate("sentences");
