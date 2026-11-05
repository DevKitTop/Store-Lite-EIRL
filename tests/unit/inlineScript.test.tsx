// =====================================================
// InlineScript must not trip React's script warning
//
// The warning we saw in the app ("Encountered a script tag while rendering
// React component") is emitted when React hoists a script out of the component
// tree, which is what the root layout does. Reproducing that hoisting inside
// jsdom did not work: a detached render does not go through the path, so a
// control test here would assert nothing.
//
// What this suite pins instead is the mechanism the warning depends on. React's
// `isScriptDataBlock` returns false - warn - only for JavaScript MIME types,
// and true for everything else. On the client the component must therefore
// render `text/plain`, which is exactly what Next's FOUC guide prescribes.
// =====================================================

import { InlineScript } from '@/shared/components/InlineScript';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/** The MIME types React treats as executable. Everything else is a data block. */
const JAVASCRIPT_MIME_TYPES = [
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
];

describe('InlineScript', () => {
  it('renders as a data block on the client, so React does not hoist-and-warn', () => {
    const { container } = render(<InlineScript html="void 0;" />);

    expect(container.querySelector('script')?.getAttribute('type')).toBe('text/plain');
  });

  it('uses a type React does not consider executable', () => {
    const { container } = render(<InlineScript html="void 0;" />);

    const type = container.querySelector('script')?.getAttribute('type') ?? '';

    expect(JAVASCRIPT_MIME_TYPES).not.toContain(type.toLowerCase());
  });

  it('does not log the script warning during a client render', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<InlineScript html="void 0;" />);

    const logged = consoleError.mock.calls.flat().join(' ');
    expect(logged).not.toMatch(/Encountered a script tag/);

    consoleError.mockRestore();
  });
});
