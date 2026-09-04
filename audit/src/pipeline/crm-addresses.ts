/**
 * Put the sweep's contact addresses into the CRM.
 *
 * The sweep already finds businesses, audits them, and fills in an address for
 * each. All of that works. The addresses then sat in a run artifact nobody
 * downloaded, so 44 prospects reached the CRM with no way to write to them and
 * not one of them was ever contacted.
 *
 * The gap was the last hop. The artifact download redirects to an Azure blob
 * host that agent sandboxes cannot reach, so it needed a person at a terminal
 * — the bottleneck this pipeline exists to remove. Inside Actions the download
 * is native, so this runs there. See .github/workflows/crm-addresses.yml.
 *
 * It only ever fills a blank, so re-running is safe and a hand-corrected
 * address is never overwritten.
 *
 * Nothing here prints an address. This repository is public and its logs are
 * public with it. The count is the finding; the list is not. Same line the
 * sweep already takes in "Say how many, without saying what".
 */
import { existsSync, readFileSync } from 'node:fs';

export interface CsvRow {
  name?: string;
  website?: string;
  email?: string;
  phone?: string;
  [key: string]: string | undefined;
}

/**
 * RFC 4180 enough for this file: quoted fields, and doubled quotes inside
 * them. A practice called "Britton, Brian DDS" is a real row in this data, and
 * a naive split on commas files its phone number under `email`.
 */
export function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const kept = rows.filter((r) => r.some((v) => v !== ''));
  const header = kept.shift() ?? [];
  return kept.map(
    (r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])) as CsvRow,
  );
}

/**
 * The join key between the artifact and the CRM.
 *
 * Both sides store a website, and neither agrees on the details. A trailing
 * slash, a `www.`, or a capital letter that one side kept and the other
 * dropped would match nothing at all — and the run would report a cheerful
 * zero rather than an error, which is the failure mode this whole project
 * keeps having.
 */
export function siteKey(url: string | null | undefined): string {
  return String(url ?? '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
    .split('/')[0] ?? '';
}

export interface CrmRow {
  id: number | string;
  website: string | null;
  email: string | null;
}

export interface Plan {
  fill: { id: string; email: string; phone: string }[];
  alreadyHad: number;
  noMatch: number;
}

/** Decide what to write. Pure, so the matching is tested without a network. */
export function planUpdates(rows: CsvRow[], clients: CrmRow[]): Plan {
  const byKey = new Map(clients.map((c) => [siteKey(c.website), c]));
  const plan: Plan = { fill: [], alreadyHad: 0, noMatch: 0 };
  for (const r of rows) {
    if (!r.email) continue;
    const client = byKey.get(siteKey(r.website));
    if (!client) {
      plan.noMatch++;
      continue;
    }
    if (client.email) {
      plan.alreadyHad++;
      continue;
    }
    plan.fill.push({ id: String(client.id), email: r.email, phone: r.phone ?? '' });
  }
  return plan;
}

/** Both layouts the artifact has used. */
const CSV_CANDIDATES = ['sweep/audit/out/prospects.csv', 'sweep/prospects.csv'];

async function main(): Promise<void> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const database = process.env.DATABASE_ID;
  const apply = process.env.APPLY === 'true';

  if (!token || !account || !database) {
    console.error(
      '::error::CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and DATABASE_ID are all required',
    );
    process.exit(1);
  }

  const csv = CSV_CANDIDATES.find((p) => existsSync(p));
  if (!csv) {
    console.error(`::error::no prospects.csv found (looked in ${CSV_CANDIDATES.join(', ')})`);
    process.exit(1);
  }

  const d1 = async (sql: string, params: string[] = []): Promise<CrmRow[]> => {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sql, params }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      errors?: { code: number; message: string }[];
      result?: { results?: CrmRow[] }[];
    };
    if (!res.ok || body.success === false) {
      const why = (body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ');
      throw new Error(`D1 ${res.status}${why ? ` — ${why}` : ''}`);
    }
    return body.result?.[0]?.results ?? [];
  };

  const rows = parseCsv(readFileSync(csv, 'utf8'));
  const withAddress = rows.filter((r) => r.email).length;
  console.log(`artifact: ${rows.length} businesses, ${withAddress} with an address`);

  const clients = await d1(
    `SELECT id, website, email FROM clients WHERE website IS NOT NULL AND website <> ''`,
  );
  const reachable = clients.filter((c) => c.email).length;
  console.log(`crm: ${clients.length} rows, ${reachable} already reachable`);

  const plan = planUpdates(rows, clients);

  if (apply) {
    for (const u of plan.fill) {
      await d1(
        `UPDATE clients
            SET email = ?1,
                phone = COALESCE(NULLIF(?2, ''), phone),
                next_action = 'Send the Rent Receipt',
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
          WHERE id = ?3`,
        [u.email, u.phone, u.id],
      );
    }
  }

  console.log(apply ? 'applied' : 'DRY RUN, nothing written');
  console.log(`  filled in       ${plan.fill.length}`);
  console.log(`  already had one ${plan.alreadyHad}`);
  console.log(`  no CRM row      ${plan.noMatch}`);

  if (plan.fill.length === 0 && withAddress > 0) {
    console.log('::warning::the artifact had addresses but none matched an empty CRM row');
  }
}

if (process.argv[1]?.endsWith('crm-addresses.ts')) {
  await main();
}
