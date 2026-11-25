'use client';

import type {
  PatternCraftCategory,
  PatternCraftPattern,
  PatternCraftStyle,
} from '@/data/patterncraft';
import { getPatternCraftById, patternCraftByCategory } from '@/data/patterncraft';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDialogSurface } from '../useDialogSurface';
import styles from './PatternBrowser.module.css';

interface PatternBrowserProps {
  open: boolean;
  onClose: () => void;
  onSelect: (pattern: PatternCraftPattern) => void;
  onClear?: (pattern: PatternCraftPattern) => void;
  currentPatternId?: string;
  colorScheme: 'light' | 'dark';
}

const CATEGORIES: {
  key: PatternCraftCategory;
  label: string;
  icon: string;
}[] = [
  { key: 'gradients', label: 'Gradientes', icon: 'gradient' },
  { key: 'geometric', label: 'Geométricos', icon: 'grid_view' },
  { key: 'decorative', label: 'Decorativos', icon: 'auto_awesome' },
  { key: 'effects', label: 'Efectos', icon: 'blur_on' },
];

function previewStyle(style: PatternCraftStyle): React.CSSProperties {
  const css: React.CSSProperties = {};
  for (const [key, value] of Object.entries(style)) {
    if (value !== undefined && value !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (css as any)[key] = String(value);
    }
  }
  return css;
}

function luminanceFromHex(hex: string): number | undefined {
  const normalized =
    hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex.slice(0, 7);
  const match = normalized.match(/^#([0-9a-f]{6})$/i);
  if (!match) return undefined;
  const r = parseInt(match[1].slice(0, 2), 16);
  const g = parseInt(match[1].slice(2, 4), 16);
  const b = parseInt(match[1].slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function extractColorLuminances(value: string): number[] {
  const luminances: number[] = [];
  const hexMatches = value.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
  for (const hex of hexMatches) {
    const lum = luminanceFromHex(hex);
    if (lum !== undefined) luminances.push(lum);
  }
  return luminances;
}

/**
 * Classifies a pattern by scheme compatibility.
 * - 'dark': dark own background -> show only in dark mode
 * - 'light': light own background -> show only in light mode
 * - 'both': transparent overlay -> show in both modes
 */
function classifyPattern(style: PatternCraftStyle): 'dark' | 'light' | 'both' {
  const bg = (typeof style.background === 'string' ? style.background : '').trim();
  const bgColor = (typeof style.backgroundColor === 'string' ? style.backgroundColor : '').trim();
  const bgImage = (typeof style.backgroundImage === 'string' ? style.backgroundImage : '').trim();
  let color = bgColor;

  if (!bgColor && bg) {
    const lastComma = bg.lastIndexOf(',');
    if (lastComma !== -1) {
      const possibleColor = bg.slice(lastComma + 1).trim();
      if (/^#[0-9a-fA-F]{6,8}$/.test(possibleColor)) {
        color = possibleColor;
      }
    }
    if (!color && !/gradient\(|url\(|image\(/i.test(bg)) {
      color = bg;
    }
  }

  const source = [bgColor, bg, bgImage].filter(Boolean).join(' ');
  const luminances = extractColorLuminances(source);
  if (!color && luminances.length > 0 && /gradient\(|url\(|image\(/i.test(source)) {
    const average = luminances.reduce((sum, lum) => sum + lum, 0) / luminances.length;
    return average < 0.45 ? 'dark' : 'light';
  }

  // No own background -> transparent overlay, works in both schemes.
  if (!color) return 'both';

  // Quick check for common dark bases
  if (/^#0[0-9a-f]{5}$/i.test(color)) return 'dark'; // #0xxxxx
  if (/^#1[0-9a-f]{5}$/i.test(color)) return 'dark'; // #1xxxxx
  if (/^#2[0-9a-b][0-9a-f]{4}$/i.test(color)) return 'dark'; // #2[0-b]xxxx
  if (color === '#000' || color === '#000000' || color === 'black') return 'dark';

  const lum = luminanceFromHex(color);
  if (lum !== undefined) {
    return lum < 0.4 ? 'dark' : 'light';
  }

  // If it has a color but we could not determine it, assume light.
  return 'light';
}

// Patrones eliminados del browser (no se renderizan en ningún scheme)
const REMOVED = new Set([
  'left-masked-basic-grid',
  'left-masked-circuit-board',
  'left-masked-circuit-board-light',
  'left-masked-dashed-grid-light',
  'right-masked-basic-grid',
  'right-masked-circuit-board',
  'right-masked-circuit-board-light',
  'right-masked-dashed-grid-light',
  'diagonal-lines',
]);

// Patrones que solo se muestran en dark mode
const DARK_ONLY = new Set([
  'striped-dark',
  'azure-depths-top',
  'crimson-depth-top',
  'dark-horizon-glow-top',
  'emerald-void-top',
  'orchid-depths-top',
  'violet-abyss-top',
  'cosmic-noise',
  'cosmic-sparkle',
  'deep-ocean-glow',
  'midnight-ember',
]);

export function PatternBrowser({
  open,
  onClose,
  onSelect,
  onClear,
  currentPatternId,
  colorScheme,
}: PatternBrowserProps) {
  const [activeCategory, setActiveCategory] = useState<PatternCraftCategory>('gradients');
  const [selectedId, setSelectedId] = useState<string | null>(currentPatternId ?? null);
  const { surfaceRef } = useDialogSurface({ open, onClose, captureEscape: true });

  // Sync selection when currentPatternId changes externally
  useEffect(() => {
    setSelectedId(currentPatternId ?? null);
  }, [currentPatternId]);

  const visibleCategories = CATEGORIES;

  // Si la categoría activa ya no es visible, switch a la primera disponible
  useEffect(() => {
    if (!visibleCategories.some((c) => c.key === activeCategory)) {
      setActiveCategory(visibleCategories[0]?.key ?? 'gradients');
    }
  }, [visibleCategories, activeCategory]);

  const patterns = useMemo(
    () =>
      (patternCraftByCategory[activeCategory] ?? []).filter((p) => {
        if (REMOVED.has(p.id)) return false;
        if (colorScheme === 'light' && DARK_ONLY.has(p.id)) return false;
        const match = classifyPattern(p.style);
        return match === 'both' || match === colorScheme;
      }),
    [activeCategory, colorScheme],
  );

  const handleConfirm = useCallback(
    (patternId: string | null = selectedId) => {
      if (!patternId) return;
      const pattern = getPatternCraftById(patternId);
      if (pattern) {
        onSelect(pattern);
      }
      onClose();
    },
    [selectedId, onSelect, onClose],
  );

  const currentPattern = currentPatternId ? getPatternCraftById(currentPatternId) : undefined;

  if (!open) return null;

  return (
    <div className={styles.overlay} data-testid="pattern-browser-backdrop" onClick={onClose}>
      <div
        ref={surfaceRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pattern-browser-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className={styles.header}>
          <h2 id="pattern-browser-title" className={styles.title}>
            Patrones PatternCraft
          </h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Cerrar selector de patrones"
          >
            ✕
          </button>
        </div>

        {/* ── Active pattern info ── */}
        {currentPattern && (
          <div className={styles.activeInfo}>
            <span className={styles.activeLabel}>Patrón actual:</span>
            <span className={styles.activeName}>{currentPattern.name}</span>
            <button
              className={styles.clearBtn}
              onClick={() => {
                onClear?.(currentPattern);
                setSelectedId(null);
                onClose();
              }}
            >
              Quitar
            </button>
          </div>
        )}

        {/* ── Category tabs ── */}
        <div className={styles.tabs}>
          {visibleCategories.map((cat) => {
            const filteredCount =
              (patternCraftByCategory[cat.key] ?? []).filter((p) => {
                if (REMOVED.has(p.id)) return false;
                if (colorScheme === 'light' && DARK_ONLY.has(p.id)) return false;
                const match = classifyPattern(p.style);
                return match === 'both' || match === colorScheme;
              }).length ?? 0;
            return (
              <button
                key={cat.key}
                className={`${styles.tab} ${activeCategory === cat.key ? styles.tabActive : ''}`}
                aria-pressed={activeCategory === cat.key}
                onClick={() => setActiveCategory(cat.key)}
              >
                <span className={styles.tabIcon}>
                  <PatternCategoryIcon icon={cat.icon} />
                </span>
                <span className={styles.tabLabel}>{cat.label}</span>
                <span className={styles.tabCount}>{filteredCount}</span>
              </button>
            );
          })}
        </div>

        {/* ── Pattern grid ── */}
        <div className={styles.grid}>
          {patterns.map((pattern) => (
            <button
              key={pattern.id}
              className={`${styles.card} ${selectedId === pattern.id ? styles.cardSelected : ''}`}
              aria-pressed={selectedId === pattern.id}
              onClick={() => setSelectedId(pattern.id)}
              onDoubleClick={() => handleConfirm(pattern.id)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (selectedId === pattern.id) {
                  handleConfirm(pattern.id);
                } else {
                  setSelectedId(pattern.id);
                }
              }}
              title={pattern.name}
            >
              <div className={styles.preview} style={previewStyle(pattern.style)} />

              {pattern.hasMask && <span className={styles.maskBadge}>Fade</span>}

              <div className={styles.cardName}>{pattern.name}</div>
            </button>
          ))}
        </div>

        {/* ── Footer ── */}
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>
            Cancelar
          </button>
          <button
            className={styles.applyBtn}
            disabled={!selectedId}
            onClick={() => handleConfirm()}
          >
            {selectedId === currentPatternId ? 'Mantener selección' : 'Aplicar patrón'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Simple SVG icons for each category (no icon library dependency)
function PatternCategoryIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'gradient':
      return (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      );
    case 'grid_view':
      return (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      );
    case 'auto_awesome':
      return (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" />
          <circle cx="6" cy="18" r="2" fill="currentColor" />
          <circle cx="18" cy="18" r="2" fill="currentColor" />
        </svg>
      );
    case 'blur_on':
      return (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <circle cx="4" cy="4" r="1.5" fill="currentColor" />
          <circle cx="20" cy="4" r="1.5" fill="currentColor" />
          <circle cx="4" cy="20" r="1.5" fill="currentColor" />
          <circle cx="20" cy="20" r="1.5" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
}
