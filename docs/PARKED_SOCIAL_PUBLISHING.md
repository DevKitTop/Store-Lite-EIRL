# Social Publishing (TikTok) — PARKED

> **Status: PARKED (2026-10-17).** This PR is a **draft on purpose — do not merge yet.**
> Blocked on TikTok granting the `video.publish` / `video.upload` scopes.
> See [Why it is parked](#why-it-is-parked) and the [Resume checklist](#resume-checklist).

## What exists

| Piece                                                        | Where                                                            | State                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------- |
| Publishing engine (MCP server + CLI)                         | `github.com/DevKitTop/social-content-engine` (**private**)       | Complete: 19 commits, 140 tests, typecheck + build green |
| Brand brain                                                  | `docs/BRAND_CONTENT_PLAYBOOK.md`, `brand/` (this branch)         | Complete                                                 |
| OpenSpec specs (3 capabilities)                              | `openspec/specs/` (this branch)                                  | Synced, verified byte-identical                          |
| Global MCP registration                                      | `~/.config/opencode/opencode.json` → `mcp.social-content-engine` | Registered                                               |
| Global skill                                                 | `~/.config/opencode/skills/social-content-manager/SKILL.md`      | Installed                                                |
| SDD artifacts (proposal / design / tasks / verify / archive) | Engram + `openspec/changes/social-publishing/` (local only)      | Archived                                                 |

## Why it is parked

The engine works end-to-end. The block is entirely on TikTok's side:

1. Adding the **Content Posting API product is not enough** — scopes must be added separately in the portal under `Scopes` → `Add Scopes`. Only `user.info.basic` is auto-added with the Login Kit.
2. Required scopes: `video.publish` + `video.upload`. Until they are granted, `/v2/auth/authorize/` returns `error=scope`.
3. Granting those scopes requires the app to pass TikTok review.

Earlier failures were different: `error=redirect_uri` (the public tunnel URL was never actually registered) and `error=non_sandbox_target`. The redirect URI issue is solved — see step 3 below.

## Resume checklist

1. TikTok portal → app → `Scopes` → **Add Scopes**: `video.publish`, `video.upload`.
2. Complete app review / approval.
3. Confirm the redirect URI is registered: `http://127.0.0.1:51789/callback` (Desktop tab). The portal accepts `127.0.0.1` but rejects `localhost`.
4. Re-create the user-level environment variables: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI=http://127.0.0.1:51789/callback`, `TIKTOK_SCOPES=user.info.basic,video.publish,video.upload`.
   Credentials live in the TikTok portal — **never commit them.**
5. Restart the OpenCode instance **from a fresh shell**. Each instance owns its own MCP process and inherits env at spawn; the Warp background daemon serves stale env.
6. MCP flow: `auth_start` → authorise logged in as the sandbox target account (portal → Sandbox → Target users) → `auth_callback`.
7. Verify: `get_creator_info` → `upload_draft` (dry run) → publish only with explicit confirmation.

## Known constraints

- `video.list` needs the Display API product, which is **not offered in the sandbox** → leave it out of `TIKTOK_SCOPES`.
- Unaudited apps can only post **private** content.
- The engine CLI auth path is unusable by design: the PKCE pending state lives in memory and the CLI builds a fresh engine per invocation → use the MCP path.
- The engine loopback server (`startLoopbackServer`) is implemented but **not wired into the MCP**; an external listener on port 51789 substitutes for it.
- Conflict status: as of `develop` @ `d3b9c70`, this branch merges **cleanly** (zero overlapping files).

## Future direction

The engine is intentionally a **standalone** repository, not part of Store_Lite. It is a generic publishing tool that can later host other providers (Bluesky, Mastodon and Telegram are free and easy), other MCP surfaces, or ship as its own service. That only makes sense if it lives apart.

## Related

- PR #244 (closed) — original draft, base `main`.
- This PR (draft, base `develop`) — parked anchor and off-machine backup for this work.
