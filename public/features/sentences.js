import { escape as e } from "./api.js";
import { bindDrag } from "./drag.js";
export class SentenceWorkspace {
  queue = Promise.resolve();
  selected = [];
  busy = false;
  destroyed = false;
  constructor(root, api, audio, notify, onProgress) {
    Object.assign(this, { root, api, audio, notify, onProgress });
  }
  async load() {
    const session = await this.api.request("/sentences");
    if (this.destroyed) return;
    if (session) {
      this.session = session;
      this.selected = session.current?.selected || [];
      this.render();
    } else await this.setup();
  }
  async setup() {
    const lessons = await this.api.request("/lessons");
    if (this.destroyed) return;
    const draw = (mode) => {
      this.root.innerHTML = `<div class="page-heading"><p class="eyebrow">FROM KNOWING TO USING</p><h1>Make it <em>yours.</em></h1><p class="intro">知っている英語で、自分のことを話せるように。</p></div><div class="practice-card setup"><div class="card-top"><span class="tag">SENTENCE BLOCKS</span><span class="muted">5 questions · Your pace</span></div><h2>今日、話したいことから。</h2><p class="muted">収入、ヨーロッパ、Shopify、集中、自信。以下は選べる練習テーマです。あなたについての事実として保存しません。</p><div class="mode-switch"><button data-mode="personal" aria-pressed="${mode === "personal"}">Personal <small>基本の文</small></button><button data-mode="hard" aria-pressed="${mode === "hard"}">Hard <small>理由・条件まで</small></button></div><ol class="lesson-preview">${lessons[mode].map(([topic, prompt]) => `<li><span>${e(topic)}</span>${e(prompt)}</li>`).join("")}</ol><p class="fine">開始すると、この5つの英文をSaved Wordsに保存し、練習結果を同じ学習履歴に記録します。会話から用意した教材がある場合は、自動で続きから再開します。</p><button id="begin" class="primary full">この5文を保存して始める <span>↗</span></button></div>`;
      this.root
        .querySelectorAll("[data-mode]")
        .forEach((b) => (b.onclick = () => draw(b.dataset.mode)));
      this.root.querySelector("#begin").onclick = async (event) => {
        event.target.disabled = true;
        try {
          this.session = await this.api.request("/sentences/start", {
            mode,
            confirm_save: true,
          });
          this.selected = this.session.current?.selected || [];
          this.render();
          void this.onProgress();
        } catch (error) {
          this.notify(error.message);
          event.target.disabled = false;
        }
      };
    };
    draw("hard");
  }
  render() {
    if (this.destroyed) return;
    this.drag?.destroy();
    const s = this.session;
    if (s.completed) {
      this.root.innerHTML = `<div class="page-heading"><p class="eyebrow">A LITTLE MORE YOURS</p><h1>Keep the <em>words.</em></h1></div><div class="practice-card completion"><div class="complete-mark">✓</div><span class="tag">SESSION COMPLETE</span><h2>5つの文が、自分の言葉に。</h2><p>5 / 5 completed · ${s.first_try} first try</p><p class="muted">練習結果を学習履歴に保存しました。<br>次は、あなたの会話の中で使ってみてください。</p><button id="again" class="primary full">次の練習を選ぶ ↗</button></div>`;
      this.root.querySelector("#again").onclick = () =>
        this.setup().catch((err) => this.notify(err.message));
      return;
    }
    const q = s.current;
    this.root.innerHTML = `<div class="page-heading"><p class="eyebrow">WORDS YOU KNOW. THOUGHTS YOU OWN.</p><h1>Build your <em>English.</em></h1><p class="intro">単語をつなげて、あなたの言葉に。</p></div><article class="practice-card"><div class="card-top"><span class="tag">SENTENCE BLOCKS <span class="mode-label">${s.mode === "hard" ? "HARD" : "PERSONAL"}</span></span><span class="counter">${q.number} <span>/ 5</span></span></div><progress value="${q.number - 1}" max="5" aria-label="Session progress"></progress><div class="question"><p class="eyebrow">${e(q.topic)} <span> / 日本語を英語に</span></p><h2>${e(q.prompt)}</h2></div><div class="area-caption"><span>YOUR SENTENCE</span><span>タップで戻す・ドラッグで並べ替え</span></div><div class="answer-area" aria-label="Your sentence"></div><div class="area-caption bank-caption"><span>WORD BANK</span><span id="selection-count"></span></div><div class="word-bank"></div><p class="keyboard-hint">キーボード：Tabで選択 · Enterで追加／戻す · Alt＋← →で並べ替え</p><div class="feedback" aria-live="polite"></div><div class="actions sentence-actions"></div></article><p class="under-card"><span class="small-dot"></span> 保存した語彙と、同じ学習履歴につながっています。</p>`;
    this.area = this.root.querySelector(".answer-area");
    this.drawBlocks();
    this.drawFeedback();
    this.drag = bindDrag(this.area, {
      getIds: () => this.selected,
      canDrag: () => !q.correct && !this.busy,
      render: (ids, index) => this.drawAnswer(ids, index),
      commit: (ids) => {
        this.selected = ids;
        this.drawBlocks();
        this.saveDraft();
      },
    });
    this.area.onclick = (event) => {
      const b = event.target.closest("[data-answer]");
      if (!b || this.drag.suppressClick() || q.correct || this.busy) return;
      this.selected = this.selected.filter((id) => id !== b.dataset.answer);
      this.drawBlocks();
      this.saveDraft();
    };
    this.area.onkeydown = (event) => {
      const b = event.target.closest("[data-answer]");
      if (
        !b ||
        !event.altKey ||
        !["ArrowLeft", "ArrowRight"].includes(event.key) ||
        q.correct ||
        this.busy
      )
        return;
      event.preventDefault();
      const index = this.selected.indexOf(b.dataset.answer);
      const to = index + (event.key === "ArrowLeft" ? -1 : 1);
      if (to < 0 || to >= this.selected.length) return;
      [this.selected[index], this.selected[to]] = [
        this.selected[to],
        this.selected[index],
      ];
      this.drawBlocks();
      this.area.querySelector(`[data-answer="${b.dataset.answer}"]`).focus();
      this.saveDraft();
    };
    this.root.querySelector(".word-bank").onclick = (event) => {
      const b = event.target.closest("[data-bank]");
      if (!b || b.disabled || q.correct || this.busy) return;
      this.selected.push(b.dataset.bank);
      this.audio.tone();
      const block = q.blocks.find((block) => block.id === b.dataset.bank);
      void this.audio.speak("word", block.text, {
        session_id: s.session_id,
        question_id: q.question_id,
        block_id: block.id,
      });
      this.drawBlocks();
      this.saveDraft();
    };
  }
  drawAnswer(ids = this.selected, gap) {
    const q = this.session.current;
    const parts = ids.map((id) => {
      const block = q.blocks.find((b) => b.id === id);
      return `<button class="block answer-block" data-answer="${id}" ${q.correct || this.busy ? "disabled" : ""} aria-label="${e(block.text)}を戻す">${e(block.text)}</button>`;
    });
    if (gap !== undefined)
      parts.splice(
        gap,
        0,
        '<span class="drop-gap" aria-label="挿入位置"></span>',
      );
    this.area.innerHTML =
      parts.join("") ||
      '<span class="answer-placeholder">Tap the blocks below to build your sentence.</span>';
    this.area.classList.toggle("solved", q.correct);
  }
  drawBlocks() {
    this.drawAnswer();
    const q = this.session.current;
    this.root.querySelector(".word-bank").innerHTML = q.blocks
      .map(
        (b) =>
          `<button class="block bank-block ${this.selected.includes(b.id) ? "used" : ""}" data-bank="${b.id}" ${this.selected.includes(b.id) || q.correct || this.busy ? "disabled" : ""}><span>${e(b.text)}</span></button>`,
      )
      .join("");
    this.root.querySelector("#selection-count").textContent =
      `${this.selected.length} / ${q.blocks.length}`;
    const check = this.root.querySelector("#check");
    if (check)
      check.disabled = this.busy || this.selected.length !== q.blocks.length;
  }
  drawFeedback() {
    const q = this.session.current;
    this.root.querySelector(".feedback").innerHTML = q.correct
      ? `<div class="correct-feedback"><strong>✓ That’s your sentence.</strong><span>声に出して、もう一度。</span><button id="replay" class="quiet">↻ Listen again</button></div>`
      : q.attempts
        ? `<div class="wrong-feedback"><strong>Almost.</strong> Try changing the word order.${q.hint ? `<p>${e(q.hint)}</p>` : ""}</div>`
        : "";
    this.root.querySelector(".sentence-actions").innerHTML = q.correct
      ? `<button id="next" class="primary full">${q.number === 5 ? "Finish" : "Next"} <span>→</span></button>`
      : `<button id="reset" class="secondary">Reset</button><button id="check" class="primary" ${this.selected.length !== q.blocks.length || this.busy ? "disabled" : ""}>Check <span>↗</span></button>`;
    if (q.correct) {
      this.root.querySelector("#next").onclick = () => this.next();
      this.root.querySelector("#replay").onclick = () => this.playSentence();
    } else {
      this.root.querySelector("#reset").onclick = () => {
        if (!this.busy) {
          this.audio.cancel();
          this.selected = [];
          this.drawBlocks();
          this.saveDraft();
        }
      };
      this.root.querySelector("#check").onclick = () => this.check();
    }
  }
  send(action, ids) {
    this.queue = this.queue.then(async () => {
      const s = this.session;
      const body = {
        session_id: s.session_id,
        question_id: s.current.question_id,
        revision: s.revision,
        request_id: crypto.randomUUID(),
        action,
        block_ids: ids,
      };
      // A lost response is retried with exactly the same request ID, never a new learning event.
      let result;
      try {
        result = await this.api.request("/sentences/action", body);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        result = await this.api.request("/sentences/action", body);
      }
      this.session = result;
      return result;
    });
    return this.queue;
  }
  saveDraft() {
    void this.send("draft", [...this.selected]).catch((error) =>
      this.recover(error),
    );
  }
  async recover(error) {
    this.notify(error.message);
    this.queue = Promise.resolve();
    this.busy = false;
    try {
      await this.load();
    } catch {
      this.notify(
        "変更を保存できませんでした。接続を確認してページを再読み込みしてください。",
      );
    }
  }
  async check() {
    if (this.busy) return;
    this.busy = true;
    this.drawBlocks();
    try {
      await this.send("check", [...this.selected]);
      this.busy = false;
      this.render();
      this.audio.tone(this.session.current.correct);
      void this.onProgress();
      if (!this.destroyed && this.session.current.correct)
        await this.playSentence(true);
    } catch (error) {
      await this.recover(error);
    }
  }
  async playSentence(wait = false) {
    const s = this.session;
    const q = s.current;
    const next = this.root.querySelector("#next");
    if (wait && next) {
      next.hidden = true;
    }
    try {
      await this.audio.speak("sentence", q.sentence, {
        session_id: s.session_id,
        question_id: q.question_id,
      });
    } finally {
      if (next) next.hidden = false;
    }
  }
  async next() {
    if (this.busy) return;
    this.busy = true;
    this.audio.cancel();
    const next = this.root.querySelector("#next");
    if (next) next.disabled = true;
    try {
      await this.send("next", []);
      this.busy = false;
      this.selected = this.session.current?.selected || [];
      this.render();
      void this.onProgress();
    } catch (error) {
      await this.recover(error);
    }
  }
  destroy() {
    this.destroyed = true;
    this.drag?.destroy();
    this.audio.cancel();
  }
}
