import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:9199', channel: 'chromium', viewport: {width:360,height:640} },
  webServer: { command: 'node mock/server.mjs', url: 'http://127.0.0.1:9199', reuseExistingServer: !process.env.CI },
});
