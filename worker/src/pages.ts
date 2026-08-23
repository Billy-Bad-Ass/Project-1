/**
 * The two pages a recipient can actually end up looking at.
 *
 * Deliberately plain text rather than a copy of the SVG mark. The mark has one
 * definition, in the audit package's brand module, and a second copy pasted in
 * here would be a copy that silently stops matching the day the logo changes.
 * The colours below are that module's values, and are the only thing worth
 * duplicating: they are three hex codes, and being slightly stale costs
 * nothing on a page that exists to say "done".
 */

const INK = '#12161F';
const MUTED = '#5A6472';
const ACCENT = '#2B5CE6';
const PAPER = '#FAFAF8';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(business: string, title: string, body: string): string {
  return `<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} — ${escapeHtml(business)}</title>
<style>
  :root{--ink:${INK};--muted:${MUTED};--accent:${ACCENT};--bg:${PAPER};--panel:#fff;--line:#dfe3ea}
  @media (prefers-color-scheme:dark){
    :root{--ink:#e8ebf0;--muted:#98A2B3;--accent:#6A8DF0;--bg:#0B0F16;--panel:#141922;--line:#252c38}
  }
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       padding:24px;background:var(--bg);color:var(--ink);
       font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  main{max-width:480px;width:100%;background:var(--panel);border:1px solid var(--line);
       border-radius:12px;padding:32px}
  .brand{font-weight:700;letter-spacing:-.02em;font-size:15px;color:var(--muted);
         text-transform:uppercase;margin:0 0 20px}
  h1{font-size:23px;letter-spacing:-.02em;margin:0 0 12px;line-height:1.25}
  p{margin:0 0 14px}
  .host{font-weight:600}
  button{appearance:none;border:0;border-radius:8px;background:var(--accent);color:#fff;
         font:inherit;font-weight:600;padding:12px 20px;cursor:pointer;width:100%}
  button:hover{filter:brightness(1.08)}
  .muted{color:var(--muted);font-size:14px;margin-top:20px}
</style>
</head>
<body><main>
<p class="brand">${escapeHtml(business)}</p>
${body}
</main></body>
</html>`;
}

/**
 * Shown on GET, and it does not unsubscribe anybody.
 *
 * Mail clients and security scanners fetch every link in a message before a
 * human sees it. If a GET performed the unsubscribe, a large share of the list
 * would be removed by software that merely looked at the email — silently, and
 * looking exactly like people choosing to leave. Hence a form, and a POST.
 */
export function confirmPage(business: string, host: string): string {
  return shell(
    business,
    'Stop these emails',
    `<h1>Stop emails about <span class="host">${escapeHtml(host)}</span>?</h1>
<p>One click and we will not contact this business again. There is nothing to fill in and no account to close.</p>
<form method="post">
  <button type="submit">Yes, stop emailing me</button>
</form>
<p class="muted">If you did not mean to open this, close the page — nothing has happened yet.</p>`,
  );
}

export function donePage(business: string, host: string, contact: string | null): string {
  return shell(
    business,
    'Done',
    `<h1>Done — you are off the list</h1>
<p><span class="host">${escapeHtml(host)}</span> has been recorded as do-not-contact. The record is permanent and is never cleared, so this will not undo itself.</p>
<p>Any email already written to you is deleted rather than sent. Sorry for the interruption.</p>
${contact ? `<p class="muted">Anything else: <a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a></p>` : ''}`,
  );
}

/**
 * The response to a token that does not verify.
 *
 * Says the same thing whether the link is stale, mistyped, or forged, and
 * offers the one route that always works. Confirming that a given host is or
 * is not on our list would be an enumeration oracle on data that is nobody
 * else's business.
 */
export function badLinkPage(business: string, contact: string | null): string {
  return shell(
    business,
    'That link did not work',
    `<h1>That link did not work</h1>
<p>It may have been broken in transit, or copied incompletely — long links get wrapped by some mail programs.</p>
${
  contact
    ? `<p>Reply to the email, or write to <a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a> with the word <strong>stop</strong>, and you will be taken off the list by hand. That route always works.</p>`
    : `<p>Reply to the email with the word <strong>stop</strong> and you will be taken off the list by hand.</p>`
}`,
  );
}
