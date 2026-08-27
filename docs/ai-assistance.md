# AI Assistance Record

The challenge explicitly requires AI-assisted delivery and critical review. This record separates earlier architectural discussions from events observed during implementation.

| Timestamp/work unit | Prompt or specification | Agent proposal/output | Risk or question reviewed | Human decision/correction | Executable evidence |
|---|---|---|---|---|---|
| Historical planning | Select an architecture for a multi-pod Cash-In flow | Pragmatic Hexagonal Architecture with PostgreSQL invariants | Redis locks and a Saga framework could add ceremony without correctness | PostgreSQL remains the authority; Redis and Saga are deferred until concrete scaling or service-boundary needs exist | `docs/implementation-plan.md` |
| Historical setup | Run the generated NestJS test command with Jest-style serialization | `--runInBand` was attempted | Vitest does not support Jest's flag | Use `--no-file-parallelism` for database suites | `package.json` test scripts |
| WU-1 | Explore the repository structurally before implementation | CodeGraph initialization aborted | Broad filesystem exploration was still required | Used the authorized filesystem fallback and preserved the failure as tooling evidence | `docs/development-plan.md` and repository history |
| WU-1 | Establish a transparent PostgreSQL integration harness | Docker Compose with a fixed PostgreSQL image and explicit migration | Fixed ports can conflict and persistent volumes can retain stale state | Document explicit lifecycle/reset commands; keep Testcontainers as a future CI-isolation option | `compose.test.yaml`, schema integration test |
| WU-1 | Execute the first TypeORM migration | The migration used a 12-digit suffix | TypeORM rejects migration class names without a JavaScript-sized 13-digit timestamp suffix | Renamed the migration and class with a 13-digit suffix before accepting the unit | `npm run migration:run:test` first failed with `migration name is wrong`, then passed |
