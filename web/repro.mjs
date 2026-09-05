import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.goto('http://localhost:5199/');
await page.waitForTimeout(1000);

// scan two QRs
for (const f of ['wifi', 'url']) {
  await page.locator('input[type="file"]').setInputFiles(resolve('tests/fixtures', `${f}.png`));
  await page.waitForTimeout(300);
}
await page.getByRole('button', { name: 'Dismiss' }).click();
await page.waitForTimeout(200);

// open history
await page.locator('button[aria-label="Open scan history"]').click();
await page.waitForTimeout(400);

// tap a row -> result portal opens ON TOP of history
await page.locator('.truncate', { hasText: 'MyNetwork' }).click({ force: true });
await page.waitForTimeout(400);

// dismiss the result card
await page.getByRole('button', { name: 'Dismiss' }).click();
await page.waitForTimeout(400);

// is history still open?
const todayVisible = await page.getByText('Today', { exact: true }).isVisible().catch(() => false);
const historyBtnVisible = await page.locator('button[aria-label="Open scan history"]').isVisible();
console.log('HISTORY STILL OPEN:', todayVisible);
console.log('BACK ON MAIN SCREEN:', historyBtnVisible);
await page.screenshot({ path: '/tmp/repro-dismiss.png' });
await browser.close();
