# TDD Evidence

This log contains commands and outcomes observed during implementation. Values that could expose credentials or business tokens are intentionally omitted.

## WU-1: Reproducible PostgreSQL foundation

- RED: `npm run test:integration -- test/database-schema.integration.spec.ts` -> exit `1`; `applies the initial migration with the required financial constraints` received an empty constraint list.
- GREEN: the focused command -> `1/1` passed after the explicit migration created the four required constraints.
- REFACTOR: migration up/down/up plus the focused command -> `1/1` passed; configuration parsing is shared by the CLI data source.
- Runtime: `docker compose -f compose.test.yaml up -d --wait` -> PostgreSQL 17.6 became healthy; migration up/down/up succeeded.
- Rollback: remove the database/config/test harness and revert dependency/script changes.
- Commit: pending.
