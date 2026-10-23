import {defineConfig} from '@playwright/test';
process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080';
export default defineConfig({testDir:'./tests',testMatch:'package-fixes.spec.ts',workers:1,timeout:45000,expect:{timeout:12000},reporter:'list',use:{baseURL:'http://127.0.0.1:5186',timezoneId:'Europe/Warsaw',locale:'pl-PL',launchOptions:{executablePath:'/usr/bin/chromium'},screenshot:'only-on-failure'},webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5186 --strictPort',url:'http://127.0.0.1:5186',reuseExistingServer:true,env:{VITE_USE_EMULATORS:'true',VITE_FIREBASE_PROJECT_ID:'demo-nasza-rodzina'}}});
