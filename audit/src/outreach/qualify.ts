import { blockedReason } from '../lib/audit';
import type { SiteAudit } from '../lib/types';

/**
 * Who is not worth contacting, and why.
 *
 * Adapted from the outbound strategist's rule that an ICP which excludes
 * nothing is not an ICP. `opportunity >= 40` was that: it dropped almost no
 * one, so the list was really "everyone we managed to scan", sorted.
 *
 * Every disqualifier below comes from something that actually happened in the
 * Fairfax County run rather than from a general theory of selling, and each
 * names a reason, because a prospect removed without explanation is one nobody
 * can argue with later.
 */

export type DisqualifierId =
  | 'unauditable'
  | 'chain-location'
  | 'nothing-to-sell'
  | 'no-findings';

export interface Disqualification {
  id: DisqualifierId;
  reason: string;
}

/**
 * Path shapes used by multi-site groups for a branch page.
 *
 * A branch manager cannot commission website work — the decision sits with a
 * head office that has an agency already. From the live run:
 * `ismileva.com/find-a-locations/fairfax/` scored 96 health precisely because
 * a corporate template is competently built, and it would have been a wasted
 * send either way.
 */
const CHAIN_PATH = /\/(find-a-)?(locations?|offices?|branch(es)?|practices)\//i;

/** Below this there is no work worth a stranger's attention, or ours. */
export const MIN_OPPORTUNITY = 40;

export function disqualify(
  audit: SiteAudit,
  opts: { minOpportunity?: number } = {},
): Disqualification | null {
  const min = opts.minOpportunity ?? MIN_OPPORTUNITY;

  if (audit.error) {
    return { id: 'unauditable', reason: audit.error.replace(/^unauditable:\s*/, '') };
  }

  // Checked again from the raw status, not only from `error`.
  //
  // Auditing decides this at fetch time, but a stored audit can predate that
  // rule — and the first data this ran against did exactly that: four sites
  // that had answered 403 arrived with error null and a full set of findings
  // generated from a page that was never actually read. One layer catching it
  // is not enough when the other layer's output outlives a deploy.
  const blocked = blockedReason(audit.status, audit.loadMs);
  if (blocked) return { id: 'unauditable', reason: blocked };

  let path = '';
  try {
    path = new URL(audit.finalUrl).pathname;
  } catch {
    path = '';
  }
  if (CHAIN_PATH.test(path)) {
    return {
      id: 'chain-location',
      reason: 'a branch page of a multi-site group — the decision is not made here',
    };
  }

  if (audit.findings.length === 0) {
    return { id: 'no-findings', reason: 'nothing was found to fix' };
  }

  if (audit.opportunityScore < min) {
    return {
      id: 'nothing-to-sell',
      reason: `opportunity ${audit.opportunityScore} is below ${min}`,
    };
  }

  return null;
}

export interface Qualified {
  audit: SiteAudit;
  /** 1 is worth writing by hand; 3 is worth sending as drafted. */
  tier: 1 | 2 | 3;
}

/**
 * Splits audits into who to contact and who to skip, and tiers the survivors.
 *
 * Tiering is the outbound strategist's idea reduced to what one person can
 * actually do: attention is the scarce resource, so it is spent where the
 * opportunity is largest rather than spread evenly. Tier 1 is a handful worth
 * rewriting the opening line for; tier 3 goes as drafted.
 */
export function qualify(
  audits: SiteAudit[],
  opts: { minOpportunity?: number; tier1?: number; tier2?: number } = {},
): { contact: Qualified[]; skipped: Array<{ audit: SiteAudit; why: Disqualification }> } {
  const tier1Size = opts.tier1 ?? 3;
  const tier2Size = opts.tier2 ?? 7;

  const contact: Qualified[] = [];
  const skipped: Array<{ audit: SiteAudit; why: Disqualification }> = [];

  for (const audit of audits) {
    const why = disqualify(audit, opts);
    if (why) skipped.push({ audit, why });
    else contact.push({ audit, tier: 3 });
  }

  contact.sort((a, b) => b.audit.opportunityScore - a.audit.opportunityScore);
  contact.forEach((entry, index) => {
    entry.tier = index < tier1Size ? 1 : index < tier1Size + tier2Size ? 2 : 3;
  });

  return { contact, skipped };
}

/** What to do with a tier, in words the person reading the list can act on. */
export const TIER_ADVICE: Record<1 | 2 | 3, string> = {
  1: 'Rewrite the opening line by hand. Look at the site first.',
  2: 'Read it, adjust the opening if anything reads generic, then send.',
  3: 'Send as drafted.',
};
