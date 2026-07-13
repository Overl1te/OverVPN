import {
  localizeCoreHealthError,
  localizeCoreStatsError,
  localizeThroughputReason,
} from './core-user-messages';

describe('core-user-messages', () => {
  it('hides sing-box from DNS errors', () => {
    const msg = localizeCoreStatsError(
      'UNAVAILABLE',
      '14 UNAVAILABLE: Name resolution failed for target dns:sing-box:8080',
    );
    expect(msg.en).toContain('Core statistics are unavailable');
    expect(msg.ru).toContain('Статистика ядра недоступна');
    expect(msg.en).not.toMatch(/sing-box/i);
  });

  it('localizes core health DNS failures', () => {
    const msg = localizeCoreHealthError('Name resolution failed for dns:core:9090');
    expect(msg.en).toContain('VPN core service is not responding');
    expect(msg.ru).toContain('VPN-ядро не отвечает');
  });

  it('localizes throughput collector states', () => {
    const msg = localizeThroughputReason('traffic-collector', 'STALE', null);
    expect(msg.ru).toBe('Сборщик трафика устарел');
  });
});
