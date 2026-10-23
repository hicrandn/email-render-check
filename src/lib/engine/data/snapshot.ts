// Typed accessor for the committed caniemail snapshot. The JSON is imported at
// build time — the engine never fetches caniemail.com at runtime.
import raw from './caniemail.json';
import type { CanIEmailSnapshot, ClientId, ClientSupport, FeatureSnapshot } from '../types';

export const snapshot = raw as CanIEmailSnapshot;

export const featureBySlug: Map<string, FeatureSnapshot> = new Map(
  snapshot.features.map((f) => [f.slug, f]),
);

export const cssSlugs: string[] = snapshot.features
  .filter((f) => f.category === 'css')
  .map((f) => f.slug);

/** A client's support entry for a slug; throws on a slug missing from the snapshot. */
export function supportFor(slug: string, client: ClientId): ClientSupport {
  const feature = featureBySlug.get(slug);
  if (!feature) throw new Error(`caniemail slug not in snapshot: ${slug}`);
  return feature.support[client];
}
