import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = (name) => resolve(__dirname, '..', 'fixtures', `${name}.png`);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).not.toBeEmpty();
});

test('version badge appears in History and matches the manifest version', async ({ page }) => {
  const manifestVersion = await page.evaluate(async () => {
    const res = await fetch('./manifest.webmanifest');
    return (await res.json()).version;
  });
  expect(manifestVersion).toMatch(/^\d+\.\d+\.\d+$/);

  await page.locator('#historyBtn').click();
  const badge = page.locator('#appVersion');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText(`v${manifestVersion}`);
});

test('tapping the version badge copies it and flashes green', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#historyBtn').click();

  const badge = page.locator('#appVersion');
  await badge.click();

  await expect(badge).toHaveClass(/version--copied/);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toMatch(/^QR Scanner v\d+\.\d+\.\d+$/);
});

test('copy action gives inline feedback on the button itself', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#result')).toBeVisible();

  // Locate by element type, not accessible name — the name mutates to
  // "Copied ✓" on click, which would make a name-based locator miss it.
  const copyBtn = page.locator('#resultActions button[type="button"]');
  await copyBtn.click();

  // Button morphs to "Copied ✓" with the ok style, then reverts.
  await expect(copyBtn).toHaveText(/Copied ✓/);
  await expect(copyBtn).toHaveClass(/btn--ok/);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('https://example.com/hello');
  await expect(copyBtn).toHaveText('Copy', { timeout: 3000 });
});
