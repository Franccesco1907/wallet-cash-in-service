import { parseEnvironment } from './environment.js';

describe('environment configuration', () => {
  it('fails fast when production secrets are absent', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'production' })).toThrow();
  });

  it('retains explicit local defaults outside production', () => {
    const environment = parseEnvironment({ NODE_ENV: 'test' });
    expect(environment.DATABASE_URL).toContain('wallet_cash_in_test');
    expect(environment.WEBHOOK_SECRET).toBe('local-development-secret');
  });
});
