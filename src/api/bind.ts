/**
 * Where the API listens. Pure functions over an interfaces table so they can be tested without a
 * network: the plugin passes `os.networkInterfaces()`, the tests pass a fake.
 */
export type ApiBind = 'loopback' | 'tailscale' | 'all';

/** The subset of `os.NetworkInterfaceInfo` these functions look at. */
export interface IfaceAddress { address: string; family: string | number; internal: boolean }
export type IfaceTable = Record<string, IfaceAddress[] | undefined>;

export const LOOPBACK = '127.0.0.1';
export const ANY = '0.0.0.0';

const isV4 = (a: IfaceAddress): boolean => a.family === 'IPv4' || a.family === 4;

/** Tailscale hands every node an address in 100.64.0.0/10 (the CGNAT range): 100.64.x.x … 100.127.x.x. */
export function isTailscaleAddress(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 100 && b >= 64 && b <= 127;
}

/** The machine's Tailscale IPv4, or undefined when Tailscale is not up. */
export function tailscaleAddress(ifaces: IfaceTable): string | undefined {
  // Prefer an interface that is obviously Tailscale's (tailscale0 on Linux, utun* on macOS), but
  // any non-internal address in the CGNAT range counts: nothing else on a laptop lives there.
  const entries = Object.entries(ifaces).sort(([a], [b]) => Number(/^(tailscale|utun)/.test(b)) - Number(/^(tailscale|utun)/.test(a)));
  for (const [, addrs] of entries) for (const a of addrs ?? []) if (isV4(a) && !a.internal && isTailscaleAddress(a.address)) return a.address;
  return undefined;
}

/**
 * The host to bind for a setting. `tailscale` with no Tailscale address resolves to loopback and says
 * so in `fallback`, so the caller can log it and show a notice instead of silently exposing nothing.
 */
export function resolveBindHost(bind: ApiBind, ifaces: IfaceTable): { host: string; fallback?: string } {
  if (bind === 'all') return { host: ANY };
  if (bind === 'tailscale') {
    const ts = tailscaleAddress(ifaces);
    return ts ? { host: ts } : { host: LOOPBACK, fallback: 'no Tailscale address found (is Tailscale running?) — listening on 127.0.0.1 instead' };
  }
  return { host: LOOPBACK };
}

/** The base URLs a client can reach the server on, given the host it is bound to. Tailscale first, loopback last. */
export function apiUrls(host: string, port: number, ifaces: IfaceTable, base = '/helm/v1'): string[] {
  const url = (h: string): string => `http://${h}:${port}${base}`;
  if (host !== ANY) return [url(host)];
  const hosts: string[] = [];
  for (const addrs of Object.values(ifaces)) for (const a of addrs ?? []) if (isV4(a) && !a.internal && !hosts.includes(a.address)) hosts.push(a.address);
  hosts.sort((a, b) => Number(isTailscaleAddress(b)) - Number(isTailscaleAddress(a)));
  return [...hosts.map(url), url(LOOPBACK)];
}
