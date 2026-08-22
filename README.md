# pSEO Forge

A programmatic-SEO affiliate site engine that runs entirely on free-tier APIs.

It turns a public data source into a few hundred to a few thousand statically
generated pages — each with real data, structured markup, and monetisable
outbound links — and rebuilds itself daily on free CI.

Two verticals ship working out of the box:

- **`cheapshark`** — PC game price comparison across ~30 stores (no API key)
- **`openlibrary`** — book discovery and buying links (no API key)

Swapping to a different niche means writing one file. See
[`docs/adding-a-source.md`](docs/adding-a-source.md).

> **Read [`docs/playbook.md`](docs/playbook.md) before you invest time in this.**
> The code is finished; whether it earns anything depends on niche choice,
> patience, and staying on the right side of search engines' scaled-content
> policies. That document is blunt about the odds.

## Quick start

```bash
npm install

# Build a dataset. --offline uses committed synthetic fixtures, so this
# works with no network access at all.
npm run data:build -- --offline --limit 400

# See what would actually be published
npm run data:stats

# Build the static site into ./out
npm run build

# Serve it locally
npm start
```

For live data, drop `--offline`:

```bash
npm run data:build -- --limit 600          # cheapshark, no key needed
SITE_SOURCE=openlibrary npm run data:build -- --limit 600
```

## How it works

```
  free API                                          ./out (static HTML)
     │                                                      ▲
     ▼                                                      │
┌──────────┐   ┌───────────┐   ┌──────────────┐   ┌─────────────────┐
│ adapter  │──▶│  quality  │──▶│ dataset.json │──▶│  Next.js SSG    │
│          │   │   gate    │   │              │   │  + JSON-LD      │
└──────────┘   └───────────┘   └──────────────┘   └─────────────────┘
     │               │                                      │
 throttled +    suppress / noindex                    sitemap index
 disk-cached    thin pages                            (post-build)
```

The site itself performs **no network I/O**. It reads one JSON file produced by
the pipeline, which makes builds fast, reproducible, and independent of whether
an upstream API is up.

| Path | Role |
|---|---|
| `config/site.config.ts` | The one file you edit — name, domain, niche, affiliate networks |
| `src/lib/sources/` | Niche adapters. Add a file, register it, done |
| `src/lib/quality.ts` | Decides publish / noindex / suppress per page |
| `src/lib/affiliate.ts` | Link decoration, `rel="sponsored"`, disclosure enforcement |
| `src/lib/seo.ts` | Metadata and JSON-LD (Product, AggregateOffer, FAQ, Breadcrumb) |
| `src/lib/http.ts` | Throttled, disk-cached, retrying HTTP — adapters must use it |
| `src/pipeline/` | `build-dataset`, `stats`, `sitemap`, `enrich-firecrawl`, `make-fixtures` |

## The quality gate

The thing that separates this from a page generator. Before anything is built,
every item is scored:

| Verdict | Meaning |
|---|---|
| **publish** | Indexable, in the sitemap, linked from hubs |
| **noindex** | Built and reachable, but `noindex` and excluded from the sitemap |
| **suppress** | Not built at all |

```
$ npm run data:stats

Pages total:   398
  indexable:   386
  noindex:     12
  suppressed:  2 (not built at all)
```

Pages with no offers are kept for readers but withheld from search. Pages whose
prose is identical apart from the figures are treated as near-duplicates and
noindexed.

Alongside the verdict, the gate reports **sentence-shape diversity** — how many
distinct phrasings the adapter produced:

```
Sentence shapes: 22 distinct (largest covers 23% of pages)
```

This gates nothing, but a site where one shape covers most pages is one where
every page makes the same statement with different values plugged in. The first
live Open Library run scored 1 shape across 139 pages; the fix was to make the
adapter branch on what the data actually says. See
[`docs/playbook.md`](docs/playbook.md).

## Monetisation

Affiliate links are **off by default**. Set `AFFILIATES_ENABLED=true` only after
you have been accepted into a programme:

```bash
AFFILIATES_ENABLED=true AFF_FANATICAL=your-id npm run build
```

The system enforces two things you cannot forget per-page:

- A network with missing credentials emits a **clean, undecorated link** rather
  than a broken tracking one.
- Any page carrying a monetised link renders an **FTC disclosure** automatically
  — `OfferTable` will not emit one without the other.

Store listings are always ordered by **price, cheapest first**, never by
commission. The disclosure says so, which makes it a promise the code has to keep.

## Deployment ($0)

`npm run build` emits a fully static `./out`. Any static host works.

To go live on GitHub Pages, free:

1. **Settings → Pages → Source: GitHub Actions.** That is the only click needed.
2. **Actions → "Refresh and deploy" → Run workflow** (or wait for 04:15 UTC).

With nothing else configured it deploys to
`https://<owner>.github.io/<repo>/` and works correctly there — the workflow
detects the project-site sub-directory and sets `BASE_PATH` for you.

When you point a real domain at it, set the `SITE_URL` repo variable and the
sub-directory prefix drops away automatically.

| Repo setting | Purpose |
|---|---|
| Variable `SITE_URL` | Your domain, once you have one. Leave unset to use the Pages URL |
| Variable `BASE_PATH` | Only with a custom domain served from a sub-directory. Usually empty |
| Variable `SITE_SOURCE` | Which adapter to build (`cheapshark`, `openlibrary`, …) |
| Variable `AFFILIATES_ENABLED` | `true` only once you have been accepted somewhere |
| Secrets `AFF_*` | Your affiliate IDs |
| Variable `GOOGLE_SITE_VERIFICATION` | Search Console ownership token (see below) |
| Variable `BING_SITE_VERIFICATION` | Bing Webmaster Tools token |

### Getting indexed

A deployed site is not a discovered one. Search engines have no idea the URL
exists until you tell them, and this is the step that actually starts the
clock:

1. [Google Search Console](https://search.google.com/search-console) → Add
   property → **URL prefix** → your site URL.
2. Choose the **HTML tag** verification method. Copy the token out of the tag —
   just the `content="..."` value, not the whole tag — and set it as the
   `GOOGLE_SITE_VERIFICATION` repo variable.
3. Re-run **Refresh and deploy**, then press Verify.
4. Submit `<your-site>/sitemap.xml` under Sitemaps.
5. [Bing Webmaster Tools](https://www.bing.com/webmasters) does the same and
   can import everything from Search Console in one click.

Then watch **Pages → Indexed**. Pages stuck at *"Discovered — currently not
indexed"* for weeks mean the content is being judged low value; the fix is
better pages, not more of them. See [`docs/playbook.md`](docs/playbook.md).

> **Sub-directory hosting is the thing that silently breaks static deploys.**
> Served from `/<repo>/`, root-absolute links and assets all 404 while the
> local build looks perfect. `BASE_PATH` handles it, `npm run verify` fails the
> build if any link is missing the prefix, and CI builds **both** ways.

`.github/workflows/ci.yml` typechecks, tests, and builds against **offline
fixtures** — at a root domain and as a sub-directory deploy — so CI never
depends on a third-party API or spends free quota.

`.github/workflows/live-data.yml` runs the real fetch against the upstream APIs
**on demand** (Actions → Live data check → Run workflow) and uploads the
resulting dataset as an artifact. It is not on a schedule: firing it per push
would hammer free APIs that ask for reasonable use.

## Optional: Firecrawl enrichment

Adds a short, attributed review excerpt to the highest-value pages. Entirely
optional — the site builds and ranks without it.

```bash
npm run data:enrich -- --dry-run              # plan + cost, spends nothing
npm run data:enrich -- --limit 50 --budget 120
```

Firecrawl's free tier is a one-off credit grant, not a monthly refill, so the
script caches every result **permanently**, enriches in value order, and refuses
to exceed `--budget`.

## Development

```bash
npm run check      # typecheck + unit tests
npm run dev        # dev server
npm test           # 36 unit tests
npm run verify     # post-build integrity check (run after `npm run build`)
```

`npm run verify` fails on broken internal links, indexable pages missing from
the sitemap, or noindex pages leaking into it. CI runs it on every push.

## Docs

- [`docs/playbook.md`](docs/playbook.md) — realistic expectations, costs, and the
  scaled-content rule that kills most sites like this
- [`docs/data-sources.md`](docs/data-sources.md) — verified no-key APIs worth
  building on, and which ones actually have an affiliate angle
- [`docs/adding-a-source.md`](docs/adding-a-source.md) — how to switch niches

## Licence

MIT for this code. The data sources have their own terms — each adapter
declares an `attribution` that is rendered in the site footer. Read the terms
of any API before putting ads on top of it.
