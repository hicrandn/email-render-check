import { describe, it, expect } from 'vitest';
import {
  CLIENT_MAP,
  compareVersion,
  latestVersion,
  parseStatus,
  resolveClient,
  type RawFeature,
} from '@/scripts/caniemail-resolve';
import { CLIENT_IDS } from '@/src/lib/engine/types';

function feature(
  stats: RawFeature['stats'],
  notes: Record<string, string> | null = null,
): RawFeature {
  return { slug: 'test', title: 'Test', category: 'css', url: 'https://x', keywords: '', notes_by_num: notes, stats };
}

describe('version ordering', () => {
  it('orders years, year-months and app versions chronologically', () => {
    expect(latestVersion({ '2016': 'n', '2019': 'n', '2024': 'y', '2024-05': 'a' })).toBe('2024-05');
    expect(latestVersion({ '16.9': 'n', '16.80': 'y' })).toBe('16.80');
    expect(compareVersion('2019-02', '2019-10')).toBeLessThan(0);
  });

  it('returns null for no versions', () => {
    expect(latestVersion({})).toBeNull();
  });
});

describe('status parsing', () => {
  it('reads the code and note references', () => {
    expect(parseStatus('a #1 #3')).toEqual({ code: 'a', noteRefs: ['1', '3'] });
    expect(parseStatus('y')).toEqual({ code: 'y', noteRefs: [] });
  });

  it('treats anything else as unknown', () => {
    expect(parseStatus('x').code).toBe('u');
  });
});

describe('desktop clients: ordered platform fallbacks', () => {
  it('uses the latest version of the first platform', () => {
    const r = resolveClient(feature({ gmail: { 'desktop-webmail': { '2019-01': 'n', '2023-01': 'y' } } }), 'gmail', []);
    expect(r).toEqual({ status: 'y', version: '2023-01', resolution: 'direct', notes: [] });
  });

  it('falls back to the next platform and says so', () => {
    const r = resolveClient(feature({ gmail: { 'mobile-webmail': { '2020-01': 'a' } } }), 'gmail', []);
    expect(r.status).toBe('a');
    expect(r.resolution).toBe('fallback');
  });

  it('resolves note references to their text', () => {
    const r = resolveClient(
      feature({ gmail: { 'desktop-webmail': { '2020-01': 'a #2' } } }, { '2': 'Only inline.' }),
      'gmail',
      [],
    );
    expect(r.notes).toEqual(['Only inline.']);
  });

  it('reports a missing family as unresolved', () => {
    const unresolved: string[] = [];
    const r = resolveClient(feature({}), 'gmail', unresolved);
    expect(r).toEqual({ status: 'u', version: null, resolution: 'unresolved', notes: [] });
    expect(unresolved).toHaveLength(1);
  });
});

describe('phone apps: the worse of iOS and Android', () => {
  it('keeps the less supported platform and notes the difference', () => {
    const r = resolveClient(
      feature({ gmail: { ios: { '2020-01': 'y' }, android: { '2020-01': 'a #1' } } }, { '1': 'Not with non-Google accounts.' }),
      'gmail-mobile',
      [],
    );
    expect(r.status).toBe('a');
    expect(r.notes).toEqual([
      'Not with non-Google accounts.',
      'Differs by platform: iOS supported, Android partial.',
    ]);
  });

  it('adds no difference note when both platforms agree', () => {
    const r = resolveClient(feature({ outlook: { ios: { '2020-01': 'n' }, android: { '2021-01': 'n' } } }), 'outlook-mobile', []);
    expect(r.status).toBe('n');
    expect(r.notes).toEqual([]);
  });

  it('does not let an unknown platform win over a known one', () => {
    const r = resolveClient(feature({ yahoo: { ios: { '2020-01': 'u' }, android: { '2020-01': 'y' } } }), 'yahoo-mobile', []);
    expect(r.status).toBe('y');
  });

  it('compares each platform at its own latest version', () => {
    const r = resolveClient(
      feature({ gmail: { ios: { '2019-01': 'n', '2023-01': 'y' }, android: { '2023-01': 'y' } } }),
      'gmail-mobile',
      [],
    );
    expect(r.status).toBe('y');
  });

  it('uses the single platform that has data', () => {
    const r = resolveClient(feature({ outlook: { android: { '2022-01': 'a' } } }), 'outlook-mobile', []);
    expect(r.status).toBe('a');
  });

  it('is unresolved when neither platform was tested', () => {
    const unresolved: string[] = [];
    const r = resolveClient(feature({ yahoo: { 'desktop-webmail': { '2025-05': 'y' } } }), 'yahoo-mobile', unresolved);
    expect(r.resolution).toBe('unresolved');
    expect(unresolved).toHaveLength(1);
  });
});

describe('client map', () => {
  it('covers exactly the engine clients', () => {
    expect(Object.keys(CLIENT_MAP).sort()).toEqual([...CLIENT_IDS].sort());
  });

  it('maps phone apps to phone platforms only', () => {
    for (const id of ['gmail-mobile', 'outlook-mobile', 'yahoo-mobile', 'apple-mail-ios'] as const) {
      for (const p of CLIENT_MAP[id].platforms) expect(['ios', 'android']).toContain(p);
    }
  });
});
