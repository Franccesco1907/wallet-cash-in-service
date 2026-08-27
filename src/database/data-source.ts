import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { parseEnvironment } from '../config/environment.js';
import { InitialSchema2026082700001 } from './migrations/2026082700001-initial-schema.js';

const environment = parseEnvironment();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: environment.DATABASE_URL,
  synchronize: false,
  logging: false,
  migrations: [InitialSchema2026082700001],
});
