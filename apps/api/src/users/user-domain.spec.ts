import { calculateNextResetAt, normalizeUserStatus } from './user-domain';

describe('user status transitions', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');

  it('keeps manual disable authoritative', () => {
    expect(
      normalizeUserStatus(
        {
          expireAt: new Date('2027-01-01T00:00:00.000Z'),
          dataLimitBytes: 1_000n,
          usedUploadBytes: 10n,
          usedDownloadBytes: 20n,
        },
        'DISABLED',
        null,
        now,
      ),
    ).toEqual({
      status: 'DISABLED',
      statusReason: 'manual',
      disabledAt: now,
    });
  });

  it('moves enabled users to EXPIRED before evaluating quota', () => {
    expect(
      normalizeUserStatus(
        {
          expireAt: new Date('2026-07-12T11:59:59.000Z'),
          dataLimitBytes: 100n,
          usedUploadBytes: 100n,
          usedDownloadBytes: 100n,
        },
        'ACTIVE',
        null,
        now,
      ),
    ).toMatchObject({ status: 'EXPIRED', statusReason: 'expired' });
  });

  it('limits an enabled user whose total traffic reached quota', () => {
    expect(
      normalizeUserStatus(
        {
          expireAt: null,
          dataLimitBytes: 100n,
          usedUploadBytes: 40n,
          usedDownloadBytes: 60n,
        },
        'ACTIVE',
        null,
        now,
      ),
    ).toMatchObject({ status: 'LIMITED', statusReason: 'quota' });
  });

  it('calculates UTC reset boundaries deterministically', () => {
    expect(calculateNextResetAt('DAILY', now)?.toISOString()).toBe(
      '2026-07-13T00:00:00.000Z',
    );
    expect(calculateNextResetAt('MONTHLY', now)?.toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
    expect(calculateNextResetAt('YEARLY', now)?.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    expect(calculateNextResetAt('NO_RESET', now)).toBeNull();
  });
});
