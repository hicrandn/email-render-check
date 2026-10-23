// Core engine types. Pure TypeScript — no Next.js / DOM dependencies.

export type Device = 'desktop' | 'mobile';

export const DESKTOP_CLIENT_IDS = [
  'gmail',
  'outlook-win',
  'outlook-com',
  'apple-mail',
  'yahoo',
] as const;

// Phone apps. Each is tested on iOS and Android by caniemail (Apple Mail on
// iOS only); the snapshot keeps the worse of the two.
export const MOBILE_CLIENT_IDS = [
  'gmail-mobile',
  'outlook-mobile',
  'apple-mail-ios',
  'yahoo-mobile',
] as const;

export type ClientId =
  | (typeof DESKTOP_CLIENT_IDS)[number]
  | (typeof MOBILE_CLIENT_IDS)[number];

export const CLIENT_IDS: ClientId[] = [...DESKTOP_CLIENT_IDS, ...MOBILE_CLIENT_IDS];

/** caniemail raw support codes: y=supported, n=unsupported, a=partial, u=unknown. */
export type SupportCode = 'y' | 'n' | 'a' | 'u';

export interface SourceLocation {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export type MutationStage =
  | 'sanitize'
  | 'css-filter'
  | 'defaults'
  | 'dark-mode'
  | 'quirk';

export type MutationAction =
  | 'remove-property'
  | 'remove-value'
  | 'unwrap-element'
  | 'remove-element'
  | 'remove-rule'
  | 'remove-attribute'
  | 'rewrite'
  | 'inject-default'
  | 'auto-invert-color'
  | 'apply-dark-override'
  | 'warn-only';

export type Severity = 'error' | 'warning' | 'info';

// ---------------------------------------------------------------------------
// Render context: the same client can be simulated under different conditions
// (dark mode on a phone, images blocked, etc.). Passed to `simulate`.
// ---------------------------------------------------------------------------

export type ColorScheme = 'light' | 'dark';

export interface RenderContext {
  /** The OS/app appearance the recipient is viewing under. */
  colorScheme: ColorScheme;
  /** Viewport width in px (e.g. 600 desktop, 375 mobile). */
  viewportWidth: number;
}

export const DEFAULT_CONTEXT: RenderContext = {
  colorScheme: 'light',
  viewportWidth: 600,
};

export interface MutationTarget {
  loc?: SourceLocation;
  selector?: string;
  element?: string;
  property?: string;
  value?: string;
}

export interface Mutation {
  client: ClientId;
  stage: MutationStage;
  action: MutationAction;
  target: MutationTarget;
  /** caniemail slug or quirk id (e.g. "quirk-gmail-clipping"). */
  feature: string;
  severity: Severity;
  /** Human-readable explanation, in English. */
  reason: string;
  /** Link to caniemail.com/{slug} or official documentation. Mandatory. */
  evidence: string;
  /** Suggested alternative. */
  fix?: string;
}

export interface SimulationResult {
  clientId: ClientId;
  html: string;
  mutations: Mutation[];
}

export interface ClientQuirks {
  /** Message is clipped past this size (Gmail = 102 KB). */
  maxSizeKB?: number;
  /** max-width is ignored on non-table elements (Outlook/Word). */
  ignoresMaxWidth?: boolean;
  /** Percentage widths render unreliably; needs fixed-width + ghost tables (Word). */
  unreliablePercentWidth?: boolean;
  /** margin on block elements is ignored/inconsistent; use cell padding (Word). */
  unreliableBlockMargin?: boolean;
}

// ---------------------------------------------------------------------------
// Dark-mode behavior. Dark mode is not one thing: each client has a distinct
// strategy, so we model it explicitly instead of a single boolean.
// ---------------------------------------------------------------------------

export type DarkModeStrategy = 'native' | 'auto-invert' | 'partial' | 'unsupported';

// Support for @media (prefers-color-scheme) and the color-scheme meta tag comes
// from the caniemail snapshot, not from the profile.
export interface DarkModeProfile {
  strategy: DarkModeStrategy;
  /** Marks recolored elements with [data-ogsc] / [data-ogsb] that authors can target. */
  supportsOgscHack: boolean;
  note: string;
}

export interface ClientProfile {
  id: ClientId;
  device: Device;
  /** Human-readable client name (used in mutation reasons). */
  name: string;
  /** The rendering engine, which explains the "why" behind many quirks. */
  engine: string;
  /** Link to vendor rendering documentation, used as fallback evidence. */
  vendorDocs: string;
  /**
   * The client's user-agent stylesheet, injected at the top of <head> as a
   * low-priority default so author inline/existing styles override it.
   */
  uaStylesheet: string;
  /** Per-client rendering quirks handled by the quirks stage. */
  quirks: ClientQuirks;
  /** How this client behaves under dark mode. */
  darkMode: DarkModeProfile;
}

// ---------------------------------------------------------------------------
// Snapshot (caniemail.json) shape — produced by scripts/update-caniemail.ts.
// ---------------------------------------------------------------------------

export type FeatureCategory = 'css' | 'html' | 'image' | 'others';

export interface ClientSupport {
  /** Resolved support code for the latest tested version of this client. */
  status: SupportCode;
  /** The version key the status was taken from (null if the client did not resolve). */
  version: string | null;
  /** Whether the family/platform pair resolved directly, via fallback, or not at all. */
  resolution: 'direct' | 'fallback' | 'unresolved';
  /** Resolved note texts referenced by the status (e.g. "#1"). */
  notes: string[];
}

export interface FeatureSnapshot {
  slug: string;
  title: string;
  category: FeatureCategory;
  url: string;
  keywords: string;
  support: Record<ClientId, ClientSupport>;
}

export interface CanIEmailSnapshot {
  apiVersion: string;
  lastUpdate: string;
  generatedAt: string;
  features: FeatureSnapshot[];
}
