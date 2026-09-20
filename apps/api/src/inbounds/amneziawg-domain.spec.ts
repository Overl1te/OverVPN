import {
  buildAmneziawgStorage,
  generateAmneziawgObfuscation,
} from './amneziawg-domain';

describe('amneziawg-domain', () => {
  it('generates AWG 2.0 obfuscation with non-overlapping headers', () => {
    const obfuscation = generateAmneziawgObfuscation();
    expect(obfuscation.jc).toBeGreaterThanOrEqual(3);
    expect(obfuscation.jc).toBeLessThanOrEqual(6);
    expect(obfuscation.jmax).toBeGreaterThanOrEqual(obfuscation.jmin);
    expect(obfuscation.s1 + 56).not.toBe(obfuscation.s2);
    expect(obfuscation.i1).toBe('<r 128>');
    const ranges = [
      obfuscation.h1,
      obfuscation.h2,
      obfuscation.h3,
      obfuscation.h4,
    ].map((value) => {
      const [lo, hi] = value.split('-').map(Number);
      return { lo, hi: hi ?? lo };
    });
    for (let i = 0; i < ranges.length; i += 1) {
      for (let j = i + 1; j < ranges.length; j += 1) {
        const overlap =
          ranges[i].hi >= ranges[j].lo && ranges[j].hi >= ranges[i].lo;
        expect(overlap).toBe(false);
      }
    }
  });

  it('keeps previous obfuscation when settings omit AWG fields', () => {
    const initial = buildAmneziawgStorage({
      listenHost: '0.0.0.0',
      listenPort: 51822,
      publicHost: 'vpn.example.test',
      publicPort: 51822,
      enabled: true,
      address: '10.67.0.1/24',
      mtu: 1420,
    });
    const updated = buildAmneziawgStorage(
      {
        listenHost: '0.0.0.0',
        listenPort: 51822,
        publicHost: 'vpn.example.test',
        publicPort: 51822,
        enabled: true,
        address: '10.67.0.1/24',
        mtu: 1280,
      },
      initial,
    );
    expect(updated.publicConfig.mtu).toBe(1280);
    expect(updated.publicConfig.jc).toBe(initial.publicConfig.jc);
    expect(updated.publicConfig.h1).toBe(initial.publicConfig.h1);
    expect(updated.secrets.privateKey).toBe(initial.secrets.privateKey);
  });
});
