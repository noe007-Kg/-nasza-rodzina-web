import { defineConfig, devices } from '@playwright/test';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.2:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.2:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.2:9199';
export default defineConfig({
  testDir: './tests', testMatch: 'music-school-errors.spec.ts', workers: 1, timeout: 45000,
  reporter: 'list', use: { baseURL: 'http://127.0.0.1:5187', timezoneId: 'Europe/Warsaw', locale: 'pl-PL' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'webkit', use: { ...devices['Desktop Safari'] } }],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5187 --strictPort', url: 'http://127.0.0.1:5187', reuseExistingServer: false,
    env: { VITE_USE_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: 'demo-nasza-rodzina', VITE_EMULATOR_HOST: '127.0.0.2' } },
});
