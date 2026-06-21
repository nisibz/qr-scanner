import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = (name) => resolve(__dirname, '..', 'fixtures', `${name}.png`);

// Batch controls are hidden whenever the "Retry camera" button is shown
// (i.e. no working camera). CI has no camera device, so simulate one with
// Chromium's fake media stream + auto-grant so `scanner.start()` succeeds,
// the retry button stays hidden, and the batch controls become visible.
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).not.toBeEmpty();
  await expect(page.locator('#retryBtn')).toBeHidden();
});

test('batch mode toggle shows the batch button and suppresses the result panel', async ({ page }) => {
  await page.locator('label.batch-toggle').click(); await expect(page.locator('#batchToggle')).toBeChecked();
  await expect(page.locator('#batchViewBtn')).toBeVisible();

  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#result')).toBeHidden();
  await expect(page.locator('#batchCount')).toHaveText('1');
  await expect(page.locator('#status')).toContainText(/Added to batch/i);
});

test('batch mode accumulates distinct scans', async ({ page }) => {
  await page.locator('label.batch-toggle').click();
  await expect(page.locator('#batchToggle')).toBeChecked();

  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#batchCount')).toHaveText('1');

  await page.locator('#fileInput').setInputFiles(fixture('plain'));
  await expect(page.locator('#batchCount')).toHaveText('2');

  await page.locator('#fileInput').setInputFiles(fixture('wifi'));
  await expect(page.locator('#batchCount')).toHaveText('3');
});

test('duplicate scans are not re-added to the batch', async ({ page }) => {
  await page.locator('label.batch-toggle').click();
  await expect(page.locator('#batchToggle')).toBeChecked();

  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#batchCount')).toHaveText('1');

  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#batchCount')).toHaveText('1');

  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#batchCount')).toHaveText('1');
});

test('batch view lists collected scans and supports removal', async ({ page }) => {
  await page.locator('label.batch-toggle').click();
  await expect(page.locator('#batchToggle')).toBeChecked();
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#batchCount')).toHaveText('1');
  await page.locator('#fileInput').setInputFiles(fixture('plain'));
  await expect(page.locator('#batchCount')).toHaveText('2');

  await page.locator('#batchViewBtn').click();
  await expect(page.locator('#batchView')).toBeVisible();
  await expect(page.locator('#batchList .hitem')).toHaveCount(2);
  await expect(page.locator('#batchViewCount')).toHaveText('2');

  await page.locator('#batchList .hitem').first().locator('.hitem__del').click();
  await expect(page.locator('#batchList .hitem')).toHaveCount(1);
  await expect(page.locator('#batchCount')).toHaveText('1');
});

test('batch items show per-type action buttons like the default result panel', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('label.batch-toggle').click();
  await expect(page.locator('#batchToggle')).toBeChecked();
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#batchCount')).toHaveText('1');

  await page.locator('#batchViewBtn').click();
  const actions = page.locator('#batchList .hitem').first().locator('.hitem__actions');

  // URL → Open (link, primary) + Copy (button)
  await expect(actions.locator('a.btn--primary')).toHaveText('Open');
  await expect(actions.locator('a.btn--primary')).toHaveAttribute('href', 'https://example.com/hello');
  await expect(actions.getByRole('button', { name: 'Copy' })).toBeVisible();

  await actions.getByRole('button', { name: 'Copy' }).click();
  await expect(page.locator('#status')).toContainText(/Copied/i);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('https://example.com/hello');
});

test('Clear batch empties the list', async ({ page }) => {
  await page.locator('label.batch-toggle').click(); await expect(page.locator('#batchToggle')).toBeChecked();
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#batchCount')).toHaveText('1');

  await page.locator('#batchViewBtn').click();
  page.on('dialog', (d) => d.accept());
  await page.locator('#batchClear').click();

  await expect(page.locator('#batchList .hitem')).toHaveCount(0);
  await expect(page.locator('#batchEmpty')).toBeVisible();
  await expect(page.locator('#batchCount')).toHaveText('0');
});

test('batch export downloads a JSON file with collected scans', async ({ page }) => {
  await page.locator('label.batch-toggle').click(); await expect(page.locator('#batchToggle')).toBeChecked();
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#batchCount')).toHaveText('1');

  await page.locator('#batchViewBtn').click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#batchExport').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/qr-batch-.*\.json$/);

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(json.kind).toBe('batch');
  expect(json.scans.length).toBe(1);
  expect(json.scans[0].content).toBe('https://example.com/hello');
});

test('disabling batch mode restores normal result display', async ({ page }) => {
  await page.locator('label.batch-toggle').click(); await expect(page.locator('#batchToggle')).toBeChecked();
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#batchCount')).toHaveText('1');

  await page.locator('label.batch-toggle').click(); await expect(page.locator('#batchToggle')).not.toBeChecked();
  await page.locator('#fileInput').setInputFiles(fixture('plain'));
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#resultText')).toHaveText('Just some plain text');
});

test('batch-mode scans are not written to history', async ({ page }) => {
  await page.locator('label.batch-toggle').click(); await expect(page.locator('#batchToggle')).toBeChecked();
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await expect(page.locator('#batchCount')).toHaveText('1');
  await page.locator('#fileInput').setInputFiles(fixture('plain'));
  await expect(page.locator('#batchCount')).toHaveText('2');

  // History badge stays hidden — nothing was persisted.
  await expect(page.locator('#historyCount')).toBeHidden();

  // Switch back to normal mode and scan: that one SHOULD land in history.
  await page.locator('label.batch-toggle').click(); await expect(page.locator('#batchToggle')).not.toBeChecked();
  await page.locator('#fileInput').setInputFiles(fixture('wifi'));
  await expect(page.locator('#historyCount')).toHaveText('1');
});
