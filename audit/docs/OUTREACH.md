# Outreach

The engine finds the signal. You send the email.

```bash
npm run audit -- --list prospects.txt   # scan
npm run emails                           # find each business's contact address
npm run draft                            # write a draft per prospect
# read out/outreach-drafts.md, edit, attach the report, send it yourself
```

## Where the addresses come from

OpenStreetMap records `contact:email` for almost nobody. The first full sweep
of Northern Virginia found eight businesses and not one address, so every
later step ran green and produced nothing anyone could send.

`npm run emails` reads the pages the audit already downloaded and takes the
address off them. It runs after the scan on purpose: the fetcher caches for 24
hours, so it usually makes no request at all. Where a homepage has no address
it will follow **one** same-origin contact page, and only if that site's
robots.txt permits it.

What it refuses matters more than what it finds:

| Refused | Why |
|---|---|
| `logo@2x.png` | a retina asset filename, not an address |
| `noreply@…` | valid, deliverable-looking, and silently discards everything |
| `hello@theiragency.com` next to "website by" | the designer who built the site, not the client |
| addresses inside `<script>` | minified JavaScript is wall-to-wall address-shaped strings |
| `you@example.com` | a placeholder from an unfinished template |

`out/contact-emails.md` names every address found, where it came from, and why
that one won — plus every business still without one and the reason. A wrong
address nobody can explain is how a prospect list becomes a spam complaint.

## Why it drafts but never sends

Three reasons, in order of how much they'd cost you.

**Your sending domain is the asset.** Software that fires cold email at
strangers unattended is the fastest way to get a domain blacklisted. Once that
happens every email you send lands in spam — including the reply to the one
person who was interested. You cannot undo it quickly.

**A human catching one bad draft pays for the whole habit.** The engine reads
HTML; it does not know the business closed last year, or that the "problem" is
deliberate. One glance catches that.

**Volume is the wrong lever anyway.** Twenty researched emails beat two
thousand generic ones, and twenty is not a workload worth automating away.

The realistic version: the agent writes each one, you skim it, you press send.
Ten seconds a message instead of ten minutes.

## What makes these different from normal cold email

Every draft opens with **one specific thing the owner can check themselves in
ten seconds** — their phone number isn't tappable, their browser shows "not
secure". That is the entire trick. Generic outreach asks the reader to take
your word for it; this hands them something verifiable about their own
business.

The tool picks the opener from findings a non-technical person can confirm, in
preference to findings that score worse but can't be seen. A missing canonical
tag may be more "severe" — it is useless as an opener.

## The template warning

`npm run draft` prints how many drafts share an opening signal:

```
Opening signal spread:
  mobile-viewport      14  ███████ 70%
  https                 4  ██ 20%
  contact-method        2  █ 10%
```

Over 70% on one signal triggers a warning. Two hundred emails opening the same
way is a template, however true each individual copy is — and it reads like
one. Send in smaller batches, or scan a more varied set of businesses.

## Before you send anything

- **Use a real address you own**, not a free one, and not your main personal
  inbox. If it does get flagged, you want that contained.
- **Send in small batches.** Ten or twenty a day from a new address. A brand
  new domain sending hundreds is the exact pattern spam filters look for.
- **Business addresses only** — the one on their contact page. Do not go
  hunting for personal ones.
- **Honour any reply asking you to stop**, immediately and without a parting
  pitch. In the UK and EU this is a legal duty under PECR and GDPR, and it is
  also just the deal you offered them.
- **Say who you are.** Real name, real business, real address in the footer.
  The drafts already carry your details from `AUDIT_SENDER_*`.

## The follow-up

```bash
npm run draft -- --follow-up
```

One follow-up. Not a five-step sequence. The report has already been sent —
there is nothing left to say that adds value, and mail that keeps arriving
after silence is what gets reported.

## Realistic numbers

Cold outreach reply rates are usually low single digits, even when done well.
Twenty good emails might get one or two replies. That is not failure; that is
the shape of it.

Which is why the report matters more than the email. The email only has to earn
the ten seconds it takes to open the attachment.
