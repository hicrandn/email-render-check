// Pure resolution of the raw Can I Email data into per-client support, used by
// update-caniemail.ts and tested in tests/scripts/. No network, no files.
import type {
  ClientId,
  ClientSupport,
  FeatureCategory,
  SupportCode,
} from '../src/lib/engine/types';

/**
 * Client -> (family, platforms). By default the platforms are ordered
 * fallbacks: the first that resolves wins, and the resolution mode ('direct'
 * vs 'fallback') is recorded so fallback entries can be surfaced in the script
 * output. With `worst`, every platform is resolved and the least supported one
 * is kept (phone apps tested separately on iOS and Android).
 */
export const CLIENT_MAP: Record<ClientId, { family: string; platforms: string[]; worst?: boolean }> = {
  gmail: { family: 'gmail', platforms: ['desktop-webmail', 'webmail', 'mobile-webmail'] },
  'outlook-win': { family: 'outlook', platforms: ['windows', 'windows-mail'] },
  'outlook-com': { family: 'outlook', platforms: ['outlook-com', 'webmail', 'desktop-webmail'] },
  'apple-mail': { family: 'apple-mail', platforms: ['macos', 'ios'] },
  yahoo: { family: 'yahoo', platforms: ['desktop-webmail', 'webmail', 'mobile-webmail'] },
  'gmail-mobile': { family: 'gmail', platforms: ['ios', 'android'], worst: true },
  'outlook-mobile': { family: 'outlook', platforms: ['ios', 'android'], worst: true },
  'apple-mail-ios': { family: 'apple-mail', platforms: ['ios'] },
  'yahoo-mobile': { family: 'yahoo', platforms: ['ios', 'android'], worst: true },
};

const PLATFORM_LABEL: Record<string, string> = { ios: 'iOS', android: 'Android' };

// Lower is less supported; unknown only wins when nothing else is known.
const STATUS_RANK: Record<SupportCode, number> = { n: 0, a: 1, y: 2, u: 3 };

// Shape of the relevant parts of the caniemail raw API response.
export interface RawFeature {
  slug: string;
  title: string;
  category: string;
  url: string;
  keywords: string;
  notes_by_num: Record<string, string> | null;
  stats: Record<string, Record<string, Record<string, string>>>;
}
export interface RawData {
  api_version: string;
  last_update_date: string;
  data: RawFeature[];
}

/** Compare two version keys chronologically. Handles "2019-02", "16.80", "2007". */
export function compareVersion(a: string, b: string): number {
  const pa = a.split(/[-.]/).map((n) => parseInt(n, 10));
  const pb = b.split(/[-.]/).map((n) => parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.isNaN(pa[i]) ? -1 : pa[i] ?? -1;
    const nb = Number.isNaN(pb[i]) ? -1 : pb[i] ?? -1;
    if (na !== nb) return na - nb;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Pick the chronologically latest version key from a version->status map. */
export function latestVersion(versions: Record<string, string>): string | null {
  const keys = Object.keys(versions);
  if (keys.length === 0) return null;
  return keys.sort(compareVersion)[keys.length - 1];
}

/** Parse a raw status string like "a #1" into a code plus referenced note numbers. */
export function parseStatus(raw: string): { code: SupportCode; noteRefs: string[] } {
  const tokens = raw.trim().split(/\s+/);
  const codeToken = tokens[0];
  const code: SupportCode =
    codeToken === 'y' || codeToken === 'n' || codeToken === 'a' ? codeToken : 'u';
  const noteRefs: string[] = [];
  for (const tok of tokens.slice(1)) {
    const m = /^#(\d+)$/.exec(tok);
    if (m) noteRefs.push(m[1]);
  }
  return { code, noteRefs };
}

/** Support on one platform, at its latest tested version. */
export function resolvePlatform(
  feature: RawFeature,
  familyStats: Record<string, Record<string, string>>,
  platform: string,
): { status: SupportCode; version: string; notes: string[] } | null {
  const versions = familyStats[platform];
  if (!versions) return null;
  const version = latestVersion(versions);
  if (version == null) return null;
  const { code, noteRefs } = parseStatus(versions[version]);
  const notes = noteRefs
    .map((n) => feature.notes_by_num?.[n])
    .filter((t): t is string => Boolean(t));
  return { status: code, version, notes };
}

export function resolveClient(
  feature: RawFeature,
  clientId: ClientId,
  unresolved: string[],
): ClientSupport {
  const { family, platforms, worst } = CLIENT_MAP[clientId];
  const familyStats = feature.stats?.[family];
  if (!familyStats) {
    unresolved.push(`${feature.slug} :: ${clientId} (family "${family}" absent)`);
    return { status: 'u', version: null, resolution: 'unresolved', notes: [] };
  }

  if (worst) {
    const resolved = platforms
      .map((platform) => ({ platform, r: resolvePlatform(feature, familyStats, platform) }))
      .filter((x): x is { platform: string; r: NonNullable<typeof x.r> } => x.r !== null);
    if (resolved.length > 0) {
      const pick = resolved.reduce((a, b) =>
        STATUS_RANK[b.r.status] < STATUS_RANK[a.r.status] ? b : a,
      );
      const notes = [...pick.r.notes];
      if (new Set(resolved.map((x) => x.r.status)).size > 1) {
        const word: Record<SupportCode, string> = { y: 'supported', a: 'partial', n: 'not supported', u: 'unknown' };
        notes.push(
          'Differs by platform: ' +
            resolved.map((x) => `${PLATFORM_LABEL[x.platform] ?? x.platform} ${word[x.r.status]}`).join(', ') +
            '.',
        );
      }
      return { status: pick.r.status, version: pick.r.version, resolution: 'direct', notes };
    }
  }

  for (let i = 0; i < platforms.length; i++) {
    const r = resolvePlatform(feature, familyStats, platforms[i]);
    if (!r) continue;
    return {
      status: r.status,
      version: r.version,
      resolution: i === 0 ? 'direct' : 'fallback',
      notes: r.notes,
    };
  }

  unresolved.push(
    `${feature.slug} :: ${clientId} (no platform of [${platforms.join(', ')}] present)`,
  );
  return { status: 'u', version: null, resolution: 'unresolved', notes: [] };
}

export function normalizeCategory(raw: string): FeatureCategory {
  if (raw === 'css' || raw === 'html' || raw === 'image') return raw;
  return 'others';
}
