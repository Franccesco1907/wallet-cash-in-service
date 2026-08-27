# TDD Evidence

This log contains commands and outcomes observed during implementation. Values that could expose credentials or business tokens are intentionally omitted.

## WU-1: Reproducible PostgreSQL foundation

- RED: `npm run test:integration -- test/database-schema.integration.spec.ts` -> exit `1`; `applies the initial migration with the required financial constraints` received an empty constraint list.
- GREEN: the focused command -> `1/1` passed after the explicit migration created the four required constraints.
- REFACTOR: migration up/down/up plus the focused command -> `1/1` passed; configuration parsing is shared by the CLI data source.
- Runtime: `docker compose -f compose.test.yaml up -d --wait` -> PostgreSQL 17.6 became healthy; migration up/down/up succeeded.
- Rollback: remove the database/config/test harness and revert dependency/script changes.
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
