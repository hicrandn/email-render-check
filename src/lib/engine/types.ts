// Core engine types. Pure TypeScript — no Next.js / DOM dependencies.

export type ClientId =
  | 'gmail'
  | 'outlook-win'
  | 'outlook-com'
  | 'apple-mail'
  | 'yahoo';

export const CLIENT_IDS: ClientId[] = [
  'gmail',
  'outlook-win',
  'outlook-com',
  'apple-mail',
  'yahoo',
];

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
  | 'inline'
  | 'defaults'
  | 'quirk';

export type MutationAction =
  | 'remove-property'
  | 'remove-value'
  | 'unwrap-element'
  | 'remove-element'
  | 'remove-attribute'
  | 'rewrite'
  | 'inject-default'
  | 'warn-only';

export type Severity = 'error' | 'warning' | 'info';

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
  /** Rendering engine ignores @media entirely (Outlook/Word). */
  ignoresMediaQueries?: boolean;
  /** Partial / unreliable @media support (warn, keep). */
  partialMediaQueries?: boolean;
  /** max-width is ignored on non-table elements (Outlook/Word). */
  ignoresMaxWidth?: boolean;
}

export interface ClientProfile {
  id: ClientId;
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
