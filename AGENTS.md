<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Mail Check

Simulates how Gmail, Outlook (Windows), Outlook.com, Apple Mail and Yahoo
render an email's HTML on desktop, and how the Gmail, Outlook, Apple Mail and
Yahoo apps render it on a phone, and lists every change a client makes with
the reason and an evidence link.

## Commands

Use pnpm (pinned via `packageManager`); there is no npm lockfile.

```bash
pnpm dev                # studio at http://localhost:3000
pnpm test               # vitest, tests/engine/*.test.ts
pnpm lint
pnpm build
pnpm update-caniemail   # refresh src/lib/engine/data/caniemail.json
```

## Layout

- `app/studio.tsx` — the whole UI: editor, client tabs, preview iframe,
  issues panel. `app/editor.tsx` wraps CodeMirror (client-only).
- `src/lib/engine/` — pure TypeScript, no DOM or Next.js imports.
  `simulate(html, clientId, context)` in `engine.ts` runs:
  1. `parse/` — parse5 HTML and postcss CSS ASTs with source locations
  2. `stages/sanitize.ts` — drop or unwrap unsupported elements, attributes
     and `<img>` formats
  3. `stages/css-filter.ts` (+ `css-rules.ts` for at-rules) — remove
     unsupported CSS per Can I Email
  4. `stages/defaults.ts` — inject the client's UA stylesheet
  5. `stages/dark-mode.ts` — color-scheme hint, dark-mode simulation
  6. `stages/quirks.ts` — Word engine quirks, Gmail 102 KB clipping, and
     (`mobile-fit.ts`) fixed widths wider than a phone screen
- Support decisions come from the Can I Email snapshot (`supportFor` in
  `data/snapshot.ts`); profiles only hold what Can I Email does not track.
  Partial ("a") entries are judged against their notes in
  `stages/partial.ts` ("Only supported on table cells", "Negative values are
  not supported"…): kept, removed or rewritten accordingly. Rules match note
  text, so a reworded note falls back to a plain warning;
  `tests/engine/partial.test.ts` pins them to the current notes.
- `src/lib/engine/profiles/` — one file per client: device, quirks and dark-mode
  strategy. `CLIENTS_BY_DEVICE` and `clientOn` map clients between desktop
  and phone. Phone clients' snapshot entries are the worse of iOS and Android.
- `src/lib/engine/data/` — committed Can I Email snapshot plus `slug-map.ts`,
  which maps feature slugs to CSS properties, values, functions and units.

## Conventions

- Every stage appends to `ctx.mutations`; each `Mutation` needs an `evidence`
  URL. The output HTML is serialized from the mutated AST; only Gmail clipping
  works on the serialized string.
- Output must be deterministic: mutations are sorted in `engine.ts`.
- Tree walks are iterative, because real emails nest deeply enough to overflow
  the stack.
- The snapshot is never fetched at runtime; regenerate it with the script.
- Write user-facing `reason`/`fix` text as plain, factual sentences.
- The studio UI is light-only; the preview has its own light/dark toggle.

## Dependency constraints

- TypeScript stays on 6.0.x: typescript-eslint supports `<6.1`.
- ESLint 10 runs with peer overrides in `pnpm-workspace.yaml` for the
  react, jsx-a11y and import plugins until they widen their ranges.
