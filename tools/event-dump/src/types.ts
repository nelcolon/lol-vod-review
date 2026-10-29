/** Shared record shapes written to the JSONL files. */

/** Per-request timestamps: wall clock at request start + monotonic ns at start and end. */
export interface Stamp {
  wallMs: number;
  /** `process.hrtime.bigint()` at request start, as a decimal string. */
  hrtimeNs_start: string;
  /** `process.hrtime.bigint()` when the response (or error) arrived. */
  hrtimeNs_end: string;
}

export type TlsMode = 'riot-ca' | 'insecure';

export interface HttpRequest {
  url: string;
  headers?: Record<string, string>;
  tls: TlsMode;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  body: string;
}

/** Rejects with an Error carrying `code` (ECONNREFUSED, ETIMEDOUT, CERT_..., ...) on transport failure. */
export type Fetcher = (req: HttpRequest) => Promise<HttpResponse>;

export interface AttemptRecord extends Stamp {
  endpoint: string;
  url: string;
  /** HTTP status, or null when no HTTP response arrived. */
  status: number | null;
  durationMs: number;
  /** Parsed JSON body, or the raw text when it is not JSON. Omitted when `sameAsPrevious`. */
  body?: unknown;
  sameAsPrevious?: true;
  error?: { code: string; message: string };
  tls?: TlsMode;
}
