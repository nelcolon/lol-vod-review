import type { LvrApi } from '../shared/ipc';

declare global {
  interface Window {
    lvr: LvrApi;
  }
}

export {};
