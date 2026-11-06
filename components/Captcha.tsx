'use client';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { useSupabaseAuth } from '@/lib/supabase/config';

// Cloudflare Turnstile, the "not a robot" check Supabase verifies on sign-up, sign-in and sending a text code (Supabase
// dashboard: Authentication -> Attack Protection). Shown only in real sign-in mode with NEXT_PUBLIC_TURNSTILE_SITE_KEY set, so a
// teammate without it (and the sample-data prototype) works as before. Usually invisible: Cloudflare decides without a puzzle.
export const captchaSiteKey = useSupabaseAuth ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '' : '';

type Turnstile = { render: (el: HTMLElement, options: Record<string, unknown>) => string; reset: (id: string) => void; remove: (id: string) => void };
declare global { interface Window { turnstile?: Turnstile } }

// onToken gets a fresh token, or '' when it expires. A token works once: change resetKey after each attempt.
export function Captcha({ onToken, resetKey = 0 }: { onToken: (token: string) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null), widget = useRef<string>(), callback = useRef(onToken);
  const [ready, setReady] = useState(false);
  callback.current = onToken;
  // The script loads once per page; a check that appears later (another tab of the form) finds it already there.
  useEffect(() => {
    if (!captchaSiteKey) return;
    if (window.turnstile) { setReady(true); return; }
    const timer = setInterval(() => { if (window.turnstile) { setReady(true); clearInterval(timer); } }, 200);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!captchaSiteKey || !ready || !box.current || !window.turnstile) return;
    widget.current = window.turnstile.render(box.current, {
      sitekey: captchaSiteKey,
      callback: (token: string) => callback.current(token),
      'expired-callback': () => callback.current(''),
      'error-callback': () => callback.current(''),
    });
    return () => { if (widget.current) window.turnstile?.remove(widget.current); widget.current = undefined; };
  }, [ready]);
  useEffect(() => { if (resetKey && widget.current) { window.turnstile?.reset(widget.current); callback.current(''); } }, [resetKey]);
  if (!captchaSiteKey) return null;
  return <>
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" />
    <div ref={box} className="mt-4 min-h-[65px]" aria-label="Security check" />
  </>;
}
