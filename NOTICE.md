# Third-party notices

The MIT grant in [`LICENSE`](LICENSE) covers the code in this repository. It
does not, and cannot, cover the data the code fetches — that belongs to the
people who publish it, on their terms.

## Data sources

Every source adapter in `src/lib/sources/` declares an `attribution` alongside
its fetch logic, and `src/app/layout.tsx` renders it in the footer of every
generated page. That coupling is deliberate: a source cannot be added without
saying who it credits, and the credit cannot be dropped without editing the
adapter.

| Source | Credit rendered |
| --- | --- |
| [Open Library](https://openlibrary.org/developers/api) | Bibliographic data from Open Library |
| [CheapShark](https://www.cheapshark.com/) | Price data provided by CheapShark |

Both are reached through their public APIs with no key. Neither dataset is
redistributed here — `data/` holds fetched results for a build, not a
republished copy of anyone's database.

**Before adding a source, read its terms.** Several free APIs permit personal
and non-commercial use but restrict commercial use, and this engine exists to
build sites that carry ads. That is a decision to make per source, in the
open, rather than a default to inherit — the README says the same thing next to
the licence.

## Generated site content

Pages this engine produces are assembled from the fetched data plus original
template copy. The template copy is covered by the MIT grant above; the facts
in it are not ours to license.
