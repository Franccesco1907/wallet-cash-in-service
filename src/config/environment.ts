import { z } from 'zod';

const localEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .url()
    .default(
      'postgresql://wallet:wallet_test@localhost:55432/wallet_cash_in_test',
    ),
  WEBHOOK_SECRET: z.string().min(16).default('local-development-secret'),
});

const productionEnvironmentSchema = z.object({
  NODE_ENV: z.literal('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  WEBHOOK_SECRET: z.string().min(16),
});

const environmentSchema = z.discriminatedUnion('NODE_ENV', [
  localEnvironmentSchema,
  productionEnvironmentSchema,
]);

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Environment {
  return environmentSchema.parse({
    ...source,
    NODE_ENV: source.NODE_ENV ?? 'development',
  });
}
