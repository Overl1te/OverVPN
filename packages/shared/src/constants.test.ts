import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CORE_ENGINES,
  INBOUND_PROTOCOLS,
  PROTOCOL_ENGINE_MAP,
  type CoreEngine,
  type InboundProtocol,
} from './constants.ts';

describe('PROTOCOL_ENGINE_MAP', () => {
  it('maps every supported protocol to a supported engine', () => {
    assert.deepEqual(Object.keys(PROTOCOL_ENGINE_MAP), [...INBOUND_PROTOCOLS]);

    for (const protocol of INBOUND_PROTOCOLS) {
      assert.ok(CORE_ENGINES.includes(PROTOCOL_ENGINE_MAP[protocol]));
    }
  });

  it('keeps existing protocols on sing-box and assigns TLS VLESS variants to Xray', () => {
    const expected = {
      HYSTERIA2: 'SING_BOX',
      VLESS_REALITY: 'SING_BOX',
      TROJAN: 'SING_BOX',
      SHADOWSOCKS: 'SING_BOX',
      WIREGUARD: 'SING_BOX',
      VLESS_XHTTP_TLS: 'XRAY',
      VLESS_GRPC_TLS: 'XRAY',
      VLESS_TCP_TLS: 'XRAY',
      TROJAN_TLS: 'XRAY',
      SHADOWSOCKS_XRAY: 'XRAY',
      WIREGUARD_XRAY: 'XRAY',
      MTPROXY: 'MTPROXY',
    } as const satisfies Record<InboundProtocol, CoreEngine>;

    assert.deepEqual(PROTOCOL_ENGINE_MAP, expected);
  });
});
