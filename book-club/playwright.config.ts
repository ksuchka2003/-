import { defineConfig, devices } from '@playwright/test';
const port = process.env.E2E_PORT || '5173';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    ...devices['iPhone 13'],
    defaultBrowserType: 'chromium',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  projects: [
    { name: 'mobile-chromium', testIgnore: 'account.spec.ts', use: { browserName: 'chromium' } },
    {
      name: 'account-chromium',
      testMatch: 'account.spec.ts',
      use: {
        browserName: 'chromium',
        baseURL: `http://127.0.0.1:${Number(port) + 1}`,
      },
    },
  ],
  globalSetup: './tests/e2e/server.ts',
  reporter: 'list',
});
