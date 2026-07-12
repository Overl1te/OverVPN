import { serializeBigInts } from './bigint-serialization';

describe('BigInt HTTP serialization', () => {
  it('converts nested BigInts to decimal strings without changing dates', () => {
    const date = new Date('2026-07-12T00:00:00.000Z');
    expect(
      serializeBigInts({
        total: 12_345n,
        nested: [{ upload: 10n, download: 20n }],
        date,
      }),
    ).toEqual({
      total: '12345',
      nested: [{ upload: '10', download: '20' }],
      date,
    });
  });
});
