import { HttpStatus } from '@nestjs/common';
import { ApiException, toErrorPayload } from './api-error';

describe('toErrorPayload', () => {
  it('attaches a stable OVN id and docs URL', () => {
    const payload = toErrorPayload(
      new ApiException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
        issues: [{ path: 'name', message: 'Required' }],
      }),
      HttpStatus.BAD_REQUEST,
    );

    expect(payload.code).toBe('VALIDATION_FAILED');
    expect(payload.id).toBe('OVN-4001');
    expect(payload.docsUrl).toBe(
      'https://overl1te.github.io/OverVPN/errors/ovn-4001.html',
    );
    expect(payload.messageRu).toContain('проверки');
  });

  it('maps unknown exceptions to INTERNAL_ERROR', () => {
    const payload = toErrorPayload(new Error('boom'), 500);
    expect(payload.code).toBe('INTERNAL_ERROR');
    expect(payload.id).toBe('OVN-5000');
  });
});
