import { test, expect } from '@playwright/test';

// Install a fake beforeinstallprompt event the app can capture. Exposes
// window.__install with fire()/accept()/dismiss() so tests can drive the flow.
async function installHarness(page) {
  await page.addInitScript(() => {
    let resolveChoice;
    let defaultPrevented = false;
    const evt = new Event('beforeinstallprompt');
    evt.preventDefault = () => {
      defaultPrevented = true;
    };
    evt.prompt = () => {
      // userChoice resolves when the test signals accept/dismiss.
    };
    evt.userChoice = new Promise((res) => {
      resolveChoice = res;
    });
    window.__install = {
      get defaultPrevented() {
        return defaultPrevented;
      },
      fire: () => window.dispatchEvent(evt),
      accept: () => resolveChoice({ outcome: 'accepted', platform: 'web' }),
      dismiss: () => resolveChoice({ outcome: 'dismissed', platform: 'web' }),
    };
  });
}

// Each Playwright test gets a fresh browser context with empty localStorage,
// so the dismiss flag is already unset at the start of every case.

test('banner appears when beforeinstallprompt fires and Install accepts it', async ({ page }) => {
  await installHarness(page);
  await page.goto('/');
  await expect(page.locator('#status')).not.toBeEmpty();

  await expect(page.locator('#installPrompt')).toBeHidden();
  await page.evaluate(() => window.__install.fire());

  await expect(page.locator('#installPrompt')).toBeVisible();
  await expect(page.locator('#installBtn')).toBeVisible();
  await expect(page.locator('#installDismiss')).toBeVisible();
  await expect(page.locator('#installIos')).toBeHidden();
  expect(await page.evaluate(() => window.__install.defaultPrevented)).toBe(true);

  // Accepting the native prompt resolves userChoice → banner hides + flag set.
  await page.locator('#installBtn').click();
  await page.evaluate(() => window.__install.accept());

  await expect(page.locator('#installPrompt')).toBeHidden();
  const flag = await page.evaluate(() => localStorage.getItem('qr.install.dismissed'));
  expect(flag).toBe('1');
});

test('Not now permanently dismisses the banner', async ({ page }) => {
  await installHarness(page);
  await page.goto('/');
  await expect(page.locator('#status')).not.toBeEmpty();

  await page.evaluate(() => window.__install.fire());
  await expect(page.locator('#installPrompt')).toBeVisible();

  await page.locator('#installDismiss').click();

  await expect(page.locator('#installPrompt')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('qr.install.dismissed'))).toBe('1');

  // Reload: the listener isn't even wired, so re-firing the event is a no-op.
  await page.reload();
  await expect(page.locator('#status')).not.toBeEmpty();
  await page.evaluate(() => window.__install.fire());
  await expect(page.locator('#installPrompt')).toBeHidden();
});

test('banner never shows when running in standalone display mode', async ({ page }) => {
  // Force matchMedia('(display-mode: standalone)') to report installed.
  await page.addInitScript(() => {
    window.matchMedia = (query) => ({
      matches: /display-mode:\s*standalone/.test(query),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    });
  });
  await installHarness(page);

  await page.goto('/');
  await expect(page.locator('#status')).not.toBeEmpty();
  await page.evaluate(() => window.__install.fire());

  await expect(page.locator('#installPrompt')).toBeHidden();
});
