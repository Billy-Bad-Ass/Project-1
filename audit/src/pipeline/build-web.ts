import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sender } from '../report/config';
import { formatDate } from '../lib/locale';
import { BRAND_SIGNATURE_CSS, brandFaviconDataUri, brandSignature } from '../report/brand';
import {
  checksHtml,
  loadTestimonials,
  PROOF_CSS,
  ruleCount,
  testimonialsHtml,
} from '../report/proof';
import { guideHtml, GUIDE_CSS } from '../report/guide';

/**
 * Builds the sales site by substituting real values into the templates.
 *
 * The templates ship with visible placeholders rather than defaults, and this
 * script refuses to build when a required one is unset. A landing page that
 * silently deploys with a dead "Buy" button costs every visitor it gets, and
 * that failure is invisible until someone tries to pay.
 *
 *   STRIPE_PAYMENT_LINK=https://buy.stripe.com/xxx PRICE_DISPLAY="£99" npm run build:web
 */

const SRC = join(process.cwd(), 'web');
const OUT = join(process.cwd(), 'out', 'site');

interface Replacement {
  token: string;
  value: string | undefined;
  required: boolean;
  hint: string;
}

async function replacements(): Promise<Replacement[]> {
  return [
    {
      token: 'STRIPE_PAYMENT_LINK',
      value: process.env.STRIPE_PAYMENT_LINK,
      required: true,
      hint: 'Your Payment Link URL from the Stripe dashboard, e.g. https://buy.stripe.com/xxxx',
    },
    {
      token: 'PRICE_DISPLAY',
      value: process.env.PRICE_DISPLAY,
      required: true,
      hint: 'The price as customers should read it, e.g. "£99"',
    },
    {
      token: 'SENDER_BUSINESS',
      value: sender.business,
      required: false,
      hint: 'AUDIT_SENDER_BUSINESS',
    },
    {
      token: 'SENDER_EMAIL',
      value: sender.email,
      required: false,
      hint: 'AUDIT_SENDER_EMAIL',
    },
    // Required on the legal page for the same reason it is required in every
    // cold email: a business selling to strangers has to be locatable.
    {
      token: 'SENDER_ADDRESS',
      value: process.env.AUDIT_POSTAL_ADDRESS,
      required: true,
      hint: 'AUDIT_POSTAL_ADDRESS — the address already used in the email footer',
    },
    {
      token: 'LEGAL_UPDATED',
      value: formatDate(new Date()),
      required: false,
      hint: 'today',
    },
    // The brand is substituted rather than pasted into the templates so the
    // site, the reports and the dashboard all draw the mark from one module.
    // A hand-copied SVG in a template is a copy that silently stops matching
    // the day the logo changes.
    {
      token: 'BRAND_SIGNATURE',
      value: brandSignature(),
      required: false,
      hint: 'generated from report/brand.ts',
    },
    {
      token: 'BRAND_CSS',
      value: BRAND_SIGNATURE_CSS,
      required: false,
      hint: 'generated from report/brand.ts',
    },
    {
      token: 'BRAND_FAVICON',
      value: brandFaviconDataUri(),
      required: false,
      hint: 'generated from report/brand.ts',
    },
    // Generated from the rules that actually run, so the page cannot claim a
    // count it no longer performs.
    {
      token: 'CHECKS_LIST',
      value: checksHtml(),
      required: false,
      hint: 'generated from rules/index.ts',
    },
    {
      token: 'RULE_COUNT',
      value: String(ruleCount()),
      required: false,
      hint: 'generated from rules/index.ts',
    },
    {
      token: 'PROOF_CSS',
      value: PROOF_CSS,
      required: false,
      hint: 'generated from report/proof.ts',
    },
    // Keyed to the rule ids, and tested in both directions: every check has an
    // entry, and no entry describes a check that no longer runs.
    {
      token: 'PROBLEM_GUIDE',
      value: guideHtml(),
      required: false,
      hint: 'generated from report/guide.ts',
    },
    {
      token: 'GUIDE_CSS',
      value: GUIDE_CSS,
      required: false,
      hint: 'generated from report/guide.ts',
    },
    // Real quotes when there are any; an honest offer when there are none.
    // Never an invented one.
    {
      token: 'TESTIMONIALS',
      value: testimonialsHtml(await loadTestimonials(), process.env.PRICE_DISPLAY ?? ''),
      required: false,
      hint: 'web/testimonials.json',
    },
  ];
}

function applyAll(html: string, subs: Replacement[]): string {
  let output = html;
  for (const sub of subs) {
    output = output.split(sub.token).join(sub.value ?? '');
  }
  return output;
}

async function main(): Promise<void> {
  const subs = await replacements();

  const missing = subs.filter((s) => s.required && (!s.value || s.value.trim() === ''));
  if (missing.length > 0) {
    const lines = missing.map((s) => `  ${s.token}  — ${s.hint}`).join('\n');
    throw new Error(
      `Refusing to build a site with a dead buy button.\n\nSet these first:\n${lines}\n`,
    );
  }

  const link = process.env.STRIPE_PAYMENT_LINK!.trim();
  if (!/^https:\/\//i.test(link)) {
    throw new Error(`STRIPE_PAYMENT_LINK must be an https URL, got: ${link}`);
  }

  await mkdir(OUT, { recursive: true });
  const files = await readdir(SRC);
  let built = 0;

  for (const file of files) {
    if (file.endsWith('.html')) {
      const html = await readFile(join(SRC, file), 'utf8');
      const output = applyAll(html, subs);

      // A placeholder surviving into the output means a dead link or a blank
      // price on the live page, so fail rather than publish it.
      const leftover = subs.find((s) => output.includes(s.token));
      if (leftover) {
        throw new Error(`Placeholder ${leftover.token} was not replaced in ${file}`);
      }

      await writeFile(join(OUT, file), output, 'utf8');
      built += 1;
    } else {
      // `cp` with recursive, not copyFile: web/assets is a directory, and
      // copyFile throws EISDIR on one.
      await cp(join(SRC, file), join(OUT, file), { recursive: true });
    }
  }

  process.stdout.write(
    `Built ${built} page(s) into out/site\n` +
      `  buy button -> ${link}\n` +
      `  price      -> ${process.env.PRICE_DISPLAY}\n\n` +
      `Upload out/site to any static host (Cloudflare Pages, Netlify, GitHub Pages).\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`\nbuild:web failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
