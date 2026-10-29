import https from 'node:https';
import { RIOT_CA_PEM } from '@lvr/schema';
import type { FetchLike } from '@lvr/core';

/**
 * HTTPS for the two local Riot servers.
 *  - 2999 (Live Client): chain verified against Riot's CA, hostname check off (the leaf is
 *    not issued for 127.0.0.1). Falls back to an unverified agent after a TLS error, as
 *    event-dump does.
 *  - LCU: self-signed per install, so `rejectUnauthorized: false` plus the lockfile password.
 */
const riotCa = RIOT_CA_PEM
  ? new https.Agent({ keepAlive: true, maxSockets: 4, ca: RIOT_CA_PEM, checkServerIdentity: () => undefined })
  : null;
const insecure = new https.Agent({ keepAlive: true, maxSockets: 4, rejectUnauthorized: false });
let liveAgent: https.Agent = riotCa ?? insecure;

export interface HttpResult {
  status: number;
  body: string;
}

export function httpsGet(
  url: string,
  opts: { agent: https.Agent; headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal },
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        agent: opts.agent,
        headers: { Accept: 'application/json', ...opts.headers },
        timeout: opts.timeoutMs ?? 2000,
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

const isTlsError = (e: unknown): boolean =>
  /CERT|SELF_SIGNED|UNABLE_TO_|ERR_TLS|HOSTNAME|DEPTH_ZERO|ERR_SSL/i.test(String((e as NodeJS.ErrnoException)?.code ?? ''));

/** `FetchLike` for `LiveClientPoller`. */
export const liveFetch: FetchLike = async (url, init) => {
  let res: HttpResult;
  try {
    res = await httpsGet(url, { agent: liveAgent, ...(init?.signal ? { signal: init.signal } : {}) });
  } catch (e) {
    if (liveAgent !== insecure && isTlsError(e)) {
      console.warn(`[live] TLS verification failed (${String((e as NodeJS.ErrnoException).code)}), falling back to insecure`);
      liveAgent = insecure;
      res = await httpsGet(url, { agent: liveAgent, ...(init?.signal ? { signal: init.signal } : {}) });
    } else {
      throw e;
    }
  }
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    json: async () => JSON.parse(res.body) as unknown,
  };
};

export function lcuGet(baseUrl: string, auth: string, path: string): Promise<HttpResult> {
  return httpsGet(baseUrl + path, { agent: insecure, headers: { Authorization: auth } });
}

export function destroyAgents(): void {
  riotCa?.destroy();
  insecure.destroy();
}
