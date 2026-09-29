# PARTNER-PROVISION-REPAIR-001 — Phase 1 read-only checkpoint

**Status:** Diagnosis only. No repair authorized or performed. The corrected Stage 2F one-shot must not be rerun. `PARTNER-PROVISION-001` remains blocked.

## Evidence boundary

- The production one-shot exited nonzero after the private runner's read-only preflight. Its Vitest output was held only in memory and discarded to avoid disclosing production values. The exact failure assertion and elapsed time are unavailable.
- A subsequent inspection used the sanctioned direct database binding, the pinned TLS root, `default_transaction_read_only=on`, `BEGIN READ ONLY`, and a verified read-only session. The target was selected by an email typed at a hidden owner prompt. No target identity or connection value is retained here.
- That inspection found exactly one matching user and one membership in the intended organization with role `sales`. Both credential hash and algorithm are present. There are two users and two memberships in total, including one owner membership. The target has zero invitations, consumed or otherwise. The user was disabled and did not satisfy the Invitations directory predicate. The stored display name matched neither the value entered into the inspector nor the earlier generic default. The stored value was not printed.
- The post-run event count was observed read-only, but the pre-run value was not retained. Therefore no unchanged-events claim is possible from this evidence.
- The private runner used for the failed attempt requested a display name at a hidden prompt and passed that input as `ASCEND_PARTNER_NAME`. The task definition's assertion that the runner passed a hard-coded default describes an earlier runner revision, not the attempt that failed. The actual stored name has not been printed or independently established.

## What the code explains

1. **Why Invitations omits the account.** `apps/os/core/auth/directory.ts:118-123` filters `u.disabled_at IS NULL` in `listOrganizationMembers()` before rendering Admin → Invitations. The read-only inspection found this account disabled, so its omission is the expected behavior of that query.
2. **Why a failed one-shot can leave the account disabled.** The final test at `apps/os/tests/db/production-2f-partner.test.ts:153-163` first sets `disabled_at = now()`, then checks `resolvePrincipal()`, and only afterward clears `disabled_at`. There is no `try/finally` around the clearing statement. The observed disabled state is consistent with the test stopping between those two writes. `apps/os/core/auth/principal.ts:95` returns reason `disabled` when it reads a non-null `disabled_at`. The final test has no enclosing transaction to roll back the first update on failure.
3. **What caused the stop remains unproven.** `apps/os/vitest.config.mts` has no test timeout override; the installed Vitest 4.1.10 package defaults to 5 seconds for a Node test. A timeout on remote round trips is possible, as is an assertion or connection failure in the final test. The withheld output prevents distinguishing them from this evidence. Neither is asserted as fact.
4. **Display name requires an owner decision.** The stored value equals neither the intended input used for inspection nor the earlier generic default. The hidden value entered during the failed run was not recorded, so the evidence cannot distinguish an input discrepancy from an incorrect stored value. The current task's hard-coded-name premise is inaccurate for the executed runner.

## Proposed bounded Phase 2, pending separate owner approval

After a fresh read-only recheck identifies exactly one target user with exactly one `sales` membership in the intended organization and confirms that the target is not the owner, use one direct-connection transaction to clear `disabled_at` on that user alone. Update `display_name` on that same user only if the owner explicitly chooses a value after the stored-name question is resolved. Each update must affect exactly one row or the transaction rolls back. Do not change credentials, memberships, invitations, events, schema, migrations, or application code. Read back the result in a separate read-only session and compare aggregate and owner-row fingerprints captured before the repair. The owner then checks Invitations in the UI.

The proposed mutation is limited to these parameterized statements, after fresh preconditions and explicit approval. `$1` is the privately entered target email; `$2` is the single row identifier returned by the locked SELECT; `$3` is an optional privately entered display name. No parameter value belongs in the checkpoint or Coordinator output.

```sql
BEGIN;
SELECT u.id
  FROM users u
 WHERE lower(u.email) = lower($1)
   AND u.disabled_at IS NOT NULL
   AND (SELECT count(*) FROM memberships m WHERE m.user_id = u.id) = 1
   AND EXISTS (
     SELECT 1 FROM memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = u.id AND m.role = 'sales' AND o.slug = 'ascend'
   )
   AND NOT EXISTS (
     SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.role = 'owner'
   )
 FOR UPDATE OF u;
-- Require exactly one selected row; otherwise ROLLBACK.
UPDATE users SET disabled_at = NULL
 WHERE id = $2 AND disabled_at IS NOT NULL
 RETURNING id;
-- Require exactly one updated row; otherwise ROLLBACK.
-- Only if separately approved:
UPDATE users SET display_name = $3 WHERE id = $2 RETURNING id;
-- Require exactly one updated row if used; otherwise ROLLBACK.
COMMIT;
```

The one-shot needs a separate reviewed test repair: guarantee that the revocation probe restores `disabled_at` in `finally`, and set an explicit timeout suitable for the sanctioned remote proof. This checkpoint does not change the test or run it again.

**Stop point:** Await owner review of this diagnosis and explicit authorization for the exact Phase 2 statements. No invitation should be issued while the account remains disabled. Partner sign-in and P8 remain pending.
