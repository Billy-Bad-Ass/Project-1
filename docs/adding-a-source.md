# Adding a new vertical

Switching niches means writing one file. Nothing in the site, SEO layer,
quality gate, affiliate system or build pipeline is aware of what the data is.

## 1. Write the adapter

Create `src/lib/sources/<your-source>.ts` implementing `DataSource`
(`src/lib/sources/types.ts`). The contract:

```ts
export const mySource: DataSource = {
  id: 'mysource',
  label: 'Human readable name',
  vertical: 'what this site is about',
  requiredEnv: [],                      // env vars needed for live fetch
  attribution: { text: '...', url: '...' },  // rendered in the footer

  async fetchAll(ctx) { /* -> SourceItem[] */ },
  buildCollections(items) { /* -> Collection[] */ },
};
```

Rules the rest of the system assumes:

- **Use `ctx.get`, never global `fetch`.** It throttles, retries with backoff,
  and caches to disk. Bypassing it will get you rate-limited.
- **Respect `ctx.limit`.** It is the only thing standing between a test run and
  your entire free quota.
- **One failed item must not kill the run.** Catch per item, log, continue.
- **Never invent a fact.** `facts` is what the quality gate counts and what the
  structured data is built from. A fabricated rating is a manual-action risk,
  not a growth hack.
- **Slugs must be unique.** Use `uniqueSlug` from `src/lib/util.ts`; a collision
  silently drops a page during static export.
- **Write `summary` from the item's own numbers.** If your summaries differ only
  by which noun was substituted, the `duplicate-shape` rule will noindex them —
  correctly.

## 2. Register it

```ts
// src/lib/sources/index.ts
import { mySource } from './mysource';

export const SOURCES: Record<string, DataSource> = {
  [cheapsharkSource.id]: cheapsharkSource,
  [openLibrarySource.id]: openLibrarySource,
  [mySource.id]: mySource,          // <-- add
};
```

## 3. Point the site at it

```bash
# config/site.config.ts — name, tagline, description, affiliate networks
SITE_SOURCE=mysource npm run data:build -- --limit 50
npm run data:stats
```

Start at `--limit 50`. Read the stats output before scaling up: if the
suppression count is high, the adapter is producing thin items and the fix is
in the adapter, not in the gate.

## 4. Add fixtures (optional but recommended)

CI builds offline so it never depends on a third-party API being up. Either
extend `src/pipeline/make-fixtures.ts` to emit `data/fixtures/<id>.json`, or
save a real (small) run:

```bash
SITE_SOURCE=mysource npm run data:build -- --limit 40
node -e "const d=require('./data/datasets/dataset.json');require('fs').writeFileSync('data/fixtures/mysource.json',JSON.stringify(d.items,null,2))"
```

Fixture-backed builds are flagged `isFixture` and render a visible
"sample data" notice on every page, so synthetic prices can never be published
as real ones.

## 5. Affiliate networks

Update `config/site.config.ts` with the merchants your new vertical actually
sends traffic to. Leave `AFFILIATES_ENABLED=false` until you have been
**accepted** into each programme — partially configured networks emit clean,
undecorated links rather than broken tracking ones.
