/**
 * Where the API lives. `/helm/v1` is the stable mount and does not change with the contract: the
 * routes in v2.ts are served under it too. `API_VERSION` (reported as `api` by `GET /health`) is the
 * contract revision a client checks to tell a newer plugin from an older one.
 */
export const API_BASE = '/helm/v1';
export const API_VERSION = 2;
