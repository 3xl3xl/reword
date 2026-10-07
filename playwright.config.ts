import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:4318",
    viewport: { width: 1365, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --import tsx e2e/server.ts",
    url: "http://127.0.0.1:4318/health",
    reuseExistingServer: false,
  },
});
