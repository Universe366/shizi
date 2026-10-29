import { useEffect, useState } from 'react';
import type { ClockOptions } from './model';

const CLOCK_KEY = 'start-clock';

function readClock(): ClockOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOCK_KEY) || '{}');
    return { seconds: raw?.seconds === true, hour12: raw?.hour12 === true };
  } catch {
    return { seconds: false, hour12: false };
  }
}

/** 起始页时钟：按设置决定 15 秒或 1 秒刷新。 */
export function useStartClock() {
  const [now, setNow] = useState(() => new Date());
  const [clock, setClock] = useState<ClockOptions>(readClock);

  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(new Date()),
      clock.seconds ? 1000 : 15_000
    );
    return () => window.clearInterval(timer);
  }, [clock.seconds]);

  const changeClock = (patch: Partial<ClockOptions>) => {
    setClock((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(CLOCK_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  return { now, clock, changeClock };
}
