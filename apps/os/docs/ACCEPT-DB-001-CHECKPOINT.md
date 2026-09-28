# ACCEPT-DB-001 — Sales iPhone acceptance database

**Status: isolated acceptance preflight passed. Oscar's real-iPhone VoiceOver check remains pending.** No deploy or production migration is part of this checkpoint.

## Isolated target and schema

- The acceptance database is a separate, empty-start Supabase project named `ascend-2a2e-acceptance` in `us-west-1`. The owner approved its quoted $0/month cost. No production backup, business record, or owner credential was copied.
- Before any acceptance write, the direct and transaction-pooler bindings were checked against the isolated project identity and every configured production database binding in memory. The client refused a missing or matching identity. The acceptance direct connection used the repository's pinned, authenticated TLS path.
- Existing migrations `001_substrate.sql` through `010_sales_actions.sql` were applied in order to the isolated database. A read-only check found all ten ledger versions and their SHA-256 checksums identical to the source files. All four Sales action tables exist. The three Sales command functions exist with `SECURITY DEFINER`, empty `search_path`, and owner/sales execution grants; relevant table/column grants and denied sales updates were verified.
- A separate read-only production check found the production ledger still at 009, before the Sales action migration. Production was not migrated, seeded, or otherwise changed.

## Synthetic operator and real application check

- The existing `provisionAppLogin`, organization, membership, and credential mechanisms established a restricted application login plus exactly one synthetic organization, operator, and prospect. The synthetic prospect has a matching creation event. The application login has no superuser, BYPASSRLS, replication, role-creation, database-creation, inherited, or direct table authority; only the five intended assumable roles are granted. No production or vault values were used.
- Private connection and operator bindings live outside Git with file mode `0600`. The app connection uses the transaction pooler and passed the repository's TLS verification. No URL, password, token, key, or owner secret is in this report or tracked by Git. The application process is launched with only the isolated app binding and a synthetic session secret; `.env.production.local` is not sourced.
- The exact 2A.2e candidate was checked at SHA `b57393ec93ffb09c7c8f841f37c59e53ef98557b`, tree `40d135563d451b3d555968c419135ffac3cfb73f`. Its tracked tree remained clean and unchanged. On a local `127.0.0.1:3002` run of that candidate, the real login route returned 200 with a session cookie; `/sales/list` and the synthetic prospect detail page both returned 200 and rendered the synthetic prospect. A wrong password returned 401 without a session cookie, and anonymous Sales list access redirected. No missing-relation error occurred.

## Oscar's iPhone run

From a terminal, after stopping the existing local server on port 3001, run exactly:

```bash
node /private/tmp/accept-db-start.mjs
```

The private launcher checks that port 3001 is free, the candidate SHA/tree is exact and clean, the binding identifies the isolated project, pinned TLS succeeds, and the isolated database still has migration 010 and the synthetic seed. It then binds the normal Turbopack app to `0.0.0.0:3001`. If a check fails, it does not start the app. At checkpoint time, port 3001 was occupied by an existing server in the main repository, so that server must be stopped first. Oscar must perform and report the actual iPhone VoiceOver check; this checkpoint does not claim that result.

## Cleanup and scope

- After the iPhone check, stop the local acceptance server. When the isolated database is no longer needed, remove the synthetic acceptance project through its normal owner-controlled lifecycle, then delete the private launcher and binding files under `/private/tmp` and the temporary directory. Do not run cleanup against production.
- The only tracked change for ACCEPT-DB-001 is this checkpoint. The 2A.2e candidate implementation was not edited. `npm run typecheck` passed in the ACCEPT-DB-001 worktree. The local login/page checks are acceptance evidence, not a full gate receipt.
