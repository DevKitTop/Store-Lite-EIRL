import { getPatternCraftById, type PatternCraftPattern } from '@/data/patterncraft';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PatternBrowser } from './PatternBrowser';

const __dirname = dirname(fileURLToPath(import.meta.url));

const firstPattern = getPatternCraftById('arctic-lights-glow');
const secondPattern = getPatternCraftById('aurora-edge-glow');

if (!firstPattern || !secondPattern) {
  throw new Error('PatternCraft fixtures are missing');
}

function BrowserHarness({
  onSelect = vi.fn(),
  onClear = vi.fn(),
  currentPatternId,
}: {
  onSelect?: (pattern: PatternCraftPattern) => void;
  onClear?: (pattern: PatternCraftPattern) => void;
  currentPatternId?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <PatternBrowser
      open={open}
      onClose={() => setOpen(false)}
      onSelect={onSelect}
      onClear={onClear}
      currentPatternId={currentPatternId}
      colorScheme="dark"
    />
  );
}

describe('PatternBrowser correctness (T22)', () => {
  let opener: HTMLButtonElement;

  beforeEach(() => {
    opener = document.createElement('button');
    opener.textContent = 'Abrir patrón';
    document.body.appendChild(opener);
    opener.focus();
  });

  afterEach(() => {
    document.body.removeChild(opener);
  });

  test('clear callback receives the active pattern and closes the browser', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<BrowserHarness onClear={onClear} currentPatternId={firstPattern.id} />);

    await user.click(screen.getByRole('button', { name: 'Quitar' }));

    expect(onClear).toHaveBeenCalledWith(firstPattern);
    expect(screen.queryByRole('heading', { name: 'Patrones PatternCraft' })).toBeNull();
  });

  test('double-click applies the clicked id rather than stale selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <PatternBrowser
        open
        onClose={vi.fn()}
        onSelect={onSelect}
        currentPatternId={firstPattern.id}
        colorScheme="dark"
      />,
    );

    await user.click(screen.getByRole('button', { name: /Arctic Lights Glow/ }));
    fireEvent.doubleClick(screen.getByRole('button', { name: /Aurora Edge Glow/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(secondPattern);
  });

  test('cards are tabbable with a visible focus ring; Enter selects and double Enter applies', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<BrowserHarness onSelect={onSelect} />);

    const card = screen.getByRole('button', { name: /Arctic Lights Glow/ });
    for (let i = 0; i < 20 && document.activeElement !== card; i += 1) {
      await user.tab();
    }
    expect(document.activeElement).toBe(card);

    const css = readFileSync(join(__dirname, 'PatternBrowser.module.css'), 'utf8');
    expect(css).toMatch(/\.card:focus-visible/);

    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Aplicar patrón' })).toHaveProperty(
      'disabled',
      false,
    );
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(firstPattern);
  });

  test('Escape closes without leaking and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const parentListener = vi.fn();
    document.addEventListener('keydown', parentListener);
    render(<BrowserHarness />);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('heading', { name: 'Patrones PatternCraft' })).toBeNull();
    expect(parentListener).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);

    document.removeEventListener('keydown', parentListener);
  });
});
