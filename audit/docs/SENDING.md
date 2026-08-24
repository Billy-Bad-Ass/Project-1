# Sending

The pipeline puts outreach into Gmail itself. It does not use a Claude
connector, and that is deliberate: a connector is an account-level OAuth grant
that lives inside the tool that asked for it, so it cannot be used by a
scheduled job and no agent can grant one to itself. A refresh token in
`.env.local` works everywhere the pipeline runs.

## What it does

```
npm run send                    # writes Gmail drafts. Nothing leaves the account.
npm run send -- --send --yes    # sends
npm run send -- --max 5         # cap the batch (default 10, hard limit 50)
npm run send -- --only acme.com # one business
```

Drafting is the default and sending needs two flags. The two outcomes are not
symmetrical: a wrong draft is deleted in a second, a wrong send cannot be
recalled from somebody else's inbox.

Each message carries the report as an attachment, a `List-Unsubscribe` header
pair so the recipient's own provider can offer a one-click opt-out, and the
compliance footer — unless the Gmail signature supplies it, in which case only
the per-recipient parts go in the body.

## What it refuses to do

- Send without `--yes`.
- Run at all without a postal address and an opt-out method configured.
- Run when the shared opt-out store is configured but unreachable. A stale
  suppression list is how somebody who asked to be left alone gets emailed
  again.
- Email a business on the opt-out list. Checked immediately before each
  message, not at drafting time, because somebody can unsubscribe in between.
- Attach a report that does not exist. Every draft says "it's attached";
  sending one without the attachment is worse than not sending it.
- Guess an address. Only what the business published in OpenStreetMap is used.
  `info@<domain>` would reach a real inbox often enough to feel clever and
  bounce the rest, and bounces are what destroy a sending domain's reputation.

A business is recorded as contacted the moment its message is accepted, so a
crash halfway through a batch cannot cause a second attempt at the ones already
done.

## One-time credentials

Three values in `.env.local`. They belong to a Google Cloud project you own,
not to any chat tool.

1. **Create an OAuth client.** Google Cloud Console → APIs & Services →
   Credentials → Create credentials → OAuth client ID → **Desktop app**. Note
   the client ID and secret.
2. **Enable the Gmail API** for that project: APIs & Services → Library →
   Gmail API → Enable.
3. **Get a refresh token.** With the client ID and secret, visit
   `https://developers.google.com/oauthplayground`, click the gear icon, tick
   *Use your own OAuth credentials*, paste them in, then authorise the scope
   `https://www.googleapis.com/auth/gmail.modify` and exchange the code for
   tokens. Copy the refresh token.

```
GMAIL_CLIENT_ID=...apps.googleusercontent.com
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=1//...
```

`gmail.modify` covers both creating drafts and sending. It does not grant
access to anything outside Gmail.

## Before the first real send

Deliverability is decided before the message is written. A cold email from a
domain with no authentication records lands in spam whatever it says.

- **SPF, DKIM and DMARC** on the sending domain. Google Workspace publishes the
  values; a `gmail.com` address inherits Google's, which is why sending from
  your own domain needs these set up first.
- **Warm up.** Ten a day for the first week is not caution for its own sake:
  a new domain sending fifty in an hour is the exact pattern spam filters are
  built to catch.
- **Send to yourself first.** `--only` your own domain, read what actually
  arrives, check the attachment opens and the unsubscribe link works.

## Where the addresses come from

Discovery reads `email` and `contact:email` from OpenStreetMap. Many businesses
publish one; many do not, and the run reports how many of each.

The ones without an address are not a gap to fill by guessing. On the first
Fairfax batch, seven of eleven qualified prospects were selected *because*
their homepage has no contact method — which is the finding the email opens on.
Those are phone calls.
