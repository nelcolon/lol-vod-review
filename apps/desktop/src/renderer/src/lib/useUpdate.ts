import { useEffect, useState } from 'react';
import type { UpdateStatus } from '@shared/contracts';

/** Live update status from the main process. */
export function useUpdate(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    void window.lvr.getUpdateStatus().then(setStatus);
    return window.lvr.onUpdateStatus(setStatus);
  }, []);
  return status;
}
