# Mail Check

A preview tool that simulates how a user's email HTML renders across the major
email clients (Gmail, Outlook Windows/Word engine, Outlook.com, Apple Mail,
Yahoo) and explains, for every incompatibility, **which client, which feature,
and why it is unsupported**.

## Architecture

The simulation engine produces exactly **one** output: a structured **Mutation
Log**. The preview HTML, the warnings panel, and (later) the diff view are all
derived from this log — they are never produced separately. The engine is pure
TypeScript with no dependency on Next.js or the DOM, so it can also run in a
CLI/CI context.

```
simulate(html, clientId) ──► { html, mutations: Mutation[] }

pipeline:  parse ─► sanitize ─► css-filter ─► (inline · defaults · quirks stubs)
                       │            │
                       │            └─ match every declaration against the
                       │               client's caniemail support status
                       └─ unwrap / remove unsupported HTML elements
```

Everything flows through ASTs — parse5 for HTML, postcss for CSS. There are **no
global/stateful regexes**; the same input always yields a byte-identical result.

### Layout

```
src/lib/engine/
  types.ts              Mutation / ClientProfile / snapshot types
  data/
    caniemail.json      committed, versioned support snapshot (never fetched at runtime)
    snapshot.ts         typed accessor + featureBySlug index
    slug-map.ts         caniemail slug -> property / value / function / unit matchers
  parse/
    html.ts             parse5 AST + source locations + style-source collection
    css.ts              postcss declarations w/ absolute locations + shorthand expansion
    position.ts         offset <-> line/col
  profiles/             per-client metadata (gmail, outlook-win, outlook-com, apple-mail, yahoo)
  stages/
    sanitize.ts         element unwrap/remove + universal security strip
    css-filter.ts       declaration support matching -> remove/warn
    inline.ts defaults.ts quirks.ts   Phase-3 stubs
  engine.ts             simulate(): runs the pipeline, derives output HTML
app/                    minimal UI (CodeMirror editor + client-tabbed preview)
scripts/update-caniemail.ts    snapshot generator
tests/                  vitest fixtures + engine tests
```

### The Mutation Log

Each `Mutation` records the `client`, `stage`, `action` (remove-property,
remove-value, unwrap-element, remove-element, warn-only, …), the `target`
(source location, selector, element, property, value), the `feature` (caniemail
slug or quirk id), `severity`, a human-readable `reason`, a **mandatory**
`evidence` link, and an optional `fix`.

## Commands

```bash
npm run dev              # start the dev UI at http://localhost:3000
npm run build            # production build
npm test                 # run the vitest suite
npm run test:watch       # watch mode
npm run update-caniemail # regenerate src/lib/engine/data/caniemail.json
npm run lint             # eslint
```

> `update-caniemail` fetches `https://www.caniemail.com/api/data.json`, resolves
> the latest-version support status for each of the 5 target clients, and writes
> the committed snapshot. It reports any fallback or unresolved client mappings.
> The app itself **never** fetches caniemail at runtime.

If you use [Bun](https://bun.sh), the equivalent is `bun run update-caniemail`,
`bun test`, etc.

## Status

- **Phase 1** — Can I Email data pipeline + snapshot schema tests. ✅
- **Phase 2** — parse layer, sanitize + css-filter stages, deterministic engine,
  and the minimal UI. ✅
- **Phase 3** — `defaults` (per-client UA stylesheet injection) and `quirks`
  (Gmail 102KB clipping, Outlook @media strip + max-width ignore, Yahoo media-query
  warnings). ✅
- **Phase 4** (planned) — diff view, dark-mode simulation, calibration sends.
