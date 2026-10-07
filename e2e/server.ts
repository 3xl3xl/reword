import { readFileSync } from "node:fs";
import { createApp } from "../src/http.js";
import { LearningService } from "../src/service.js";
import { SnapshotRepository } from "../src/storage/snapshot.js";
const app = createApp(new LearningService(new SnapshotRepository()), {
  allowedHosts: ["127.0.0.1:4318"],
});
app.use(
  "/isolated",
  createApp(new LearningService(new SnapshotRepository()), {
    allowedHosts: ["127.0.0.1:4318"],
  }),
);
app.get("/test-host", (_req, res) =>
  res
    .type("html")
    .send(readFileSync(new URL("./host.html", import.meta.url), "utf8")),
);
app.get("/test-widget", (_req, res) =>
  res
    .type("html")
    .send(
      readFileSync(
        new URL("../public/generated/today.html", import.meta.url),
        "utf8",
      ),
    ),
);
app.listen(4318, "127.0.0.1");
