import { expect, test } from '@playwright/test';

test('serves an installable web app manifest', async ({ page, request }) => {
  await page.goto('/');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('/manifest.webmanifest');

  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);

  const manifest = await response.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.scope).toBe('/');
  expect(manifest.start_url).toBe('/');

  const sizes = (manifest.icons ?? []).map((icon: { sizes?: string }) => icon.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
});

test('serves the service worker without long-lived caching', async ({ request }) => {
  const response = await request.get('/sw.js');

  expect(response.ok()).toBe(true);
  expect(response.headers()['cache-control']).toContain('max-age=0');
  expect(response.headers()['cache-control']).toContain('must-revalidate');
});

test('registers the service worker at root scope', async ({ page }) => {
  await page.goto('/');

  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    return registration.scope;
  });

  expect(new URL(scope).pathname).toBe('/');
});
