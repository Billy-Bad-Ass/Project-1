import { ALL_RULES } from '../rules/index';

/**
 * What each problem means and what fixing it involves.
 *
 * Keyed by rule id and checked against `ALL_RULES` by a test in both
 * directions: every check must have an entry, and no entry may describe a
 * check that no longer runs. A guide that quietly falls behind the product
 * is worse than no guide, because it is read as a promise.
 *
 * `effort` and `who` are estimates for a typical small-business site, and the
 * page says so. They are here because "add structured data" means nothing to
 * someone deciding whether to phone their web person.
 */

export type Effort = 'Minutes' | 'About an hour' | 'Half a day' | 'Depends';
export type Who = 'You can do this' | 'Web developer' | 'Whoever hosts the site';

export interface GuideEntry {
  /** What we found, in the words a non-technical owner would use. */
  problem: string;
  /** Why it costs them something. */
  means: string;
  /** What the fix actually is. */
  fix: string;
  effort: Effort;
  who: Who;
}

export const GUIDE: Record<string, GuideEntry> = {
  // --- technical ---
  'mobile-viewport': {
    problem: 'The site is not set up for phone screens',
    means: 'Phones show the desktop layout shrunk down, so visitors pinch and zoom to read anything. Most give up instead.',
    fix: 'One line added to the page header telling browsers to use the phone\'s width.',
    effort: 'Minutes',
    who: 'Web developer',
  },
  'http-status': {
    problem: 'The page returns an error instead of loading',
    means: 'Visitors and Google both see an error. Nothing else on the site matters until this is fixed.',
    fix: 'Depends on the cause — usually a server or hosting problem rather than the site itself.',
    effort: 'Depends',
    who: 'Whoever hosts the site',
  },
  favicon: {
    problem: 'No icon in the browser tab',
    means: 'Your site is a blank page symbol among a dozen open tabs, and the same in everyone\'s bookmarks.',
    fix: 'Add a small square logo image and one line linking to it.',
    effort: 'Minutes',
    who: 'You can do this',
  },
  sitemap: {
    problem: 'No sitemap for search engines',
    means: 'Google eventually finds your pages by following links. A sitemap tells it directly, so new pages appear sooner.',
    fix: 'Generate a sitemap file and reference it from robots.txt. Most site builders do this on request.',
    effort: 'About an hour',
    who: 'Web developer',
  },

  // --- conversion ---
  'contact-method': {
    problem: 'No way to get in touch from the home page',
    means: 'Someone ready to book has to go hunting, and most will call whoever is easier instead. This is usually the most expensive problem on a small business site.',
    fix: 'A tap-to-call phone number in the header on every page, and a short form.',
    effort: 'About an hour',
    who: 'Web developer',
  },
  'call-to-action': {
    problem: 'No clear next step for a visitor',
    means: 'People read the page, feel positive, and leave — because nothing told them what to do next.',
    fix: 'One obvious button saying the thing you want them to do. "Book an appointment", not "Learn more".',
    effort: 'About an hour',
    who: 'Web developer',
  },
  'social-preview': {
    problem: 'Shared links show no image or description',
    means: 'When someone sends your site in a message or posts it, it appears as a bare grey link. It gets noticed far less, and looks broken.',
    fix: 'Add a handful of tags naming the title, description and an image to use.',
    effort: 'Minutes',
    who: 'Web developer',
  },

  // --- trust ---
  https: {
    problem: 'The site is not on a secure connection',
    means: 'Browsers show "Not secure" next to your address. Anyone deciding whether to trust you with an appointment reads that first.',
    fix: 'Turn on a certificate — most hosts now provide one free — and redirect the old insecure address to the new one.',
    effort: 'About an hour',
    who: 'Whoever hosts the site',
  },
  'privacy-policy': {
    problem: 'No privacy policy anywhere on the site',
    means: 'If you collect enquiries you are handling personal data, and a missing policy reads as carelessness to anyone who looks.',
    fix: 'One page saying what you collect, why, and how to ask you to delete it.',
    effort: 'About an hour',
    who: 'You can do this',
  },

  // --- findability ---
  'title-tag': {
    problem: 'The page title is missing or unhelpful',
    means: 'This is the blue headline in Google results. A weak one is the difference between someone clicking you or the practice below you.',
    fix: 'Write one line: what you do and where you are.',
    effort: 'Minutes',
    who: 'You can do this',
  },
  'meta-description': {
    problem: 'Google is writing your search listing for you',
    means: 'With no description, Google picks whatever text it finds first — often a cookie notice. That is the sentence people judge you on.',
    fix: 'Write about 150 characters naming the practice, the area and why to choose you.',
    effort: 'Minutes',
    who: 'You can do this',
  },
  'heading-structure': {
    problem: 'The page has no clear main heading',
    means: 'Search engines use headings to work out what a page is about. Without one they guess, and often guess wrong.',
    fix: 'One main heading per page, with sub-headings under it in order.',
    effort: 'About an hour',
    who: 'Web developer',
  },
  'canonical-url': {
    problem: 'Several addresses serve the same page',
    means: 'With www and without, http and https, Google may treat them as competing copies and split the credit between them.',
    fix: 'One tag on each page naming the address you want counted.',
    effort: 'Minutes',
    who: 'Web developer',
  },
  'structured-data': {
    problem: 'No business details search engines can read',
    means: 'Opening hours, address and phone number can appear directly in search results — but only if they are marked up in a way Google understands.',
    fix: 'Add a small block of business information in the format search engines expect.',
    effort: 'About an hour',
    who: 'Web developer',
  },
  indexability: {
    problem: 'The page tells Google not to list it',
    means: 'The site is invisible in search. This is almost always left behind by accident after a redesign, and can cost every search visitor you have.',
    fix: 'Remove the instruction telling search engines to skip the page.',
    effort: 'Minutes',
    who: 'Web developer',
  },

  // --- speed ---
  'document-weight': {
    problem: 'The page is much heavier than it needs to be',
    means: 'On a phone away from wifi it takes seconds to appear, and a good share of people leave before it does.',
    fix: 'Usually images. Compress them, and remove anything loading that nobody looks at.',
    effort: 'Half a day',
    who: 'Web developer',
  },
  'response-time': {
    problem: 'The server is slow to answer',
    means: 'Before anything can load at all, there is a wait. It makes the whole site feel sluggish regardless of how well it is built.',
    fix: 'Caching, or moving to better hosting. Often the cheapest real speed win.',
    effort: 'Depends',
    who: 'Whoever hosts the site',
  },
  'image-sizing': {
    problem: 'Photographs are far larger than displayed',
    means: 'A 4 MB photo shown at postcard size still downloads all 4 MB. It is the most common reason a small business site feels slow.',
    fix: 'Export each image at the size actually shown and save as WebP. Usually cuts the weight by ninety per cent with no visible difference.',
    effort: 'About an hour',
    who: 'You can do this',
  },
  'script-count': {
    problem: 'Too much code runs before the page appears',
    means: 'Tracking, chat widgets and plugins each add delay. Visitors stare at a blank screen while they load.',
    fix: 'Work out which are actually earning their place, remove the rest, and load what stays after the page shows.',
    effort: 'Half a day',
    who: 'Web developer',
  },

  // --- accessibility ---
  'image-alt': {
    problem: 'Images have no text description',
    means: 'Anyone using a screen reader hears nothing where the picture is. Search engines cannot tell what the images show either.',
    fix: 'Describe each meaningful image in a few words. Decorative ones get an empty description so they are skipped.',
    effort: 'About an hour',
    who: 'You can do this',
  },
  'html-lang': {
    problem: 'The page does not say what language it is in',
    means: 'Screen readers may read English in a Spanish accent, and browsers offer to translate pages that need no translating.',
    fix: 'One attribute on the page.',
    effort: 'Minutes',
    who: 'Web developer',
  },
  'form-labels': {
    problem: 'Form fields have no labels',
    means: 'The placeholder text vanishes as soon as someone types, so they lose track of which box is which — and screen readers announce nothing at all.',
    fix: 'A proper label attached to each field.',
    effort: 'About an hour',
    who: 'Web developer',
  },
};

const CATEGORY_LABEL: Record<string, string> = {
  conversion: 'Turning visitors into customers',
  findability: 'Being found',
  trust: 'Trust and safety',
  speed: 'Speed',
  accessibility: 'Access for everyone',
  technical: 'Technical',
};

const CATEGORY_ORDER = [
  'conversion',
  'findability',
  'trust',
  'speed',
  'accessibility',
  'technical',
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const EFFORT_CLASS: Record<Effort, string> = {
  Minutes: 'q',
  'About an hour': 'm',
  'Half a day': 'l',
  Depends: 'd',
};

/** The guide, grouped, in the order a business owner cares about. */
export function guideHtml(): string {
  const byCategory = new Map<string, Array<{ id: string; entry: GuideEntry }>>();
  for (const rule of ALL_RULES) {
    const entry = GUIDE[rule.id];
    if (!entry) continue;
    const list = byCategory.get(rule.category) ?? [];
    list.push({ id: rule.id, entry });
    byCategory.set(rule.category, list);
  }

  const ordered = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return ordered
    .map((category) => {
      const items = (byCategory.get(category) ?? [])
        .map(
          ({ entry }) => `
        <details class="g-item">
          <summary>
            <span class="g-problem">${escapeHtml(entry.problem)}</span>
            <span class="g-meta">
              <span class="g-effort g-${EFFORT_CLASS[entry.effort]}">${escapeHtml(entry.effort)}</span>
              <span class="g-who">${escapeHtml(entry.who)}</span>
            </span>
          </summary>
          <div class="g-body">
            <p><b>What it costs you.</b> ${escapeHtml(entry.means)}</p>
            <p><b>What fixing it means.</b> ${escapeHtml(entry.fix)}</p>
          </div>
        </details>`,
        )
        .join('');

      return `
      <div class="g-group">
        <h3>${escapeHtml(CATEGORY_LABEL[category] ?? category)}</h3>
        ${items}
      </div>`;
    })
    .join('');
}

export const GUIDE_CSS = `
  .g-group{margin-bottom:26px}
  .g-group h3{font-size:13px;text-transform:uppercase;letter-spacing:.09em;
    color:var(--muted);margin:0 0 10px}
  .g-item{border:1px solid var(--line);border-radius:9px;margin-bottom:7px;background:var(--bg)}
  .g-item[open]{border-color:var(--accent)}
  .g-item summary{cursor:pointer;list-style:none;padding:13px 16px;display:flex;
    gap:12px;align-items:baseline;flex-wrap:wrap}
  .g-item summary::-webkit-details-marker{display:none}
  .g-item summary::before{content:"+";color:var(--accent);font-weight:700;
    flex:0 0 auto;width:12px}
  .g-item[open] summary::before{content:"\\2212"}
  .g-problem{flex:1 1 220px;font-weight:600;font-size:15.5px}
  .g-meta{flex:0 0 auto;display:flex;gap:8px;align-items:center}
  .g-effort{font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;white-space:nowrap}
  .g-q{background:#E7F5EE;color:#0F7A52}
  .g-m{background:#EAEFFD;color:#1E45B8}
  .g-l{background:#FDF0E4;color:#a8541b}
  .g-d{background:var(--panel);color:var(--muted)}
  .g-who{font-size:12.5px;color:var(--muted);white-space:nowrap}
  .g-body{padding:0 16px 15px 40px}
  .g-body p{margin:0 0 9px;font-size:15px;color:var(--muted)}
  .g-body p:last-child{margin-bottom:0}
  .g-body b{color:var(--ink)}
  @media (prefers-color-scheme:dark){
    .g-q{background:#12281F;color:#4fbf8f}
    .g-m{background:#18213A;color:#9DB6F6}
    .g-l{background:#2A1F14;color:#d98a4a}
  }
`;
