/**
 * Maps caniemail `css-*` slugs onto concrete CSS declaration matchers.
 *
 * Two kinds of mapping are critical to distinguish:
 *   - Property-level: `css-border-radius` -> the `border-radius` property.
 *   - Value-level:    `css-display-flex`  -> `display` with value `flex`/`inline-flex`.
 *
 * Plus two cross-cutting kinds that caniemail models as their own slugs:
 *   - Function-level: `css-unit-calc` -> the `calc()` function (any property).
 *   - Unit-level:     `css-unit-px`   -> the `px` unit (any property).
 *
 * Most `css-<property>` slugs are derived automatically by stripping the prefix.
 * Anything that is NOT a plain declaration property (selectors, pseudo-classes,
 * at-rules, and a handful of meta slugs) is intentionally kept in `UNMAPPED` —
 * never silently swallowed.
 */
import { cssSlugs } from './snapshot';

export interface PropertyMapping {
  kind: 'property';
  slug: string;
  property: string;
}
export interface ValueMapping {
  kind: 'value';
  slug: string;
  property: string;
  values: string[];
}
export interface FunctionMapping {
  kind: 'function';
  slug: string;
  functions: string[];
}
export interface UnitMapping {
  kind: 'unit';
  slug: string;
  units: string[];
}
export type SlugMapping =
  | PropertyMapping
  | ValueMapping
  | FunctionMapping
  | UnitMapping;

// --- Hand-curated value-level entries (cannot be derived automatically) ------
const VALUE_LEVEL: ValueMapping[] = [
  { kind: 'value', slug: 'css-display-flex', property: 'display', values: ['flex', 'inline-flex'] },
  { kind: 'value', slug: 'css-display-grid', property: 'display', values: ['grid', 'inline-grid'] },
  { kind: 'value', slug: 'css-display-none', property: 'display', values: ['none'] },
];

// --- Hand-curated function-level entries -------------------------------------
const FUNCTION_LEVEL: FunctionMapping[] = [
  { kind: 'function', slug: 'css-unit-calc', functions: ['calc'] },
  { kind: 'function', slug: 'css-function-clamp', functions: ['clamp'] },
  { kind: 'function', slug: 'css-function-min', functions: ['min'] },
  { kind: 'function', slug: 'css-function-max', functions: ['max'] },
  { kind: 'function', slug: 'css-function-light-dark', functions: ['light-dark'] },
  { kind: 'function', slug: 'css-linear-gradient', functions: ['linear-gradient', 'repeating-linear-gradient'] },
  { kind: 'function', slug: 'css-radial-gradient', functions: ['radial-gradient', 'repeating-radial-gradient'] },
  { kind: 'function', slug: 'css-conic-gradient', functions: ['conic-gradient', 'repeating-conic-gradient'] },
  { kind: 'function', slug: 'css-rgb', functions: ['rgb'] },
  { kind: 'function', slug: 'css-rgba', functions: ['rgba'] },
  { kind: 'function', slug: 'css-modern-color', functions: ['oklch', 'oklab', 'lab', 'lch', 'hwb', 'color'] },
];

// --- Hand-curated unit-level entries -----------------------------------------
const UNIT_LEVEL: UnitMapping[] = [
  { kind: 'unit', slug: 'css-unit-ch', units: ['ch'] },
  { kind: 'unit', slug: 'css-unit-cm', units: ['cm'] },
  { kind: 'unit', slug: 'css-unit-em', units: ['em'] },
  { kind: 'unit', slug: 'css-unit-ex', units: ['ex'] },
  { kind: 'unit', slug: 'css-unit-in', units: ['in'] },
  { kind: 'unit', slug: 'css-unit-mm', units: ['mm'] },
  { kind: 'unit', slug: 'css-unit-pc', units: ['pc'] },
  { kind: 'unit', slug: 'css-unit-percent', units: ['%'] },
  { kind: 'unit', slug: 'css-unit-pt', units: ['pt'] },
  { kind: 'unit', slug: 'css-unit-px', units: ['px'] },
  { kind: 'unit', slug: 'css-unit-rem', units: ['rem'] },
  { kind: 'unit', slug: 'css-unit-vh', units: ['vh'] },
  { kind: 'unit', slug: 'css-unit-vmax', units: ['vmax'] },
  { kind: 'unit', slug: 'css-unit-vmin', units: ['vmin'] },
  { kind: 'unit', slug: 'css-unit-vw', units: ['vw'] },
];

/**
 * Slugs that are not declaration-level: handled elsewhere or not modeled.
 * Matched by exact slug or by prefix.
 */
const SKIP_PREFIXES = [
  'css-selector-',
  'css-pseudo-class-',
  'css-pseudo-element-',
  'css-at-',
];
const SKIP_EXACT = new Set([
  'css-important', // handled as a special flag, not a property
  'css-comments',
  'css-nesting',
  'css-variables',
  'css-sytem-ui', // caniemail's spelling of system-ui keyword
  'css-inert-attribute', // HTML attribute, not a CSS property
  'css-unit-initial', // the `initial` keyword, not a property/unit
  // logical-property umbrella slugs whose "property" is not a single concrete
  // declaration name; the concrete longhands are covered by their own slugs.
  'css-block-inline-size',
  'css-border-inline-block',
  'css-border-inline-block-individual',
  'css-border-inline-block-longhand',
  'css-column-layout-properties',
  'css-left-right-top-bottom',
  'css-margin-block-start-end',
  'css-margin-inline-block',
  'css-margin-inline-start-end',
  'css-padding-block-start-end',
  'css-padding-inline-block',
  'css-padding-inline-start-end',
]);

interface BuiltSlugMap {
  mappings: SlugMapping[];
  byProperty: Map<string, PropertyMapping>;
  valueMappings: ValueMapping[];
  functionMappings: FunctionMapping[];
  unitMappings: UnitMapping[];
  /** slug -> mapping, for reverse lookups. */
  bySlug: Map<string, SlugMapping>;
  /** Slugs deliberately left unmapped (not applicable to declarations). */
  unmapped: string[];
}

function build(): BuiltSlugMap {
  const curated: SlugMapping[] = [...VALUE_LEVEL, ...FUNCTION_LEVEL, ...UNIT_LEVEL];
  const curatedSlugs = new Set(curated.map((m) => m.slug));

  const mappings: SlugMapping[] = [...curated];
  const unmapped: string[] = [];

  for (const slug of cssSlugs) {
    if (curatedSlugs.has(slug)) continue;
    if (SKIP_EXACT.has(slug) || SKIP_PREFIXES.some((p) => slug.startsWith(p))) {
      unmapped.push(slug);
      continue;
    }
    // Auto-derive a plain property from the slug (`css-border-radius` -> `border-radius`).
    const property = slug.replace(/^css-/, '');
    mappings.push({ kind: 'property', slug, property });
  }

  const byProperty = new Map<string, PropertyMapping>();
  const valueMappings: ValueMapping[] = [];
  const functionMappings: FunctionMapping[] = [];
  const unitMappings: UnitMapping[] = [];
  const bySlug = new Map<string, SlugMapping>();

  for (const m of mappings) {
    bySlug.set(m.slug, m);
    switch (m.kind) {
      case 'property':
        byProperty.set(m.property, m);
        break;
      case 'value':
        valueMappings.push(m);
        break;
      case 'function':
        functionMappings.push(m);
        break;
      case 'unit':
        unitMappings.push(m);
        break;
    }
  }

  return { mappings, byProperty, valueMappings, functionMappings, unitMappings, bySlug, unmapped };
}

export const SLUG_MAP: BuiltSlugMap = build();
export const UNMAPPED: string[] = SLUG_MAP.unmapped;
