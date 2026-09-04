import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = (name) => resolve(__dirname, '..', 'fixtures', `${name}.png`);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).not.toBeEmpty();
});

test('scanning saves to history and shows the count badge', async ({ page }) => {
  await expect(page.locator('#historyCount')).toBeHidden();

  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#result')).toBeVisible();

  await expect(page.locator('#historyCount')).toBeVisible();
  await expect(page.locator('#historyCount')).toHaveText('1');
});

test('multiple distinct scans increment the badge', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await page.locator('#fileInput').setInputFiles(fixture('plain'));
  await page.locator('#fileInput').setInputFiles(fixture('wifi'));

  await expect(page.locator('#historyCount')).toHaveText('3');
});

test('identical scans within the dedupe window are not duplicated', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await page.locator('#fileInput').setInputFiles(fixture('url'));

  await expect(page.locator('#historyCount')).toHaveText('1');
});

test('history view lists saved scans with type badge and timestamp', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('wifi'));
  await expect(page.locator('#historyCount')).toHaveText('1');

  await page.locator('#historyBtn').click();
  await expect(page.locator('#historyView')).toBeVisible();

  const item = page.locator('.prow').first();
  await expect(item.locator('.prow__sub')).toHaveText('Wi-Fi');
  await expect(item.locator('.prow__title')).toContainText('MyNetwork');
  await expect(item.locator('.prow__time')).not.toBeEmpty();
});

test('history rows no longer render inline action buttons', async ({ page }) => {
  // Rows are compact now (icon + title + time); actions live in the result
  // card when the row is tapped, not inline in the list.
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#historyCount')).toHaveText('1');

  await page.locator('#historyBtn').click();
  await expect(page.locator('.prow')).toHaveCount(1);
  await expect(page.locator('.prow button.btn')).toHaveCount(0);
  await expect(page.locator('.prow .prow__title')).toHaveText(/example\.com/);
});

test('search filters the history list', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await page.locator('#fileInput').setInputFiles(fixture('plain'));
  await expect(page.locator('#historyCount')).toHaveText('2');

  await page.locator('#historyBtn').click();
  await expect(page.locator('.prow')).toHaveCount(2);

  await page.locator('#historySearch').fill('example.com');
  await expect(page.locator('.prow')).toHaveCount(1);
  await expect(page.locator('.prow__title').first()).toContainText('example.com');

  await page.locator('#historySearch').fill('no-match-query');
  await expect(page.locator('.prow')).toHaveCount(0);
  await expect(page.locator('#historyEmpty')).toBeVisible();
});

test('type filter narrows the list', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await page.locator('#fileInput').setInputFiles(fixture('plain'));
  await expect(page.locator('#historyCount')).toHaveText('2');

  await page.locator('#historyBtn').click();
  await expect(page.locator('.prow')).toHaveCount(2);

  await page.locator('#historyFilter').selectOption('text');
  await expect(page.locator('.prow')).toHaveCount(1);
});

test('tapping an item re-displays the result and closes history', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('wifi'));
  await expect(page.locator('#historyCount')).toHaveText('1');

  await page.locator('#historyBtn').click();
  await page.locator('.prow__title').first().click();

  await expect(page.locator('#historyView')).toBeHidden();
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#resultLabel')).toHaveText(/Wi-Fi/i);
});

test('re-displaying a history item does not create a duplicate', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#historyCount')).toHaveText('1');

  await page.locator('#historyBtn').click();
  await expect(page.locator('.prow')).toHaveCount(1);

  await page.locator('.prow__title').first().click();
  await expect(page.locator('#result')).toBeVisible();

  // Re-opening history must still show a single entry — re-viewing must not persist again.
  await page.locator('#historyBtn').click();
  await expect(page.locator('.prow')).toHaveCount(1);
  await expect(page.locator('#historyCount')).toHaveText('1');
});

test('swiping a row left deletes it', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await page.locator('#fileInput').setInputFiles(fixture('plain'));
  await expect(page.locator('#historyCount')).toHaveText('2');

  await page.locator('#historyBtn').click();
  await expect(page.locator('.prow')).toHaveCount(2);

  // Simulate a left swipe past the delete threshold on the first row.
  const row = page.locator('.prow').first();
  const box = await row.boundingBox();
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;

  await row.dispatchEvent('touchstart', {
    touches: [{ identifier: 1, clientX: x, clientY: y }],
    changedTouches: [{ identifier: 1, clientX: x, clientY: y }],
  });
  await row.dispatchEvent('touchmove', {
    touches: [{ identifier: 1, clientX: x - 90, clientY: y }],
    changedTouches: [{ identifier: 1, clientX: x - 90, clientY: y }],
  });
  await row.dispatchEvent('touchend', {
    touches: [],
    changedTouches: [{ identifier: 1, clientX: x - 90, clientY: y }],
  });

  await expect(page.locator('.prow')).toHaveCount(1);
  await expect(page.locator('#historyCount')).toHaveText('1');
  await expect(page.locator('#status')).toContainText(/Deleted/i);
});

test('Clear all empties history after confirmation', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('url'));

  await page.locator('#historyBtn').click();
  page.on('dialog', (d) => d.accept());
  await page.locator('#historyClear').click();

  await expect(page.locator('.prow')).toHaveCount(0);
  await expect(page.locator('#historyEmpty')).toBeVisible();
  await expect(page.locator('#historyCount')).toBeHidden();
});

test('disabling history stops saving new scans', async ({ page }) => {
  await page.locator('#historyBtn').click();
  await page.locator('#historyEnabled').uncheck();
  await page.locator('#historyClose').click();

  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#result')).toBeVisible();
  // Nothing was saved: badge stays hidden.
  await expect(page.locator('#historyCount')).toBeHidden();
});

test('export downloads a JSON file containing saved scans', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('url'));

  await page.locator('#historyBtn').click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#historyExport').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/qr-history-.*\.json$/);

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(json.app).toBe('qr-scanner-pwa');
  expect(json.scans.length).toBeGreaterThanOrEqual(1);
  expect(json.scans[0].content).toBe('https://example.com/hello');
});
