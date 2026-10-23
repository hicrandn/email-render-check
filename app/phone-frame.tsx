'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

// A current iPhone in CSS pixels (iPhone 15/16: 393 × 852). The screen is the
// viewport the engine simulates, so @media rules in the preview switch where
// the engine assumes they do.
export const PHONE_SCREEN = { width: 393, height: 852 };
const BEZEL = 12;
const FRAME = { width: PHONE_SCREEN.width + 2 * BEZEL, height: PHONE_SCREEN.height + 2 * BEZEL };

// Shrunk to fit the preview pane, but not below this; past it the pane scrolls
// rather than making the email unreadable.
export const MIN_SCALE = 0.75;

/** Scale at which the whole phone fits a box, between MIN_SCALE and 1. */
export function fitScale(boxWidth: number, boxHeight: number): number {
  const s = Math.min(1, boxHeight / FRAME.height, boxWidth / FRAME.width);
  return Math.max(MIN_SCALE, s);
}

function StatusIcons() {
  return (
    <span className="flex items-center gap-1.5" aria-hidden>
      {/* signal */}
      <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
        <rect x="0" y="7" width="3" height="4" rx="1" />
        <rect x="4.5" y="5" width="3" height="6" rx="1" />
        <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
        <rect x="13.5" y="0" width="3" height="11" rx="1" />
      </svg>
      {/* wi-fi */}
      <svg width="15" height="11" viewBox="0 0 15 11" fill="currentColor">
        <path d="M7.5 2.3c2.1 0 4 .8 5.5 2.1l1.1-1.2A9.6 9.6 0 0 0 7.5.6 9.6 9.6 0 0 0 .9 3.2L2 4.4a7.9 7.9 0 0 1 5.5-2.1Z" />
        <path d="M7.5 5.6c1.2 0 2.3.4 3.1 1.2l1.1-1.2a6.3 6.3 0 0 0-8.4 0l1.1 1.2a4.6 4.6 0 0 1 3.1-1.2Z" />
        <path d="M7.5 8.4c.4 0 .8.2 1 .4L7.5 10 6.5 8.8c.2-.2.6-.4 1-.4Z" />
      </svg>
      {/* battery */}
      <svg width="27" height="12" viewBox="0 0 27 12" fill="none">
        <rect x="0.5" y="0.5" width="22" height="11" rx="3.5" stroke="currentColor" opacity="0.4" />
        <rect x="2" y="2" width="19" height="8" rx="2" fill="currentColor" />
        <path d="M24.5 4v4a2 2 0 0 0 0-4Z" fill="currentColor" opacity="0.4" />
      </svg>
    </span>
  );
}

export default function PhoneFrame({
  app,
  platform,
  dark,
  children,
}: {
  app: string;
  platform: string;
  dark: boolean;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => setScale(fitScale(box.clientWidth, box.clientHeight));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const ink = dark ? 'text-white' : 'text-black';
  const screenBg = dark ? 'bg-black' : 'bg-white';

  return (
    <div ref={boxRef} className="flex min-h-0 w-full flex-1 justify-center">
      {/* Reserves the scaled size so the pane scrolls correctly. */}
      <div style={{ width: FRAME.width * scale, height: FRAME.height * scale }} className="shrink-0">
        <div
          style={{
            width: FRAME.width,
            height: FRAME.height,
            padding: BEZEL,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          className={`relative rounded-[60px] bg-[#1c1c1e] ${dark ? 'ring-1 ring-white/15' : ''}`}
        >
          {/* side buttons */}
          <span className="absolute -left-[3px] top-[120px] h-8 w-[3px] rounded-l bg-[#2c2c2e]" />
          <span className="absolute -left-[3px] top-[180px] h-14 w-[3px] rounded-l bg-[#2c2c2e]" />
          <span className="absolute -left-[3px] top-[250px] h-14 w-[3px] rounded-l bg-[#2c2c2e]" />
          <span className="absolute -right-[3px] top-[200px] h-20 w-[3px] rounded-r bg-[#2c2c2e]" />

          <div className={`relative flex h-full flex-col overflow-hidden rounded-[48px] ${screenBg}`}>
            {/* status bar with the Dynamic Island */}
            <div className={`relative flex h-[54px] shrink-0 items-center justify-between px-8 pt-1 ${ink}`}>
              <span className="w-[54px] text-center text-[15px] font-semibold">9:41</span>
              <span className="absolute left-1/2 top-[11px] h-[37px] w-[126px] -translate-x-1/2 rounded-full bg-black" />
              <StatusIcons />
            </div>

            {/* the mail app's message view bar */}
            <div
              className={`flex h-11 shrink-0 items-center justify-between border-b px-4 text-[15px] ${
                dark ? 'border-white/10' : 'border-black/10'
              }`}
            >
              <span className="text-[#0a84ff]">‹ Inbox</span>
              <span className={`text-[13px] ${dark ? 'text-white/50' : 'text-black/45'}`}>
                {app} · {platform}
              </span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">{children}</div>

            {/* home indicator */}
            <span
              className={`pointer-events-none absolute bottom-2 left-1/2 h-[5px] w-[134px] -translate-x-1/2 rounded-full ${
                dark ? 'bg-white/80' : 'bg-black/80'
              }`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
