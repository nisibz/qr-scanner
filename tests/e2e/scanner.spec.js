import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = (name) => resolve(__dirname, '..', 'fixtures', `${name}.png`);
const actions = (page) => page.locator('#resultActions');

// Camera auto-starts on load and fails in CI (no device). The file-scan path
// works independently, so the suite relies on the file input.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Wait for the scanner module to attempt startup and settle the status text,
  // so it doesn't race with subsequent assertions.
  await expect(page.locator('#status')).not.toBeEmpty();
});

test('app shell renders', async ({ page }) => {
  await expect(page).toHaveTitle(/QR Scanner/);
  await expect(page.getByRole('heading', { name: 'QR Scanner' })).toBeVisible();
  await expect(page.locator('#fileInput')).toBeAttached();
});

test('scans a URL QR from an image file and renders Open + Copy actions', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('url'));

  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#resultLabel')).toHaveText(/Website/i);
  await expect(page.locator('#resultText')).toHaveText('https://example.com/hello');

  const openLink = actions(page).getByRole('link', { name: 'Open' });
  await expect(openLink).toBeVisible();
  await expect(openLink).toHaveAttribute('href', 'https://example.com/hello');

  await expect(page.locator('#resultWarning')).toBeHidden();
  await expect(page.locator('#status')).toContainText(/Scanned/i);
});

test('suspicious URL renders a safety warning', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('suspicious'));

  await expect(page.locator('#resultText')).toHaveText('http://192.168.1.1/login');
  await expect(page.locator('#resultWarning')).toBeVisible();
  await expect(page.locator('#resultWarning')).toContainText(/IP address/i);
});

test('non-URL payload renders only a Copy action', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('plain'));

  await expect(page.locator('#resultLabel')).toHaveText(/Text/i);
  await expect(page.locator('#resultText')).toHaveText('Just some plain text');
  await expect(actions(page).getByRole('link')).toHaveCount(0);
  await expect(actions(page).getByRole('button', { name: 'Copy' })).toBeVisible();
});

test('Wi-Fi payload renders structured fields and copy actions', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('wifi'));

  await expect(page.locator('#resultLabel')).toHaveText(/Wi-Fi/i);
  await expect(page.locator('#resultFields')).toContainText('MyNetwork');
  await expect(page.locator('#resultFields')).toContainText('WPA');
  await expect(page.locator('#resultFields')).toContainText('secretpass');
  await expect(actions(page).getByRole('button', { name: 'Copy password' })).toBeVisible();
});

test('vCard payload offers a Save contact download', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('vcard'));

  await expect(page.locator('#resultLabel')).toHaveText(/Contact/i);
  await expect(page.locator('#resultText')).toHaveText('Jane Doe');
  await expect(page.locator('#resultFields')).toContainText('Acme Inc');
  await expect(actions(page).getByRole('button', { name: /Save contact/i })).toBeVisible();
});

test('Dismiss clears the result', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('plain'));
  await expect(page.locator('#result')).toBeVisible();

  await page.locator('#clearBtn').click();
  await expect(page.locator('#result')).toBeHidden();
  await expect(page.locator('#resultText')).toHaveText('');
});

test('Copy puts the decoded text on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#fileInput').setInputFiles(fixture('plain'));
  await expect(page.locator('#result')).toBeVisible();

  await actions(page).getByRole('button', { name: 'Copy' }).click();

  await expect(page.locator('#status')).toContainText(/Copied/i);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('Just some plain text');
});

test('image with no QR code reports a friendly message', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture('noop'));

  await expect(page.locator('#result')).toBeHidden();
  await expect(page.locator('#status')).toContainText(/No QR code found/i);
});
