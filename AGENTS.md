# Wallet Cash-In Service

## Scope

This NestJS service provides idempotent wallet cash-in. Protect financial correctness and API contracts before convenience or refactoring.

## Commands

```bash
npm ci
docker compose -f compose.test.yaml up -d
npm run migration:run:test
npm run lint
npm run build
npm run test:unit
npm run test:integration
npm run test:e2e
npm run format:check
```

## Environment

- Keep `.env` files uncommitted; use `.env.example` and `.env.test.example` as templates.
- Development and test default to port `3000`, the local test PostgreSQL instance on port `55432`, and a local webhook secret.
- Production must provide a valid `DATABASE_URL` and a `WEBHOOK_SECRET` of at least 16 characters.

## Architecture

- Organize code into domain, application, infrastructure, and presentation layers; dependencies point inward.
- Define external interactions as application ports and model use cases with explicit commands and responses.
- Keep interfaces near their owners; do not create a global interfaces folder.
- Put reusable cross-cutting concerns under `src/shared`.

## Persistence

- Use explicit SQL for advisory locks, exact `FOR UPDATE` behavior, conflict targets, and ledger/wallet invariants.
- Use QueryBuilder or repositories only when they make ordinary operations clearer.
- Keep TypeORM `synchronize` set to `false`; evolve the schema through migrations.

## Validation and Errors

- Use `class-validator` and `class-transformer` for environment and DTO validation.
- Keep failed HTTP response fields stable and omit sensitive internals; do not change successful response contracts.

## TypeScript

- Keep strict typing; prefer `unknown` over `any`, use `import type`, and derive types from `as const` values.
- Prefer flat interfaces and include `.ts` extensions in source imports.

## Change Discipline

- Preserve unrelated work. Use TDD and run focused verification for every change.

## Helpful Agent Skills

`typescript`, `test-driven-development`, `systematic-debugging`, `code-explorer`, `verification-before-completion`
