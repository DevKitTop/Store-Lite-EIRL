# Content Publishing Engine Specification

## Purpose

Provide a zero-cost, official-API-only publishing engine for Store_Lite's own brand: a thin `ContentProvider` seam with a TikTok adapter, PKCE loopback OAuth, an encrypted token store outside any repository, rate-limited and deduplicated draft-first publishing, a double publish gate, and parity between a CLI and a single global MCP server. Direct public publishing is gated by TikTok app audit.

## Requirements

### Requirement: Provider seam and capability flags

The engine MUST expose a thin `ContentProvider` seam (`getCreatorInfo`, `createDraft`, `publish`, `getStatus`, `listPosts`) with explicit capability flags, and MUST support exactly one adapter (`tiktok`) at this time; it MUST NOT add speculative adapters.

#### Scenario: Capabilities reported

- GIVEN the engine is initialized with the TikTok provider
- WHEN the capability flags are read
- THEN `supportsDirectPublish` reflects audit + config
- AND `supportsScheduling` and `supportsMusicSelection` are false

### Requirement: TikTok OAuth with PKCE and loopback

The engine MUST obtain authorization via OAuth 2.0 with PKCE (`code_challenge_method=S256`) and a loopback redirect (`http://localhost:51789/callback`), MUST verify the returned `state`, and MUST exchange the authorization code for a `TokenSet`.

#### Scenario: Successful authorization

- GIVEN `auth_start` returns an authorize URL, state, and redirect URI
- WHEN the user grants access and TikTok redirects to `/callback?code=..&state=..`
- THEN the engine verifies state and exchanges the code with the PKCE verifier
- AND persists the resulting `TokenSet`

#### Scenario: State mismatch rejected

- GIVEN a callback whose state does not match the pending request
- WHEN the callback is handled
- THEN the exchange is refused and no tokens are persisted

### Requirement: Encrypted token storage outside repositories

The engine MUST store tokens encrypted with AES-256-GCM under `${SOCIAL_ENGINE_HOME}` (default `~/.config/social-content-engine`), MUST keep the 32-byte `master.key` and all state outside any repository, and MUST NOT write plaintext token material to disk, logs, or commits.

#### Scenario: Encrypted at rest

- GIVEN a saved `TokenSet`
- WHEN the token file is inspected
- THEN it contains only base64 IV, tag, and ciphertext
- AND no plaintext token appears anywhere under the repository

#### Scenario: Token material never logged

- GIVEN any engine operation that handles tokens
- WHEN logs are emitted
- THEN fields matching token/secret/verifier patterns are redacted

### Requirement: Atomic single-flight refresh rotation

The engine MUST refresh access tokens single-flight so concurrent callers share ONE in-flight refresh, MUST persist rotated tokens atomically (temp file then rename), and MUST treat access tokens as valid 24h and refresh tokens as valid 365d.

#### Scenario: Concurrent refresh shares one call

- GIVEN 10 concurrent `getValidAccessToken()` calls with an expired token
- WHEN refresh runs
- THEN exactly one token endpoint call is made
- AND the rotated `TokenSet` is persisted once

#### Scenario: Atomic write survives interruption

- GIVEN a rotation is in progress
- WHEN the process is interrupted before rename
- THEN the prior token file remains valid and uncorrupted

### Requirement: Rate limiting and pending-draft ceiling

The engine MUST enforce token-bucket limits per endpoint class (init 6/min, status 30/min, display 600/min) and MUST reject new draft creation beyond 5 pending drafts in any 24h window.

#### Scenario: Hard ceiling returns retry hint

- GIVEN the init bucket is drained
- WHEN a draft is requested
- THEN a `RateLimitedError` with `retryAfterMs` is returned

#### Scenario: Too many pending drafts

- GIVEN 5 unposted drafts created within 24h
- WHEN a sixth draft is requested
- THEN the request is rejected with a clear reason

### Requirement: Duplicate content prevention

The engine MUST compute a content hash (caption + media) and MUST reject a draft or publish whose hash was seen within a configurable window (default 24h), returning the prior timestamp and publish id.

#### Scenario: Duplicate within window

- GIVEN a successful draft recorded at T
- WHEN the identical content is submitted before T + window
- THEN a `DuplicateContentError` carrying the prior timestamp is returned

#### Scenario: Outside window allowed

- GIVEN a recorded hash older than the window
- WHEN the identical content is submitted
- THEN the request proceeds

### Requirement: Dry-run is the default

The engine MUST default `dryRun` to true and MUST perform NO network publish or upload when `dryRun` is true, returning a draft result with `dryRun: true`.

#### Scenario: Dry-run performs no network

- GIVEN a request with `dryRun: true` or omitted
- WHEN it is executed
- THEN no provider upload/publish request is issued
- AND the result reports `dryRun: true`

### Requirement: Double publish gate

The engine MUST require BOTH explicit user confirmation AND `confirm: true` for a public publish; if `allowDirectPublish` is false or `confirm` is not true, it MUST NOT publish and MUST return a typed no-op error.

#### Scenario: Confirm missing

- GIVEN `allowDirectPublish` is true and `confirm` is false or absent
- WHEN `publish_direct` is called
- THEN a `ConfirmationRequiredError` is returned and nothing is published

#### Scenario: Direct publish disabled

- GIVEN `allowDirectPublish` is false
- WHEN `publish_direct` is called with `confirm: true`
- THEN a `DirectPublishDisabledError` is returned and nothing is published

### Requirement: Unaudited-app handling

When TikTok rejects a public post with `unaudited_client_can_only_post_to_private_accounts`, the engine MUST surface a handled `UnauditedAppError` and MUST leave the draft (inbox) path functional.

#### Scenario: Unaudited public post handled

- GIVEN an unaudited app and a public direct publish attempt
- WHEN TikTok returns the unaudited error
- THEN the engine returns `UnauditedAppError`
- AND a subsequent draft request succeeds

#### Scenario: Draft path unaffected

- GIVEN an unaudited app
- WHEN a draft is uploaded
- THEN the draft succeeds regardless of audit status

### Requirement: Terminal status states

The engine MUST resolve `get_status` to a terminal state — `PROCESSING_UPLOAD`, `PROCESSING_DOWNLOAD`, `SEND_TO_USER_INBOX`, `PUBLISH_COMPLETE`, or `FAILED` — and MUST include `fail_reason` when the state is `FAILED`.

#### Scenario: Poll to terminal

- GIVEN a `publishId` in a non-terminal state
- WHEN `get_status` polls while respecting the status rate limit
- THEN it returns a terminal state

#### Scenario: Failure surfaced

- GIVEN a job that fails provider-side
- WHEN `get_status` resolves it
- THEN the state is `FAILED` with a `fail_reason`

### Requirement: CLI and MCP parity

The engine MUST expose the same operations through a CLI and an MCP server over ONE shared core library: `auth_start`/`auth_callback`, `get_creator_info`, `upload_draft`, `publish_direct` (disabled by default), `get_status`, `list_posts`.

#### Scenario: Same operations on both surfaces

- GIVEN the shared core library
- WHEN the CLI subcommands and the MCP tools are enumerated
- THEN both expose the same six operations

#### Scenario: MCP starts and lists tools

- GIVEN the engine MCP server is configured
- WHEN a client connects and lists tools
- THEN the six tools are returned

### Requirement: Single global MCP registration

The system MUST register exactly ONE `social-content-engine` entry in the global `~/.config/opencode/opencode.json` and MUST reconcile any duplicate `engram` entry only via an explicit opt-in, reversible, manual procedure that backs the file up first.

#### Scenario: One engine entry

- GIVEN the global config after registration
- WHEN the MCP entries are counted
- THEN exactly one `social-content-engine` entry exists

#### Scenario: Reversible reconciliation

- GIVEN a duplicate `engram` entry in `opencode.jsonc`
- WHEN the operator runs the opt-in reconciliation
- THEN a backup is created and the duplicate is removed
- AND the change can be rolled back from the backup

### Requirement: Operator documentation

The engine MUST document install, configuration, authentication, permissions, limitations, and token recovery, including how to re-authorize and rotate the `master.key`.

#### Scenario: Docs cover required topics

- GIVEN the engine repository
- WHEN an operator looks up the required topics
- THEN install, config, auth, permissions, limitations, and token recovery are each documented

### Requirement: TikTok API limitations are non-requirements

The engine MUST NOT implement features TikTok does not expose; it MUST treat as limitations, not requirements, that TikTok has NO comment API, NO profile-edit API, NO native scheduling, and NO specific-music selection (only the `auto_add_music` boolean). Photo posts MUST use `PULL_FROM_URL` with a verified URL prefix.

#### Scenario: No invented endpoints

- GIVEN the TikTok adapter
- WHEN its endpoint set is inspected
- THEN only documented TikTok endpoints are present, with none for comments, profile editing, scheduling, or music selection

#### Scenario: Photo post requires verified URL

- GIVEN a photo post submission
- WHEN the media source lacks a verified URL prefix
- THEN the engine reports the verified-URL-prefix limitation instead of publishing

## Out of Scope

Meta/X/LinkedIn adapters, per-tenant seller accounts, native scheduling (external queue/cron only), a new orchestrator, and any scraping-based integration are excluded.
