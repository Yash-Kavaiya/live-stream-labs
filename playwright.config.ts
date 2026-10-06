import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    // Installed Chrome, with a synthetic camera and microphone and no permission prompts.
    channel: 'chrome',
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/dev.mjs',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
    env: { NO_WATCH: '1' },
  },
});
