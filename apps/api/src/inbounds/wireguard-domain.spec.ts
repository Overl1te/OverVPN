import {
  buildWireguardStorage,
  buildWireguardUri,
  createWireguardCredential,
  generateWireguardKeypair,
} from './wireguard-domain';

describe('WireGuard domain', () => {
  it('generates server and peer key material with stored client addresses', () => {
    const server = generateWireguardKeypair();
    const credential = createWireguardCredential('10.66.0.1/24');

    expect(Buffer.from(server.privateKey, 'base64')).toHaveLength(32);
    expect(Buffer.from(server.publicKey, 'base64')).toHaveLength(32);
    expect(Buffer.from(credential.privateKey, 'base64')).toHaveLength(32);
    expect(Buffer.from(credential.publicKey, 'base64')).toHaveLength(32);
    expect(credential.address).toMatch(/^10\.66\.0\.\d+\/32$/);
  });

  it('preserves generated server secrets across settings updates', () => {
    const initial = buildWireguardStorage({
      listenHost: '0.0.0.0',
      listenPort: 51820,
      publicHost: 'vpn.example.com',
      enabled: true,
      address: '10.66.0.1/24',
      mtu: 1420,
    });
    const updated = buildWireguardStorage(
      {
        listenHost: '0.0.0.0',
        listenPort: 51820,
        publicHost: 'vpn.example.com',
        enabled: true,
        address: '10.66.0.1/24',
        mtu: 1380,
      },
      initial,
    );

    expect(updated.secrets).toEqual(initial.secrets);
    expect(updated.publicConfig.mtu).toBe(1380);
  });

  it('builds a portable WireGuard endpoint URI', () => {
    const uri = buildWireguardUri({
      privateKey: 'private/key=',
      publicKey: 'client+key=',
      serverPublicKey: 'server+key=',
      address: '10.66.0.2/32',
      host: 'vpn.example.com',
      port: 51820,
      mtu: 1420,
      label: 'WireGuard main',
    });

    expect(uri.startsWith('wg://private%2Fkey%3D@vpn.example.com:51820?')).toBe(
      true,
    );
    expect(uri).toContain('server_public_key=server%2Bkey%3D');
    expect(uri.endsWith('#WireGuard%20main')).toBe(true);
  });
});
