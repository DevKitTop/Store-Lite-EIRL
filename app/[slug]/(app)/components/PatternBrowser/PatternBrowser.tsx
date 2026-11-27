'use client';

import type {
  PatternCraftCategory,
  PatternCraftPattern,
  PatternCraftStyle,
} from '@/data/patterncraft/curated';
import {
  classifyPatternSuitability,
  curatedPatternByCategory,
  getCuratedPatternById,
} from '@/data/patterncraft/curated';
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

type PatternBrowserCategoryKey = 'gradients' | 'geometric' | 'effects';

const CATEGORIES: {
  key: PatternBrowserCategoryKey;
  label: string;
  icon: string;
}[] = [
  { key: 'gradients', label: 'Gradientes', icon: 'gradient' },
  { key: 'geometric', label: 'Geométricos', icon: 'grid_view' },
  { key: 'effects', label: 'Efectos', icon: 'auto_awesome' },
];

const CATEGORY_FAMILIES: ReadonlyMap<PatternBrowserCategoryKey, readonly PatternCraftCategory[]> =
  new Map([
    ['gradients', ['gradients']],
    ['geometric', ['geometric']],
    ['effects', ['decorative', 'effects']],
  ]);

function patternsForFamily(family: PatternCraftCategory): PatternCraftPattern[] {
  switch (family) {
    case 'gradients':
      return curatedPatternByCategory.gradients;
    case 'geometric':
      return curatedPatternByCategory.geometric;
    case 'decorative':
      return curatedPatternByCategory.decorative;
    case 'effects':
      return curatedPatternByCategory.effects;
  }
}

function curatedForCategory(key: PatternBrowserCategoryKey): PatternCraftPattern[] {
  return (CATEGORY_FAMILIES.get(key) ?? []).flatMap(patternsForFamily);
}

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

export function PatternBrowser({
  open,
  onClose,
  onSelect,
  onClear,
  currentPatternId,
  colorScheme,
}: PatternBrowserProps) {
  const [activeCategory, setActiveCategory] = useState<PatternBrowserCategoryKey>('gradients');
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
      curatedForCategory(activeCategory).filter((p) => {
        const match = classifyPatternSuitability(p.style);
        return match === 'both' || match === colorScheme;
      }),
    [activeCategory, colorScheme],
  );

  const handleConfirm = useCallback(
    (patternId: string | null = selectedId) => {
      if (!patternId) return;
      const pattern = getCuratedPatternById(patternId);
      if (pattern) {
        onSelect(pattern);
      }
      onClose();
    },
    [selectedId, onSelect, onClose],
  );

  const currentPattern = currentPatternId ? getCuratedPatternById(currentPatternId) : undefined;

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
            const filteredCount = curatedForCategory(cat.key).filter((p) => {
              const match = classifyPatternSuitability(p.style);
              return match === 'both' || match === colorScheme;
            }).length;
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
            Aplicar patrón
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
