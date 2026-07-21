'use client';

import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { simulate } from '@/src/lib/engine/engine';
import { PROFILES } from '@/src/lib/engine/profiles';
import {
  CLIENT_IDS,
  type ClientId,
  type Mutation,
  type MutationStage,
  type RenderContext,
  type Severity,
  type SimulationResult,
} from '@/src/lib/engine/types';
import { HugeiconsIcon } from '@hugeicons/react';
import { ComputerIcon, Mail01Icon, Moon02Icon, SmartPhone01Icon, Sun03Icon } from '@hugeicons/core-free-icons';
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

type PreviewScheme = 'light' | 'dark';
type Device = 'desktop' | 'mobile';

// Visual card width (desktop column vs. a common phone) and the matching
// engine viewport width passed into the RenderContext.
const DEVICE_WIDTH: Record<Device, number> = { desktop: 680, mobile: 390 };
const DEVICE_VIEWPORT: Record<Device, number> = { desktop: 600, mobile: 375 };

// Issues are grouped by pipeline stage so dark-mode findings read distinctly
// from feature-strip / sanitize ones.
const STAGE_ORDER: MutationStage[] = ['sanitize', 'css-filter', 'inline', 'defaults', 'dark-mode', 'quirk'];
const STAGE_LABELS: Record<MutationStage, string> = {
  sanitize: 'Sanitized',
  'css-filter': 'Unsupported CSS',
  inline: 'Inlined',
  defaults: 'Client defaults',
  'dark-mode': 'Dark mode',
  quirk: 'Rendering quirks',
};

// A compact icon segmented control for the preview device + scheme pickers.
function Segmented<T extends string>({
  value,
  options,
  onPick,
}: {
  value: T;
  options: { id: T; label: string; icon: ReactNode }[];
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-(--border) bg-(--panel-2) p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.label}
          aria-label={o.label}
          aria-pressed={value === o.id}
          onClick={() => onPick(o.id)}
          className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
            value === o.id
              ? 'bg-(--panel) text-(--fg) shadow-sm ring-1 ring-(--border)'
              : 'text-(--fg-muted) hover:text-(--fg)'
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

function IssueRow({ m, onSelect }: { m: Mutation; onSelect: () => void }) {
  const sev = SEVERITY[m.severity];
  return (
    <li>
      <button
        onClick={onSelect}
        className="group block w-full px-3 py-2.5 text-left transition-colors hover:bg-black/3 dark:hover:bg-white/3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset ${sev.badge}`}>
            {sev.label}
          </span>
          <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-(--fg-muted) dark:bg-white/10">
            {m.action}
          </code>
          {m.target.property && (
            <code className="font-mono text-[11px] text-(--fg-muted)">
              {m.target.property}
              {m.target.value ? `: ${m.target.value}` : ''}
            </code>
          )}
          {m.target.element && !m.target.property && (
            <code className="font-mono text-[11px] text-(--fg-muted)">&lt;{m.target.element}&gt;</code>
          )}
          {m.target.loc && (
            <span className="ml-auto font-mono text-[10px] text-(--fg-muted) group-hover:text-sky-500">
              L{m.target.loc.startLine}:{m.target.loc.startCol}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-(--fg)/80">{m.reason}</p>
        {m.fix && (
          <p className="mt-1 text-[11px] leading-relaxed text-(--fg-muted)">
            <span className="font-semibold">Fix:</span> {m.fix}
          </p>
        )}
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
}

export default function Studio() {
  const [source, setSource] = useState(SAMPLE);
  const [debounced, setDebounced] = useState(SAMPLE);
  const [active, setActive] = useState<ClientId>('gmail');
  const viewRef = useRef<CmView | null>(null);

  // How the EMAIL is previewed (independent of the studio's own theme): the
  // device width it's viewed at, and whether it's shown on a light or dark
  // screen — because the same email is opened on phones and dark clients.
  const [device, setDevice] = useState<Device>('desktop');
  const [previewScheme, setPreviewScheme] = useState<PreviewScheme>('light');

  // Draggable divider between the preview and the issues panel.
  const splitRef = useRef<HTMLDivElement>(null);
  const [previewPct, setPreviewPct] = useState(58);
  const dragging = useRef(false);

  // 400ms debounce — the engine is pure TS, so analysis stays client-side.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(source), 400);
    return () => clearTimeout(t);
  }, [source]);

  // The conditions being simulated. The engine (not a CSS hack) produces the
  // dark output per client, so previewScheme/device feed straight into it.
  const renderCtx = useMemo<RenderContext>(
    () => ({ colorScheme: previewScheme, imagesBlocked: false, viewportWidth: DEVICE_VIEWPORT[device] }),
    [previewScheme, device],
  );

  // Analyze every client once per (debounced input × context); tab switches are instant.
  const results = useMemo(() => {
    const out = {} as Record<ClientId, SimulationResult>;
    for (const id of CLIENT_IDS) out[id] = simulate(debounced, id, renderCtx);
    return out;
  }, [debounced, renderCtx]);

  const result = results[active];
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const m of result.mutations) c[m.severity]++;
    return c;
  }, [result]);

  // Group the active client's mutations by pipeline stage, in pipeline order.
  const groups = useMemo(() => {
    const byStage = new Map<MutationStage, Mutation[]>();
    for (const m of result.mutations) {
      const list = byStage.get(m.stage);
      if (list) list.push(m);
      else byStage.set(m.stage, [m]);
    }
    return STAGE_ORDER.filter((s) => byStage.has(s)).map((s) => ({ stage: s, items: byStage.get(s)! }));
  }, [result]);

  // Outlook/Win never switches to dark — surface that instead of a fake preview.
  const alwaysLight = previewScheme === 'dark' && PROFILES[active].darkMode.strategy === 'unsupported';

  function scrollToLoc(mutation: Mutation) {
    const view = viewRef.current;
    const loc = mutation.target.loc;
    if (!view || !loc) return;
    const lineNo = Math.min(Math.max(loc.startLine, 1), view.state.doc.lines);
    const line = view.state.doc.line(lineNo);
    view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
    view.focus();
  }

  function onDividerDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onDividerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging.current || !splitRef.current) return;
    const rect = splitRef.current.getBoundingClientRect();
    const pct = ((e.clientY - rect.top) / rect.height) * 100;
    setPreviewPct(Math.min(85, Math.max(15, pct)));
  }
  function onDividerUp(e: ReactPointerEvent<HTMLDivElement>) {
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // pointer already released
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-(--canvas) text-(--fg)">
      {/* Top bar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-(--border) bg-(--panel) px-4 py-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
          <HugeiconsIcon icon={Mail01Icon} size={14} strokeWidth={2} />
        </div>
        <h1 className="text-sm font-semibold tracking-tight">Email Renderer</h1>
        <span className="hidden text-xs text-(--fg-muted) sm:inline">
          See how each client mangles your HTML — and why.
        </span>
      </header>

      {/* Pane-title strip — reads as one filename row across both panes. */}
      <div className="flex shrink-0 items-stretch border-b border-(--border) bg-(--panel-2) text-[11px] text-(--fg-muted)">
        <div className="relative flex w-[46%] min-w-0 items-center justify-center border-r border-(--border) px-3 py-2">
          <span className="font-mono">source.html</span>
          <span className="absolute right-3 font-mono tabular-nums text-(--fg-muted)/70">
            {source.split('\n').length} lines
          </span>
        </div>
        <div className="flex flex-1 min-w-0 items-center justify-center px-3 py-2">
          <span className="truncate font-mono">
            {shortName(active)} · {PROFILES[active].engine}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ---- Editor pane ---- */}
        <section className="flex w-[46%] min-w-0 min-h-0 flex-col border-r border-(--border) bg-(--panel)">
          <div className="min-h-0 flex-1 overflow-hidden">
            <Editor value={source} onChange={setSource} onView={(v) => (viewRef.current = v)} theme="light" />
          </div>
        </section>

        {/* ---- Preview + issues pane ---- */}
        <section className="flex min-h-0 flex-1 min-w-0 flex-col">
          {/* Client tabs + preview view controls (device / light-dark) */}
          <nav className="flex shrink-0 items-center gap-2 border-b border-(--border) bg-(--panel) px-2 py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {CLIENT_IDS.map((id) => {
              const res = results[id];
              // Badge shows the count of the WORST severity present, colored to
              // match — not the total mutation count. Otherwise a client with 90
              // informational notes and 1 real error reads as "91 errors" (red).
              const errs = res.mutations.filter((m) => m.severity === 'error').length;
              const warns = res.mutations.filter((m) => m.severity === 'warning').length;
              const worst: Severity = errs > 0 ? 'error' : warns > 0 ? 'warning' : 'info';
              const badgeCount = errs > 0 ? errs : warns > 0 ? warns : res.mutations.length;
              const isActive = active === id;
              return (
                <button
                  key={id}
                  onClick={() => setActive(id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-(--tab-active-bg) text-(--tab-active-fg)'
                      : 'text-(--fg-muted) hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  {shortName(id)}
                  {res.mutations.length > 0 && (
                    <span
                      className={`rounded-full px-1.5 text-[10px] font-semibold ${
                        worst === 'error'
                          ? 'bg-red-500 text-white'
                          : worst === 'warning'
                            ? 'bg-amber-400/90 text-white'
                            : 'bg-sky-500/90 text-white'
                      }`}
                    >
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
            </div>

            {alwaysLight && (
              <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-1 text-[10px] font-medium text-amber-600 ring-1 ring-amber-500/30 dark:text-amber-300">
                {shortName(active)} always light
              </span>
            )}
            <div className="flex shrink-0 items-center gap-1.5">
              <Segmented
                value={device}
                onPick={setDevice}
                options={[
                  { id: 'desktop', label: 'Desktop width', icon: <HugeiconsIcon icon={ComputerIcon} size={12}  /> },
                  { id: 'mobile', label: 'Mobile width', icon: <HugeiconsIcon icon={SmartPhone01Icon} size={12}  /> },
                ]}
              />
              <Segmented
                value={previewScheme}
                onPick={setPreviewScheme}
                options={[
                  { id: 'light', label: 'Light screen', icon: <HugeiconsIcon icon={Sun03Icon} size={12}  /> },
                  { id: 'dark', label: 'Dark screen', icon: <HugeiconsIcon icon={Moon02Icon} size={12}  /> },
                ]}
              />
            </div>
          </nav>

          {/* Preview + issues split (draggable divider) */}
          <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
          {/* Preview device */}
          <div
            style={{ height: `${previewPct}%` }}
            className={`flex min-h-0 shrink-0 flex-col overflow-auto p-4 transition-colors ${
              previewScheme === 'dark' ? 'bg-[#0a0a0a]' : 'bg-(--preview-bg)'
            }`}
          >
            <div
              style={{ maxWidth: DEVICE_WIDTH[device] }}
              className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-(--preview-frame-ring) transition-[max-width] duration-200"
            >
              <iframe
                title={`${active} preview`}
                sandbox=""
                srcDoc={result.html}
                className="min-h-0 w-full flex-1 border-0"
              />
            </div>
          </div>

          {/* Draggable divider */}
          <div
            onPointerDown={onDividerDown}
            onPointerMove={onDividerMove}
            onPointerUp={onDividerUp}
            className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center border-y border-(--border) bg-(--panel-2) hover:bg-black/4 dark:hover:bg-white/6"
          >
            <span className="h-0.5 w-8 rounded-full bg-(--border) group-hover:bg-(--fg-muted)" />
          </div>

          {/* Issues panel */}
          <div className="flex min-h-0 flex-1 flex-col border-t border-(--border) bg-(--panel)">
            <div className="flex shrink-0 items-center gap-3 border-b border-(--border-soft) px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-(--fg-muted)">
                Incompatibilities
              </span>
              <div className="flex items-center gap-3 text-[11px] text-(--fg-muted)">
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

            <div className="min-h-0 flex-1 overflow-auto">
              {groups.map((g) => (
                <section key={g.stage}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-(--border-soft) bg-(--panel-2) px-3 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-(--fg-muted)">
                      {STAGE_LABELS[g.stage]}
                    </span>
                    <span className="rounded-full bg-(--surface-tint) px-1.5 text-[10px] font-semibold text-(--fg-muted)">
                      {g.items.length}
                    </span>
                  </div>
                  <ul className="divide-y divide-(--border-soft)">
                    {g.items.map((m, i) => (
                      <IssueRow key={i} m={m} onSelect={() => scrollToLoc(m)} />
                    ))}
                  </ul>
                </section>
              ))}
              {result.mutations.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-1 px-3 py-10 text-center">
                  <span className="text-2xl">🎉</span>
                  <p className="text-xs text-(--fg-muted)">
                    No incompatibilities for {shortName(active)}.
                  </p>
                </div>
              )}
            </div>
          </div>
          </div>
        </section>
      </div>
    </div>
  );
}
