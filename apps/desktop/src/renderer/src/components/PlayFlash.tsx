import { type RefObject, useEffect, useState } from 'react';

/**
 * Play / pause icon that pops up in the middle of the video and fades out whenever the
 * video starts or pauses, however that happened (click, Space, buttons).
 */
export function PlayFlash({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
  const [flash, setFlash] = useState<{ kind: 'play' | 'pause'; n: number } | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let n = 0;
    const play = () => setFlash({ kind: 'play', n: ++n });
    // a pause at the very end is the video finishing, not the user pausing
    const pause = () => !el.ended && setFlash({ kind: 'pause', n: ++n });
    el.addEventListener('play', play);
    el.addEventListener('pause', pause);
    return () => {
      el.removeEventListener('play', play);
      el.removeEventListener('pause', pause);
    };
  }, [videoRef]);

  if (!flash) return null;
  return (
    <div key={flash.n} className="play-flash" aria-hidden onAnimationEnd={() => setFlash(null)}>
      {flash.kind === 'play' ? (
        <svg viewBox="0 0 24 24" width="40" height="40">
          <path d="M8 5v14l11-7z" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="40" height="40">
          <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" />
        </svg>
      )}
    </div>
  );
}
