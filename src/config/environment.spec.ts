import { parseEnvironment } from './environment.ts';

describe('environment configuration', () => {
  it('uses explicit development defaults when NODE_ENV is absent', () => {
    expect(parseEnvironment({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL:
        'postgresql://wallet:wallet_test@localhost:55432/wallet_cash_in_test',
      WEBHOOK_SECRET: 'local-development-secret',
    });
  });

  it('uses the local defaults in test mode', () => {
    expect(parseEnvironment({ NODE_ENV: 'test' })).toEqual({
      NODE_ENV: 'test',
      PORT: 3000,
      DATABASE_URL:
        'postgresql://wallet:wallet_test@localhost:55432/wallet_cash_in_test',
      WEBHOOK_SECRET: 'local-development-secret',
    });
  });

  it('coerces PORT to a number', () => {
    expect(parseEnvironment({ PORT: '4100' }).PORT).toBe(4100);
  });

  it('accepts the maximum TCP port and rejects the next value', () => {
    expect(parseEnvironment({ PORT: '65535' }).PORT).toBe(65535);
    expect(() => parseEnvironment({ PORT: '65536' })).toThrowError(
      /^Configuration validation error:/,
    );
  });

  it('rejects unsupported NODE_ENV values with a stable error prefix', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'staging' })).toThrowError(
      /^Configuration validation error:/,
    );
  });

  it.each(['0', '-1', '1.5', 'not-a-number'])(
    'rejects invalid PORT %s with a stable error prefix',
    (PORT) => {
      expect(() => parseEnvironment({ PORT })).toThrowError(
        /^Configuration validation error:/,
      );
    },
  );

  it('requires DATABASE_URL and WEBHOOK_SECRET in production', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'production' })).toThrowError(
      /^Configuration validation error:/,
    );
  });

  it('accepts a valid production configuration and defaults PORT', () => {
    expect(
      parseEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://wallet:secret@database:5432/wallet',
        WEBHOOK_SECRET: 'production-secret-value',
      }),
    ).toEqual({
      NODE_ENV: 'production',
      PORT: 3000,
      DATABASE_URL: 'postgresql://wallet:secret@database:5432/wallet',
      WEBHOOK_SECRET: 'production-secret-value',
    });
  });

  it.each(['https://database.example.com/wallet', 'not-a-url'])(
    'rejects production database URL %s',
    (DATABASE_URL) => {
      expect(() =>
        parseEnvironment({
          NODE_ENV: 'production',
          DATABASE_URL,
          WEBHOOK_SECRET: 'production-secret-value',
        }),
      ).toThrowError(/^Configuration validation error:/);
    },
  );

  it('rejects a short production secret without exposing it', () => {
    const sensitiveValue = 'too-short';

    try {
      parseEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://wallet:secret@database:5432/wallet',
        WEBHOOK_SECRET: sensitiveValue,
      });
      expect.fail('Expected environment validation to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) return;
      expect(error.message).toMatch(/^Configuration validation error:/);
      expect(error.message).not.toContain(sensitiveValue);
    }
  });
});
