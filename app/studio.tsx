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
          <tr><td align="center" style="background:#2563eb;padding:36px 32px">
            <h1 style="margin:0 0 6px;color:#ffffff;font-size:30px">Hello, gorgeous!</h1>
            <p style="margin:0;color:#dbeafe;font-size:14px">
              This email is about to have a very bad day in Outlook.
            </p>
          </td></tr>

          <tr><td class="card" style="display:flex;gap:12px;padding:36px 40px 24px">
            <p style="margin:0;color:#4b5563;font-size:15px;line-height:1.6">
              Click through the client tabs. Outlook is about to soften these rounded
              corners — by deleting them — and flatten this flexbox like it's 2007.
              Paste your own HTML on the left: every declaration a client drops shows
              up below with the reason and a link to the evidence.
            </p>
          </td></tr>

          <tr><td align="center" style="padding:0 40px 36px">
            <a href="https://www.caniemail.com" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 28px;display:inline-block;font-size:15px;font-weight:bold;border-radius:999px;box-shadow:0 6px 16px rgba(37,99,235,0.35)">
              Browse the support data →
            </a>
            <p style="margin:12px 0 0;font-size:12px;color:#9ca3af">
              Yes, that pill is round. Ask Outlook how it feels about that.
            </p>
          </td></tr>

          <tr><td align="center" style="background:#f9fafb;padding:20px 40px">
            <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6">
              No account, no tracking pixel, no "click here to view in browser".<br>
              Everything runs locally in your browser.
            </p>
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

/**
 * Identity of a distinct issue. Occurrences of the same feature are collapsed
 * into one row, but a differing action or severity stays separate — merging
 * those would hide genuinely different findings.
 */
const issueKey = (m: Mutation) => `${m.feature}|${m.action}|${m.severity}`;

/** Distinct issues at a severity — not raw occurrences, so counts don't inflate. */
function distinctCount(muts: Mutation[], severity: Severity): number {
  const keys = new Set<string>();
  for (const m of muts) if (m.severity === severity) keys.add(issueKey(m));
  return keys.size;
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

/**
 * One row per DISTINCT issue. The same feature hit at 15 source locations is a
 * single row with 15 jump-to chips, not 15 copies of the same explanation —
 * otherwise the genuinely different problems drown in repetition.
 */
function IssueRow({ items, onSelect }: { items: Mutation[]; onSelect: (m: Mutation) => void }) {
  const head = items[0];
  const sev = SEVERITY[head.severity];
  const located = items.filter((m) => m.target.loc);

  // Only show a property/value in the header when every occurrence agrees;
  // otherwise the header would misrepresent the other occurrences.
  const properties = new Set(items.map((m) => m.target.property).filter(Boolean));
  const values = new Set(items.map((m) => m.target.value).filter(Boolean));
  const property = properties.size === 1 ? [...properties][0] : undefined;
  const value = property && values.size === 1 ? [...values][0] : undefined;
  const elements = new Set(items.map((m) => m.target.element).filter(Boolean));
  const element = !property && elements.size === 1 ? [...elements][0] : undefined;

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset ${sev.badge}`}>
          {sev.label}
        </span>
        <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-(--fg-muted) dark:bg-white/10">
          {head.action}
        </code>
        {property && (
          <code className="font-mono text-[11px] text-(--fg-muted)">
            {property}
            {value ? `: ${value}` : ''}
          </code>
        )}
        {element && (
          <code className="font-mono text-[11px] text-(--fg-muted)">&lt;{element}&gt;</code>
        )}
        {items.length > 1 && (
          <span className="ml-auto rounded-full bg-(--surface-tint) px-1.5 text-[10px] font-semibold text-(--fg-muted)">
            {items.length}×
          </span>
        )}
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-(--fg)/80">{head.reason}</p>
      {head.fix && (
        <p className="mt-1 text-[11px] leading-relaxed text-(--fg-muted)">
          <span className="font-semibold">Fix:</span> {head.fix}
        </p>
      )}

      {located.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {located.map((m, i) => (
            <button
              key={i}
              onClick={() => onSelect(m)}
              title={
                m.target.property
                  ? `${m.target.property}${m.target.value ? `: ${m.target.value}` : ''}`
                  : m.target.element
                    ? `<${m.target.element}>`
                    : undefined
              }
              className="rounded bg-(--surface-tint) px-1.5 py-0.5 font-mono text-[10px] text-(--fg-muted) transition-colors hover:text-sky-500"
            >
              L{m.target.loc!.startLine}:{m.target.loc!.startCol}
            </button>
          ))}
        </div>
      )}

      <a
        href={head.evidence}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-block text-[11px] font-medium text-sky-600 hover:underline dark:text-sky-400"
      >
        {head.feature} ↗
      </a>
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
  const counts = useMemo(
    () => ({
      error: distinctCount(result.mutations, 'error'),
      warning: distinctCount(result.mutations, 'warning'),
      info: distinctCount(result.mutations, 'info'),
    }),
    [result],
  );

  // Group by pipeline stage, then collapse repeated occurrences of the same
  // issue within each stage. Mutations arrive pre-sorted, so Map insertion
  // order keeps both levels deterministic.
  const groups = useMemo(() => {
    const byStage = new Map<MutationStage, Map<string, Mutation[]>>();
    for (const m of result.mutations) {
      let stage = byStage.get(m.stage);
      if (!stage) {
        stage = new Map();
        byStage.set(m.stage, stage);
      }
      const key = issueKey(m);
      const list = stage.get(key);
      if (list) list.push(m);
      else stage.set(key, [m]);
    }
    return STAGE_ORDER.filter((s) => byStage.has(s)).map((s) => ({
      stage: s,
      issues: [...byStage.get(s)!.entries()].map(([key, items]) => ({ key, items })),
    }));
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
        <h1 className="text-sm font-semibold tracking-tight">Mail Check</h1>
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
              const errs = distinctCount(res.mutations, 'error');
              const warns = distinctCount(res.mutations, 'warning');
              const worst: Severity = errs > 0 ? 'error' : warns > 0 ? 'warning' : 'info';
              const badgeCount =
                errs > 0 ? errs : warns > 0 ? warns : distinctCount(res.mutations, 'info');
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
                      {g.issues.length}
                    </span>
                  </div>
                  <ul className="divide-y divide-(--border-soft)">
                    {g.issues.map((iss) => (
                      <IssueRow key={iss.key} items={iss.items} onSelect={scrollToLoc} />
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
