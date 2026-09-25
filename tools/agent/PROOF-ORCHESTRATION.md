# COORD-PROOF-001 — Owner proof orchestration

The local `prove` command operates only on `COORD-PROOF-001` in its claimed, clean builder worktree. It neither updates Coordinator state nor publishes evidence. `freeze` remains the publishing boundary. Proof receipts stay in the private worktree Git directory and retain the existing HMAC, manifest, suite hash, phase, environment class, and exact-tree binding.

## Derived state machine

`CANDIDATE -> STATIC -> SERVER -> DB -> READ-ONLY RESIDUE -> FIXTURE -> OWNER CHECKPOINT -> R1B -> R1C -> AGGREGATE -> READY TO FREEZE`.

The driver checks HEAD, tree, and cleanliness before and after each phase. A phase with valid receipts for the same tree is skipped. A missing or invalid receipt causes that phase to run again. Any failure stops before READY; a changed tree invalidates the run and prior receipts cannot satisfy the final aggregate. The static phase has a receipt-only entry point; the direct `gate:static` command still aggregates and fails closed. Direct gate commands remain available for diagnosis.

## Authority boundaries

Server and DB proofs use three explicitly named URLs from the existing private `.env.production.local`: application pooled, application direct, and admin pooled. The server startup proof also receives the existing session secret required by its test. The test URL comes only from the admin pooled value. The disposable PostgreSQL binary is the retained 17.6 build. Each child gets an allowlisted environment. Fixture and artifact recovery get a fresh environment with no inherited PG, database URL, Supabase, or `NEXT_PUBLIC_SUPABASE_URL` names. Migration and hardening inputs are never passed. A read-only admin transaction checks the application-login fixture residue and two known scratch schemas after DB proof.

The current artifact is chosen by the unique `CURRENT recovery point` entry in the pinned legacy contract registry and its full SHA-256. Legacy v2 requires that exact contract ID; v3 carries its own contract. The existing recovery runner validates the artifact and executes R1b/R1c. For R1c the driver copies and hashes all 1,879 entries in the retained PostgreSQL 17.6 build into a private root under `~/.ascend-r1c/`, runs the existing two-leg test, stops remaining local clusters, and removes the root. A stop failure leaves the private root intact rather than deleting a live server's files.

The Codex invocation runs through fixture proof, then prints one owner action if owner receipts are absent. The owner runs `env -u ASCEND_AGENT npm run agent -- prove COORD-PROOF-001 --owner` in that same worktree and types the email once at a silent terminal prompt. The owner password is read only from the sanctioned local file and passed only to the isolated recovery child. Neither value appears in argv, history, Coordinator events, results, receipts, or logs. The command never impersonates a Coordinator human admin or unblocks a BLOCKED task. A green aggregate makes the exact tree eligible for builder freeze and human decisions governed by Coordinator.

The app driver suppresses raw child output; the Coordinator wrapper accepts only fixed, nonsecret progress lines. Gate logs and review manifest tails contain fixed pass/fail summaries, never raw child output. Tests use synthetic inputs and no production connection.
