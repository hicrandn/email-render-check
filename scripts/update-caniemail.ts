/**
 * Fetches the Can I Email dataset, resolves per-client support for the desktop
 * and phone clients, and writes a normalized, committed snapshot to
 * `src/lib/engine/data/caniemail.json`.
 *
 * The snapshot is committed to the repo and read at build/runtime; the app never
 * fetches caniemail.com at runtime.
 *
 * Run with: `pnpm update-caniemail`.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  CanIEmailSnapshot,
  ClientId,
  ClientSupport,
  FeatureSnapshot,
} from '../src/lib/engine/types';
import { CLIENT_MAP, normalizeCategory, resolveClient, type RawData } from './caniemail-resolve';

const DATA_URL = 'https://www.caniemail.com/api/data.json';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/lib/engine/data/caniemail.json');

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
