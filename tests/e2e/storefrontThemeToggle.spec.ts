import { expect, test } from '@playwright/test';

test('storefront theme toggle stays on the left and responds to clicks', async ({ page }) => {
  await page.goto('/demo-store');

  const toggle = page.getByRole('button', { name: /cambiar a modo (oscuro|claro)/i });
  await expect(toggle).toBeVisible();

  const box = await toggle.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeCloseTo(24, 0);
  expect(box!.y).toBeCloseTo(24, 0);

  const styles = await toggle.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      position: computed.position,
      zIndex: computed.zIndex,
    };
  });
  expect(styles.position).toBe('fixed');
  expect(styles.zIndex).toBe('150');

  const shell = page.locator('[data-storefront-theme]').first();
  await expect(shell).toBeAttached();

  // The demo store has no saved theme: the shell must inherit platform MD3
  // tokens instead of emitting its own inline CSS variables.
  expect(await shell.getAttribute('style')).toBeNull();

  const initialLabel = await toggle.getAttribute('aria-label');
  const nextLabel =
    initialLabel === 'Cambiar a modo oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  await toggle.click();
  await expect(page.getByRole('button', { name: nextLabel })).toBeVisible();
});

test('storefront editor FAB opens the style panel on the public page', async ({ page }) => {
  await page.goto('/demo-store');

  const editor = page.getByRole('button', { name: 'Personalizar tienda' });
  await expect(editor).toBeVisible();

  const box = await editor.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThan(0);
  expect(box!.y).toBeCloseTo(24, 0);

  await editor.click();
  await expect(page.getByRole('dialog', { name: 'Personalizar tienda' })).toBeVisible();
});

test('translucent storefront surfaces blur their backdrop', async ({ page }) => {
  await page.goto('/demo-store');

  await page.getByRole('button', { name: 'Personalizar tienda' }).click();
  const panel = page.getByRole('dialog', { name: 'Personalizar tienda' });
  await expect(panel).toBeVisible();
  await expect
    .poll(() => panel.evaluate((element) => getComputedStyle(element).backdropFilter))
    .toContain('blur(12px)');

  await page.getByRole('button', { name: 'Cerrar editor' }).click();

  await page.getByRole('button', { name: 'Ver vista previa' }).first().click();
  const sheet = page.locator('.md-sheet.open').first();
  await expect(sheet).toBeVisible();
  await expect
    .poll(() => sheet.evaluate((element) => getComputedStyle(element).backdropFilter))
    .toContain('blur(12px)');
});
