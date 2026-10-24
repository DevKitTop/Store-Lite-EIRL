# Design: Refactor SettingsClient.tsx

## Technical Approach

Extract 5 files from the 3249-line monolithic `SettingsClient.tsx` by feature boundary: constants/types/utilities → `constants.ts`, three feature panels → individual files, shared feedback pattern → custom hook. The main orchestrator stays in `SettingsClient.tsx` (~300 lines remaining). Zero behavioral change.

## Architecture Decisions

### Decision: One constants file vs split types/constants/components

| Option | Tradeoff | Decision |
|--------|----------|----------|
| One `constants.ts` | Single import, clear home for shared code. File ~200 lines but coherent. | **Chosen** — matches proposal, keeps imports simple |
| Split into `types.ts`, `constants.ts`, `utils.ts` | Cleaner separation but 2 extra files. Over-engineering for this scope. | Rejected |

### Decision: Extracted components receive props directly, no shared store

The current code passes all data `SettingsClientProps → sub-components` as props. Each section uses `useState`/`useTransition` locally. No shared state exists between sections. Adding a store or context would be scope creep.

**Choice**: Keep current props-only data flow. Each extracted section receives `business`, `entitlements`, `isOwner`, `permissions` as props.
**Rationale**: Matches current pattern, zero refactor risk, clean testability.

### Decision: `useSettingsState` = feedback snackbar hook only

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Feedback-only hook | Small, reusable, 4 sections benefit | **Chosen** |
| Full state management hook | Would fabricate shared state that doesn't exist. Every section has independent state. | Rejected |

## Data Flow

```
page.tsx (server)
  └─ SettingsClient (client, orchestrator)
       ├─ active section state (useState)
       ├─ NAV_GROUPS access filter (useMemo)
       ├─ BusinessSection          ← stays inline
       ├─ StorefrontThemeEditor    ← extracted
       ├─ TeamManagementPanel      ← extracted
       ├─ PaymentsConfig           ← extracted
       ├─ SEOSection               ← stays inline
       ├─ StorefrontSectionEditor  ← stays inline
       ├─ PlanSection              ← stays inline
       └─ LegalSection             ← stays inline

All extracted components receive `business`, `entitlements`, `isOwner`, `permissions` as props.
```

## Extraction Boundaries

### Source: `SettingsClient.tsx` (3249 lines)

| Target File | Source Lines | Lines | What |
|---|---|---|---|
| `constants.ts` | 73–210, 2206–2215 | ~130 | Types (SettingsBusiness, Entitlements, SettingsClientProps, TeamMemberData), constants (PLAN_CONFIG, COLUMN_OPTIONS, GAP_OPTIONS, SECTION_LABELS, THEME_COLOR_FIELDS), pure utils (getFontFamilyCSS, getRemainingTime, moveSection, updateSection, getSelectValue, SelectValueEvent), shared leaf components (SectionHeader, CopyableValue, LimitItem, SearchPreview, CharCounter, DeviceCard, ColumnChips) |
| `StorefrontThemeEditor.tsx` | 752–1136 | ~385 | AppearanceSection → rename to default export StorefrontThemeEditor. Props: `business`, `entitlements`, `initialStorefrontTheme`, `initialHasCustomTheme`, `initialScheme`, `isOwner`, `permissions`. |
| `TeamManagementPanel.tsx` | 2202–2766 | ~565 | TeamSection → rename. Full team CRUD: member list, invitation code with rotation, permissions modal (uses PermissionsMatrix), delete confirmation dialog. |
| `PaymentsConfig.tsx` | 2768–3082 | ~315 | PaymentsSection → rename. Culqi credential form, key visibility toggles, status display, config dialog. |
| `useSettingsState.ts` | new | ~35 | `useSnackbarFeedback()` hook. Encapsulates `{ open, description, color, icon }` pattern used in 4 sections. Returns `{ feedback, showSuccess(msg), showError(msg), close }`. |

### After extraction: `SettingsClient.tsx` (~1130 → ~300 lines)

Remaining inline: BusinessSection (242–735), PlanSection (1157–1358), LegalSection (1388–1467), StorefrontSectionEditor (1606–1906), SEOSection (1961–2200), plus the orchestrator (3084–3249). Initial imports and `'use client'` directive.

## File Changes

| File | Action | Description |
|---|---|---|
| `app/[slug]/settings/constants.ts` | Create | Types, constants, pure utilities, shared leaf components |
| `app/[slug]/settings/hooks/useSettingsState.ts` | Create | `useSnackbarFeedback()` hook (create dir `hooks/`) |
| `app/[slug]/settings/components/StorefrontThemeEditor.tsx` | Create | Theme customization panel (extracted AppearanceSection) |
| `app/[slug]/settings/components/TeamManagementPanel.tsx` | Create | Team management panel (extracted TeamSection) |
| `app/[slug]/settings/components/PaymentsConfig.tsx` | Create | Payments config panel (extracted PaymentsSection) |
| `app/[slug]/settings/components/SettingsClient.tsx` | Modify | Remove extracted code, import from new files, re-export SettingsBusiness type |
| `app/[slug]/settings/page.tsx` | Modify | Update import path for `SettingsBusiness` type (from `./components/SettingsClient` → `./constants`) |

## Interfaces / Contracts

```typescript
// Each extracted component follows this uniform props shape:
interface SectionProps {
  business: SettingsBusiness;
  entitlements: Entitlements;
  isOwner: boolean;
  permissions: Permission[];
}

// Specialized additions:
// StorefrontThemeEditor adds:
interface StorefrontThemeEditorProps extends SectionProps {
  initialStorefrontTheme: StorefrontTheme;
  initialHasCustomTheme?: boolean;
  initialScheme?: 'light' | 'dark';
}

// useSnackbarFeedback hook:
interface SnackbarFeedback {
  feedback: { open: boolean; description: string; color: 'success' | 'error'; icon: string };
  showSuccess: (description: string) => void;
  showError: (description: string) => void;
  close: () => void;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `useSnackbarFeedback` hook | Render hook in test, call showSuccess/showError, assert state transitions |
| Integration | Each extracted component renders with mock props | Render with test data, assert key elements render, no crashes |
| E2E | Settings page loads fully | Existing E2E tests pass (no visual regressions) |

No new test files required — existing tests must pass with zero changes. Component extraction preserves all JSX and behavior.

## Migration / Rollout

No migration required. Each extraction is one reverting commit:
1. `constants.ts` + `useSettingsState.ts` — no behavioral impact
2. `StorefrontThemeEditor.tsx` — move block, verify build
3. `TeamManagementPanel.tsx` — move block, verify build
4. `PaymentsConfig.tsx` — move block, verify build
5. Final cleanup: re-export types from SettingsClient for backward compat in page.tsx

## Open Questions

- None — all extraction boundaries are unambiguous.
