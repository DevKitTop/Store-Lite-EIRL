import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '../../app/[slug]/(app)/components/ThemeToggle';

describe('ThemeToggle', () => {
  describe('icon rendering', () => {
    it('renders sun icon when currentScheme is light', () => {
      const onToggle = vi.fn();
      render(<ThemeToggle currentScheme="light" onToggle={onToggle} />);

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();

      // Sun SVG path: the sun icon uses a circle + rays path
      const svg = button.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg?.innerHTML).toContain('circle');
    });

    it('renders moon icon when currentScheme is dark', () => {
      const onToggle = vi.fn();
      render(<ThemeToggle currentScheme="dark" onToggle={onToggle} />);

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();

      // Moon SVG path: the moon icon uses a path (not a circle)
      const svg = button.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg?.innerHTML).toContain('path');
    });
  });

  describe('aria-label', () => {
    it('has aria-label "Cambiar a modo oscuro" when light', () => {
      const onToggle = vi.fn();
      render(<ThemeToggle currentScheme="light" onToggle={onToggle} />);

      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Cambiar a modo oscuro');
    });

    it('has aria-label "Cambiar a modo claro" when dark', () => {
      const onToggle = vi.fn();
      render(<ThemeToggle currentScheme="dark" onToggle={onToggle} />);

      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Cambiar a modo claro');
    });
  });

  describe('interaction', () => {
    it('fires onToggle when clicked', () => {
      const onToggle = vi.fn();
      render(<ThemeToggle currentScheme="light" onToggle={onToggle} />);

      fireEvent.click(screen.getByRole('button'));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('fires onToggle when Space key is pressed', () => {
      const onToggle = vi.fn();
      render(<ThemeToggle currentScheme="light" onToggle={onToggle} />);

      fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('fires onToggle when Enter key is pressed', () => {
      const onToggle = vi.fn();
      render(<ThemeToggle currentScheme="light" onToggle={onToggle} />);

      fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire onToggle for other keys', () => {
      const onToggle = vi.fn();
      render(<ThemeToggle currentScheme="light" onToggle={onToggle} />);

      fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' });
      expect(onToggle).not.toHaveBeenCalled();
    });
  });

  it('keeps the fixed toggle on the left, clear of the editor FAB', () => {
    const cssPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'app',
      '[slug]',
      '(app)',
      'components',
      'ThemeToggle.module.css',
    );
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toContain('left: 24px');
    expect(css).not.toContain('right: 24px');
    expect(css).toMatch(/z-index:\s*150/);
  });
});
