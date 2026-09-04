import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

// E2E for the React rewrite. Fixtures are generated QR images from the
// repo-level tests/fixtures (generate via `npm run test:fixtures` there).
const fixture = (name) => resolve(process.cwd(), '../tests/fixtures', `${name}.png`);

async function seedHistory(page, fixtures) {
  // Seed through the app itself (file scans) — direct IDB writes are blocked
  // in non-mobile contexts, and this exercises the real write path anyway.
  for (const f of fixtures) {
    await page.locator('input[type="file"]').setInputFiles(fixture(f));
    await page.waitForTimeout(250);
  }
}

test('app shell renders and camera degrades gracefully without camera', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'QR Scanner' })).toBeVisible();
  await expect(page.getByRole('status')).not.toBeEmpty();
});

test('history opens with seeded rows, day headers and version in menu', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(800);
  // wifi → today, url → via fixture (all today; day-header presence checked generically)
  await seedHistory(page, ['wifi', 'url', 'vcard']);

  // The last scan leaves its result card open (portal scrim blocks the page)
  // — dismiss it before opening History.
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.waitForTimeout(200);

  await page.locator('button[aria-label="Open scan history"]').click();

  // Day headers render.
  await expect(page.getByText('Today', { exact: true })).toBeVisible();

  // Titled rows: SSID for Wi-Fi; URL without saved title shows the domain
  // (truthful, unambiguous); vCard shows the contact name.
  await expect(page.getByText('MyNetwork')).toBeVisible();
  await expect(page.locator('.truncate', { hasText: 'example.com' })).toBeVisible();
  await expect(page.locator('.truncate', { hasText: 'Jane Doe' })).toBeVisible();

  // Version lives in the ⋯ menu.
  await page.locator('button[aria-label="History options"]').click();
  await expect(page.getByTestId('version')).toHaveText(/^v\d+\.\d+\.\d+$/);
  await expect(page.getByText('Save scans on this device')).toBeVisible();
});

test('scan an image file → result sheet with actions', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture('url'));

  const sheet = page.getByRole('dialog', { name: 'Scan result' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://example.com/hello');

  // Locate by exact text at click time; the accessible name mutates to
  // "Copied ✓" after the click, so re-resolve for the assertion instead.
  await sheet.locator('button', { hasText: /^Copy$/ }).click();
  await expect(sheet.locator('button', { hasText: /Copied ✓/ })).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('https://example.com/hello');
});

test('swipe left reveals Delete; deleting asks for confirmation', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(800);
  await seedHistory(page, ['url']);

  // Dismiss the result card left open by the seed scan.
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.waitForTimeout(200);

  await page.locator('button[aria-label="Open scan history"]').click();
  const row = page.locator('li .relative.z-10').first();
  await expect(row).toBeVisible();

  const box = await row.boundingBox();
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await row.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: x, clientY: y }], changedTouches: [{ identifier: 1, clientX: x, clientY: y }] });
  await row.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: x - 80, clientY: y }], changedTouches: [{ identifier: 1, clientX: x - 80, clientY: y }] });
  await row.dispatchEvent('touchend', { touches: [], changedTouches: [{ identifier: 1, clientX: x - 80, clientY: y }] });
  await page.waitForTimeout(300);

  // Delete affordance appears; tapping it asks for confirmation first.
  await page.locator('button[aria-label="Delete this scan"]').click();
  await expect(page.getByText('Delete this scan?')).toBeVisible();

  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await page.waitForTimeout(500);
  await expect(page.locator('li .relative.z-10')).toHaveCount(0);
});
