'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { simulate } from '@/src/lib/engine/engine';
import { PROFILES } from '@/src/lib/engine/profiles';
import { CLIENT_IDS, type ClientId, type Mutation, type SimulationResult } from '@/src/lib/engine/types';
import type { CmView } from './editor';

// CodeMirror touches the DOM — load it client-side only.
const Editor = dynamic(() => import('./editor'), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-zinc-500">Loading editor…</div>,
});

const SAMPLE = `<!doctype html>
<html>
  <head>
    <style>
      .card { display: flex; border-radius: 8px; padding: 16px; }
      .hero { background: #ffffff url(hero.png) no-repeat center; }
    </style>
  </head>
  <body style="margin:0;background:#f4f4f7;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:8px;overflow:hidden">
          <tr><td align="center" style="background:#2563eb;padding:32px">
            <h1 style="margin:0;color:#fff;font-size:28px">🚀 Welcome!</h1>
          </td></tr>
          <tr><td class="card" style="display:flex;gap:12px;padding:40px">
            <h2 style="margin:0 0 16px;font-size:24px;color:#111827">Hello John 👋</h2>
            <marquee>Limited offer!</marquee>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

const SEVERITY: Record<Mutation['severity'], { dot: string; badge: string; label: string }> = {
  error: {
    dot: 'bg-red-500',
    badge: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-400/20',
    label: 'Error',
  },
  warning: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-400/20',
    label: 'Warning',
  },
  info: {
    dot: 'bg-sky-500',
    badge: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-400/20',
    label: 'Info',
  },
};

function shortName(id: ClientId): string {
  return PROFILES[id].name.split(' (')[0];
}

export default function Studio() {
  const [source, setSource] = useState(SAMPLE);
  const [debounced, setDebounced] = useState(SAMPLE);
  const [active, setActive] = useState<ClientId>('gmail');
  const viewRef = useRef<CmView | null>(null);

  // 400ms debounce — the engine is pure TS, so analysis stays client-side.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(source), 400);
    return () => clearTimeout(t);
  }, [source]);

  // Analyze every client once per (debounced) input; tab switches are instant.
  const results = useMemo(() => {
    const out = {} as Record<ClientId, SimulationResult>;
    for (const id of CLIENT_IDS) out[id] = simulate(debounced, id);
    return out;
  }, [debounced]);

  const result = results[active];
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const m of result.mutations) c[m.severity]++;
    return c;
  }, [result]);

  function scrollToLoc(mutation: Mutation) {
    const view = viewRef.current;
    const loc = mutation.target.loc;
    if (!view || !loc) return;
    const lineNo = Math.min(Math.max(loc.startLine, 1), view.state.doc.lines);
    const line = view.state.doc.line(lineNo);
    view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
    view.focus();
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Top bar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-zinc-900 text-xs font-bold text-white dark:bg-white dark:text-zinc-900">
          ✉
        </div>
        <h1 className="text-sm font-semibold tracking-tight">Email Renderer</h1>
        <span className="hidden text-xs text-zinc-500 sm:inline">
          See how each client mangles your HTML — and why.
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---- Editor pane ---- */}
        <section className="flex w-[46%] min-w-0 min-h-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              HTML source
            </span>
            <span className="text-[11px] text-zinc-400">{source.split('\n').length} lines</span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <Editor value={source} onChange={setSource} onView={(v) => (viewRef.current = v)} />
          </div>
        </section>

        {/* ---- Preview + issues pane ---- */}
        <section className="flex min-h-0 flex-1 min-w-0 flex-col">
          {/* Client tabs */}
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
            {CLIENT_IDS.map((id) => {
              const res = results[id];
              const errs = res.mutations.filter((m) => m.severity === 'error').length;
              const isActive = active === id;
              return (
                <button
                  key={id}
                  onClick={() => setActive(id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                  }`}
                >
                  {shortName(id)}
                  {res.mutations.length > 0 && (
                    <span
                      className={`rounded-full px-1.5 text-[10px] font-semibold ${
                        errs > 0
                          ? 'bg-red-500 text-white'
                          : isActive
                            ? 'bg-white/25 text-white dark:bg-zinc-900/15 dark:text-zinc-900'
                            : 'bg-amber-400/90 text-amber-950'
                      }`}
                    >
                      {res.mutations.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Preview device */}
          <div className="flex min-h-0 flex-3 items-start justify-center overflow-auto bg-zinc-200/60 p-5 dark:bg-black/40">
            <div className="flex h-full w-full max-w-[680px] flex-col overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/5 dark:ring-white/10">
              <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/60">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
                <span className="ml-2 truncate text-[11px] text-zinc-500">
                  {PROFILES[active].name} · {PROFILES[active].engine}
                </span>
              </div>
              <iframe
                title={`${active} preview`}
                sandbox=""
                srcDoc={result.html}
                className="min-h-0 w-full flex-1 border-0 bg-white"
              />
            </div>
          </div>

          {/* Issues panel */}
          <div className="flex min-h-0 flex-2 flex-col border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Incompatibilities
              </span>
              <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                {counts.error > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                    {counts.error} error{counts.error === 1 ? '' : 's'}
                  </span>
                )}
                {counts.warning > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    {counts.warning} warning{counts.warning === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </div>

            <ul className="min-h-0 flex-1 divide-y divide-zinc-100 overflow-auto dark:divide-zinc-800">
              {result.mutations.map((m, i) => {
                const sev = SEVERITY[m.severity];
                return (
                  <li key={i}>
                    <button
                      onClick={() => scrollToLoc(m)}
                      className="group block w-full px-3 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset ${sev.badge}`}>
                          {sev.label}
                        </span>
                        <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {m.action}
                        </code>
                        {m.target.property && (
                          <code className="font-mono text-[11px] text-zinc-500">
                            {m.target.property}
                            {m.target.value ? `: ${m.target.value}` : ''}
                          </code>
                        )}
                        {m.target.element && !m.target.property && (
                          <code className="font-mono text-[11px] text-zinc-500">&lt;{m.target.element}&gt;</code>
                        )}
                        {m.target.loc && (
                          <span className="ml-auto font-mono text-[10px] text-zinc-400 group-hover:text-sky-500">
                            L{m.target.loc.startLine}:{m.target.loc.startCol}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                        {m.reason}
                      </p>
                      <a
                        href={m.evidence}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 inline-block text-[11px] font-medium text-sky-600 hover:underline dark:text-sky-400"
                      >
                        {m.feature} ↗
                      </a>
                    </button>
                  </li>
                );
              })}
              {result.mutations.length === 0 && (
                <li className="flex flex-col items-center justify-center gap-1 px-3 py-10 text-center">
                  <span className="text-2xl">🎉</span>
                  <p className="text-xs text-zinc-400">
                    No incompatibilities for {shortName(active)}.
                  </p>
                </li>
              )}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
