# PARTNER-PROVISION-REPAIR-001 — diagnosis and bounded repair checkpoint

**Status:** Bounded repair completed after explicit owner authorization. The corrected Stage 2F one-shot was not rerun. `PARTNER-PROVISION-001` remains blocked pending normal review and promotion.

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
4. **The old display-name discrepancy cannot be attributed.** The pre-repair stored value equaled neither the intended input used for inspection nor the earlier generic default. The hidden value entered during the failed run was not recorded, so the evidence cannot distinguish an input discrepancy from an incorrect stored value. The current task's hard-coded-name premise is inaccurate for the executed runner. The owner later authorized replacing the stored value with a fresh privately entered name.

## Bounded Phase 2 and authorization

The repair required a fresh read-only recheck identifying exactly one target user with exactly one `sales` membership in the intended organization and confirming that the target was not the owner. A single direct-connection transaction cleared `disabled_at` and updated `display_name` on that user alone. Each update had to affect exactly one row or the transaction would roll back. Credentials, memberships, invitations, events, schema, migrations, and application code were outside the mutation. A separate read-only session compared the result with aggregate and owner-row snapshots captured before the repair. The owner must also check Invitations in the UI.

The owner explicitly authorized enabling this one partner and setting the display name supplied at a hidden prompt. The private repair runner repeated the read-only preflight before prompting for a second confirmation, then executed one transaction. `$1` is the privately entered target email; `$2` is the single row identifier returned by the locked SELECT; `$3` is the privately entered display name. No parameter value belongs in the checkpoint or Coordinator output.

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;
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
UPDATE users SET display_name = $3 WHERE id = $2 RETURNING id;
-- Require exactly one updated row; otherwise ROLLBACK.
COMMIT;
```

The runner reported **one selected row, one enabled row, and one renamed row**. It checked the owner row and non-target membership rows before commit; a mismatch would have rolled back. No other mutation statement was issued. The runner printed neither private input nor row content.

## Separate read-only verification

After the commit, the runner opened a separate read-only session. It reported one enabled user with the privately entered display name, credential hash and algorithm present, exactly one `sales` membership in the intended organization, and satisfaction of the Invitations directory predicate. The total user and membership counts remained **2 and 2**; the owner row and non-target membership rows matched their pre-repair snapshots; the event count was unchanged. No current event total is published here.

The owner separately confirmed that the repaired partner appears in Admin → Invitations. This UI observation corroborates the SQL directory-predicate check; neither the displayed identity nor a screenshot is published here.

The one-shot needs a separate reviewed test repair: guarantee that the revocation probe restores `disabled_at` in `finally`, and set an explicit timeout suitable for the sanctioned remote proof. This checkpoint does not change the test or run it again.

**Stop point:** No further production repair is authorized or needed on this evidence. Keep the original provisioning task blocked until this repair is accepted and promoted through Coordinator. Partner invitation, sign-in, and P8 remain pending.
