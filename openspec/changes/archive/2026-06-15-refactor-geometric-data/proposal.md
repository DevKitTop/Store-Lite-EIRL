# Proposal: Refactor geometric.ts Data to JSON

## Intent

Move ~1994 lines of static pattern data from `src/data/patterncraft/geometric.ts` to a JSON file. When imported in client components, the TypeScript data inflates the initial JS bundle. Extracting to JSON enables dynamic fetch, shrinking bundle size with zero behavioral change.

## Scope

### In Scope
- Extract the `geometricPatterns` array into `public/patterns/geometric.json`
- Create `src/lib/patterns/loadPatterns.ts` (async loader for dynamic import)
- Update `src/data/patterncraft/geometric.ts` to import from JSON (maintains backward compat for barrel exports)
- Verify bundle size improvement via analyzer

### Out of Scope
- Refactoring other pattern files (gradients, decorative, effects) — defer to separate changes
- Runtime caching or memoization of loaded patterns
- Schema validation of the JSON file

## Capabilities

> No spec-level changes — pure refactor.

### New Capabilities
None

### Modified Capabilities
None

## Approach

1. Convert the `geometricPatterns` array to `public/patterns/geometric.json` — stringify `style` objects with multi-line CSS values as-is, preserving exact content
2. Rewrite `geometric.ts` to re-export from the loader while keeping the same named export for barrel compat
3. Create `loadPatterns.ts` that resolves server-side via `import()` and client-side via `fetch()`, returning `PatternCraftPattern[]`
4. Verify all imports through `src/data/patterncraft/index.ts` work identically

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/data/patterncraft/geometric.ts` | Modified | Rewritten to import from JSON via loader |
| `public/patterns/geometric.json` | New | Extracted pattern data as JSON |
| `src/lib/patterns/loadPatterns.ts` | New | Async loader helper (server: `import()`, client: `fetch`) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| JSON stringification corrupts multi-line CSS values | Low | Manual review of generated JSON + visual diff per pattern |
| Barrel exports (`index.ts`) break | Low | Keep `geometric.ts` as re-export shim — same named export |
| Client component import patterns change | Med | Loader handles both server/client transparently |

## Rollback Plan

Revert single commit — restores `geometric.ts` to current state, deletes `public/patterns/geometric.json` and `src/lib/patterns/loadPatterns.ts`.

## Dependencies

None.

## Success Criteria

- [ ] `geometricPatterns` array identical before/after (parsed data diff)
- [ ] All existing imports resolve without errors (`tsc --noEmit`)
- [ ] Bundle analyzer shows no geometric data in initial client JS
- [ ] `pnpm test:unit` passes
