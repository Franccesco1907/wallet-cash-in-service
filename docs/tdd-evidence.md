# TDD Evidence

This log contains commands and outcomes observed during implementation. Values that could expose credentials or business tokens are intentionally omitted.

## WU-1: Reproducible PostgreSQL foundation

- RED: `npm run test:integration -- test/database-schema.integration.spec.ts` -> exit `1`; `applies the initial migration with the required financial constraints` received an empty constraint list.
- GREEN: the focused command -> `1/1` passed after the explicit migration created the four required constraints.
- REFACTOR: migration up/down/up plus the focused command -> `1/1` passed; configuration parsing is shared by the CLI data source.
- Runtime: `docker compose -f compose.test.yaml up -d --wait` -> PostgreSQL 17.6 became healthy; migration up/down/up succeeded.
- Rollback: remove the database/config/test harness and revert dependency/script changes.
- Commit: pending.

## WU-6: Unknown provider outcome and safe retry

- RED: `npm run test:e2e -- test/cash-in-timeout.e2e-spec.ts` -> exit `1`; timeout remained `payment_requested` instead of `awaiting_confirmation`.
- GREEN: focused e2e -> `1/1` passed with stable `AWAITING_CONFIRMATION`, one provider attempt, and no ledger.
- REFACTOR: unit suite, lint, build, and focused rerun -> green; provider result translation remains behind the provider port.
- Runtime: retry returned the same operation/provider key, one provider attempt, and zero ledger rows.
- Rollback: remove unknown-result transition while retaining confirmed success/failure flows.
- Commit: pending.

## WU-5: Confirmed rejection and idempotency conflict

- RED: `npm run test:e2e -- test/cash-in-failure.e2e-spec.ts` -> exit `1`; confirmed rejection remained `202` instead of stable terminal `422` while conflict already passed.
- GREEN: focused e2e -> `2/2` passed; rejection replayed `PAYMENT_DECLINED`, conflict returned `409`, and provider calls remained one.
- REFACTOR: unit suite, lint, build, and focused rerun -> green; public errors expose stable codes rather than provider details.
- Runtime: e2e asserted one provider call and zero ledger rows for rejection/conflict paths.
- Rollback: remove rejection state/result mapping while preserving success and arbitration.
- Commit: pending.

## WU-4: Atomic successful finalization

- RED: `npm run test:e2e -- test/cash-in-success.e2e-spec.ts` -> exit `1`; success returned `202` instead of `200` and produced no wallet credit.
- GREEN: focused e2e -> `1/1` passed with one ledger row, `10000` minor-unit balance, and replayed `200` response.
- REFACTOR: integration suite, lint, build, and focused rerun -> green; shared typed completion result and transaction-scoped manager retained.
- Runtime: the e2e scenario repeats the request and inspects PostgreSQL ledger and wallet rows.
- Rollback: remove success result mapping and `finalizeCompleted`; retain arbitration and schema.
- Commit: pending.

## WU-3: HTTP boundary and multi-pod idempotency arbitration

- RED: `npm run test:e2e -- test/cash-in-idempotency.e2e-spec.ts` -> exit `1`; five independent app instances shared one operation but made `5` provider calls instead of `1`.
- GREEN: focused e2e -> `2/2` passed after only the PostgreSQL insert winner was allowed to charge.
- REFACTOR: unit suite, lint, build, and focused rerun -> green; header validation and HTTP mapping remain presentation concerns.
- Runtime: five Nest application instances shared PostgreSQL and received the same UUID key concurrently.
- Rollback: remove the Cash-In module, HTTP boundary, ports, adapters, correlation context, and e2e helper while retaining WU-1/WU-2.
- Commit: pending.

## WU-2: Domain invariants

- RED: `npm run test:unit -- src/cash-in/domain/operation-state.policy.spec.ts src/cash-in/domain/request-fingerprint.spec.ts` -> exit `1`; terminal transition, invalid-money, and canonical fingerprint expectations failed (`5` failed, `5` passed).
- GREEN: the focused command -> `10/10` passed after exact decimal parsing, fixed-field SHA-256 serialization, and state transition rules were implemented.
- REFACTOR: full unit suite plus focused rerun -> `11/11` and `10/10` passed; domain types remain flat and persistence-free.
- Runtime: N/A; this unit contains pure domain functions with no runtime boundary.
- Rollback: remove `src/cash-in/domain` without affecting the database foundation.
- Commit: pending.
