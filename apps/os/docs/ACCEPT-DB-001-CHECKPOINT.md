# ACCEPT-DB-001 — Sales iPhone acceptance database

**Status: isolated acceptance preflight passed. Oscar reported real-iPhone VoiceOver Save-flow PASS on the earlier port-3001 acceptance run.** The corrected port-3002 launcher has passed technical checks; a new iPhone run on that exact port has not been claimed. No deployment or production migration is part of this checkpoint.

## Isolated target and schema

- The acceptance database is a separate, empty-start Supabase project named `ascend-2a2e-acceptance` in `us-west-1`. The owner approved its quoted $0/month cost. No production backup, business record, or owner credential was copied.
- Before any acceptance write, the direct and transaction-pooler bindings were checked against the isolated project identity and every configured production database binding in memory. The client refused a missing or matching identity. The acceptance direct connection used the repository's pinned, authenticated TLS path.
- Existing migrations `001_substrate.sql` through `010_sales_actions.sql` were applied in order to the isolated database. A read-only check found all ten ledger versions and their SHA-256 checksums identical to the source files. All four Sales action tables exist. The three Sales command functions exist with `SECURITY DEFINER`, empty `search_path`, and owner/sales execution grants; relevant table/column grants and denied sales updates were verified.
- A separate read-only production check found the production ledger still at 009, before the Sales action migration. Production was not migrated, seeded, or otherwise changed.

## Synthetic operator and real application check

- The existing `provisionAppLogin`, organization, membership, and credential mechanisms established a restricted application login plus exactly one synthetic organization, operator, and prospect. The synthetic prospect has a matching creation event. The application login has no superuser, BYPASSRLS, replication, role-creation, database-creation, inherited, or direct table authority; only the five intended assumable roles are granted. No production or vault values were used.
- Private connection and operator bindings live outside Git with file mode `0600`. The app connection uses the transaction pooler and passed the repository's TLS verification. No database URL, password, token, key, or owner secret is in this report or tracked by Git. The private launcher passes only the isolated app database URL, synthetic session secret, Postgres prospect-source selection, and `ASCEND_VAULT_PATH` for a new private empty vault under `/private/tmp`, alongside ordinary process variables needed by Next. It does not source `.env.production.local` or pass any production database binding.
- The temporary vault was created with `mktemp -d`, mode `0700`, and only the three expected empty top-level folders. It has no symlinks or copied data. At launch, the private script rejects symlinks and verifies the temporary vault's realpath differs from the vault roots configured in `.env.local` and `.env.production.local`, comparing without printing those values. The Sales render left the temporary vault empty.
- The exact 2A.2e candidate was checked at SHA `b57393ec93ffb09c7c8f841f37c59e53ef98557b`, tree `40d135563d451b3d555968c419135ffac3cfb73f`. Its tracked tree remained clean and unchanged. A separate temporary staging directory was made from `git archive` of that commit and built with `next build --turbopack`; the private launcher serves that production-style build with `next start`. Through the exact port-3002 launcher, the real login route returned 200 with a session cookie; `/sales/list` and the synthetic prospect detail page both returned 200 and rendered the synthetic prospect. A wrong password returned 401 without a session cookie, and anonymous Sales list access redirected. The LAN login page and all ten of its JavaScript files returned 200. No vault-path or missing-relation error occurred.

## Oscar's iPhone run

From a terminal, run exactly:

```bash
node /private/tmp/accept-db-start.mjs
```

The private launcher checks that port 3002 is free, the candidate SHA/tree is exact and clean, the build proof matches that candidate, the binding identifies the isolated project, pinned TLS succeeds, migration 010 and the synthetic seed remain present, and the temporary vault is distinct from the real vault. It then serves the staged production-style build at `0.0.0.0:3002`. If a check fails, it does not start the app. Open `http://<Mac-LAN-IP>:3002` from the iPhone. Do not stop the production service on port 3001 for this test. Oscar's PASS was reported for the earlier isolated run on port 3001; a port-3002 VoiceOver PASS remains for Oscar to confirm.

## Cleanup and scope

- The first checkpoint incorrectly told Oscar to stop the server on port 3001. That port belonged to the existing production LaunchAgent as well as the temporary acceptance run; production was found unloaded during review. The acceptance listener was stopped, Oscar explicitly approved restoring the existing service, and `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.ascend.os.plist` succeeded. A read-only check then found the service running and its local login page responding 200 while acceptance remained separate on port 3002. No code deployment was performed.
- After the iPhone check, stop only the port-3002 acceptance server. Confirm `launchctl print gui/501/com.ascend.os` shows the production service running; if it is not loaded, the owner may restore the existing service with `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.ascend.os.plist`. When the isolated database is no longer needed, remove the synthetic acceptance project through its normal owner-controlled lifecycle, then delete the private launchers, bindings, staged build, and empty vault under `/private/tmp`. Do not run acceptance cleanup against production.
- The only tracked change for ACCEPT-DB-001 is this checkpoint. The 2A.2e candidate implementation was not edited. `npm run typecheck` passed in the ACCEPT-DB-001 worktree. The local login/page checks are acceptance evidence, not a full gate receipt.
