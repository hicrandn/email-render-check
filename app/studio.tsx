'use client';

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import { simulate } from '@/src/lib/engine/engine';
import { CLIENTS_BY_DEVICE, PROFILES, clientOn } from '@/src/lib/engine/profiles';
import { snapshot } from '@/src/lib/engine/data/snapshot';
import {
  type ClientId,
  type Device,
  type Mutation,
  type MutationStage,
  type RenderContext,
  type Severity,
  type SimulationResult,
} from '@/src/lib/engine/types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowUpRight01Icon,
  ComputerIcon,
  Mail01Icon,
  Moon02Icon,
  SmartPhone01Icon,
  Sun03Icon,
} from '@hugeicons/core-free-icons';
import type { CmView } from './editor';
import { SAMPLE } from './sample';
import PhoneFrame, { PHONE_SCREEN } from './phone-frame';

// CodeMirror touches the DOM — load it client-side only.
const Editor = dynamic(() => import('./editor'), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-zinc-500">Loading editor…</div>,
});

const SEVERITY: Record<Mutation['severity'], { dot: string; label: string }> = {
  error: { dot: 'bg-red-500', label: 'Error' },
  warning: { dot: 'bg-amber-500', label: 'Warning' },
  info: { dot: 'bg-sky-500', label: 'Info' },
};

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

// What the client did, in words; the engine's action ids are internal.
const ACTION_LABEL: Record<Mutation['action'], string> = {
  'remove-property': 'Removed',
  'remove-value': 'Removed',
  'remove-rule': 'Removed',
  'remove-element': 'Removed',
  'remove-attribute': 'Removed',
  'unwrap-element': 'Unwrapped',
  rewrite: 'Rewritten',
  'inject-default': 'Default added',
  'auto-invert-color': 'Inverted',
  'apply-dark-override': 'Dark styles applied',
  'warn-only': 'Kept',
};

/**
 * Engine reasons and Can I Email notes use `code` and [text](url) markdown.
 * Render those two inline forms; everything else stays plain text.
 */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
          return (
            <code key={i} className="rounded bg-(--surface-tint) px-1 font-mono text-[0.92em]">
              {part.slice(1, -1)}
            </code>
          );
        }
        const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
        if (link) {
          return (
            <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="underline decoration-(--border) underline-offset-2 hover:decoration-current">
              {link[1]}
            </a>
          );
        }
        return part;
      })}
    </>
  );
}

function evidenceLabel(url: string): string {
  try {
    const { hostname } = new URL(url);
    return hostname.endsWith('caniemail.com') ? 'Can I Email' : hostname.replace(/^www\./, '');
  } catch {
    return 'Reference';
  }
}

function shortName(id: ClientId): string {
  return PROFILES[id].name.split(' (')[0];
}

/**
 * The result of simulating one client, plus an error if it threw. Pathological
 * input (e.g. thousands of levels of nesting) can blow the call stack inside
 * `simulate()` — the engine can't fully guard against that (parse5's own
 * serializer is recursive too), so the UI treats it as a per-client failure
 * instead of letting the whole page crash.
 */
interface ClientResult {
  result: SimulationResult;
  error?: string;
}

function simulateSafe(html: string, id: ClientId, ctx: RenderContext): ClientResult {
  try {
    return { result: simulate(html, id, ctx) };
  } catch (e) {
    return {
      result: { clientId: id, html: '', mutations: [] },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** requestIdleCallback isn't available in every engine (e.g. Safari) — fall back to a macrotask. */
function scheduleIdle(cb: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(cb);
  else setTimeout(cb, 0);
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

// Engine viewport width per device. On desktop the preview column is a little
// wider than the email; on a phone it is the phone frame's screen.
const DEVICE_VIEWPORT: Record<Device, number> = { desktop: 600, mobile: PHONE_SCREEN.width };
const DESKTOP_PREVIEW_WIDTH = 680;

/** "iOS/Android app" from "Gmail (iOS/Android app)". */
function platformOf(id: ClientId): string {
  return /\(([^)]+)\)/.exec(PROFILES[id].name)?.[1] ?? '';
}

// Issues are grouped by pipeline stage so dark-mode findings read distinctly
// from feature-strip / sanitize ones.
const STAGE_ORDER: MutationStage[] = ['sanitize', 'css-filter', 'defaults', 'dark-mode', 'quirk'];
const STAGE_LABELS: Record<MutationStage, string> = {
  sanitize: 'Sanitized',
  'css-filter': 'Unsupported CSS',
  defaults: 'Client defaults',
  'dark-mode': 'Dark mode',
  quirk: 'Rendering quirks',
};

// A compact segmented control for the preview device + scheme pickers. An
// option with `text` shows it next to its icon.
function Segmented<T extends string>({
  value,
  options,
  onPick,
}: {
  value: T;
  options: { id: T; label: string; icon: ReactNode; text?: string }[];
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
          className={`flex h-6 items-center justify-center gap-1.5 rounded-md text-[11px] transition-colors ${
            o.text ? 'px-2' : 'w-6'
          } ${
            value === o.id
              ? 'bg-(--panel) text-(--fg) shadow-sm ring-1 ring-(--border)'
              : 'text-(--fg-muted) hover:text-(--fg)'
          }`}
        >
          {o.icon}
          {o.text}
        </button>
      ))}
    </div>
  );
}

/**
 * One row per distinct issue. The same feature hit at 15 source locations is a
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
    <li className="flex gap-2.5 px-4 py-3">
      <span
        title={sev.label}
        aria-label={sev.label}
        className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${sev.dot}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-medium">{ACTION_LABEL[head.action]}</span>
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
            <span className="ml-auto text-[11px] tabular-nums text-(--fg-muted)">
              {items.length} places
            </span>
          )}
        </div>

        <p className="mt-1 text-xs leading-relaxed text-(--fg)/80">
          <RichText text={head.reason} />
        </p>
        {head.fix && (
          <p className="mt-1 text-xs leading-relaxed text-(--fg-muted)">
            <span className="font-medium text-(--fg)/80">Fix: </span>
            <RichText text={head.fix} />
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-(--fg-muted)">
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
              className="font-mono tabular-nums hover:text-(--fg)"
            >
              line {m.target.loc!.startLine}
            </button>
          ))}
          <a
            href={head.evidence}
            target="_blank"
            rel="noopener noreferrer"
            title={head.feature}
            className="inline-flex items-center gap-0.5 hover:text-(--fg)"
          >
            {evidenceLabel(head.evidence)}
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={11} />
          </a>
        </div>
      </div>
    </li>
  );
}

export default function Studio() {
  const [source, setSource] = useState(SAMPLE);
  const [debounced, setDebounced] = useState(SAMPLE);
  // The client last picked, on either device; `active` is its counterpart on
  // the current device, so switching device and back returns to the same tab.
  const [picked, setPicked] = useState<ClientId>('gmail');
  const viewRef = useRef<CmView | null>(null);

  // How the email is previewed (independent of the studio's own theme): the
  // device width it's viewed at, and whether it's shown on a light or dark
  // screen — because the same email is opened on phones and dark clients.
  const [device, setDevice] = useState<Device>('desktop');
  const [previewScheme, setPreviewScheme] = useState<PreviewScheme>('light');
  // Phones run the clients' apps, not their desktop versions, so the device
  // also picks which clients are simulated.
  const clients = CLIENTS_BY_DEVICE[device];
  const active = clientOn(device, picked);

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
    () => ({ colorScheme: previewScheme, viewportWidth: DEVICE_VIEWPORT[device] }),
    [previewScheme, device],
  );

  // The active client is simulated synchronously — it's the only one the
  // interactive typing path needs right away. The others (needed only for
  // the tab badge counts) are computed off that path, one at a time during
  // idle time, so a large email doesn't block every keystroke on 5x the work.
  const activeResult = useMemo(
    () => simulateSafe(debounced, active, renderCtx),
    [debounced, active, renderCtx],
  );
  const [backgroundResults, setBackgroundResults] = useState<Partial<Record<ClientId, ClientResult>>>({});

  useEffect(() => {
    let cancelled = false;
    const others = clients.filter((id) => id !== active);

    function step(i: number) {
      if (cancelled || i >= others.length) return;
      const id = others[i];
      const r = simulateSafe(debounced, id, renderCtx);
      if (!cancelled) setBackgroundResults((prev) => ({ ...prev, [id]: r }));
      scheduleIdle(() => step(i + 1));
    }
    step(0);

    return () => {
      cancelled = true;
    };
  }, [debounced, renderCtx, active, clients]);

  // Active client always has a fresh result; the others fill in progressively.
  const results: Partial<Record<ClientId, ClientResult>> = {
    ...backgroundResults,
    [active]: activeResult,
  };
  const result = activeResult.result;
  const activeError = activeResult.error;
  const counts = useMemo(
    () => ({
      error: distinctCount(result.mutations, 'error'),
      warning: distinctCount(result.mutations, 'warning'),
      info: distinctCount(result.mutations, 'info'),
    }),
    [result],
  );

  // Group by pipeline stage, then collapse repeated occurrences of the same
  // issue within each stage. Errors come first: inside a stage, issues are
  // ordered by severity, and stages by the worst severity they contain.
  // Mutations arrive pre-sorted and Array#sort is stable, so ties keep
  // source order (within a stage) and pipeline order (between stages).
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
    return STAGE_ORDER.filter((s) => byStage.has(s))
      .map((s) => ({
        stage: s,
        issues: [...byStage.get(s)!.entries()]
          .map(([key, items]) => ({ key, items }))
          .sort((a, b) => SEVERITY_RANK[a.items[0].severity] - SEVERITY_RANK[b.items[0].severity]),
      }))
      .sort((a, b) => SEVERITY_RANK[a.issues[0].items[0].severity] - SEVERITY_RANK[b.issues[0].items[0].severity]);
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
  function onDividerKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = 4;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      setPreviewPct((pct) => Math.max(15, pct - step));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      setPreviewPct((pct) => Math.min(85, pct + step));
    } else if (e.key === 'Home') {
      setPreviewPct(15);
    } else if (e.key === 'End') {
      setPreviewPct(85);
    } else {
      return;
    }
    e.preventDefault();
  }

  const previewBody = activeError ? (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1 bg-(--panel) p-6 text-center">
      <p className="text-xs text-(--fg-muted)">
        Couldn&apos;t render this HTML for {shortName(active)} — see the note below.
      </p>
    </div>
  ) : (
    <iframe
      title={`${active} preview`}
      sandbox=""
      srcDoc={result.html}
      className="min-h-0 w-full flex-1 border-0"
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-(--canvas) text-(--fg)">
      {/* Top bar */}
      <header className="flex shrink-0 items-center gap-2 border-b border-(--border) bg-(--panel) px-4 py-2.5">
        <HugeiconsIcon icon={Mail01Icon} size={16} strokeWidth={1.8} />
        <h1 className="text-sm font-semibold">Mail Check</h1>
        <span className="ml-2 hidden text-xs text-(--fg-muted) sm:inline">
          How email clients render your HTML, and what they drop.
        </span>
        <a
          href="https://www.caniemail.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto hidden shrink-0 text-[11px] text-(--fg-muted) hover:text-(--fg) sm:inline"
        >
          Can I Email data, {snapshot.lastUpdate.split(' ')[0]}
        </a>
      </header>

      {/* Pane-title strip — reads as one filename row across both panes. */}
      <div className="flex shrink-0 items-stretch border-b border-(--border) bg-(--panel-2) text-[11px] text-(--fg-muted)">
        <div className="flex w-[46%] min-w-0 items-center justify-between gap-3 border-r border-(--border) px-4 py-2">
          <span className="font-mono text-(--fg)/80">source.html</span>
          <span className="font-mono tabular-nums">{source.split('\n').length} lines</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2">
          <span className="shrink-0 font-medium text-(--fg)/80">{PROFILES[active].name}</span>
          <span className="truncate">{PROFILES[active].engine}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ---- Editor pane ---- */}
        <section className="flex w-[46%] min-w-0 min-h-0 flex-col border-r border-(--border) bg-(--panel)">
          <div className="min-h-0 flex-1 overflow-hidden">
            <Editor value={source} onChange={setSource} onView={(v) => (viewRef.current = v)} />
          </div>
        </section>

        {/* ---- Preview + issues pane ---- */}
        <section className="flex min-h-0 flex-1 min-w-0 flex-col">
          {/* Client tabs + preview view controls (device / light-dark) */}
          <nav
            role="tablist"
            aria-label="Email client"
            className="flex shrink-0 items-stretch gap-2 border-b border-(--border) bg-(--panel) px-2"
          >
            <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
            {clients.map((id) => {
              const res = results[id];
              const isActive = active === id;
              // Badge shows the count of the worst severity present, colored to
              // match — not the total mutation count. Otherwise a client with 90
              // informational notes and 1 real error reads as "91 errors" (red).
              const errs = res ? distinctCount(res.result.mutations, 'error') : 0;
              const warns = res ? distinctCount(res.result.mutations, 'warning') : 0;
              const worst: Severity = errs > 0 ? 'error' : warns > 0 ? 'warning' : 'info';
              const badgeCount =
                errs > 0 ? errs : warns > 0 ? warns : res ? distinctCount(res.result.mutations, 'info') : 0;
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setPicked(id)}
                  className={`relative flex shrink-0 items-center gap-2 px-3 py-2.5 text-xs transition-colors ${
                    isActive
                      ? 'font-medium text-(--fg) after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-(--fg)'
                      : 'text-(--fg-muted) hover:text-(--fg)'
                  }`}
                >
                  {shortName(id)}
                  {res?.error && (
                    <span title={res.error} className="text-[11px] font-normal text-red-600">
                      failed
                    </span>
                  )}
                  {!res?.error && res && res.result.mutations.length > 0 && (
                    <span
                      title={`${badgeCount} ${SEVERITY[worst].label.toLowerCase()}${badgeCount === 1 ? '' : 's'}`}
                      className="flex items-center gap-1 text-[11px] font-normal tabular-nums text-(--fg-muted)"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY[worst].dot}`} />
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
            </div>

            {alwaysLight && (
              <span className="shrink-0 self-center text-[11px] text-(--fg-muted)">
                {shortName(active)} has no dark mode
              </span>
            )}
            <div className="flex shrink-0 items-center gap-1.5 py-1.5">
              <Segmented
                value={device}
                onPick={(d) => {
                  setDevice(d);
                  // A phone is tall: give the preview more of the split.
                  if (d === 'mobile') setPreviewPct((pct) => Math.max(pct, 70));
                }}
                options={[
                  { id: 'desktop', label: 'Desktop clients', text: 'Desktop', icon: <HugeiconsIcon icon={ComputerIcon} size={12} /> },
                  { id: 'mobile', label: 'Phone apps', text: 'Phone', icon: <HugeiconsIcon icon={SmartPhone01Icon} size={12} /> },
                ]}
              />
              <Segmented
                value={previewScheme}
                onPick={setPreviewScheme}
                options={[
                  { id: 'light', label: 'Light screen', icon: <HugeiconsIcon icon={Sun03Icon} size={12} /> },
                  { id: 'dark', label: 'Dark screen', icon: <HugeiconsIcon icon={Moon02Icon} size={12} /> },
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
            {device === 'mobile' ? (
              <PhoneFrame
                app={shortName(active)}
                platform={platformOf(active)}
                dark={previewScheme === 'dark'}
              >
                {previewBody}
              </PhoneFrame>
            ) : (
              <div
                style={{ maxWidth: DESKTOP_PREVIEW_WIDTH }}
                className={`mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-md border ${
                  previewScheme === 'dark' ? 'border-white/10' : 'border-(--border)'
                }`}
              >
                {previewBody}
              </div>
            )}
          </div>

          {/* Draggable divider */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-valuenow={Math.round(previewPct)}
            aria-valuemin={15}
            aria-valuemax={85}
            tabIndex={0}
            onPointerDown={onDividerDown}
            onPointerMove={onDividerMove}
            onPointerUp={onDividerUp}
            onKeyDown={onDividerKeyDown}
            className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center border-y border-(--border) bg-(--panel-2) hover:bg-black/4 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <span className="h-0.5 w-8 rounded-full bg-(--border) group-hover:bg-(--fg-muted)" />
          </div>

          {/* Issues panel */}
          <div className="flex min-h-0 flex-1 flex-col border-t border-(--border) bg-(--panel)">
            <div className="flex shrink-0 items-baseline gap-3 border-b border-(--border) px-4 py-2.5">
              <span className="text-xs font-medium">Issues in {shortName(active)}</span>
              <div className="flex items-center gap-3 text-[11px] tabular-nums text-(--fg-muted)">
                {counts.error > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    {counts.error} error{counts.error === 1 ? '' : 's'}
                  </span>
                )}
                {counts.warning > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    {counts.warning} warning{counts.warning === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {activeError ? (
                <div className="flex flex-col items-center justify-center gap-1 px-3 py-10 text-center">
                  <p className="max-w-xs text-xs text-(--fg-muted)">
                    Couldn&apos;t analyze this HTML for {shortName(active)}.
                  </p>
                  <p className="mt-1 max-w-xs font-mono text-[10px] text-(--fg-muted)/70">{activeError}</p>
                </div>
              ) : (
                <>
                  {groups.map((g) => (
                    <section key={g.stage}>
                      <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-(--border-soft) bg-(--panel-2) px-4 py-1.5 text-[11px] text-(--fg-muted)">
                        <span className="font-medium text-(--fg)/70">{STAGE_LABELS[g.stage]}</span>
                        <span className="tabular-nums">{g.issues.length}</span>
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
                      <p className="text-xs text-(--fg-muted)">
                        No incompatibilities for {shortName(active)}.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          </div>
        </section>
      </div>
    </div>
  );
}
