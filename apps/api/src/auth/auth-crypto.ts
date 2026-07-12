import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { argon2id, hash, verify as verifyArgon2 } from 'argon2';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import type { AppEnvironment } from '../config/environment';

const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;

@Injectable()
export class PasswordService {
  private readonly dummyHash = hash(
    'constant-invalid-password-used-for-timing-equalization',
    ARGON2_OPTIONS,
  );

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(
    passwordHash: string | null,
    password: string,
  ): Promise<boolean> {
    const candidate = passwordHash ?? (await this.dummyHash);
    try {
      const valid = await verifyArgon2(candidate, password);
      return passwordHash !== null && valid;
    } catch {
      return false;
    }
  }
}

@Injectable()
export class SecretEncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService<AppEnvironment, true>) {
    const configured = config.get('SECRETS_MASTER_KEY', { infer: true });
    this.key = /^[0-9a-f]{64}$/i.test(configured)
      ? Buffer.from(configured, 'hex')
      : Buffer.from(configured, 'base64');
    if (this.key.length !== 32) {
      throw new Error('SECRETS_MASTER_KEY did not decode to 32 bytes');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return ['v1', iv, tag, ciphertext]
      .map((part) =>
        typeof part === 'string' ? part : part.toString('base64url'),
      )
      .join(':');
  }

  decrypt(payload: string): string {
    const [version, ivValue, tagValue, ciphertextValue, extra] =
      payload.split(':');
    if (
      version !== 'v1' ||
      !ivValue ||
      !tagValue ||
      !ciphertextValue ||
      extra
    ) {
      throw new Error('Encrypted secret has an invalid envelope');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  encryptBytes(plaintext: Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from('OVB1'), iv, tag, ciphertext]);
  }

  decryptBytes(payload: Buffer): Buffer {
    if (
      payload.length < 4 + 12 + 16 ||
      payload.subarray(0, 4).toString('utf8') !== 'OVB1'
    ) {
      throw new Error('Encrypted backup has an invalid envelope');
    }
    const iv = payload.subarray(4, 16);
    const tag = payload.subarray(16, 32);
    const ciphertext = payload.subarray(32);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

@Injectable()
export class TotpService {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  create(username: string): {
    secret: string;
    provisioningUri: string;
  } {
    const secret = generateSecret({ length: 20 });
    return {
      secret,
      provisioningUri: generateURI({
        issuer: this.config.get('TOTP_ISSUER', { infer: true }),
        label: username,
        secret,
        digits: 6,
        period: 30,
      }),
    };
  }

  async verify(secret: string, token: string): Promise<boolean> {
    try {
      const result = await verifyTotp({
        secret,
        token,
        epochTolerance: 30,
      });
      return result.valid;
    } catch {
      return false;
    }
  }
}

export function createOpaqueToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
