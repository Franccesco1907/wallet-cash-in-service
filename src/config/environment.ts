import 'reflect-metadata';
import { Type, plainToInstance } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const ENVIRONMENT_MODE = {
  DEVELOPMENT: 'development',
  TEST: 'test',
  PRODUCTION: 'production',
} as const;

type EnvironmentMode = (typeof ENVIRONMENT_MODE)[keyof typeof ENVIRONMENT_MODE];

const DEFAULT_PORT = 3000;
const LOCAL_DATABASE_URL =
  'postgresql://wallet:wallet_test@localhost:55432/wallet_cash_in_test';
const LOCAL_WEBHOOK_SECRET = 'local-development-secret';

export interface Environment {
  NODE_ENV: EnvironmentMode;
  PORT: number;
  DATABASE_URL: string;
  WEBHOOK_SECRET: string;
}

class EnvironmentVariables implements Environment {
  @IsIn(Object.values(ENVIRONMENT_MODE))
  NODE_ENV!: EnvironmentMode;

  @Type(() => Number)
  @IsInt()
  @Max(65535)
  @Min(1)
  PORT!: number;

  @IsDefined()
  @IsUrl({
    protocols: ['postgres', 'postgresql'],
    require_protocol: true,
    require_tld: false,
  })
  DATABASE_URL!: string;

  @IsDefined()
  @MinLength(16)
  WEBHOOK_SECRET!: string;
}

export function parseEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Environment {
  const nodeEnvironment = source.NODE_ENV ?? ENVIRONMENT_MODE.DEVELOPMENT;
  const isProduction = nodeEnvironment === ENVIRONMENT_MODE.PRODUCTION;
  const environment = plainToInstance(EnvironmentVariables, {
    NODE_ENV: nodeEnvironment,
    PORT: source.PORT ?? DEFAULT_PORT,
    DATABASE_URL:
      source.DATABASE_URL ?? (isProduction ? undefined : LOCAL_DATABASE_URL),
    WEBHOOK_SECRET:
      source.WEBHOOK_SECRET ??
      (isProduction ? undefined : LOCAL_WEBHOOK_SECRET),
  });

  const errors = validateSync(environment, {
    validationError: { target: false, value: false },
  });
  if (errors.length > 0) {
    const invalidProperties = errors
      .map(({ property }) => property)
      .sort()
      .join(', ');
    throw new Error(`Configuration validation error: ${invalidProperties}`);
  }

  return {
    NODE_ENV: environment.NODE_ENV,
    PORT: environment.PORT,
    DATABASE_URL: environment.DATABASE_URL,
    WEBHOOK_SECRET: environment.WEBHOOK_SECRET,
  };
}
