# TDD Development Plan

This document turns the architecture in [`implementation-plan.md`](./implementation-plan.md) into an executable development sequence. The implementation will proceed through eight reviewable work units, each using **RED -> GREEN -> REFACTOR** and keeping its tests, runtime evidence, documentation, and production code in the same commit.

## Quick path

1. Establish the PostgreSQL test harness and explicit migration.
2. Implement one invariant at a time through the eight work units below.
3. Record truthful RED, GREEN, and REFACTOR evidence as it is produced.
4. Run focused checks after every unit and the full verification suite before delivery.

Database invariants, concurrency tests, the uncertain-payment state, and the required documentation are protected scope. If the time box becomes tight, cut optional polish before cutting those guarantees.

## 1. Current state and gaps

The repository is a clean NestJS 12 scaffold on strict TypeScript 6 with Vitest 4. It currently has only the generated `Hello World` behavior and the challenge documentation.

| Area | Current state | Gap to close |
|---|---|---|
| Runtime | NestJS 12 scaffold | Replace the example endpoint with the Cash-In module and two required endpoints |
| Type safety | TypeScript 6 with `strict: true` | Preserve strictness; use runtime values plus derived types for states and results; never use `any` |
| Tests | One generated unit test; Vitest include is `**/*.spec.ts` | Separate unit, integration, and e2e configs so suites cannot be collected twice |
| Persistence | None | Add PostgreSQL, TypeORM, explicit migrations, constraints, transactions, and test cleanup |
| Configuration | Direct environment access | Add `@nestjs/config` with a Zod-validated environment schema |
| Validation | None | Add DTO validation and a global `ValidationPipe` |
| Idempotency | None | Add PostgreSQL arbitration, request fingerprints, stable provider keys, and replay semantics |
| Provider | None | Add a port and deterministic fake adapter for success, rejection, timeout, and delayed confirmation |
| Webhooks | None | Add authenticity validation, durable inbox, deduplication, ordering rules, and shared finalization |
| Observability | None | Add correlation context with `AsyncLocalStorage` and structured Nest logs |
| Delivery evidence | Architecture plan only | Add TDD evidence, AI-assistance record, README decisions, and reproducible commands |

The existing architecture document remains the source for the system design and financial invariants. This plan intentionally does not repeat its schema and state-machine explanations except where a development step needs them.

## 2. Agreed stack and tooling

| Concern | Choice | Development rule |
|---|---|---|
| Framework | NestJS 12 | One pragmatic `CashInModule`; no microservices, CQRS, or Saga framework |
| Language | TypeScript 6 strict | Const objects plus derived types for runtime enums; flat interfaces; `unknown` at untrusted boundaries; no `any` |
| Test runner | Vitest 4 | Separate configs; serial integration/e2e execution with `--no-file-parallelism`; never use Jest's unsupported `--runInBand` |
| Database | PostgreSQL | Source of truth for operation ownership, wallet balance, ledger, and webhook inbox |
| Persistence adapter | `@nestjs/typeorm`, TypeORM, `pg` | Use explicit transactions and the transaction-scoped entity manager |
| Schema evolution | Explicit TypeORM migrations | `synchronize: false` in all environments; migration up/down paths are executable |
| Configuration | `@nestjs/config` + Zod | Fail fast at bootstrap on invalid or missing values |
| HTTP validation | Global `ValidationPipe` | `transform: true`, `whitelist: true`, `forbidNonWhitelisted: true`; DTO classes retain runtime metadata |
| Correlation | Node `AsyncLocalStorage` | Accept or generate `X-Correlation-ID`; never use it as an idempotency key |
| Local test database | Docker Compose PostgreSQL | Healthcheck-gated, fixed documented version, isolated test database, deterministic reset |

Redis, Saga, brokers, an outbox, Testcontainers, and a real payment-provider SDK remain deferred. They do not improve the core proof required by this time-boxed challenge.

### Docker Compose instead of Testcontainers

Docker Compose is the deliberate first implementation choice, not a claim that it is universally superior.

| Consideration | Docker Compose now | Testcontainers later |
|---|---|---|
| Reviewer visibility | The database version, port, healthcheck, credentials, and lifecycle commands are explicit in one file | The lifecycle is hidden behind test bootstrap code unless the reviewer follows the library integration |
| Repository baseline | Requires Docker only; no additional Node test dependency or container-runtime adapter | Adds a library, hooks, cleanup behavior, and possible CI/runtime-specific troubleshooting |
| Repeatability | One documented database shared by serial integration/e2e suites | Strong per-suite isolation and random ports are valuable when parallel CI becomes necessary |
| Time-box risk | Low and familiar; failures can be inspected with normal Compose commands | Image pull, startup, and resource-reaper behavior increase setup surface during a 3-4 hour challenge |
| Known cost | Fixed ports and stale state must be managed with explicit reset/down commands | Extra startup cost and infrastructure coupling move into the test process |

Use a project-specific Compose name, a PostgreSQL healthcheck, and explicit migration/reset commands. Reconsider Testcontainers when parallel CI isolation or contributor port conflicts become a demonstrated problem.

## 3. Defensible contract assumptions

The challenge fixes the two route names but leaves parts of the provider and webhook contracts unspecified. The implementation must state these assumptions in the README rather than present them as facts about a real provider.

### Cash-In HTTP contract

- `POST /cash-in` requires an `Idempotency-Key` header containing a UUID.
- The request uses the field names from the challenge: `user_id`, `amount`, `currency`, and `payment_method`.
- `amount` is exact decimal text, must be positive, and may have at most two fractional digits. JSON numeric literals are rejected because precision can be lost before validation. It is converted once to integer minor units; persisted calculations never use floating-point amounts.
- `currency` is normalized to uppercase. The initial slice supports `PEN`; unsupported currencies fail validation instead of being silently accepted.
- `payment_method` is an opaque provider token. It is never logged.
- `200 OK` means the operation is confirmed complete and returns the replayable stored balance.
- `202 Accepted` means the same operation remains in a non-terminal or uncertain state; it is not proof of failure.
- `409 Conflict` means the idempotency key already belongs to a different normalized request.
- Confirmed provider rejection maps to a stable terminal application response and is replayed for the same request. The final HTTP status and error code must be documented and tested consistently rather than inferred from the provider message.

### Provider port contract

- A payment request accepts a stable `provider_request_key`/merchant reference derived from the operation, and the fake provider honors that key idempotently.
- The provider port returns a discriminated result: confirmed success, confirmed rejection, or unknown outcome. Transport exceptions are translated inside the adapter and do not leak into the application layer.
- Provider status lookup is safe and idempotent. A payment request is retried only with the same key and only when the provider contract guarantees idempotency.
- No database transaction remains open during a provider network call.

### Webhook contract

- `POST /webhooks/payment` receives a provider event ID, provider payment/reference ID, event type, event time or ordering value, and payload.
- The fake adapter verifies an HMAC signature over the raw request body. Missing or invalid signatures are rejected before business processing.
- A valid duplicate event receives a successful acknowledgement after the inbox uniqueness check; duplicate delivery is normal, not an error.
- An event is correlated through the stable merchant/operation reference, not through mutable user fields.
- Older events and repeated terminal events are idempotent no-ops. A contradictory terminal event is retained for reconciliation and does not reverse a completed credit.
- The API response and webhook path call the same transactional `finalizeCompleted` persistence operation.

## 4. Vitest scripts and suite boundaries

The implementation work will introduce dedicated configurations and scripts equivalent to:

```json
{
  "test:unit": "vitest run --config ./vitest.config.unit.ts --no-file-parallelism",
  "test:unit:watch": "vitest --config ./vitest.config.unit.ts --no-file-parallelism",
  "test:integration": "vitest run --config ./vitest.config.integration.ts --no-file-parallelism",
  "test:e2e": "vitest run --config ./vitest.config.e2e.ts --no-file-parallelism",
  "test:all": "npm run test:unit && npm run test:integration && npm run test:e2e"
}
```

Recommended suite patterns:

| Suite | Include | Database |
|---|---|---|
| Unit | `src/**/*.spec.ts` excluding integration/e2e suffixes | No |
| Integration | `test/**/*.integration.spec.ts` | Real PostgreSQL |
| E2E | `test/**/*.e2e-spec.ts` | Real PostgreSQL |

When selecting a focused file, pass it after the script separator, for example:

```bash
npm run test:integration -- test/idempotency.integration.spec.ts
```

`--no-file-parallelism` is kept in the script so independent Vitest files do not mutate the same test database concurrently. Concurrency inside a scenario is still created deliberately with `Promise.all`. `--runInBand` must never appear because it is a Jest flag, not a Vitest flag.

## 5. TDD evidence protocol

TDD evidence must describe what actually happened. It is not reconstructed after the implementation.

For every work unit:

1. **Prepare**: reset the relevant database state and state the invariant under test.
2. **RED**: add only the smallest test that expresses the missing behavior. Run the exact focused command. The expected failure must be an assertion about missing behavior, not a syntax error, missing dependency, unavailable Docker daemon, or broken fixture.
3. **Capture RED**: append the command, exit status, failing test name, and a short relevant failure excerpt to `docs/tdd-evidence.md`. Never claim a failure that was not observed.
4. **GREEN**: implement the minimum behavior needed for the focused test to pass. Run the same command and record its exact result.
5. **REFACTOR**: improve names, boundaries, duplication, and types without adding behavior. Run the focused suite again and record the unchanged green result.
6. **Broaden**: run the unit's quality gates, migration/runtime scenario, and all previously completed relevant suites.
7. **Commit**: commit the test, implementation, evidence, and any user-facing documentation together as one Conventional Commit.

Each entry in `docs/tdd-evidence.md` will use this shape:

```markdown
## WU-<n>: <behavior>

- RED: `<command>` -> exit `<code>`; `<test name>` failed because `<observed assertion>`.
- GREEN: `<same command>` -> `<passed>/<failed>` tests, duration `<observed>`.
- REFACTOR: `<command>` -> `<observed result>`; structural change: `<what changed>`.
- Runtime: `<command or scenario>` -> `<observed result>`, or `N/A` with a reason.
- Commit: `<sha>` (filled after commit).
```

Console excerpts must be short and free of secrets, complete webhook bodies, payment tokens, raw idempotency keys, and environment values.

## 6. Eight RED -> GREEN -> REFACTOR work units

### WU-1: Reproducible PostgreSQL foundation

**Objective:** provide a healthy test database, fail-fast configuration, and a reversible migration containing all four tables and their critical unique constraints.

**Exact RED test:** create `test/database-schema.integration.spec.ts` with `it('applies the initial migration with the required financial constraints')`. Run:

```bash
npm run test:integration -- test/database-schema.integration.spec.ts
```

The valid RED is an assertion that the migrated schema/constraints are absent. Infrastructure startup failure is not valid RED evidence.

**Minimum GREEN:** add dependencies, `compose.test.yaml`, validated configuration, TypeORM `DataSource`, migration scripts, and the initial up/down migration. Set `synchronize: false`. The test applies migrations to an empty database and inspects the required primary/unique constraints.

**REFACTOR:** centralize parsed database settings; keep migration configuration independent of Nest dependency injection; remove duplicated test lifecycle code.

**Evidence and commands:**

```bash
docker compose -f compose.test.yaml up -d --wait
npm run migration:run:test
npm run test:integration -- test/database-schema.integration.spec.ts
npm run migration:revert:test
npm run migration:run:test
```

**Expected files:** `compose.test.yaml`, `.env.test.example`, `src/config/*`, `src/database/data-source.ts`, `src/database/migrations/*`, `test/database-schema.integration.spec.ts`, Vitest config files, and script updates in `package.json`.

**Rollback boundary:** remove the database/config/test harness files and revert only the dependency/script changes introduced by this unit; the original Nest scaffold must still build.

**Suggested commit:** `test: establish PostgreSQL integration harness`

### WU-2: Domain states, money normalization, and request fingerprint

**Objective:** define pure domain rules before transport or persistence orchestration.

**Exact RED test:** create `src/cash-in/domain/operation-state.policy.spec.ts` with `it('rejects a transition from a terminal state')`. In the same RED cycle, table-test canonical money/fingerprint inputs in `request-fingerprint.spec.ts`. Run:

```bash
npm run test:unit -- src/cash-in/domain/operation-state.policy.spec.ts src/cash-in/domain/request-fingerprint.spec.ts
```

**Minimum GREEN:** introduce const-backed operation states/result kinds, valid transitions, terminal no-op behavior, decimal-to-minor-unit validation, normalized currency, canonical fixed-field serialization, and SHA-256 fingerprinting.

**REFACTOR:** keep state transitions and normalization pure; extract flat input types; eliminate transport and TypeORM imports from the domain.

**Evidence and commands:** focused unit command above, followed by `npm run test:unit` and `npm run lint`.

**Expected files:** `src/cash-in/domain/operation-state.ts`, `operation-state.policy.ts`, `money.ts`, `request-fingerprint.ts`, and colocated unit tests.

**Rollback boundary:** remove only `src/cash-in/domain`; no database or HTTP behavior depends on it before the next unit.

**Suggested commit:** `feat: define cash-in domain invariants`

### WU-3: HTTP validation, correlation context, and idempotency arbitration

**Objective:** expose a valid `POST /cash-in` boundary and prove that five concurrent requests with one key create one operation and authorize one provider call.

**Exact RED test:** create `test/cash-in-idempotency.e2e-spec.ts` with `it('authorizes one provider charge for five concurrent identical requests')`. Fire five requests through independently created application instances sharing PostgreSQL and the same instrumented fake-provider counter. Run:

```bash
npm run test:e2e -- test/cash-in-idempotency.e2e-spec.ts
```

**Minimum GREEN:** add DTO classes and global `ValidationPipe`, correlation middleware/interceptor backed by `AsyncLocalStorage`, application ports, module wiring, the controller, and PostgreSQL `INSERT ... ON CONFLICT DO NOTHING RETURNING` arbitration. Only the inserter may call the provider; duplicate requests load and compare fingerprints.

**REFACTOR:** isolate HTTP-to-application result mapping; keep provider and persistence tokens explicit; hash sensitive idempotency data before structured logging.

**Evidence and commands:** focused e2e command; invalid UUID/unknown-field request checks; `npm run test:unit`; `npm run lint`.

**Expected files:** `src/main.ts`, `src/cash-in/presentation/*`, `src/cash-in/application/*`, `src/cash-in/infrastructure/persistence/*`, `src/shared/observability/*`, `src/cash-in/cash-in.module.ts`, `test/cash-in-idempotency.e2e-spec.ts`, and e2e helpers.

**Rollback boundary:** revert the Cash-In module/controller, correlation context, application ports, and arbitration adapter while retaining WU-1 database tooling and WU-2 domain code.

**Suggested commit:** `feat: arbitrate concurrent cash-in requests`

### WU-4: Successful payment and atomic wallet finalization

**Objective:** turn a confirmed provider success into exactly one ledger entry, one atomic balance increment, one terminal operation, and a replayable `200` response.

**Exact RED test:** add `it('credits the wallet once and replays the stored completed response')` to `test/cash-in-success.e2e-spec.ts`. Run:

```bash
npm run test:e2e -- test/cash-in-success.e2e-spec.ts
```

**Minimum GREEN:** implement the success fake-provider behavior and `finalizeCompleted` as one TypeORM transaction using only its transaction-scoped entity manager. Insert the unique ledger entry, atomically update/upsert the wallet, mark the operation complete, and persist the resulting balance for replay.

**REFACTOR:** share a typed completion result between synchronous and future webhook callers; keep the external provider call outside the transaction.

**Evidence and commands:** focused e2e command; database assertions for one operation/ledger/balance update; repeat the request; `npm run test:integration`; `npm run lint`.

**Expected files:** fake provider adapter, finalization methods in the store adapter, completion application flow, fixtures, and `test/cash-in-success.e2e-spec.ts`.

**Rollback boundary:** revert success orchestration and finalization methods/tests without removing idempotency arbitration or the schema.

**Suggested commit:** `feat: finalize successful cash-in atomically`

### WU-5: Confirmed rejection and idempotency conflict

**Objective:** distinguish definitive business failure from uncertainty and reject reuse of a key with a different request.

**Exact RED test:** create `test/cash-in-failure.e2e-spec.ts` with `it('replays a confirmed provider rejection without crediting the wallet')` and `it('returns conflict when the same key is reused for a different payload')`. Run:

```bash
npm run test:e2e -- test/cash-in-failure.e2e-spec.ts
```

**Minimum GREEN:** map a confirmed provider rejection to `FAILED`, persist a stable failure code/response, replay it without a new provider call, and return `409` before provider access when fingerprints differ. Never create a ledger entry for either case.

**REFACTOR:** consolidate terminal replay mapping and redact provider details from public errors and logs.

**Evidence and commands:** focused e2e command; provider call count and zero-ledger assertions; `npm run test:unit`; `npm run lint`.

**Expected files:** provider result types/fake scenarios, application error/result mapping, controller mapping, persistence additions if required, and `test/cash-in-failure.e2e-spec.ts`.

**Rollback boundary:** remove rejection/conflict response mapping and their tests while preserving successful processing and arbitration.

**Suggested commit:** `feat: preserve terminal cash-in failures`

### WU-6: Unknown provider outcome and safe client retry

**Objective:** prove that a provider timeout creates `AWAITING_CONFIRMATION` and a client retry observes the same operation without issuing a blind second charge.

**Exact RED test:** create `test/cash-in-timeout.e2e-spec.ts` with `it('returns the same uncertain operation after a provider timeout without charging again')`. Run:

```bash
npm run test:e2e -- test/cash-in-timeout.e2e-spec.ts
```

**Minimum GREEN:** translate ambiguous transport/provider results to the unknown result kind, persist `AWAITING_CONFIRMATION`, return `202`, and replay that operation on identical retries. Add a safe status-query method to the provider port but do not add an automated scheduler.

**REFACTOR:** centralize provider-result-to-state decisions; ensure exception translation lives in the provider adapter, not in `CashInService`.

**Evidence and commands:** focused e2e command; assert one provider charge attempt, stable operation ID/provider key, no ledger entry; `npm run test:unit`; `npm run lint`.

**Expected files:** provider timeout/status-query contracts, fake behavior, application state handling, and `test/cash-in-timeout.e2e-spec.ts`.

**Rollback boundary:** remove uncertain-result handling and timeout scenario without changing confirmed success/failure behavior.

**Suggested commit:** `feat: preserve uncertain payment outcomes`

### WU-7: Durable, authenticated, duplicate-safe webhooks

**Objective:** persist valid provider events before processing and handle duplicate, old, and webhook-before-response delivery through the shared finalizer.

**Exact RED test:** create `test/payment-webhook.e2e-spec.ts` with `it('credits once when a successful webhook arrives twice before the provider response')`. Add table cases for invalid signature and an older event. Run:

```bash
npm run test:e2e -- test/payment-webhook.e2e-spec.ts
```

**Minimum GREEN:** add raw-body HMAC verification, webhook DTO/adapter, inbox insert protected by `provider_event_id UNIQUE`, correlation to the operation, ordering/no-op rules, and invocation of the existing `finalizeCompleted`. A late synchronous success becomes an idempotent no-op.

**REFACTOR:** keep signature verification provider-specific; share transition/finalization functions instead of duplicating webhook and synchronous paths.

**Evidence and commands:** focused e2e command; assert one inbox row for the duplicate ID, one ledger entry, one balance increment, signature rejection, and safe late response; `npm run test:integration`; `npm run lint`.

**Expected files:** `payment-webhook.controller.ts`, webhook DTO and signature adapter, inbox persistence/application handlers, and `test/payment-webhook.e2e-spec.ts`.

**Rollback boundary:** remove the webhook presentation/application/adapter code and tests while leaving synchronous Cash-In behavior intact.

**Suggested commit:** `feat: process payment webhooks idempotently`

### WU-8: Lost-update protection, operational evidence, and reviewer documentation

**Objective:** prove independent concurrent Cash-Ins cannot lose wallet updates, then finish the operational and decision record required for review.

**Exact RED test:** create `test/wallet-concurrency.integration.spec.ts` with `it('preserves both credits for concurrent operations on the same wallet')`. Run:

```bash
npm run test:integration -- test/wallet-concurrency.integration.spec.ts
```

**Minimum GREEN:** use an atomic wallet upsert/update or row lock inside finalization, retry only bounded PostgreSQL transient transaction failures, and prove the final balance equals both unique ledger credits. Complete correlation-log assertions, README runbook/architecture/limitations, `docs/tdd-evidence.md`, and the actual AI-assistance record.

**REFACTOR:** remove generated scaffold behavior, clarify naming and module exports, deduplicate test builders, and keep public documentation consistent with observed behavior.

**Evidence and commands:** focused integration command; a two-operation concurrency runtime scenario; then the full verification sequence in section 9.

**Expected files:** wallet finalization concurrency adjustment and tests, shared test builders, `README.md`, `docs/tdd-evidence.md`, and `docs/ai-assistance.md`.

**Rollback boundary:** revert the concurrency refinement and reviewer documentation as one unit only if WU-4's single-operation behavior remains correct; do not remove the ledger uniqueness or atomic transaction established earlier.

**Suggested commit:** `feat: protect concurrent wallet credits`

## 7. AI-assistance record

Create `docs/ai-assistance.md` when implementation starts and update it during each work unit. It must record real prompts and observed corrections, not a retrospective story designed to satisfy the rubric.

Start with the decisions already made:

1. Use pragmatic Hexagonal Architecture with only meaningful provider/store boundaries.
2. Keep PostgreSQL as the financial and idempotency authority.
3. Defer Redis because it would be an optimization, not the correctness boundary.
4. Defer Saga because there are no autonomous participating services or compensations in this slice.
5. Use Docker Compose rather than Testcontainers for a transparent, time-boxed integration harness.
6. Use Vitest's `--no-file-parallelism`, never the incompatible Jest `--runInBand` flag.

Use a table with these columns:

| Timestamp/work unit | Prompt or specification | Agent proposal/output | Risk or question reviewed | Human decision/correction | Executable evidence |
|---|---|---|---|---|---|

If an agent proposal is correct, say that it was accepted after review and link the confirming test. Do **not** invent an agent mistake. If a proposal is rejected, preserve enough of the original proposal and technical reason to show the correction without copying secrets or excessive transcript content.

## 8. Quality gates per work unit

Before committing a unit, all applicable checks must pass:

- [ ] The focused RED failure was behavior-based and recorded before production code.
- [ ] The same focused command passed at GREEN.
- [ ] The focused and relevant broader suites stayed green after REFACTOR.
- [ ] `npm run lint` passed.
- [ ] `npm run build` passed when the unit changed production TypeScript or configuration.
- [ ] `git diff --check` passed.
- [ ] Migration up/down/up succeeded when the unit changed schema.
- [ ] The runtime boundary was exercised, or evidence states `N/A` with a concrete reason.
- [ ] Test data, logs, and evidence contain no secrets or sensitive tokens.
- [ ] The unit has a clear rollback boundary and one Conventional Commit.

Coverage percentage is diagnostic, not a substitute for the scenario invariants. The critical proof is observable database state and provider-call count under concurrency.

## 9. Full verification before delivery

Run from a clean checkout with the documented test environment:

```bash
npm ci
docker compose -f compose.test.yaml up -d --wait
npm run migration:run:test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:cov
npm run lint
npm run build
git diff --check
docker compose -f compose.test.yaml down -v
```

The final report must state the exact observed results and environment prerequisites. A partial or unavailable command is reported as such; it is never converted into an assumed pass.

## 10. Delivery sequence and scope-cut rule

Deliver the units in order because each one consumes the stable contract produced by the previous unit. Do not split tests from the behavior they verify.

| Priority | Protect | Cut first if the 3-4 hour time box is at risk |
|---:|---|---|
| 1 | Migration constraints, distributed idempotency arbitration, unique ledger, atomic balance update | Additional abstractions, generic repositories, decorative domain types |
| 2 | Success, confirmed failure, uncertainty, duplicate/out-of-order webhook behavior | Automated reconciliation scheduler; retain the status-query port and documented manual path |
| 3 | Real PostgreSQL concurrency tests and truthful RED/GREEN evidence | Broad coverage targets and low-value controller permutations |
| 4 | README architecture/limits and AI-assistance record | Metrics exporter, dashboards, full tracing stack |
| 5 | Correlation-aware structured logs | Extra log fields beyond the rubric |

Never cut the required two endpoints, multi-pod idempotency proof, unknown timeout state, duplicate webhook protection, minimum required tests, or the explanation of AI-assisted decisions. If those cannot fit, stop at the last green work unit and state the missing scope honestly instead of publishing unverified behavior.

## 11. Primary documentation references

- [NestJS database and TypeORM integration](https://docs.nestjs.com/techniques/database)
- [NestJS validation](https://docs.nestjs.com/techniques/validation)
- [NestJS configuration](https://docs.nestjs.com/techniques/configuration)
- [NestJS Async Local Storage recipe](https://docs.nestjs.com/recipes/async-local-storage)
- [Node.js `AsyncLocalStorage`](https://nodejs.org/api/async_context.html#class-asynclocalstorage)
- [TypeORM PostgreSQL driver](https://typeorm.io/docs/drivers/postgres/)
- [TypeORM migration setup](https://typeorm.io/docs/migrations/setup/)
- [TypeORM transactions](https://typeorm.io/docs/transactions/)
- [PostgreSQL `INSERT ... ON CONFLICT`](https://www.postgresql.org/docs/current/sql-insert.html)
- [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [Vitest CLI options](https://vitest.dev/guide/cli)
- [Docker Compose startup order and healthchecks](https://docs.docker.com/compose/how-tos/startup-order/)
- [Testcontainers for Node.js](https://node.testcontainers.org/)

## 12. Final readiness checklist

- [ ] Docker is available and the Compose test database becomes healthy.
- [ ] Node/npm versions used for delivery are documented.
- [ ] Unit, integration, and e2e Vitest configs have mutually exclusive includes.
- [ ] All TypeScript remains strict and contains no `any`.
- [ ] Environment configuration fails fast through Zod.
- [ ] `synchronize` is disabled and migration up/down/up is proven.
- [ ] Five concurrent duplicate requests produce one operation and one provider call.
- [ ] Same key plus different payload returns `409` without provider access.
- [ ] Successful processing creates one ledger entry and one atomic balance increment.
- [ ] Confirmed failure creates no credit and is replayable.
- [ ] Timeout returns the same uncertain operation without a second blind charge.
- [ ] Duplicate, old, early, and late webhook cases are deterministic.
- [ ] Concurrent independent credits preserve the final wallet balance.
- [ ] Correlation logs exclude raw idempotency keys, payment tokens, and webhook bodies.
- [ ] Every work unit has observed RED, GREEN, REFACTOR, and runtime evidence.
- [ ] `docs/ai-assistance.md` contains actual prompts and reviewed decisions without invented mistakes.
- [ ] README explains architecture, idempotency, concurrency, retries, webhooks, assumptions, and limitations.
- [ ] Full verification is green and the repository is clean before push.

## Next step

Begin WU-1 by adding the schema integration test first. Do not add the migration until the test has produced a valid behavior-level RED result.
