// Typed accessor for the committed caniemail snapshot. The JSON is imported at
// build time — the engine NEVER fetches caniemail.com at runtime.
import raw from './caniemail.json';
import type { CanIEmailSnapshot, FeatureSnapshot } from '../types';

export const snapshot = raw as CanIEmailSnapshot;

export const featureBySlug: Map<string, FeatureSnapshot> = new Map(
  snapshot.features.map((f) => [f.slug, f]),
);

export const cssSlugs: string[] = snapshot.features
  .filter((f) => f.category === 'css')
  .map((f) => f.slug);

export const htmlFeatures: FeatureSnapshot[] = snapshot.features.filter(
  (f) => f.category === 'html',
);
