import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reportSlug } from '../lib/slug';
import type { SiteAudit } from '../lib/types';
import type { Prospect } from '../discover/overpass';

/**
 * Gathers everything the pipeline has produced into one picture.
 *
 * There is no database and no server: the pipeline already writes its state to
 * disk, so the dashboard reads those files rather than inventing a second
 * source of truth that could disagree with them. The one thing it does own is
 * the contact log — who you actually emailed and who replied — because no
 * automated step knows that.
 */

const OUT = join(process.cwd(), 'out');

/** What you did, which only you can record. */
export interface ContactRecord {
  /** Hostname, matching the audit. */
  host: string;
  sentAt?: string;
  repliedAt?: string;
  /** 'interested' | 'declined' | 'no-reply' | 'client' */
  outcome?: string;
  /** Money actually received, in whole currency units. */
  paid?: number;
  notes?: string;
}

export interface FulfilledOrder {
  sessionId: string;
  siteUrl: string;
  email: string | null;
  reportFile: string;
  fulfilledAt: string;
  healthScore: number;
}

export interface Snapshot {
  generatedAt: string;
  prospects: Prospect[];
  audits: SiteAudit[];
  contacts: Record<string, ContactRecord>;
  orders: FulfilledOrder[];
  /** Files that were missing, so the dashboard can say what it does not know. */
  missing: string[];
}

async function readJson<T>(file: string, fallback: T, missing: string[]): Promise<T> {
  try {
    return JSON.parse(await readFile(join(OUT, file), 'utf8')) as T;
  } catch {
    missing.push(file);
    return fallback;
  }
}

export async function collect(): Promise<Snapshot> {
  const missing: string[] = [];

  const [prospects, audits, contactList, orderMap] = await Promise.all([
    readJson<Prospect[]>('prospects.json', [], missing),
    readJson<SiteAudit[]>('audits.json', [], missing),
    readJson<ContactRecord[]>('contacts.json', [], missing),
    readJson<Record<string, FulfilledOrder>>('fulfilled.json', {}, missing),
  ]);

  const contacts: Record<string, ContactRecord> = {};
  for (const record of contactList) {
    if (record.host) contacts[record.host.trim().toLowerCase().replace(/^www\./, '')] = record;
  }

  return {
    generatedAt: new Date().toISOString(),
    prospects,
    audits: audits.filter((a) => a.error === null),
    contacts,
    orders: Object.values(orderMap),
    missing,
  };
}

export interface Funnel {
  found: number;
  audited: number;
  worthContacting: number;
  contacted: number;
  replied: number;
  clients: number;
  revenue: number;
}

/**
 * The funnel.
 *
 * Reported as absolute counts rather than percentages: at these volumes a
 * percentage of four prospects is noise dressed up as a metric.
 */
export function funnel(snapshot: Snapshot): Funnel {
  const contacts = Object.values(snapshot.contacts);
  const paidOrders = snapshot.orders.length;

  const serviceRevenue = contacts.reduce((sum, c) => sum + (c.paid ?? 0), 0);

  return {
    found: snapshot.prospects.length,
    audited: snapshot.audits.length,
    worthContacting: snapshot.audits.filter((a) => a.opportunityScore >= 40).length,
    contacted: contacts.filter((c) => c.sentAt).length,
    replied: contacts.filter((c) => c.repliedAt).length,
    clients: contacts.filter((c) => c.outcome === 'client').length + paidOrders,
    revenue: serviceRevenue,
  };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export interface Row {
  host: string;
  name: string | null;
  url: string;
  phone: string | null;
  opportunity: number;
  health: number;
  critical: number;
  findings: number;
  contact: ContactRecord | null;
  /** Where this one has got to. */
  stage: 'audited' | 'sent' | 'replied' | 'client' | 'closed';
}

/**
 * Match a hand-written contact record to a row.
 *
 * Keyed on the same host-plus-path identity that names report files, because
 * keying on host alone made two pages of one domain collide — the same bug
 * that silently overwrote reports earlier. A bare hostname is still accepted,
 * since that is what anyone would naturally type, but only when exactly one
 * row has it. An ambiguous hostname matches nothing rather than being applied
 * to several businesses at once, which would misreport who actually replied.
 */
function matchContact(
  contacts: Record<string, ContactRecord>,
  slug: string,
  host: string,
  hostCounts: Map<string, number>,
): ContactRecord | null {
  const bySlug = contacts[slug];
  if (bySlug) return bySlug;

  const byHost = contacts[host];
  if (byHost && hostCounts.get(host) === 1) return byHost;

  return null;
}

export function rows(snapshot: Snapshot): Row[] {
  // Identity is host plus path, matching how report files are named.
  const byKey = new Map(snapshot.prospects.map((p) => [reportSlug(p.website), p]));

  const hostCounts = new Map<string, number>();
  for (const audit of snapshot.audits) {
    const host = hostOf(audit.finalUrl);
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  }

  return snapshot.audits
    .map((audit): Row => {
      const host = hostOf(audit.finalUrl);
      const slug = reportSlug(audit.finalUrl);
      const prospect = byKey.get(slug) ?? null;
      const contact = matchContact(snapshot.contacts, slug, host, hostCounts);

      let stage: Row['stage'] = 'audited';
      if (contact?.outcome === 'client') stage = 'client';
      else if (contact?.outcome === 'declined') stage = 'closed';
      else if (contact?.repliedAt) stage = 'replied';
      else if (contact?.sentAt) stage = 'sent';

      return {
        host,
        name: prospect?.name ?? null,
        url: audit.finalUrl,
        phone: prospect?.phone ?? null,
        opportunity: audit.opportunityScore,
        health: audit.healthScore,
        critical: audit.findings.filter((f) => f.severity === 'critical').length,
        findings: audit.findings.length,
        contact,
        stage,
      };
    })
    .sort((a, b) => {
      // Anything needing a human decision floats above the untouched pile.
      const rank: Record<Row['stage'], number> = {
        replied: 0, client: 1, sent: 2, audited: 3, closed: 4,
      };
      return rank[a.stage] - rank[b.stage] || b.opportunity - a.opportunity;
    });
}
