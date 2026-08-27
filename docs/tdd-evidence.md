# TDD Evidence

Observed commands and outcomes from implementation. Sensitive values are omitted.

## WU-1: PostgreSQL foundation

- RED: `npm run test:integration -- test/database-schema.integration.spec.ts` -> exit `1`; required constraint list was empty.
- GREEN: same command -> `1/1` passed after the explicit migration.
- REFACTOR: migration up/down/up and focused rerun -> `1/1` passed; configuration parsing is shared.
- Runtime: PostgreSQL 17.6 became healthy through Compose.
- Rollback: database/config/test harness only.
- Commit: `f462d58`.

## WU-2: Domain invariants

- RED: focused state/fingerprint command -> exit `1`; `5` failed and `5` passed for terminal transition, invalid money, and canonical serialization.
- GREEN: same command -> `10/10` passed.
- REFACTOR: full unit plus focused rerun -> `11/11` and `10/10` passed at that work-unit boundary.
- Runtime: N/A; pure domain behavior.
- Rollback: `src/cash-in/domain`.
- Commit: `f634994`.

## WU-3: HTTP and multi-pod arbitration

- RED: focused idempotency e2e -> exit `1`; five same-process application instances shared one operation but made `5` provider calls.
- GREEN: same command -> `2/2` passed after only the PostgreSQL insert winner could charge.
- REFACTOR: unit, lint, build, focused rerun -> green.
- Runtime: five Nest instances shared PostgreSQL and one UUID key concurrently.
- Rollback: Cash-In HTTP/module/ports/adapters/correlation behavior.
- Commit: `10e048a`.

## WU-4: Atomic success

- RED: focused success e2e -> exit `1`; returned `202` instead of `200` and no credit.
- GREEN: same command -> `1/1` passed with one ledger row, `10000` balance, and replay.
- REFACTOR: integration, lint, build, focused rerun -> green.
- Runtime: repeated request plus direct ledger/wallet assertions.
- Rollback: success orchestration and finalizer.
- Commit: `dec3945`.

## WU-5: Rejection and conflict

- RED: focused failure e2e -> exit `1`; confirmed rejection remained `202`; conflict already passed.
- GREEN: same command -> `2/2` passed with stable `PAYMENT_DECLINED`, `409` conflict, one provider call, and no ledger.
- REFACTOR: unit, lint, build, focused rerun -> green.
- Runtime: rejection replay and conflict were exercised through HTTP and PostgreSQL.
- Rollback: rejection/conflict mapping.
- Commit: `42f3deb`.

## WU-6: Unknown outcome

- RED: focused timeout e2e -> exit `1`; status remained `payment_requested`.
- GREEN: same command -> `1/1` passed with stable `AWAITING_CONFIRMATION`, one attempt, and no ledger.
- REFACTOR: unit, lint, build, focused rerun -> green.
- Runtime: client retry observed the same operation/provider key.
- Rollback: uncertain-result transition.
- Commit: `6b82c30`.

## WU-7: Webhooks

- RED: focused webhook e2e -> exit `1`; controllable delayed-provider/webhook behavior did not exist.
- GREEN: same command -> `1/1` passed; duplicate delivery credited once, old event was ignored, invalid HMAC was rejected, and late success was a no-op.
- REFACTOR: integration, lint, build, focused rerun -> green.
- Runtime: signed success arrived twice before the delayed provider response.
- Rollback: webhook controller/DTO/verifier/inbox/delayed fake.
- Commit: `26db310`.

## WU-8: Concurrency and delivery

- RED: the exact two-credit scenario initially passed because WU-4 already used the required atomic upsert. A bounded transient-retry scenario was then added and the focused integration command exited `1` on simulated `40P01` (`1` failed, `1` passed). This sequencing deviation is explicit rather than inventing a failure.
- GREEN: focused integration -> `2/2` passed after one bounded retry was implemented.
- REFACTOR: formatter/check, lint, build, unit `10/10`, integration `3/3`, e2e `7/7`, and focused rerun all passed.
- Runtime: two operations finalized concurrently to balance `3000` with both ledger IDs.
- Rollback: bounded retry and reviewer-documentation refinement.
- Commit: this work-unit commit; see Git history.

## Final verification

- Empty database migration: up/down/up succeeded.
- Unit: `2` files, `10` tests passed.
- Integration: `2` files, `3` tests passed.
- E2E: `5` files, `7` tests passed.
- Coverage: statements `100%`, branches `88.88%`, functions `100%`, lines `100%` for the unit-test scope.
- Formatting, lint, build, and `git diff --check`: passed.

## Independent-review correction

- RED unit: focused configuration/money command -> `2` failures; production silently accepted known defaults and `9007199254740993` minor units formatted as `.92` instead of `.93`.
- RED integration: focused wallet command -> `1` failure; a late success rewrote `FAILED` to `COMPLETED` and credited the ledger.
- RED e2e: focused timeout/webhook command -> `4` failures; thrown timeout returned `500`, uncertain retry stayed `202`, failure webhook returned `400`, and changed duplicate identity returned `202`.
- GREEN: focused unit `11/11`, integration `3/3`, and corrected timeout/webhook/success e2e `9/9` passed.
- REFACTOR: formatter/check, lint, build, unit `13/13`, integration `4/4`, e2e `14/14`, coverage, production audit, and diff check passed.
- Runtime: real PostgreSQL proved terminal-state protection, exact `BIGINT` balances, migration identity column, restart recovery, status reconciliation, failure webhook, and immutable duplicate rejection. The `40P01` case remains explicitly a retry-policy simulation, not evidence of a real deadlock.
