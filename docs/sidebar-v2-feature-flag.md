# Sidebar v2 Feature Flag Documentation

## Overview

The new sidebar implementation (Sidebar v2) is controlled by a feature flag to enable safe rollout and instant rollback.

## Feature Flag

**Environment Variable:** `NEXT_PUBLIC_SIDEBAR_V2`

**Values:**

- `true` - Enables new Sidebar v2 (collapsible rail, expanded drawer, mobile overlay)
- `false` (or unset) - Uses legacy Navbar (floating, centered)

**Default:** `false` (legacy Navbar active by default)

## Enabling Sidebar v2

### Local Development

Create `.env.local` in project root:

```bash
NEXT_PUBLIC_SIDEBAR_V2=true
```

Then restart the dev server:

```bash
pnpm dev
```

### Vercel Deployment

1. Go to Vercel Dashboard → Project Settings → Environment Variables
2. Add `NEXT_PUBLIC_SIDEBAR_V2` = `true`
3. Select environments: Production, Preview, Development
4. Redeploy

### Docker/Container

```dockerfile
ENV NEXT_PUBLIC_SIDEBAR_V2=true
```

## Rollback Procedure

### Instant Rollback (No Deploy Required)

Set environment variable to `false` or remove it:

```bash
NEXT_PUBLIC_SIDEBAR_V2=false
```

Or in Vercel: Remove the environment variable → Redeploy (or use instant rollback if configured)

### Code Rollback

If immediate code rollback needed:

1. Revert commit that modified `AppLayout.tsx`
2. Remove `sidebar.css` import from `AppLayout.tsx`
3. Revert `layout.css` token changes
4. Deploy

## Migration Timeline

| Phase                        | Description                                                             | Status         |
| ---------------------------- | ----------------------------------------------------------------------- | -------------- |
| **Phase 1: Foundation**      | Core components (Sidebar, NavSection, NavItem, UserMenu, hooks, tokens) | ✅ Complete    |
| **Phase 2: Navigation Data** | Permission/plan filtering, active route detection, keyboard navigation  | ✅ Complete    |
| **Phase 3: Integration**     | AppLayout integration, feature flag, CSS tokens, visual tests, docs     | 🔄 In Progress |
| **Phase 4: Cleanup**         | Remove feature flag, remove legacy Navbar, remove navbar.css            | ⏳ Planned     |

### Phase 4 Cleanup Checklist

- [ ] Remove `USE_SIDEBAR_V2` feature flag from `AppLayout.tsx`
- [ ] Remove legacy Navbar conditional rendering
- [ ] Remove `navbar.css` import from `AppLayout.tsx`
- [ ] Remove `navbar.css` file
- [ ] Remove `--navbar-width` and `--navbar-expanded-width` from CSS
- [ ] Update `layout.css` to use sidebar tokens exclusively
- [ ] Remove legacy localStorage key `navbarCollapsed` references
- [ ] Delete `Navbar.tsx`, `NavbarNotificationsBadge.tsx`, `navData.ts` (legacy)
- [ ] Update imports in all files
- [ ] Run full test suite
- [ ] Deploy to production

## Architecture

### Components

```
src/shared/components/navigation/
├── Sidebar.tsx          # Main sidebar component
├── SidebarHeader.tsx    # Header with workspace selector, search, create
├── NavSection.tsx       # Collapsible navigation sections
├── NavItem.tsx          # Individual navigation items
├── UserMenu.tsx         # User dropdown menu
├── WorkspaceSelector.tsx # Standalone workspace selector
├── types.ts             # TypeScript types
├── navData.ts           # Navigation item builder
├── activeRoute.ts       # Active route detection
└── index.ts             # Public exports
```

### Hooks

```
src/hooks/
├── useSidebarState.ts   # State persistence + cross-tab sync
├── useKeyboardNavigation.ts # Arrow key navigation
└── useMobileDrawer.ts   # Mobile drawer + focus trap
```

### Styles

```
src/styles/components/
├── sidebar.css          # All sidebar styles (MD3 tokenized)
└── layout.css           # Updated to use sidebar tokens
```

## CSS Tokens

All sizing uses CSS custom properties defined in `sidebar.css`:

```css
:root {
  --sidebar-width-collapsed: 72px; /* Rail width */
  --sidebar-width-expanded: 280px; /* Expanded drawer width */
  --sidebar-width-mobile: 320px; /* Mobile drawer width */
  --sidebar-transition-duration: 250ms;
  --sidebar-transition-easing: cubic-bezier(0.4, 0, 0.2, 1);
  --sidebar-header-height: 64px;
  --sidebar-item-height: 48px;
  --sidebar-item-radius: 12px;
  --sidebar-item-padding-x: 16px;
  --sidebar-icon-size: 24px;
  --sidebar-label-font-size: 0.9375rem;
  --sidebar-badge-size: 20px;
}
```

Layout CSS now references these tokens:

```css
.content-wrapper--expanded {
  margin-left: var(--sidebar-width-expanded);
}
.content-wrapper--collapsed {
  margin-left: var(--sidebar-width-collapsed);
}
```

## Cross-Tab Synchronization

Both `useBusinessSession` and `useSidebarState` use `localStorage` + `storage` event for cross-tab sync:

- Business session: `business:session` key
- Sidebar state: `sidebar:v1:state` key

Changes in one tab automatically reflect in other tabs.

## Keyboard Shortcuts

| Key                     | Action                           |
| ----------------------- | -------------------------------- |
| `Tab` / `Shift+Tab`     | Navigate between items           |
| `ArrowUp` / `ArrowDown` | Navigate within section          |
| `ArrowRight`            | Expand section / open submenu    |
| `ArrowLeft`             | Collapse section / close submenu |
| `Enter` / `Space`       | Activate item / toggle section   |
| `Escape`                | Close mobile drawer / dropdown   |
| `Home` / `End`          | First / last item in section     |

## Mobile Behavior

| Breakpoint         | Behavior                                                |
| ------------------ | ------------------------------------------------------- |
| `> 768px`          | Persistent rail (collapsed) or expanded drawer          |
| `≤ 768px`          | Overlay drawer (hidden by default, opens via hamburger) |
| Chat page + mobile | Sidebar completely hidden when drawer open              |

## Dark Theme

Automatically adapts via `body.dark` class using MD3 semantic tokens. No additional configuration needed.

## Reduced Motion

Respects `prefers-reduced-motion: reduce` - transitions disabled automatically.

## Testing

### Visual Regression

```bash
# Run visual tests
pnpm test:visual

# Update baselines
pnpm test:visual --update-snapshots
```

Test scenarios:

- Desktop rail (collapsed): 72px width, icons only
- Desktop expanded: 280px width, labels visible
- Mobile drawer: 320px overlay with backdrop
- Chat page mobile: sidebar hidden
- Chat page desktop: rail visible
- Dark theme: all states
- Reduced motion: transitions disabled

### Unit Tests

```bash
pnpm test
```

## Troubleshooting

### Sidebar not appearing

1. Check `NEXT_PUBLIC_SIDEBAR_V2=true` is set
2. Restart dev server after env change
3. Clear browser localStorage (`sidebar:v1:state`)
4. Check console for errors

### Layout shift on SSR

- Ensure `data-ssr` attribute is present on sidebar during hydration
- Check `.sidebar[data-ssr] { transition: none; }` in CSS

### Cross-tab sync not working

- Verify `storage` event listener is registered
- Check localStorage quota not exceeded
- Ensure same origin (not cross-origin iframes)

### Mobile drawer not opening

- Check `useMobileDrawer` hook is receiving correct state
- Verify `onCloseMobile` callback is provided
- Check z-index conflicts

## Related Files

- `src/shared/components/layout/AppLayout.tsx` - Integration point
- `src/styles/components/layout.css` - Content wrapper margins
- `src/styles/components/sidebar.css` - All sidebar styles
- `src/hooks/useSidebarState.ts` - State management
- `tests/visual/sidebar.spec.ts` - Visual regression tests
