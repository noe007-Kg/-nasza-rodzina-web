import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'family-home.spec.ts', workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5184', timezoneId: 'Europe/Warsaw', locale: 'pl-PL', browserName: 'chromium', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }, screenshot: 'only-on-failure' },
  reporter: 'list',
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5184 --strictPort', url: 'http://127.0.0.1:5184', reuseExistingServer: false, env: { VITE_USE_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: 'demo-nasza-rodzina' } },
});
