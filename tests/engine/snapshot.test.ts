import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { snapshot, featureBySlug } from '@/src/lib/engine/data/snapshot';
import { CLIENT_IDS } from '@/src/lib/engine/types';
import { SLUG_MAP, UNMAPPED } from '@/src/lib/engine/data/slug-map';

const clientSupportSchema = z.object({
  status: z.enum(['y', 'n', 'a', 'u']),
  version: z.string().nullable(),
  resolution: z.enum(['direct', 'fallback', 'unresolved']),
  notes: z.array(z.string()),
});

const featureSchema = z.object({
  slug: z.string().min(1),
  title: z.string(),
  category: z.enum(['css', 'html', 'image', 'others']),
  url: z.string().url(),
  keywords: z.string(),
  support: z.object({
    gmail: clientSupportSchema,
    'outlook-win': clientSupportSchema,
    'outlook-com': clientSupportSchema,
    'apple-mail': clientSupportSchema,
    yahoo: clientSupportSchema,
  }),
});

const snapshotSchema = z.object({
  apiVersion: z.string(),
  lastUpdate: z.string(),
  generatedAt: z.string(),
  features: z.array(featureSchema).min(1),
});

describe('caniemail snapshot', () => {
  it('matches the expected schema', () => {
    expect(() => snapshotSchema.parse(snapshot)).not.toThrow();
  });

  it('resolves all 5 clients for every feature', () => {
    for (const feature of snapshot.features) {
      for (const client of CLIENT_IDS) {
        expect(feature.support[client]).toBeDefined();
      }
    }
  });

  it('reports no unresolved client mappings', () => {
    const unresolved = snapshot.features.flatMap((f) =>
      CLIENT_IDS.filter((c) => f.support[c].resolution === 'unresolved').map(
        (c) => `${f.slug}:${c}`,
      ),
    );
    expect(unresolved).toEqual([]);
  });

  it('reports display:flex as unsupported (n) for outlook-win', () => {
    const flex = featureBySlug.get('css-display-flex');
    expect(flex).toBeDefined();
    expect(flex!.support['outlook-win'].status).toBe('n');
  });

  it('reports display:flex as supported for apple-mail', () => {
    const flex = featureBySlug.get('css-display-flex');
    expect(flex!.support['apple-mail'].status).toBe('y');
  });
});

describe('slug map', () => {
  it('maps css-display-flex as a value-level entry', () => {
    const m = SLUG_MAP.bySlug.get('css-display-flex');
    expect(m).toMatchObject({ kind: 'value', property: 'display' });
  });

  it('maps css-border-radius as a property-level entry', () => {
    const m = SLUG_MAP.bySlug.get('css-border-radius');
    expect(m).toMatchObject({ kind: 'property', property: 'border-radius' });
  });

  it('only maps slugs that exist in the snapshot', () => {
    const missing = SLUG_MAP.mappings.filter((m) => !featureBySlug.has(m.slug)).map((m) => m.slug);
    expect(missing).toEqual([]);
  });

  it('maps every border-radius longhand to css-border-radius', () => {
    const slugs = SLUG_MAP.byProperty.get('border-top-left-radius')?.map((m) => m.slug);
    expect(slugs).toEqual(['css-border-radius']);
  });

  it('keeps selector/pseudo/at-rule slugs in UNMAPPED (never swallowed)', () => {
    expect(UNMAPPED).toContain('css-selector-child');
    expect(UNMAPPED).toContain('css-pseudo-class-hover');
    expect(UNMAPPED).toContain('css-at-media');
  });
});
