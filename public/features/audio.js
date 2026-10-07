/** @interface SpeechProvider: speakWord(text, selection), speakSentence(text, selection), cancel() */
export class BrowserSpeechProvider {
  cancel() {
    window.speechSynthesis?.cancel();
    this.finish?.();
  }
  speakWord(text) {
    return this.speak(text, 0.85);
  }
  speakSentence(text) {
    return this.speak(text, 1);
  }
  speak(text, rate) {
    this.cancel();
    if (!window.speechSynthesis) return Promise.resolve();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = rate;
      const voices = speechSynthesis
        .getVoices()
        .filter((v) => /^en[-_]/i.test(v.lang));
      utterance.voice =
        voices.find((v) =>
          /Daniel|David|Alex|Aaron|James|Male/i.test(v.name),
        ) ||
        voices.find((v) => /enhanced|premium|natural/i.test(v.name)) ||
        voices[0] ||
        null;
      const timer = setTimeout(() => {
        speechSynthesis.cancel();
        finish();
      }, 15000);
      const finish = () => {
        clearTimeout(timer);
        this.finish = undefined;
        resolve();
      };
      this.finish = finish;
      utterance.onend = utterance.onerror = finish;
      speechSynthesis.speak(utterance);
    });
  }
}
export class OpenAISpeechProvider {
  constructor(api) {
    this.api = api;
  }
  cancel() {
    this.controller?.abort();
    this.audio?.pause();
    this.finish?.();
  }
  speakWord(text, selection) {
    return this.speak(text, { ...selection, kind: "word" });
  }
  speakSentence(text, selection) {
    return this.speak(text, { ...selection, kind: "sentence" });
  }
  async speak(_text, selection) {
    this.cancel();
    const controller = (this.controller = new AbortController());
    const timer = setTimeout(() => controller.abort(), 12000);
    let url;
    try {
      const blob = await this.api.request("/speech", selection, {
        audio: true,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      const audio = (this.audio = new Audio(url));
      await new Promise((resolve, reject) => {
        const finish = () => {
          this.finish = undefined;
          resolve();
        };
        this.finish = finish;
        audio.onended = finish;
        audio.onerror = reject;
        controller.signal.addEventListener("abort", finish, { once: true });
        audio.play().catch(reject);
      });
    } finally {
      clearTimeout(timer);
      if (controller.signal.aborted) this.audio?.pause();
      if (url) URL.revokeObjectURL(url);
    }
  }
}
export class AudioController {
  enabled = true;
  remote = false;
  sequence = 0;
  constructor(api, report) {
    this.browser = new BrowserSpeechProvider();
    this.openai = new OpenAISpeechProvider(api);
    this.report = report;
  }
  cancel() {
    this.sequence++;
    this.browser.cancel();
    this.openai.cancel();
  }
  async speak(kind, text, selection) {
    this.cancel();
    const sequence = this.sequence;
    if (!this.enabled) return;
    const method = kind === "word" ? "speakWord" : "speakSentence";
    if (this.remote) {
      try {
        await this.openai[method](text, selection);
        return;
      } catch {
        if (sequence !== this.sequence || !this.enabled) return;
        this.report("端末の音声で読み上げます。");
      }
    }
    if (sequence === this.sequence && this.enabled)
      await this.browser[method](text);
  }
  async speakLocal(kind, text) {
    this.cancel();
    if (!this.enabled) return;
    await this.browser[kind === "word" ? "speakWord" : "speakSentence"](text);
  }
  tone(correct) {
    if (!this.enabled) return;
    try {
      this.context ??= new (window.AudioContext || window.webkitAudioContext)();
      void this.context.resume();
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.frequency.value =
        correct === true ? 660 : correct === false ? 220 : 440;
      gain.gain.setValueAtTime(0.035, this.context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        this.context.currentTime + 0.1,
      );
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start();
      oscillator.stop(this.context.currentTime + 0.11);
    } catch {
      /* Sound is optional. */
    }
  }
}
