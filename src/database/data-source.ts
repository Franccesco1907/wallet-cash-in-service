import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { parseEnvironment } from '../config/environment.ts';
import { InitialSchema2026082700001 } from './migrations/2026082700001-initial-schema.ts';
import { ProviderEventIdentity2026082700002 } from './migrations/2026082700002-provider-event-identity.ts';
import { ProviderPaymentUniqueness2026082800001 } from './migrations/2026082800001-provider-payment-uniqueness.ts';

const environment = parseEnvironment();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: environment.DATABASE_URL,
  synchronize: false,
  logging: false,
  migrations: [
    InitialSchema2026082700001,
    ProviderEventIdentity2026082700002,
    ProviderPaymentUniqueness2026082800001,
  ],
});
