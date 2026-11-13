import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the running dev stack (API :4000 + web :3000)
 * with seeded demo data. Set E2E_PASSWORD to the SEED_PASSWORD used for seeding.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // The specs share the same seeded demo accounts (employee@, manager@, hr@, admin@): running
  // files in parallel workers lets one test's preference or status change bleed into another.
  workers: 1,
  retries: 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
