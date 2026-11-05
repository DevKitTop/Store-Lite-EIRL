// =====================================================
// Culqi secret key must not reach the browser
//
// The settings page is a server component that renders `SettingsClient`. Every
// prop it passes is serialised into the RSC payload the browser downloads, so
// `culqiSecretKey` was a live credential in the client's hands: encrypted for
// rows written by the current code, plain text for older ones.
//
// The screen only needs to know *whether* a key exists. These assertions read
// the source because the leak is a prop, not a behaviour a render can show:
// the value never appears in the markup, only in the payload.
// =====================================================

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SETTINGS_PAGE = readFileSync('app/[slug]/(app)/settings/page.tsx', 'utf8');
const PAYMENTS_CONFIG = readFileSync(
  'app/[slug]/(app)/settings/components/PaymentsConfig.tsx',
  'utf8',
);
const CONSTANTS = readFileSync('app/[slug]/(app)/settings/constants.tsx', 'utf8');

describe('settings screen and the Culqi secret key', () => {
  it('never passes the secret key as a client component prop', () => {
    // Reading it on the server to compute the boolean is the point; passing it
    // as a prop is the leak. `\b` does not fire inside `hasCulqiSecretKey`.
    expect(SETTINGS_PAGE).not.toMatch(/(?<![A-Za-z])culqiSecretKey:/);
    expect(SETTINGS_PAGE).toMatch(/hasCulqiSecretKey:/);
  });

  it('never reads the secret value from the business prop', () => {
    expect(PAYMENTS_CONFIG).not.toMatch(/business\.culqiSecretKey/);
    expect(PAYMENTS_CONFIG).not.toMatch(/maskKey\(business\.culqiSecretKey\)/);
  });

  it('types the prop as a boolean, because a string would invite the value back', () => {
    expect(CONSTANTS).toMatch(/hasCulqiSecretKey:\s*boolean;/);
    expect(CONSTANTS).not.toMatch(/^\s*culqiSecretKey:/m);
  });
});
