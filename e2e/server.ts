import { createApp } from "../src/http.js";
import { LearningService } from "../src/service.js";
import { SnapshotRepository } from "../src/storage/snapshot.js";
createApp(new LearningService(new SnapshotRepository()), {
  allowedHosts: ["127.0.0.1:4318"],
}).listen(4318, "127.0.0.1");
