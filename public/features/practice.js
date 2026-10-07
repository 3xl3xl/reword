import { escape as e } from "./api.js";
export class PracticeWorkspace {
  busy = false;
  destroyed = false;
  selected = null;
  constructor(root, api, audio, notify, onProgress = async () => {}) {
    Object.assign(this, { root, api, audio, notify, onProgress });
  }
  async load(mode) {
    this.mode = mode;
    const result = await this.api.request("/practice/start", { mode });
    if (!this.destroyed) this.show(result);
  }
  show(result) {
    if (this.destroyed) return;
    this.mode = result.mode;
    this.data = result.data;
    this.selected = null;
    this.render();
  }
  render() {
    if (this.destroyed) return;
    const d = this.data;
    const labels = {
      flashcard: "Flashcard",
      multiple_choice: "Multiple Choice",
      free_recall: "Free Recall",
    };
    if (!d) {
      this.root.innerHTML =
        '<div class="practice-card"><h2>今は復習できる教材がありません。</h2><p>会話で出会った表現を保存すると、次の復習につながります。</p></div>';
      return;
    }
    if (d.completed) {
      this.root.innerHTML = `<div class="practice-card completion"><span class="tag">${labels[this.mode]}</span><h2>今日の復習、完了。</h2><p>${d.answered} / ${d.total} · 同じ学習履歴に保存しました。</p><p>次は会話の中で使ってみてください。</p></div>`;
      return;
    }
    const q = d.current;
    let content;
    if (this.mode === "flashcard") {
      content = `<button id="flip" class="flashcard ${q.revealed ? "flipped" : ""}" aria-label="${q.revealed ? "カードの裏面" : "タップして意味を表示"}">${q.revealed ? `<strong>${e(q.back.meaning)}</strong><span>${e(q.back.example)}</span>${q.back.context ? `<small>${e(q.back.context)}</small>` : ""}` : `<strong>${e(q.front)}</strong><small>Tap to flip</small>`}</button><button id="pronounce" class="quiet">${e(q.front)} ♫</button>${q.revealed ? '<div class="actions"><button id="dont-know" class="secondary">Don’t know</button><button id="know" class="primary">Know</button></div>' : ""}`;
    } else if (this.mode === "multiple_choice") {
      content = `<h2>${e(q.prompt)}</h2>${q.front ? `<button id="pronounce" class="quiet">${e(q.front)} ♫</button>` : ""}<div class="choice-options">${q.options.map((o, i) => `<button class="choice-option" data-option="${o.id}" aria-pressed="false"><span>${"ABCD"[i]}</span>${e(o.text)}</button>`).join("")}</div><button id="practice-check" class="primary full" disabled>Check</button>`;
    } else {
      content = `<h2>${e(q.prompt)}</h2><form id="recall-form"><label>保存した英語<input name="answer" required maxlength="2000" autocomplete="off" autocapitalize="off" spellcheck="false"></label><button class="primary full">Check</button></form>`;
    }
    this.root.innerHTML = `<article class="practice-card"><div class="card-top"><span class="tag">${labels[this.mode]}</span><span>${q.number} / ${d.total}</span></div>${content}<div id="practice-feedback" aria-live="polite"></div></article>`;
    this.root
      .querySelector("#pronounce")
      ?.addEventListener(
        "click",
        () => void this.audio.speakLocal("word", q.front),
      );
    this.root.querySelector("#flip")?.addEventListener("click", () => {
      if (!q.revealed) {
        void this.audio.speakLocal("word", q.front);
        void this.send("reveal");
      }
    });
    this.root
      .querySelector("#know")
      ?.addEventListener("click", () => void this.send("answer", "know"));
    this.root
      .querySelector("#dont-know")
      ?.addEventListener("click", () => void this.send("answer", "dont_know"));
    this.root.querySelectorAll("[data-option]").forEach(
      (b) =>
        (b.onclick = () => {
          if (this.busy) return;
          this.selected = b.dataset.option;
          this.root.querySelectorAll("[data-option]").forEach((option) => {
            option.classList.toggle("selected", option === b);
            option.setAttribute("aria-pressed", String(option === b));
          });
          this.root.querySelector("#practice-check").disabled = false;
        }),
    );
    this.root
      .querySelector("#practice-check")
      ?.addEventListener(
        "click",
        () => void this.send("answer", this.selected),
      );
    this.root
      .querySelector("#recall-form")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        void this.send("answer", new FormData(event.target).get("answer"));
      });
  }
  async send(action, answer) {
    if (this.busy || this.destroyed) return;
    this.busy = true;
    const d = this.data;
    const q = d.current;
    this.root
      .querySelectorAll("button, input")
      .forEach((el) => (el.disabled = true));
    try {
      const result = await this.api.request("/practice/answer", {
        mode: this.mode,
        session_id: d.activity_id || d.quiz_id,
        question_id: q.question_id,
        action,
        ...(answer ? { answer } : {}),
      });
      if (this.destroyed) return;
      if (action === "reveal") {
        this.show(result);
        return;
      }
      void this.onProgress();
      const last = result.data.results.find(
        (r) => r.question_id === q.question_id,
      );
      const correct = last.outcome !== "incorrect";
      this.audio.tone(correct);
      this.root.querySelectorAll("[data-option]").forEach((el) => {
        el.classList.toggle(
          "correct-option",
          q.options.find((o) => o.id === el.dataset.option)?.text ===
            last.expected,
        );
        el.classList.toggle(
          "incorrect-option",
          el.dataset.option === answer && !correct,
        );
      });
      const expected = last.expected || q.back?.meaning;
      this.root.querySelector("#practice-feedback").innerHTML =
        `<div class="${correct ? "correct-feedback" : "wrong-feedback"}"><strong>${correct ? "✓ Correct" : this.mode === "flashcard" ? "また復習しましょう。" : "もう一度、意味を確認しましょう。"}</strong>${last.selected_text && this.mode === "multiple_choice" ? `<p>選んだ答え：${e(last.selected_text)}</p>` : ""}${expected ? `<p>正解：${e(expected)}</p>` : ""}${!correct && this.mode === "multiple_choice" ? `<p>${e(q.front || "この表現")} は、この意味で使います。</p>` : ""}${last.example ? `<button id="example-audio" class="quiet">${e(last.example)} ♫</button>` : ""}</div><button id="practice-next" class="primary full">${result.data.completed ? "Finish" : "Next"} →</button>`;
      this.root
        .querySelector("#example-audio")
        ?.addEventListener(
          "click",
          () => void this.audio.speakLocal("sentence", last.example),
        );
      this.root.querySelector("#practice-next").onclick = () => {
        this.audio.cancel();
        this.show(result);
      };
    } catch (error) {
      if (this.destroyed) return;
      this.notify(error.message);
      // Retrying the same answer is safe; a reload also resumes the server state.
      this.root
        .querySelectorAll("button, input")
        .forEach((el) => (el.disabled = false));
      if (this.mode === "multiple_choice" && !this.selected)
        this.root.querySelector("#practice-check").disabled = true;
    } finally {
      this.busy = false;
    }
  }
  destroy() {
    this.destroyed = true;
    this.audio.cancel();
  }
}
