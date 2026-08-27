# Wallet Cash-In Service

A focused NestJS service demonstrating multi-pod idempotency, safe wallet credits, uncertain payment handling, and authenticated webhooks. PostgreSQL—not process memory or a distributed lock—is the financial authority.

## Quick start

Requirements: Node.js 24+, npm, and Docker Compose.

```bash
npm ci
docker compose -f compose.test.yaml up -d --wait
npm run migration:run:test
npm run test:all
```

Set `DATABASE_URL` and `WEBHOOK_SECRET` before `npm run start:dev`. Tear down tests with `docker compose -f compose.test.yaml down -v`.

## HTTP contracts

### `POST /cash-in`

Requires `Idempotency-Key: <UUID>`.

```json
{
  "user_id": "usr_abc123",
  "amount": 100.00,
  "currency": "PEN",
  "payment_method": "fake_success"
}
```

| Result | HTTP | Meaning |
|---|---:|---|
| `completed` | 200 | Confirmed once; stored balance is replayable |
| `awaiting_confirmation` | 202 | Provider outcome is unknown; no blind second charge |
| `failed` | 422 | Confirmed rejection; stable error is replayed |
| key conflict | 409 | UUID belongs to another normalized request |

The deterministic fake accepts `fake_success`, `fake_decline`, `fake_timeout`, and test-controlled `fake_delayed`. These are test scenarios, not a production provider contract.

### `POST /webhooks/payment`

Requires `X-Webhook-Signature`, a hexadecimal HMAC-SHA256 of the exact raw body using `WEBHOOK_SECRET`.

```json
{
  "event_id": "evt_1",
  "operation_id": "1e049f36-90e7-4bf8-a8f3-31efad401fd8",
  "type": "payment.succeeded",
  "sequence": 2,
  "provider_payment_id": "pay_1"
}
```

Valid duplicates and old events receive `202`; invalid signatures receive `401` before business processing.

## Architecture

```mermaid
flowchart LR
  HTTP[Controllers] --> APP[CashInService]
  APP --> STORE[CashInStorePort]
  APP --> PROVIDER[PaymentProviderPort]
  STORE --> PG[(PostgreSQL)]
  PROVIDER --> FAKE[Deterministic fake provider]
```

This is pragmatic Hexagonal Architecture. Ports exist only for volatile persistence and provider boundaries. There is no generic repository, command bus, CQRS layer, or framework-level Saga.

## Correctness model

### Idempotency and multiple pods

The request becomes integer minor units and fixed-field canonical data, then SHA-256. `INSERT ... ON CONFLICT DO NOTHING` against the unique key elects exactly one provider-call owner. Replays compare fingerprints before provider access. Unique constraints protect provider request, ledger operation, and provider event IDs.

### Money and concurrency

Persisted money uses `BIGINT`. Successful finalization locks the operation, inserts its unique ledger entry, atomically upserts `wallets.balance_minor = current + credit`, stores the resulting balance, and completes the operation in one transaction. Provider calls never occur inside it. PostgreSQL deadlock/serialization failures receive one bounded retry.

### Unknown outcomes

A timeout is `AWAITING_CONFIRMATION`, not failure. Retries receive the same operation and do not create a new provider request. If a provider offers neither idempotent requests nor canonical lookup, no service can guarantee both availability and no duplicate external charge; this service chooses safety and waits for reconciliation.

### Webhooks

HMAC verification uses the raw body. Events are serialized, persisted once, and compared with the latest operation sequence. Duplicate IDs are acknowledged, older sequences are retained as ignored, and success shares the synchronous transactional finalizer. A late response after an early webhook is therefore a no-op.

## Database and configuration

- TypeORM owns connections/migrations; parameterized SQL protects critical invariants.
- `synchronize: false` is mandatory.
- Zod 4 validates configuration at bootstrap.
- The explicit migration is tested up/down/up.
- `.env.example` contains placeholders only.

## Verification

| Suite | Command | Boundary |
|---|---|---|
| Unit | `npm run test:unit` | states, money, fingerprint |
| Integration | `npm run test:integration` | migration and real PostgreSQL concurrency |
| E2E | `npm run test:e2e` | HTTP, multi-instance arbitration, provider, webhook |
| Coverage | `npm run test:cov` | diagnostic unit coverage |
| Quality | `npm run format:check && npm run lint && npm run build` | static gates |

Database suites use Vitest `--no-file-parallelism`; `--runInBand` is an unsupported Jest option.

## Guarantees and limitations

Guaranteed locally: one owner per key across pods, one ledger credit per operation, lost-update-safe balance changes, terminal/uncertain replay, and authenticated duplicate/order-aware webhooks.

Not claimed: distributed exactly-once charging by an arbitrary provider, refunds, chargebacks, FX, reconciliation scheduling, production provider networking, metrics export, or load testing.

Redis may later be a cache/duplicate shield, never the financial authority. Saga becomes relevant only if Payment and Wallet become autonomous services with durable messaging and real compensation. Broker/outbox is deferred until cross-service delivery exists.

## Defense notes

- Five pods are arbitrated by PostgreSQL, not memory.
- Timeout preserves uncertainty because a new provider key could charge twice.
- Ledger uniqueness protects credit regardless of webhook delivery count.
- At one million operations/day, evaluate partitioning/retention, pool budgets, async reconciliation, outbox, rate limits, and measured cache pressure.

Review [`docs/tdd-evidence.md`](docs/tdd-evidence.md), [`docs/ai-assistance.md`](docs/ai-assistance.md), and [`docs/challenge.md`](docs/challenge.md).
