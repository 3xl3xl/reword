export class Api {
  token = "";
  async request(path, body, options = {}) {
    const response = await fetch(`/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error(
          "接続を確認してください。必要な場合は右上の「接続」から認証できます。",
        );
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.error || "接続できませんでした。もう一度お試しください。",
      );
    }
    return options.audio ? response.blob() : response.json();
  }
}
export const escape = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
