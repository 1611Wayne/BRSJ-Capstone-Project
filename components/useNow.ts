'use client';
import { useEffect, useState } from 'react';
// The current time, set after the page has loaded (so the server and browser render the same HTML) and refreshed every
// minute, for "waiting" times that should move while a Staff member keeps the page open. Undefined on the first render.
export function useNow(everyMs = 60_000): number | undefined {
  const [now, setNow] = useState<number>();
  useEffect(() => { setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(id); }, [everyMs]);
  return now;
}
