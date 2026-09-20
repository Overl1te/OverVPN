import { validateEnvironment } from './environment';

const productionSecrets = {
  JWT_ACCESS_SECRET: 'AbCdEfGhIjKlMnOpQrStUvWxYz012345',
  SECRETS_MASTER_KEY:
    '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  SING_BOX_CLASH_API_SECRET: 'n4HsE8yK2mP7qW1zT5cV9bX0jL6dR3aFg',
};

function productionValues(overrides: Record<string, unknown> = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://overvpn:CiPassw0rd@127.0.0.1:5432/overvpn',
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    CORS_ORIGINS: 'https://panel.example.test',
    SUB_PUBLIC_BASE_URL: 'https://sub.example.test',
    AUTH_COOKIE_SECURE: true,
    ALLOW_INSECURE_HTTP: false,
    ...productionSecrets,
    ...overrides,
  };
}

describe('validateEnvironment', () => {
  it('accepts production HTTPS with Secure cookies', () => {
    expect(() => validateEnvironment(productionValues())).not.toThrow();
  });

  it('rejects production HTTP without the IP-only flag', () => {
    expect(() =>
      validateEnvironment(
        productionValues({
          CORS_ORIGINS: 'http://203.0.113.10:8080',
          SUB_PUBLIC_BASE_URL: 'http://203.0.113.10:8080',
          AUTH_COOKIE_SECURE: false,
        }),
      ),
    ).toThrow(/HTTPS|Secure/);
  });

  it('allows production HTTP to a literal IP when ALLOW_INSECURE_HTTP is set', () => {
    expect(() =>
      validateEnvironment(
        productionValues({
          CORS_ORIGINS: 'http://203.0.113.10:8080',
          SUB_PUBLIC_BASE_URL: 'http://203.0.113.10:8080',
          AUTH_COOKIE_SECURE: false,
          ALLOW_INSECURE_HTTP: true,
        }),
      ),
    ).not.toThrow();
  });

  it('does not allow ALLOW_INSECURE_HTTP for a hostname HTTP URL', () => {
    expect(() =>
      validateEnvironment(
        productionValues({
          CORS_ORIGINS: 'http://panel.example.test',
          SUB_PUBLIC_BASE_URL: 'http://sub.example.test',
          AUTH_COOKIE_SECURE: false,
          ALLOW_INSECURE_HTTP: true,
        }),
      ),
    ).toThrow(/HTTPS|Secure/);
  });
});
