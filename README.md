# Wallet Cash-In Service

NestJS cash-in demo with PostgreSQL-enforced idempotency, atomic wallet credits, uncertain-payment reconciliation and authenticated webhooks. The provider is a deterministic fake, not a production payment integration.

## Run and verify

Requires Node.js 24+, npm and Docker Compose. Migration scripts use POSIX environment assignment (use a POSIX shell or WSL on Windows).

```sh
npm ci
docker compose -f compose.test.yaml up -d --wait
npm run migration:run:test
npm run test:all
npm run format:check
npm run lint
npm run build
```

For development run `npm run start:dev`. See [.env.example](.env.example) and [.env.test.example](.env.test.example): local defaults use port 3000, test PostgreSQL on 55432 and a development webhook secret. Production requires explicit DATABASE_URL and WEBHOOK_SECRET (at least 16 characters). Configuration uses class-validator/class-transformer. Never commit real environment files.

Only for the disposable test database, `docker compose -f compose.test.yaml down -v` removes its volume.

## HTTP contract

`POST /cash-in` requires `Idempotency-Key: <UUID>` and a body such as:

```json
{"user_id":"usr_abc123","amount":100.00,"currency":"PEN","payment_method":"fake_success"}
```

| HTTP | Meaning |
| --- | --- |
| 200 | completed; replay includes the stored balance |
| 202 | awaiting_confirmation; no blind second charge |
| 422 | confirmed failure, replayable |
| 409 | key belongs to a different normalized request |

Amounts accept numbers or exact decimal strings from 0.01 through 1,000,000.00. Fractional cents and larger amounts return 400. Responses use numeric amount/new_balance only when exact cent round-trip succeeds; otherwise they use canonical decimal strings. Fake methods: fake_success, fake_decline, fake_timeout and test-controlled fake_delayed.

`POST /webhooks/payment` requires `X-Webhook-Signature`: hex HMAC-SHA256 of the exact raw body using WEBHOOK_SECRET.

```json
{"event_id":"evt_1","operation_id":"1e049f36-90e7-4bf8-a8f3-31efad401fd8","type":"payment.succeeded","sequence":2,"provider_payment_id":"pay_1"}
```

Types are payment.succeeded and payment.failed (optional failure_code). Identical duplicates/old events receive 202; changed immutable event identity returns 409; invalid signatures return 401 before processing. Sequence accepts safe positive JSON integers or decimal digit strings through PostgreSQL BIGINT (9223372036854775807); unsafe numeric literals/larger strings return 400.

## Invariants and boundaries

- Controllers call CashInService through persistence/provider ports. Keep dependencies inward and TypeORM synchronize false; schema changes use migrations.
- Normalize to integer minor units and canonical SHA-256 fingerprints. PostgreSQL uniqueness elects one provider-call owner and rejects key conflicts before provider access.
- Finalization locks the operation, inserts one unique ledger credit, atomically increments the wallet, stores the resulting balance and completes the operation in one transaction. No provider call occurs inside it; serialization/deadlock failures get one bounded retry.
- A timeout preserves AWAITING_CONFIRMATION. Replays use one bounded status lookup and no new provider key. CREATED may be claimed after restart; PAYMENT_REQUESTED is reconciled. Without provider idempotency/canonical lookup, safety requires waiting rather than promising exactly-once external charging.
- Webhooks persist immutable event identity (operation, provider payment, type, sequence and payload hash); older sequences are ignored, terminal states cannot be rewritten, and success shares the transactional finalizer.
- Never log raw idempotency keys, payment tokens, secrets or full webhook bodies. Correlation IDs are distinct from idempotency keys.

Unit tests cover policies/validation; integration and E2E suites require real PostgreSQL for migration and concurrency proof. The five-instance E2E harness uses same-process Nest applications, not deployed pods. Run `npm run test:cov` for diagnostic unit coverage; database suites use Vitest --no-file-parallelism, not Jest --runInBand. Verify migration up/down/up for schema changes.

No refunds, chargebacks, FX, reconciliation scheduler, real provider networking, metrics export or load-test guarantee. Redis is only a possible cache; Saga requires autonomous services/compensation; broker/outbox is deferred until cross-service delivery exists.

[Challenge](docs/challenge.md), [historical TDD evidence](docs/tdd-evidence.md), and [AI assistance decisions](docs/ai-assistance.md) retain the original requirements and implementation evidence. See [AGENTS.md](AGENTS.md) for change rules.
