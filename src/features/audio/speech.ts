export interface SpeechProvider {
  synthesize(text: string, kind: "word" | "sentence"): Promise<Uint8Array>;
}
// Server-only. The API key is never returned to a browser.
export class OpenAISpeechProvider implements SpeechProvider {
  constructor(
    private apiKey: string,
    private voice = "cedar",
    private request: typeof fetch = fetch,
  ) {}
  async synthesize(text: string, kind: "word" | "sentence") {
    const response = await this.request(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: this.voice,
          input: text,
          response_format: "mp3",
          speed: kind === "word" ? 0.85 : 1,
          instructions:
            "Speak in a calm, natural, conversational native English voice. Articulate clearly without sounding robotic.",
        }),
      },
    );
    if (!response.ok) throw new Error("Speech unavailable");
    return new Uint8Array(await response.arrayBuffer());
  }
}
