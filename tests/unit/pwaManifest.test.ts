import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SITE_NAME } from '@/shared/utils/siteJsonLd';
import buildManifest from '../../app/manifest';

const manifest = buildManifest();
const publicDir = path.resolve(process.cwd(), 'public');

function findIcon(size: string, purpose: 'any' | 'maskable') {
  return (manifest.icons ?? []).find((icon) => icon.sizes === size && icon.purpose === purpose);
}

describe('web app manifest', () => {
  it('identifies the app with a stable root start URL and scope', () => {
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.name).toBe(SITE_NAME);
    expect(manifest.short_name).toBe(SITE_NAME);
    expect(manifest.display).toBe('standalone');
  });

  it('declares brand colors for the splash screen and app chrome', () => {
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('declares 192/512 any icons and a maskable icon', () => {
    expect(findIcon('192x192', 'any')).toBeDefined();
    expect(findIcon('512x512', 'any')).toBeDefined();
    expect(findIcon('512x512', 'maskable')).toBeDefined();
  });

  it('only references icon files that exist in public/', () => {
    const iconSrcs = (manifest.icons ?? []).map((icon) => icon.src);

    expect(iconSrcs.length).toBeGreaterThan(0);

    for (const src of iconSrcs) {
      expect(src.startsWith('/'), `${src} must be root-relative`).toBe(true);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- src comes from the manifest fixture above
      expect(existsSync(path.join(publicDir, src)), `${src} must exist`).toBe(true);
    }
  });
});
