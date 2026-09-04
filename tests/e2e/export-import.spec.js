import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = (name) => resolve(__dirname, '..', 'fixtures', `${name}.png`);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).not.toBeEmpty();
});

test('export downloads a CSV with header and scanned content', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('url'));

  await page.locator('#historyBtn').click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#historyExportCsv').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/qr-history-.*\.csv$/);

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const csv = Buffer.concat(chunks).toString('utf8');
  // BOM for Excel, header row, then the scanned URL.
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain('content,type,label,scannedAt');
  expect(csv).toContain('https://example.com/hello');
});

test('import merges a JSON export and re-importing the same file adds nothing', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('url'));
  await page.locator('#fileInput').setInputFiles(fixture('wifi'));
  await expect(page.locator('#historyCount')).toHaveText('2');

  await page.locator('#historyBtn').click();

  // Export, then clear everything.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#historyExport').click(),
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const json = Buffer.concat(chunks).toString('utf8');

  page.on('dialog', (d) => d.accept());
  await page.locator('#historyClear').click();
  await expect(page.locator('#historyCount')).toBeHidden();

  // Import the file back — both records return.
  await page.locator('#historyImport').click();
  await page.locator('#importInput').setInputFiles({
    name: 'qr-history.json',
    mimeType: 'application/json',
    buffer: Buffer.from(json),
  });

  await expect(page.locator('#status')).toContainText(/Imported 2 scans/);
  await expect(page.locator('.prow')).toHaveCount(2);
  await expect(page.locator('#historyCount')).toHaveText('2');

  // Re-importing the same file is a no-op (deduped by content+createdAt).
  await page.locator('#historyImport').click();
  await page.locator('#importInput').setInputFiles({
    name: 'qr-history.json',
    mimeType: 'application/json',
    buffer: Buffer.from(json),
  });
  await expect(page.locator('#status')).toContainText(/Nothing new to import/);
  await expect(page.locator('#historyCount')).toHaveText('2');
});

test('importing a non-JSON file shows a friendly error', async ({ page }) => {
  await page.locator('#historyBtn').click();
  await page.locator('#historyImport').click();
  await page.locator('#importInput').setInputFiles({
    name: 'not-a-backup.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await expect(page.locator('#status')).toContainText(/Import failed/);
});
