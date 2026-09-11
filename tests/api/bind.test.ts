import { describe, expect, it } from 'vitest';
import { apiUrls, isTailscaleAddress, resolveBindHost, tailscaleAddress, type IfaceTable } from '../../src/api/bind';

const MAC: IfaceTable = {
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }, { address: '::1', family: 'IPv6', internal: true }],
  en0: [{ address: '192.168.1.23', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
  utun4: [{ address: 'fd7a:115c:a1e0::1', family: 'IPv6', internal: false }, { address: '100.67.202.68', family: 'IPv4', internal: false }],
};
const NO_TS: IfaceTable = { lo0: MAC['lo0'], en0: MAC['en0'], undefined_entry: undefined };

describe('the API bind address', () => {
  it('recognises the CGNAT range Tailscale uses and nothing else', () => {
    expect(isTailscaleAddress('100.64.0.1')).toBe(true);
    expect(isTailscaleAddress('100.127.255.254')).toBe(true);
    expect(isTailscaleAddress('100.67.202.68')).toBe(true);
    expect(isTailscaleAddress('100.63.255.255')).toBe(false);
    expect(isTailscaleAddress('100.128.0.0')).toBe(false);
    expect(isTailscaleAddress('192.168.1.23')).toBe(false);
    expect(isTailscaleAddress('not an ip')).toBe(false);
  });

  it('finds the Tailscale IPv4 in an interfaces table, whatever the interface is called and even with a numeric family', () => {
    expect(tailscaleAddress(MAC)).toBe('100.67.202.68');
    expect(tailscaleAddress(NO_TS)).toBeUndefined();
    expect(tailscaleAddress({ tailscale0: [{ address: '100.100.1.2', family: 4, internal: false }] })).toBe('100.100.1.2');
    expect(tailscaleAddress({ lo0: [{ address: '100.70.1.1', family: 'IPv4', internal: true }] })).toBeUndefined();
  });

  it('resolves each setting to a host, falling back to loopback with a reason when Tailscale is missing', () => {
    expect(resolveBindHost('loopback', MAC)).toEqual({ host: '127.0.0.1' });
    expect(resolveBindHost('all', MAC)).toEqual({ host: '0.0.0.0' });
    expect(resolveBindHost('tailscale', MAC)).toEqual({ host: '100.67.202.68' });
    const fb = resolveBindHost('tailscale', NO_TS);
    expect(fb.host).toBe('127.0.0.1');
    expect(fb.fallback).toMatch(/no Tailscale address/);
  });

  it('lists the URLs a client can use, Tailscale first when bound everywhere', () => {
    expect(apiUrls('127.0.0.1', 27125, MAC)).toEqual(['http://127.0.0.1:27125/helm/v1']);
    expect(apiUrls('100.67.202.68', 27125, MAC)).toEqual(['http://100.67.202.68:27125/helm/v1']);
    expect(apiUrls('0.0.0.0', 27125, MAC)).toEqual(['http://100.67.202.68:27125/helm/v1', 'http://192.168.1.23:27125/helm/v1', 'http://127.0.0.1:27125/helm/v1']);
    expect(apiUrls('0.0.0.0', 1, NO_TS)).toEqual(['http://192.168.1.23:1/helm/v1', 'http://127.0.0.1:1/helm/v1']);
  });
});
