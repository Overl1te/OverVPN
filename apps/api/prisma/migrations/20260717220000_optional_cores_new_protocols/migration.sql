-- Optional cores + new protocol variants (WireGuard, Xray Trojan/SS).
ALTER TYPE "InboundProtocol" ADD VALUE IF NOT EXISTS 'WIREGUARD';
ALTER TYPE "InboundProtocol" ADD VALUE IF NOT EXISTS 'TROJAN_TLS';
ALTER TYPE "InboundProtocol" ADD VALUE IF NOT EXISTS 'SHADOWSOCKS_XRAY';
ALTER TYPE "InboundProtocol" ADD VALUE IF NOT EXISTS 'WIREGUARD_XRAY';
