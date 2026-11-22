import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against a throw-away copy of the internal database (port 54329, folder
// local-db/.e2e-data, recreated with fresh dummy data on every run) and the app built with the
// "e2e" configuration (port 4300). Your own test data on port 54321 is never touched.
const baseURL = 'http://localhost:4300';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // tests share one database, run them in order
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Africa/Nairobi',
    locale: 'en-KE',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
  ],
  webServer: [
    {
      command: 'node ../local-db/server.mjs --reset',
      url: 'http://localhost:54329/console/meta',
      env: { LOCAL_DB_PORT: '54329', LOCAL_DB_DATA: '../local-db/.e2e-data' },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
    },
    {
      command: 'npx ng serve --configuration e2e --port 4300',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
