/**
 * Fetches the Can I Email dataset, resolves per-client support for the 5 target
 * clients, and writes a normalized, committed snapshot to
 * `src/lib/engine/data/caniemail.json`.
 *
 * The snapshot is committed to the repo and read at build/runtime; the app NEVER
 * fetches caniemail.com at runtime.
 *
 * Run with: `npm run update-caniemail` (or `bun run update-caniemail`).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  CanIEmailSnapshot,
  ClientId,
  ClientSupport,
  FeatureCategory,
  FeatureSnapshot,
  SupportCode,
} from '../src/lib/engine/types';

const DATA_URL = 'https://www.caniemail.com/api/data.json';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/lib/engine/data/caniemail.json');

/**
 * Client -> (family, ordered platform fallbacks). The first platform that
 * resolves wins; the resolution mode ('direct' vs 'fallback') is recorded so
 * unresolved / fallback entries can be surfaced in the script output.
 */
const CLIENT_MAP: Record<ClientId, { family: string; platforms: string[] }> = {
  gmail: { family: 'gmail', platforms: ['desktop-webmail', 'webmail', 'mobile-webmail'] },
  'outlook-win': { family: 'outlook', platforms: ['windows', 'windows-mail'] },
  'outlook-com': { family: 'outlook', platforms: ['outlook-com', 'webmail', 'desktop-webmail'] },
  'apple-mail': { family: 'apple-mail', platforms: ['macos', 'ios'] },
  yahoo: { family: 'yahoo', platforms: ['desktop-webmail', 'webmail', 'mobile-webmail'] },
};

// Shape of the relevant parts of the caniemail raw API response.
interface RawFeature {
  slug: string;
  title: string;
  category: string;
  url: string;
  keywords: string;
  notes_by_num: Record<string, string> | null;
  stats: Record<string, Record<string, Record<string, string>>>;
}
interface RawData {
  api_version: string;
  last_update_date: string;
  data: RawFeature[];
}

/** Compare two version keys chronologically. Handles "2019-02", "16.80", "2007". */
function compareVersion(a: string, b: string): number {
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
function latestVersion(versions: Record<string, string>): string | null {
  const keys = Object.keys(versions);
  if (keys.length === 0) return null;
  return keys.sort(compareVersion)[keys.length - 1];
}

/** Parse a raw status string like "a #1" into a code plus referenced note numbers. */
function parseStatus(raw: string): { code: SupportCode; noteRefs: string[] } {
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

function resolveClient(
  feature: RawFeature,
  clientId: ClientId,
  unresolved: string[],
): ClientSupport {
  const { family, platforms } = CLIENT_MAP[clientId];
  const familyStats = feature.stats?.[family];
  if (!familyStats) {
    unresolved.push(`${feature.slug} :: ${clientId} (family "${family}" absent)`);
    return { status: 'u', version: null, resolution: 'unresolved', notes: [] };
  }

  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];
    const versions = familyStats[platform];
    if (!versions) continue;
    const version = latestVersion(versions);
    if (version == null) continue;
    const { code, noteRefs } = parseStatus(versions[version]);
    const notes = noteRefs
      .map((n) => feature.notes_by_num?.[n])
      .filter((t): t is string => Boolean(t));
    return {
      status: code,
      version,
      resolution: i === 0 ? 'direct' : 'fallback',
      notes,
    };
  }

  unresolved.push(
    `${feature.slug} :: ${clientId} (no platform of [${platforms.join(', ')}] present)`,
  );
  return { status: 'u', version: null, resolution: 'unresolved', notes: [] };
}

function normalizeCategory(raw: string): FeatureCategory {
  if (raw === 'css' || raw === 'html' || raw === 'image') return raw;
  return 'others';
}

async function main() {
  console.log(`Fetching ${DATA_URL} ...`);
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  const raw = (await res.json()) as RawData;

  const unresolved: string[] = [];
  const fallbacks: string[] = [];

  const features: FeatureSnapshot[] = raw.data.map((feature) => {
    const support = {} as Record<ClientId, ClientSupport>;
    for (const clientId of Object.keys(CLIENT_MAP) as ClientId[]) {
      const resolved = resolveClient(feature, clientId, unresolved);
      if (resolved.resolution === 'fallback') {
        fallbacks.push(`${feature.slug} :: ${clientId} -> ${resolved.version}`);
      }
      support[clientId] = resolved;
    }
    return {
      slug: feature.slug,
      title: feature.title,
      category: normalizeCategory(feature.category),
      url: feature.url,
      keywords: feature.keywords ?? '',
      support,
    };
  });

  const snapshot: CanIEmailSnapshot = {
    apiVersion: raw.api_version,
    lastUpdate: raw.last_update_date,
    generatedAt: new Date().toISOString(),
    features,
  };

  writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  console.log(`\nWrote ${features.length} features -> ${OUT_PATH}`);
  console.log(`  fallback resolutions: ${fallbacks.length}`);
  if (fallbacks.length) console.log(fallbacks.map((f) => `    ${f}`).join('\n'));
  console.log(`  UNRESOLVED entries:   ${unresolved.length}`);
  if (unresolved.length) console.log(unresolved.map((u) => `    ${u}`).join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
