# Content Manager Skill Specification

## Purpose

Define the behavior of the global `social-content-manager` skill at `~/.config/opencode/skills/social-content-manager/`: it grounds drafts on the brand brain, drafts first, challenges off-brand or compliance risks, requires explicit confirmation before any public publish, and executes through the engine's confirm/dry-run rules.

## Requirements

### Requirement: Skill location and global scope

The skill MUST live at `~/.config/opencode/skills/social-content-manager/SKILL.md` and MUST be global, not repository-scoped.

#### Scenario: Skill is global

- GIVEN an OpenCode session in any repository
- WHEN skills are listed
- THEN `social-content-manager` is available

### Requirement: Grounds on the brand brain

Before drafting, the skill MUST load the brand brain — `docs/BRAND_CONTENT_PLAYBOOK.md` plus the tag-selected docs from `brand/knowledge-index.yaml` — and MUST cite which documents grounded the draft.

#### Scenario: Grounded draft

- GIVEN a content request
- WHEN the skill drafts
- THEN it loads the Playbook and tag-matched docs
- AND it reports which documents grounded the draft

### Requirement: Draft-first execution

The skill MUST default to the engine's draft (inbox) path (`upload_draft`) and MUST NOT initiate a public publish without completing the confirmation protocol.

#### Scenario: Default is draft

- GIVEN a content request with no publish confirmation
- WHEN the skill executes
- THEN it calls `upload_draft` and not `publish_direct`

### Requirement: Challenges off-brand and compliance risks

Before drafting, the skill MUST proactively flag unverifiable, off-brand, or non-compliant claims and MUST present that risk before proceeding.

#### Scenario: Off-brand request challenged

- GIVEN a request contradicting a content pillar or making an unverifiable claim
- WHEN the skill evaluates it
- THEN it states the specific off-brand/compliance risk before drafting

### Requirement: Explicit confirmation before publish

The skill MUST present the final caption, media path and kind, grounding docs, and an off-brand risk note, and MUST require a literal user confirmation before invoking the public path with the engine's `confirm: true`.

#### Scenario: Publish blocked without confirmation

- GIVEN a prepared draft and no literal user confirmation
- WHEN the user has not confirmed
- THEN no public publish occurs and the draft path is used

#### Scenario: Publish after confirmation

- GIVEN the user explicitly confirms to publish
- WHEN the skill invokes the public path
- THEN it passes `confirm: true` and the engine's double gate still applies

### Requirement: Dedupe-aware execution logging

The skill MUST record each executed draft/publish outcome, including when the engine rejects content as a duplicate, so repeated content is visible and not silently re-posted.

#### Scenario: Duplicate reported

- GIVEN identical content submitted within the dedupe window
- WHEN the engine returns a duplicate error
- THEN the skill surfaces the prior post and does not re-post

## Out of Scope

Defining a new orchestrator, and directly manipulating the engine's encrypted token store, are excluded.
