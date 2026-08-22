# Selling audits with Stripe

Two ways to make money from this tool. They share the same engine.

| | What you do | What you charge |
|---|---|---|
| **Outreach** | Audit prospects, send the report free, some hire you | Whatever the fix work is worth |
| **Product** | Put up a page, people pay, they get a report | A fixed price per audit |

The product path is documented here. It needs **no server** — a Stripe Payment
Link collects the money and the customer's web address, and you run one command
to fulfil.

## Why no webhook

A webhook needs a URL that is online all the time, which means hosting, which
means either money or a free tier that sleeps. Instead, fulfilment *polls*
Stripe for paid orders when you run it.

The trade is that reports go out when you run the command rather than the
instant someone pays. Since you are promising delivery within a working day
anyway, that costs nothing real — and there is no endpoint to secure and no
signing secret to leak.

## 1. Create the Payment Link

In the Stripe dashboard → **Payment Links** → **New**.

1. Create a product, e.g. "Website Health Check", and set your price.
2. Under **Options → Add custom fields**, add a **Text** field:
   - Label: `Your website address`
   - Key: `website`
   - **Required**: yes
   
   This is how the customer tells you what to audit. Fulfilment looks for a
   field keyed `website` (also accepts `site`, `url`, `siteurl`), and falls
   back to any field whose value looks like a web address — so a slightly
   different key will not lose an order.
3. Under **After payment**, choose **Redirect to a page** and set:
   ```
   https://your-site/thanks.html?session_id={CHECKOUT_SESSION_ID}
   ```
   Stripe substitutes the real id. The thanks page shows it as a reference.
4. Copy the link. It looks like `https://buy.stripe.com/xxxxx`.

**Start in test mode.** The dashboard toggle switches between test and live.
Test mode gives you a `sk_test_…` key and card `4242 4242 4242 4242` for a fake
purchase. Do a full run end to end before touching live mode.

## 2. Build the sales page

```bash
cd audit
STRIPE_PAYMENT_LINK="https://buy.stripe.com/xxxxx" \
PRICE_DISPLAY="£99" \
AUDIT_SENDER_BUSINESS="Your Business" \
AUDIT_SENDER_EMAIL="you@example.com" \
npm run build:web
```

Output lands in `out/site`. Upload it to Cloudflare Pages, Netlify or GitHub
Pages — all free, all static.

The build **refuses to run** without a payment link and price. A landing page
that deploys with a dead buy button costs you every visitor it gets, and you
would not notice until someone complained.

## 3. Fulfil orders

```bash
export STRIPE_SECRET_KEY=sk_test_...        # test key first
npm run fulfil -- --dry-run                 # see what is waiting, touch nothing
npm run fulfil                              # audit and generate reports
```

For each paid order this fetches the customer's site, runs all 22 checks,
writes the report to `out/delivered/`, and records it in `out/fulfilled.json`
so it is never done twice. It prints the email address to send each file to.

Then attach the HTML (or print it to PDF) and reply to their receipt email.

Orders that arrive **without** a usable web address are printed loudly rather
than skipped — someone has paid, and a silent skip becomes a refund request a
week later. Contact those people directly.

Orders whose site **could not be reached** are not marked delivered, so they
stay in the queue for a retry.

## 4. Go live

Only after a full test-mode run has worked:

1. Switch the dashboard to live mode and recreate the Payment Link.
2. Rebuild the site with the live link.
3. Swap `STRIPE_SECRET_KEY` for the live key. `npm run fulfil` prints
   `Stripe mode: LIVE` so you always know which set of orders you are looking at.

## Pricing

Whatever you charge, the report has to be worth more than the price to the
person reading it — the fixes in it are typically an hour or two of a
developer's time, so price it against that, not against how long the scan took.

Start lower than feels right. It is far easier to raise a price than to explain
why the first ten customers paid more than the next ten.

## The honest version

This does not sell itself. A page nobody visits earns nothing, and there is no
audience attached to it. Realistically the **outreach** path earns first: audit
real businesses, send the report free, and let the ones who reply become
customers. The paid page is where you send them once they ask "can you just do
this for my other site too".
