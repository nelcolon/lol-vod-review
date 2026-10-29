import https from 'node:https';
import { RIOT_CA_PEM } from '@lvr/schema';
import type { Fetcher, HttpRequest, HttpResponse, TlsMode } from './types.js';

/** Node https fetcher with one keep-alive agent per TLS mode. */
export function createNodeFetcher(): { fetch: Fetcher; destroy: () => void } {
  const insecure = new https.Agent({ keepAlive: true, maxSockets: 4, rejectUnauthorized: false });
  const riotCa = RIOT_CA_PEM
    ? new https.Agent({
        keepAlive: true,
        maxSockets: 4,
        ca: RIOT_CA_PEM,
        // The 2999 leaf is not issued for "127.0.0.1"; the chain is still verified.
        checkServerIdentity: () => undefined,
      })
    : insecure;
  const agents: Record<TlsMode, https.Agent> = { insecure, 'riot-ca': riotCa };

  const fetch: Fetcher = (req: HttpRequest) =>
    new Promise<HttpResponse>((resolve, reject) => {
      const r = https.request(
        req.url,
        {
          method: 'GET',
          agent: agents[req.tls],
          headers: { Accept: 'application/json', ...req.headers },
          timeout: req.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
          res.on('error', reject);
        },
      );
      r.on('timeout', () => r.destroy(Object.assign(new Error(`timeout after ${req.timeoutMs} ms`), { code: 'ETIMEDOUT' })));
      r.on('error', reject);
      r.end();
    });

  return {
    fetch,
    destroy: () => {
      insecure.destroy();
      riotCa.destroy();
    },
  };
}

export function errorInfo(e: unknown): { code: string; message: string } {
  if (e instanceof Error) {
    const code = (e as NodeJS.ErrnoException).code ?? e.name;
    const message = e.message || (e instanceof AggregateError ? e.errors.map(String).join('; ') : '');
    return { code: String(code), message };
  }
  return { code: 'UNKNOWN', message: String(e) };
}

export const isTlsError = (code: string): boolean =>
  /CERT|SELF_SIGNED|UNABLE_TO_|ERR_TLS|HOSTNAME|DEPTH_ZERO|ERR_SSL/i.test(code);
