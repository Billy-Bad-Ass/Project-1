# Free data sources worth building a site on

Every API here requires **no key and no signup**, verified against
[public-apis](https://github.com/public-apis/public-apis) at the time of writing.
Re-check before you commit to one — free APIs do disappear.

The column that matters is the last one. Plenty of free APIs exist; very few
sit next to a product someone can actually buy, and without that there is
nothing to monetise.

| Vertical | API | What it gives you | Affiliate angle |
|---|---|---|---|
| **PC games** | [CheapShark](https://www.cheapshark.com/api) | Live prices across ~30 stores, all-time lows | Fanatical, Green Man Gaming, Humble all run open programmes. **Implemented — see `src/lib/sources/cheapshark.ts`** |
| **Books** | [Open Library](https://openlibrary.org/developers/api) | Titles, authors, ratings, page counts, ISBNs | Bookshop.org and Amazon Associates both key on ISBN. **Implemented — see `src/lib/sources/openlibrary.ts`** |
| **Board games** | [BoardGameGeek XML API2](https://boardgamegeek.com/wiki/page/BGG_XML_API2) | Ratings, weights, player counts, playing time | Strong Amazon category; high-intent "best 2-player games" style queries |
| **Groceries / supplements** | [Open Food Facts](https://world.openfoodfacts.org/data) | Ingredients, nutrition, additives, barcodes for ~3M products | Comparison pages ("lowest sugar X") map onto iHerb/Amazon |
| **Cars & parts** | [NHTSA vPIC](https://vpic.nhtsa.dot.gov/api/) | Every US make/model/trim, specs, recalls, VIN decode | Parts and accessories affiliate; recall pages pull steady search traffic |
| **Anime & manga** | [Jikan](https://jikan.moe) | MyAnimeList data: ratings, episodes, studios, airing status | Merch and streaming affiliate; very high content velocity |
| **Music** | [MusicBrainz](https://musicbrainz.org/doc/Development/XML_Web_Service/Version_2) · [iTunes Search](https://performance-partners.apple.com/) | Releases, artists, tracks, label metadata | iTunes Search *is* Apple's affiliate API |
| **Beer** | [Open Brewery DB](https://www.openbrewerydb.org) | Breweries by city/type with addresses | Local-intent pages; weaker affiliate, better for display ads |
| **Public-domain books** | [Gutendex](https://gutendex.com/) | Full Project Gutenberg catalogue | Low commercial intent — good for traffic, poor for revenue |
| **Crypto** | [CoinGecko](https://www.coingecko.com/api) | Prices, market caps, exchange listings | Exchange referral programmes; note the free tier is rate-limited and its terms change often |
| **Currency** | [Frankfurter](https://www.frankfurter.app/docs) | ECB reference rates, historical series | Almost no affiliate value; useful as a supporting dataset |

## Choosing between them

Three questions, in order:

1. **Does the data change?** A static catalogue gives search engines no reason
   to recrawl. Prices and availability change daily; a list of public-domain
   book titles does not.
2. **Can a reader buy something at the end of the page?** If not, your ceiling
   is display-ad revenue, which needs roughly an order of magnitude more
   traffic to make the same money.
3. **Does the page beat the merchant's own page?** You are competing with
   Steam's own listing for that game. Cross-merchant comparison and price
   history are things no single merchant will ever show. Restating the
   merchant's own description is not.

CheapShark scores well on all three, which is why it is the reference
implementation.

## Things that will bite you

- **Rate limits are often undocumented.** `src/lib/http.ts` throttles and caches
  every request; keep using it rather than calling `fetch` from an adapter.
- **Terms of use are not the same as "free".** Several APIs above allow
  non-commercial use only, or require attribution. Read the terms before you
  put ads on it. Every adapter must declare an `attribution` — it is rendered
  in the site footer.
- **Nominatim and other OSM services ban bulk/scraped use** for exactly this
  kind of project. They are omitted deliberately.
- **Free tiers are withdrawn.** Cache aggressively (the pipeline already does)
  and keep the last good dataset so a dead API degrades to stale data rather
  than an empty site.
