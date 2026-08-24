const { defineConfig } = require('playwright/test');
const fs = require('node:fs');
const path = require('node:path');

function loadLocalTestingEnv() {
  const envPath = path.resolve(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^(TESTING_NSEC|TESTING_MEMBER_NSEC)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim();
  }
}

loadLocalTestingEnv();

const port = process.env.PLAYWRIGHT_PORT || '4173';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const configuredBackendUrl = String(process.env.PLAYWRIGHT_TOWER_URL || '').trim();
const backendUrl = configuredBackendUrl || 'http://127.0.0.1:3100';

function isLoopbackUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid Playwright Tower URL: ${value}`);
  }
  return ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
}

if (!isLoopbackUrl(backendUrl)) {
  if (!configuredBackendUrl) {
    throw new Error('External Playwright Tower execution requires PLAYWRIGHT_TOWER_URL.');
  }
  if (process.env.PLAYWRIGHT_EXTERNAL_BACKEND_ACK !== backendUrl) {
    throw new Error(
      'External Playwright Tower execution requires PLAYWRIGHT_EXTERNAL_BACKEND_ACK to exactly match PLAYWRIGHT_TOWER_URL.',
    );
  }
}

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}),
    trace: 'retain-on-failure',
    video: process.env.PLAYWRIGHT_DISABLE_VIDEO === '1' ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: `bunx vite --host 127.0.0.1 --port ${port} --strictPort`,
    env: {
      ...process.env,
      VITE_DEFAULT_SUPERBASED_URL: backendUrl,
    },
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
