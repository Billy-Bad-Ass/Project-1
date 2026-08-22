# What actually has to happen for this to earn money

The code is the easy part and it is finished. This document is the part that
decides whether it earns anything. Read it before you spend weeks on the site.

## The honest version

Programmatic SEO works, but it is a **slow, high-variance** channel:

- New domains typically see little organic traffic for the first few months
  regardless of content quality. Search engines are cautious with unknown sites.
- Most programmatic sites earn nothing. The common causes are picking a niche
  with no commercial intent, publishing pages that restate what the merchant
  already says, and abandoning the site before it is indexed.
- Affiliate revenue is a function of *qualified* traffic. At a typical 1-3%
  click-through-to-sale rate and a few percent commission, meaningful income
  needs tens of thousands of monthly visits, not hundreds.

Nothing here is a reason not to try. It is a reason to expect a 6-12 month
horizon, and to not spend money you need.

## The rule that kills most sites like this

Search engines explicitly demote **scaled content abuse**: generating many
pages that provide no value beyond what already exists elsewhere. Publishing
5,000 pages that each restate one merchant's product description is the exact
pattern the policy names.

This project is built to stay on the right side of that line, and the
mechanism is `src/lib/quality.ts`:

- pages with too few real data points are **not built at all**
- pages with nothing to offer the reader are built but **noindexed** and kept
  out of the sitemap
- summaries that differ only in their numbers get **noindexed** as templated

Those thresholds are deliberately strict. If you loosen them to publish more
pages, you are opting into the risk, and the failure mode is not "ranks a bit
worse" — it is the whole domain being deindexed.

**The defensible claim for this site is cross-merchant comparison and price
history.** Steam will never show you GOG's price. That is the entire reason
this site is allowed to exist, and every content decision should protect it.

## Realistic sequence

1. **Buy a real domain.** ~$10/year, and the one cost that is not optional. A
   `github.io` subdomain will not carry a commercial site.
2. **Ship small.** 300-800 genuinely useful pages beats 50,000 thin ones. The
   `--limit` flag exists for this.
3. **Verify in Google Search Console and Bing Webmaster Tools.** Free. Submit
   `/sitemap.xml`. Without this you are blind.
4. **Wait, and watch Search Console.** You are looking for pages moving from
   "Discovered" to "Indexed". If they sit at "Discovered — currently not
   indexed" for weeks, your pages are being judged as low value. Fix the pages;
   adding more will not help.
5. **Apply to affiliate programmes once you have traffic.** Most reject empty
   sites. This ordering is not optional — Amazon Associates in particular will
   close an account that makes no qualifying sales in its trial window.
6. **Turn monetisation on** (`AFFILIATES_ENABLED=true`) only after acceptance.

## Where the traffic actually comes from

For a price-comparison vertical, in rough order of value:

- **Long-tail item queries** — "cheapest place to buy <title>", "<title> price
  history", "is <title> on sale". Low volume each, thousands of them, and they
  convert because the intent is already commercial. This is what the `/p/`
  pages target.
- **Hub queries** — "best games under $10". Higher volume, much harder, and
  what the `/best/` pages target. Do not expect these early.
- **Deal aggregators and forums** — a genuinely good price-history page gets
  linked. This is the main way a new site earns its first authority.

## Costs at $0

| Item | Cost | Notes |
|---|---|---|
| Hosting | $0 | GitHub Pages / Cloudflare Pages, static output |
| Data | $0 | CheapShark and Open Library need no key |
| Rebuilds | $0 | GitHub Actions free tier for public repos |
| Search Console / Bing | $0 | |
| **Domain** | **~$10/yr** | The only real cost |
| Firecrawl enrichment | $0 then paid | Free tier is a one-off credit grant; the script caps spend |

## What to do if it is not working after 6 months

Be willing to conclude the niche was wrong. The adapter layer exists precisely
so that testing a second vertical costs one file rather than a rewrite — see
[`adding-a-source.md`](./adding-a-source.md) and the candidate list in
[`data-sources.md`](./data-sources.md).
