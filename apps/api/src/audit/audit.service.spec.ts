import { redactAuditData } from './audit.service';

describe('audit redaction', () => {
  it('recursively removes credentials, tokens, passwords, and TOTP secrets', () => {
    const redacted = redactAuditData({
      username: 'owner',
      password: 'do-not-store',
      nested: {
        refreshToken: 'do-not-store',
        totpCode: '123456',
        authorization: 'Bearer do-not-store',
        safe: 42n,
      },
      items: [{ subToken: 'do-not-store', status: 'ACTIVE' }],
    });

    expect(redacted).toEqual({
      username: 'owner',
      password: '[REDACTED]',
      nested: {
        refreshToken: '[REDACTED]',
        totpCode: '[REDACTED]',
        authorization: '[REDACTED]',
        safe: '42',
      },
      items: [{ subToken: '[REDACTED]', status: 'ACTIVE' }],
    });
    expect(JSON.stringify(redacted)).not.toContain('do-not-store');
    expect(JSON.stringify(redacted)).not.toContain('123456');
  });
});
