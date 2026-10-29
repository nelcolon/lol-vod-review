#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOCKFILE_PATH } from '@lvr/schema';
import { createNodeFetcher } from './http.js';
import { Recorder } from './recorder.js';
import { formatSummary } from './summary.js';
import type { TlsMode } from './types.js';

const HELP = `lvr-event-dump: record LCU gameflow + Live Client Data (port 2999) for Phase 0 fixtures

Options:
  --lockfile <path>     LCU lockfile (default: ${DEFAULT_LOCKFILE_PATH})
  --no-lcu              skip the LCU; poll 2999 immediately
  --out <dir>           parent folder for session folders (default: <repo>/fixtures/raw)
  --max-seconds <n>     stop after n seconds
  --live-url <url>      Live Client base URL (default: https://127.0.0.1:2999)
  --tls <mode>          riot-ca (default; falls back to insecure on TLS error) | insecure
  --quiet               only print the final summary
  -h, --help            show this help

Stops on GameEnd + 10 s, when 2999 stops answering for 15 s after having answered,
on --max-seconds, or on Ctrl-C (files are flushed).`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      lockfile: { type: 'string' },
      'no-lcu': { type: 'boolean', default: false },
      out: { type: 'string' },
      'max-seconds': { type: 'string' },
      'live-url': { type: 'string' },
      tls: { type: 'string' },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const tls = (values.tls ?? 'riot-ca') as TlsMode;
  if (tls !== 'riot-ca' && tls !== 'insecure') throw new Error(`--tls must be riot-ca or insecure, got ${tls}`);
  let maxSeconds: number | undefined;
  if (values['max-seconds'] !== undefined) {
    maxSeconds = Number(values['max-seconds']);
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) throw new Error('--max-seconds must be a positive number');
  }
  const outRoot = values.out ?? fileURLToPath(new URL('../../../fixtures/raw/', import.meta.url));
  const http = createNodeFetcher();
  const quiet = values.quiet;
  const recorder = new Recorder({
    outRoot,
    fetch: http.fetch,
    lcu: !values['no-lcu'],
    lockfilePath: values.lockfile ?? DEFAULT_LOCKFILE_PATH,
    liveBaseUrl: values['live-url'] ?? 'https://127.0.0.1:2999',
    tls,
    ...(maxSeconds !== undefined ? { maxSeconds } : {}),
    log: (l) => {
      if (!quiet) console.log(`[${new Date().toISOString()}] ${l}`);
    },
  });
  let sigints = 0;
  const onSig = () => {
    sigints++;
    if (sigints > 1) process.exit(130);
    console.log('\nevent-dump: stopping (Ctrl-C again to force)...');
    recorder.stop('sigint');
  };
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);
  try {
    const { outDir, summary } = await recorder.run();
    console.log(formatSummary(summary, outDir));
    return 0;
  } finally {
    http.destroy();
    process.off('SIGINT', onSig);
    process.off('SIGTERM', onSig);
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`event-dump: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
