import { onlineSessionListQuerySchema } from '@overvpn/shared/schemas';
import { quotaUsagePercent } from '../subscriptions/subscription-status-page';

describe('onlineSessionListQuerySchema', () => {
  it('accepts username and inboundTag filters', () => {
    const parsed = onlineSessionListQuerySchema.parse({
      page: 1,
      pageSize: 25,
      username: 'alice',
      inboundTag: 'vless-reality',
      state: 'all',
    });
    expect(parsed.username).toBe('alice');
    expect(parsed.inboundTag).toBe('vless-reality');
    expect(parsed.state).toBe('all');
  });
});

describe('quotaUsagePercent', () => {
  it('returns null when unlimited', () => {
    expect(quotaUsagePercent('100', null)).toBeNull();
  });

  it('caps at 100 when over quota', () => {
    expect(quotaUsagePercent('200', '100')).toBe(100);
  });

  it('computes fractional percent', () => {
    expect(quotaUsagePercent('1', '3')).toBe(33.3);
  });
});
