/**
 * Maps caniemail `css-*` slugs onto concrete CSS declaration matchers.
 *
 * Two kinds of mapping are critical to distinguish:
 *   - Property-level: `css-border-radius` -> the `border-radius` property.
 *   - Value-level:    `css-display-flex`  -> `display` with value `flex`/`inline-flex`.
 *
 * Plus cross-cutting kinds that caniemail models as their own slugs:
 *   - Function-level: `css-unit-calc` -> the `calc()` function (any property).
 *   - Unit-level:     `css-unit-px`   -> the `px` unit (any property).
 *   - Keyword-level:  `css-intrinsic-size` -> `fit-content` etc. (any property).
 *
 * Most `css-<property>` slugs are derived automatically by stripping the prefix.
 * `PROPERTY_LEVEL` overrides that for slugs that cover several properties
 * (longhands, logical properties) or whose name is not a property.
 * Anything that is NOT a plain declaration property (selectors, pseudo-classes,
 * at-rules, nesting) is kept in `UNMAPPED` and checked by stages/css-rules.ts.
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
export interface KeywordMapping {
  kind: 'keyword';
  slug: string;
  keywords: string[];
}
export type SlugMapping =
  | PropertyMapping
  | ValueMapping
  | FunctionMapping
  | UnitMapping
  | KeywordMapping;

// --- Hand-curated property-level entries --------------------------------------
// Slugs whose name is not a single property. The first entry is the slug's
// primary property.
const SIDES = ['top', 'right', 'bottom', 'left'];
const PROPERTY_LEVEL: Record<string, string[]> = {
  'css-animation': [
    'animation', 'animation-name', 'animation-duration', 'animation-timing-function',
    'animation-delay', 'animation-iteration-count', 'animation-direction',
    'animation-fill-mode', 'animation-play-state',
  ],
  'css-background-position': ['background-position', 'background-position-x', 'background-position-y'],
  'css-block-inline-size': ['block-size', 'inline-size'],
  'css-border': [
    'border', 'border-width', 'border-style', 'border-color',
    ...SIDES.flatMap((s) => [`border-${s}`, `border-${s}-width`, `border-${s}-style`, `border-${s}-color`]),
  ],
  'css-border-image': [
    'border-image', 'border-image-source', 'border-image-slice', 'border-image-width',
    'border-image-outset', 'border-image-repeat',
  ],
  'css-border-inline-block': ['border-inline', 'border-block'],
  'css-border-inline-block-individual': [
    'border-inline-color', 'border-block-color', 'border-inline-style', 'border-block-style',
    'border-inline-width', 'border-block-width', 'border-inline-start', 'border-inline-end',
    'border-block-start', 'border-block-end',
  ],
  'css-border-inline-block-longhand': ['inline', 'block'].flatMap((axis) =>
    ['start', 'end'].flatMap((edge) =>
      ['color', 'style', 'width'].map((part) => `border-${axis}-${edge}-${part}`),
    ),
  ),
  'css-border-radius': [
    'border-radius', 'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-right-radius', 'border-bottom-left-radius',
  ],
  'css-border-radius-logical': [
    'border-start-start-radius', 'border-start-end-radius',
    'border-end-start-radius', 'border-end-end-radius',
  ],
  // column-count has its own slug.
  'css-column-layout-properties': [
    'columns', 'column-fill', 'column-gap', 'column-rule', 'column-rule-color',
    'column-rule-style', 'column-rule-width', 'column-span', 'column-width',
  ],
  'css-gap': ['gap', 'column-gap', 'row-gap', 'grid-gap', 'grid-column-gap', 'grid-row-gap'],
  'css-grid-template': [
    'grid-template', 'grid-template-areas', 'grid-template-columns', 'grid-template-rows',
  ],
  'css-inset': [
    'inset', 'inset-block', 'inset-inline', 'inset-inline-start', 'inset-inline-end',
    'inset-block-start', 'inset-block-end',
  ],
  'css-left-right-top-bottom': ['left', 'right', 'top', 'bottom'],
  'css-margin': ['margin', ...SIDES.map((s) => `margin-${s}`)],
  'css-margin-block-start-end': ['margin-block-start', 'margin-block-end'],
  'css-margin-inline-block': ['margin-inline', 'margin-block'],
  'css-margin-inline-start-end': ['margin-inline-start', 'margin-inline-end'],
  'css-outline': ['outline', 'outline-color', 'outline-style', 'outline-width'],
  'css-overflow': ['overflow', 'overflow-x', 'overflow-y', 'overflow-block', 'overflow-inline'],
  'css-padding': ['padding', ...SIDES.map((s) => `padding-${s}`)],
  'css-padding-block-start-end': ['padding-block-start', 'padding-block-end'],
  'css-padding-inline-block': ['padding-inline', 'padding-block'],
  'css-padding-inline-start-end': ['padding-inline-start', 'padding-inline-end'],
  'css-scroll-snap': ['scroll-snap-type', 'scroll-snap-align', 'scroll-snap-stop'],
  'css-text-emphasis': ['text-emphasis', 'text-emphasis-style', 'text-emphasis-color'],
  'css-transition': [
    'transition', 'transition-property', 'transition-duration',
    'transition-timing-function', 'transition-delay',
  ],
};

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
  { kind: 'function', slug: 'css-variables', functions: ['var'] },
];

// Matched in css-filter from the declaration itself rather than a mapping:
// the `!important` flag, and `--name:` custom property declarations.
export const IMPORTANT_SLUG = 'css-important';
export const CUSTOM_PROPERTY_SLUG = 'css-variables';

// --- Hand-curated keyword-level entries --------------------------------------
const KEYWORD_LEVEL: KeywordMapping[] = [
  { kind: 'keyword', slug: 'css-intrinsic-size', keywords: ['fit-content', 'min-content', 'max-content'] },
  // caniemail's spelling of system-ui.
  { kind: 'keyword', slug: 'css-sytem-ui', keywords: ['system-ui', 'ui-serif', 'ui-sans-serif', 'ui-rounded', 'ui-monospace'] },
  { kind: 'keyword', slug: 'css-unit-initial', keywords: ['initial'] },
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
  'css-comments',
  'css-nesting',
  'css-inert-attribute', // HTML attribute, not a CSS property
]);

interface BuiltSlugMap {
  mappings: SlugMapping[];
  /** property -> every slug that covers it (e.g. column-gap: gap and columns). */
  byProperty: Map<string, PropertyMapping[]>;
  valueMappings: ValueMapping[];
  functionMappings: FunctionMapping[];
  unitMappings: UnitMapping[];
  keywordMappings: KeywordMapping[];
  /** slug -> mapping (the primary one, for multi-property slugs), for reverse lookups. */
  bySlug: Map<string, SlugMapping>;
  /** Slugs deliberately left unmapped (not applicable to declarations). */
  unmapped: string[];
}

function build(): BuiltSlugMap {
  const curated: SlugMapping[] = [
    ...VALUE_LEVEL,
    ...FUNCTION_LEVEL,
    ...UNIT_LEVEL,
    ...KEYWORD_LEVEL,
    ...Object.entries(PROPERTY_LEVEL).flatMap(([slug, props]) =>
      props.map((property): PropertyMapping => ({ kind: 'property', slug, property })),
    ),
  ];
  const curatedSlugs = new Set([...curated.map((m) => m.slug), IMPORTANT_SLUG]);

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

  const byProperty = new Map<string, PropertyMapping[]>();
  const valueMappings: ValueMapping[] = [];
  const functionMappings: FunctionMapping[] = [];
  const unitMappings: UnitMapping[] = [];
  const keywordMappings: KeywordMapping[] = [];
  const bySlug = new Map<string, SlugMapping>();

  for (const m of mappings) {
    if (!bySlug.has(m.slug)) bySlug.set(m.slug, m);
    switch (m.kind) {
      case 'property': {
        const list = byProperty.get(m.property) ?? [];
        list.push(m);
        byProperty.set(m.property, list);
        break;
      }
      case 'value':
        valueMappings.push(m);
        break;
      case 'function':
        functionMappings.push(m);
        break;
      case 'unit':
        unitMappings.push(m);
        break;
      case 'keyword':
        keywordMappings.push(m);
        break;
    }
  }

  return {
    mappings, byProperty, valueMappings, functionMappings, unitMappings, keywordMappings,
    bySlug, unmapped,
  };
}

export const SLUG_MAP: BuiltSlugMap = build();
export const UNMAPPED: string[] = SLUG_MAP.unmapped;
