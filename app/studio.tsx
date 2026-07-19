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
  <body>
    <table role="presentation" width="600" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <div class="card" style="display:flex; gap:12px;">
            <h2 style="border-radius:4px; color:#111">Weekly digest</h2>
            <marquee>Limited offer!</marquee>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const SEVERITY_STYLES: Record<Mutation['severity'], string> = {
  error: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
};

export default function Studio() {
  const [source, setSource] = useState(SAMPLE);
  const [debounced, setDebounced] = useState(SAMPLE);
  const [active, setActive] = useState<ClientId>('outlook-win');
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
    <div className="flex flex-1 min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold">Email Renderer</h1>
        <span className="text-xs text-zinc-500">
          Simulate how email clients mangle your HTML, and why.
        </span>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Editor */}
        <section className="flex w-1/2 min-w-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
          <div className="border-b border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:border-zinc-800">
            HTML source
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <Editor value={source} onChange={setSource} onView={(v) => (viewRef.current = v)} />
          </div>
        </section>

        {/* Preview + mutations */}
        <section className="flex w-1/2 min-w-0 flex-col">
          <nav className="flex flex-wrap gap-1 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
            {CLIENT_IDS.map((id) => {
              const count = results[id].mutations.length;
              return (
                <button
                  key={id}
                  onClick={() => setActive(id)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    active === id
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                  }`}
                >
                  {PROFILES[id].name.split(' (')[0]}
                  {count > 0 && (
                    <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-[10px] text-white">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Rendered preview — sandboxed, NO script permission. */}
          <div className="min-h-0 flex-1 overflow-auto bg-white">
            <iframe
              title={`${active} preview`}
              sandbox=""
              srcDoc={result.html}
              className="h-full min-h-[240px] w-full border-0"
            />
          </div>

          {/* Mutation log */}
          <div className="min-h-0 flex-1 overflow-auto border-t border-zinc-200 dark:border-zinc-800">
            <div className="px-3 py-1.5 text-xs font-medium text-zinc-500">
              {result.mutations.length} incompatibilit
              {result.mutations.length === 1 ? 'y' : 'ies'} for {PROFILES[active].name}
              <span className="ml-1 text-zinc-400">· engine: {PROFILES[active].engine}</span>
            </div>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {result.mutations.map((m, i) => (
                <li key={i}>
                  <button
                    onClick={() => scrollToLoc(m)}
                    className="block w-full px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY_STYLES[m.severity]}`}>
                        {m.severity}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-500">{m.action}</span>
                      {m.target.loc && (
                        <span className="font-mono text-[11px] text-zinc-400">
                          L{m.target.loc.startLine}:{m.target.loc.startCol}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-300">{m.reason}</p>
                    <a
                      href={m.evidence}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 inline-block text-[11px] text-sky-600 hover:underline dark:text-sky-400"
                    >
                      {m.feature} ↗
                    </a>
                  </button>
                </li>
              ))}
              {result.mutations.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-zinc-400">
                  No incompatibilities detected for this client. 🎉
                </li>
              )}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
