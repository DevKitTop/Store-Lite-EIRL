# Remote branch hygiene

Purpose: record which remote branches must NOT be deleted and why, so we do
not re-investigate them on every cleanup pass.

Last review: 2026-11-20.

## Keep — do not delete

| Branch                                   | Reason                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix/payments-webhook-dedup-fail-closed` | Has an OPEN PR (#393). Intended for future use (webhook dedup fail-closed + Sentry alerting). Not merged yet — keep until merged or explicitly abandoned. |
| `dependabot/**` (11 branches)            | Managed automatically by Dependabot. Do not touch manually.                                                                                               |

## Deleted in the 2026-11-20 cleanup (for reference)

Merged into `develop` via PR (safe to remove):

- `docs/pwa-research` — #394
- `feat/pwa-t21-push-subscriptions-schema` — #409
- `feat/pwa-t22-subscription-api` — #410
- `feat/pwa-t23-worker-handlers` — #411
- `feat/pwa-t24-web-push-sender` — #412
- `feat/pwa-t28-notification-endpoint-hardening` — #413
- `feat/pwa-t29-tests-device-matrix` — #414

Closed / parked, not merged (removed on request):

- `feat/social-publishing` — social publishing + brand/content-manager MCP engine.
  PRs #244 and #249 CLOSED without merge; parked work ("blocked on TikTok scope approval").
  Not in use. Recovery SHA: `3fde373edce66261067bb3e983e8b209f4f150f2`
  (`git push origin 3fde373edcee:refs/heads/feat/social-publishing` to restore).

## How to re-verify before deleting

1. `git fetch --prune origin`
2. `git branch -r --merged origin/develop` — catches fast-forward/merge-commit branches.
3. For the rest, cross-check with `gh pr list --state all --head <branch>`.

Gotcha: this repo merges PRs via squash, so `git branch -r --merged` does NOT
detect merged branches — their commit hashes differ. Always confirm merge state
against GitHub PRs before deleting. A branch with an OPEN PR is never deleted.
