import {
  sessionTrafficFromClient,
  trafficUpdateFields,
} from './online-session-collector.service';

describe('sessionTrafficFromClient', () => {
  it('parses nonnegative counters', () => {
    expect(
      sessionTrafficFromClient({ uploadBytes: '10', downloadBytes: '20' }),
    ).toEqual({
      uploadBytes: 10n,
      downloadBytes: 20n,
    });
  });

  it('keeps null when core did not report counters', () => {
    expect(
      sessionTrafficFromClient({ uploadBytes: null, downloadBytes: null }),
    ).toEqual({
      uploadBytes: null,
      downloadBytes: null,
    });
  });

  it('rejects invalid values', () => {
    expect(
      sessionTrafficFromClient({ uploadBytes: '-1', downloadBytes: 'abc' }),
    ).toEqual({
      uploadBytes: null,
      downloadBytes: null,
    });
  });
});

describe('trafficUpdateFields', () => {
  it('omits null fields so known values are not wiped', () => {
    expect(
      trafficUpdateFields({ uploadBytes: 5n, downloadBytes: null }),
    ).toEqual({
      uploadBytes: 5n,
    });
    expect(
      trafficUpdateFields({ uploadBytes: null, downloadBytes: null }),
    ).toEqual({});
  });
});
