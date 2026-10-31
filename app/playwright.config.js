import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:3101', channel: 'chrome', headless: true, viewport: { width: 1440, height: 1040 }, screenshot: 'only-on-failure' },
  webServer: { command: 'PORT=3101 node src/demo.js', url: 'http://127.0.0.1:3101', reuseExistingServer: false },
  reporter: 'list'
});
