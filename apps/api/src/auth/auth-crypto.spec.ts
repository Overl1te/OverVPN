import { generate } from 'otplib';
import type { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import {
  PasswordService,
  SecretEncryptionService,
  TotpService,
} from './auth-crypto';

function config(values: Partial<AppEnvironment>) {
  return {
    get: (key: keyof AppEnvironment) => values[key],
  } as ConfigService<AppEnvironment, true>;
}

describe('authentication cryptography', () => {
  it('hashes and verifies passwords with Argon2id', async () => {
    const passwords = new PasswordService();
    const passwordHash = await passwords.hash('correct horse battery staple');

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    await expect(
      passwords.verify(passwordHash, 'correct horse battery staple'),
    ).resolves.toBe(true);
    await expect(
      passwords.verify(passwordHash, 'wrong password'),
    ).resolves.toBe(false);
    await expect(passwords.verify(null, 'any value')).resolves.toBe(false);
  });

  it('encrypts TOTP secrets with authenticated encryption and verifies codes', async () => {
    const testConfig = config({
      SECRETS_MASTER_KEY: '11'.repeat(32),
      TOTP_ISSUER: 'OverVPN Test',
    });
    const encryption = new SecretEncryptionService(testConfig);
    const totp = new TotpService(testConfig);
    const setup = totp.create('owner');
    const encrypted = encryption.encrypt(setup.secret);
    const token = await generate({ secret: setup.secret });
    const invalidToken = String((Number(token) + 1) % 1_000_000).padStart(
      6,
      '0',
    );

    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain(setup.secret);
    expect(encryption.decrypt(encrypted)).toBe(setup.secret);
    await expect(totp.verify(setup.secret, token)).resolves.toBe(true);
    await expect(totp.verify(setup.secret, invalidToken)).resolves.toBe(false);
    expect(setup.provisioningUri).toContain('otpauth://totp/');
  });
});
