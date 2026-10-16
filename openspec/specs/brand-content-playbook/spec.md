# Brand Content Playbook Specification

## Purpose

Provide an in-repo brand brain for Store_Lite: a versioned Playbook that defines voice and tone, ICP (Peruvian small business), content pillars, per-platform rules, and CTA patterns, plus a knowledge index that lets the content-manager skill load only task-relevant brand documents.

## Requirements

### Requirement: Playbook presence and location

The repository MUST contain `docs/BRAND_CONTENT_PLAYBOOK.md` as the single source of truth for brand content guidance.

#### Scenario: Playbook exists

- GIVEN the Store_Lite repository
- WHEN brand content guidance is requested
- THEN `docs/BRAND_CONTENT_PLAYBOOK.md` exists

### Requirement: Playbook content and versioning

The Playbook MUST define voice and tone, the ICP (Peruvian small business), content pillars, per-platform rules, and CTA patterns, and MUST include explicit off-brand examples; it MUST be versioned.

#### Scenario: Required sections present

- GIVEN the Playbook
- WHEN its sections are inspected
- THEN voice/tone, ICP, pillars, per-platform rules, and CTA patterns are present
- AND a version identifier is recorded

#### Scenario: Off-brand examples actionable

- GIVEN a draft that violates a pillar
- WHEN the Playbook is consulted
- THEN a matching off-brand example clarifies the correction

### Requirement: Knowledge index manifest

The repository MUST contain `brand/knowledge-index.yaml` declaring `always_load` documents and a tagged document manifest so the skill loads only task-relevant docs.

#### Scenario: Selective loading

- GIVEN a task tagged `audience`
- WHEN the index is resolved
- THEN `always_load` docs plus only tag-matching docs are selected

#### Scenario: Unmatched docs skipped

- GIVEN a task whose tags match no catalog doc
- WHEN the index is resolved
- THEN only `always_load` docs are loaded

### Requirement: Gitignore whitelist

The repository `.gitignore` MUST whitelist `docs/BRAND_CONTENT_PLAYBOOK.md` and `brand/**` despite an existing `*.md` ignore rule, so the brand brain stays version-controlled.

#### Scenario: Playbook tracked

- GIVEN the repository `.gitignore`
- WHEN the Playbook and `brand/**` are checked
- THEN both are whitelisted and not ignored

#### Scenario: Other markdown still ignored

- GIVEN an unrelated generated `*.md` file
- WHEN `git status` is run
- THEN it remains ignored

## Out of Scope

Hosting the brand brain inside the engine, and any automated brand-doc generation, are excluded.
