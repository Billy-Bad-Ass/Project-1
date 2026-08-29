# Keeping track

```bash
npm run dashboard      # builds out/dashboard.html
```

Open it in a browser. It shows where every prospect stands, what needs you
today, and what you have actually earned.

## There is no database

The pipeline already writes its state to disk, so the dashboard reads those
files rather than inventing a second source of truth that could quietly
disagree with them. Nothing to host, nothing to back up, nothing to pay for.

| File | Written by | Holds |
|---|---|---|
| `out/prospects.json` | `npm run find`, then `npm run emails` | Names, phones, addresses |
| `out/contact-emails.md` | `npm run emails` | Which address was chosen for each business, and why |
| `out/audits.json` | `npm run audit` | Findings and scores |
| `out/fulfilled.json` | `npm run fulfil` | Local mirror of the R2 fulfilment ledger (truth lives in R2) |
| `out/contacts.json` | **you** | Who you emailed, who replied, who paid |

## The one file you maintain

No automated step can know that you sent an email, or that someone rang you
back. `out/contacts.json` is where that goes:

```json
[
  {
    "host": "redlanddental.co.uk",
    "sentAt": "2026-08-20",
    "repliedAt": "2026-08-21",
    "outcome": "interested",
    "notes": "wants a call Thursday"
  },
  {
    "host": "acmeplumbing.co.uk",
    "sentAt": "2026-08-20",
    "outcome": "client",
    "paid": 450
  }
]
```

`outcome` is free text; `interested`, `declined` and `client` are the ones the
dashboard understands. `paid` is whole pounds actually received — not quoted,
not invoiced.

Use the bare hostname. It resolves to that business's homepage. If you audited
several pages of one site and need to be specific, use the report filename
without `.html` (e.g. `acme.co.uk-services`).

## What it deliberately does not show

**Reply rates, until you have sent about twenty.** A percentage of four
prospects is noise dressed as a metric, and acting on it is worse than having
no number at all. The dashboard says how many you have sent and withholds the
rate until it means something.

**Projected or pipeline revenue.** Only money received. Every other figure on a
sales dashboard is a story you tell yourself.

## Reading it

The top row is counts, not rates. Below that, the funnel shows where people
fall out — the gap between *worth contacting* and *emailed* is usually the
honest one, and it is the only gap you can close today.

**Waiting on you** appears only when someone has replied. If it is empty and
the emailed count is low, the next action is not on this screen: it is sending
more.
