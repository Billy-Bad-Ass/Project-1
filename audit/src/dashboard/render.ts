import { funnel, type Row, type Snapshot } from './collect';

/**
 * Renders the pipeline as a single self-contained page.
 *
 * This is an operations screen, not a document: it is scanned to answer "what
 * needs me today", so state is encoded in form as well as number, and the
 * things needing a decision sit above the things that do not.
 *
 * Deliberately honest about small numbers. At four prospects a percentage is
 * noise dressed as a metric, so counts are shown and rates are withheld until
 * they mean anything.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const STAGE_LABEL: Record<Row['stage'], string> = {
  replied: 'Replied',
  client: 'Client',
  sent: 'Sent',
  audited: 'Not contacted',
  closed: 'Closed',
};

function money(amount: number): string {
  return `£${amount.toLocaleString('en-GB')}`;
}

function funnelBar(label: string, value: number, of: number, tone: string): string {
  const width = of === 0 ? 0 : Math.round((value / of) * 100);
  return `
      <div class="step">
        <div class="step-head">
          <span class="step-label">${escapeHtml(label)}</span>
          <span class="step-value">${value}</span>
        </div>
        <div class="track"><div class="fill ${tone}" style="width:${Math.max(width, value > 0 ? 3 : 0)}%"></div></div>
      </div>`;
}

export function renderDashboard(snapshot: Snapshot, allRows: Row[]): string {
  const f = funnel(snapshot);
  const needsYou = allRows.filter((r) => r.stage === 'replied');
  const notContacted = allRows.filter((r) => r.stage === 'audited');

  const rowHtml = (r: Row): string => `
        <tr class="stage-${r.stage}">
          <td>
            <span class="host">${escapeHtml(r.name ?? r.host)}</span>
            <a class="url" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.host)}</a>
          </td>
          <td class="num"><span class="score" style="--v:${r.opportunity}">${r.opportunity}</span></td>
          <td class="num">${r.health}</td>
          <td class="num">${r.critical > 0 ? `<span class="crit">${r.critical}</span>` : '<span class="dash">—</span>'}</td>
          <td><span class="pill pill-${r.stage}">${STAGE_LABEL[r.stage]}</span></td>
          <td class="phone">${r.phone ? escapeHtml(r.phone) : '<span class="dash">—</span>'}</td>
        </tr>`;

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pipeline</title>
<style>
  :root{
    --bg:#f4f6f2; --card:#fff; --ink:#1a2027; --soft:#5a6670;
    --rule:#dde2d9; --rule-soft:#eaeee7;
    --accent:#0e7c66; --warn:#a8541b; --crit:#b0322a; --good:#0e7c66;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
  @media (prefers-color-scheme:dark){
    :root{--bg:#12171b;--card:#191f25;--ink:#e6eae6;--soft:#95a0a0;
          --rule:#2b343a;--rule-soft:#222a30;--accent:#4fbfa2;--warn:#d98a4a;--crit:#e5776b;--good:#4fbfa2}
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .wrap{max-width:1080px;margin:0 auto;padding:32px 22px 64px}

  header{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap;margin-bottom:26px}
  h1{font-size:23px;letter-spacing:-.015em;margin:0}
  .stamp{color:var(--soft);font-size:12.5px;font-family:var(--mono)}

  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:26px}
  .card{background:var(--card);border:1px solid var(--rule);border-radius:11px;padding:15px 17px}
  .card .v{font-size:27px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1}
  .card .k{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--soft);margin-top:5px}
  .card.money .v{color:var(--good)}

  .panel{background:var(--card);border:1px solid var(--rule);border-radius:11px;padding:20px 22px;margin-bottom:22px}
  .panel h2{font-size:13px;text-transform:uppercase;letter-spacing:.09em;color:var(--soft);margin:0 0 16px;font-weight:600}

  .step{margin-bottom:13px}
  .step:last-child{margin-bottom:0}
  .step-head{display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:4px}
  .step-label{color:var(--soft)}
  .step-value{font-family:var(--mono);font-weight:600;font-variant-numeric:tabular-nums}
  .track{height:7px;background:var(--rule-soft);border-radius:99px;overflow:hidden}
  .fill{height:100%;border-radius:99px;background:var(--accent);min-width:0}
  .fill.warm{background:var(--warn)}
  .fill.good{background:var(--good)}

  .todo{border-left:3px solid var(--warn)}
  .todo ul{margin:0;padding-left:18px}
  .todo li{margin-bottom:6px}
  .todo a{color:var(--accent)}

  .table-scroll{overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;color:var(--soft);
     font-weight:600;padding:0 10px 9px;border-bottom:1px solid var(--rule);white-space:nowrap}
  td{padding:11px 10px;border-bottom:1px solid var(--rule-soft);vertical-align:middle}
  td.num{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono)}
  tr:last-child td{border-bottom:none}
  .host{display:block;font-weight:600}
  .url{font-size:12px;color:var(--soft);text-decoration:none;font-family:var(--mono)}
  .url:hover{color:var(--accent)}
  .phone{font-family:var(--mono);font-size:12.5px;color:var(--soft);white-space:nowrap}
  .dash{color:var(--rule)}

  .score{display:inline-block;min-width:2.6em;padding:2px 7px;border-radius:5px;font-weight:600;
         background:color-mix(in srgb,var(--warn) calc(var(--v)*1%),transparent);
         color:var(--ink)}
  .crit{color:var(--crit);font-weight:700}

  .pill{font-size:11px;font-weight:600;padding:3px 9px;border-radius:99px;white-space:nowrap;
        border:1px solid var(--rule)}
  .pill-replied{background:var(--warn);color:#fff;border-color:transparent}
  .pill-client{background:var(--good);color:#fff;border-color:transparent}
  .pill-sent{color:var(--soft)}
  .pill-audited{color:var(--soft);opacity:.75}
  .pill-closed{color:var(--soft);opacity:.5}

  .empty{color:var(--soft);font-size:14px;margin:0}
  .note{color:var(--soft);font-size:12.5px;margin:14px 0 0}
  code{font-family:var(--mono);font-size:12px;background:var(--rule-soft);padding:1px 5px;border-radius:4px}
</style>
</head>
<body>
<div class="wrap">

  <header>
    <h1>Pipeline</h1>
    <span class="stamp">${escapeHtml(new Date(snapshot.generatedAt).toLocaleString('en-GB'))}</span>
  </header>

  <div class="cards">
    <div class="card"><div class="v">${f.found}</div><div class="k">Found</div></div>
    <div class="card"><div class="v">${f.worthContacting}</div><div class="k">Worth contacting</div></div>
    <div class="card"><div class="v">${f.contacted}</div><div class="k">Emailed</div></div>
    <div class="card"><div class="v">${f.replied}</div><div class="k">Replied</div></div>
    <div class="card money"><div class="v">${money(f.revenue)}</div><div class="k">Earned</div></div>
  </div>

  ${
    needsYou.length > 0
      ? `<div class="panel todo">
    <h2>Waiting on you</h2>
    <ul>
      ${needsYou
        .map(
          (r) =>
            `<li><strong>${escapeHtml(r.name ?? r.host)}</strong> replied${
              r.contact?.repliedAt
                ? ` on ${escapeHtml(new Date(r.contact.repliedAt).toLocaleDateString('en-GB'))}`
                : ''
            }${r.contact?.notes ? ` — ${escapeHtml(r.contact.notes)}` : ''}</li>`,
        )
        .join('\n      ')}
    </ul>
  </div>`
      : ''
  }

  <div class="panel">
    <h2>Where everything is</h2>
    ${funnelBar('Businesses found', f.found, f.found, '')}
    ${funnelBar('Audited', f.audited, f.found || 1, '')}
    ${funnelBar('Worth contacting', f.worthContacting, f.found || 1, '')}
    ${funnelBar('Emailed', f.contacted, f.found || 1, 'warm')}
    ${funnelBar('Replied', f.replied, f.found || 1, 'warm')}
    ${funnelBar('Paying', f.clients, f.found || 1, 'good')}
    ${
      f.contacted < 20
        ? `<p class="note">Too early for reply rates to mean anything. ${
            f.contacted === 0
              ? 'Nothing has been sent yet.'
              : `${f.contacted} sent so far; percentages start being real around 20.`
          }</p>`
        : `<p class="note">${f.replied} replies from ${f.contacted} sent.</p>`
    }
  </div>

  <div class="panel">
    <h2>Prospects</h2>
    ${
      allRows.length === 0
        ? `<p class="empty">Nothing audited yet. Run <code>npm run find -- --what dentist --where Leeds --country GB</code> then <code>npm run audit -- --list out/prospects.txt</code>.</p>`
        : `<div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Business</th><th class="num">Opportunity</th><th class="num">Health</th>
            <th class="num">Urgent</th><th>Stage</th><th>Phone</th>
          </tr>
        </thead>
        <tbody>${allRows.map(rowHtml).join('')}</tbody>
      </table>
    </div>
    ${
      notContacted.length > 0
        ? `<p class="note">${notContacted.length} audited and not yet emailed. Drafts are in <code>out/emails/</code>.</p>`
        : ''
    }`
    }
  </div>

  ${
    snapshot.missing.length > 0
      ? `<p class="note">Not yet run: ${snapshot.missing.map((m) => `<code>${escapeHtml(m)}</code>`).join(' ')}</p>`
      : ''
  }

</div>
</body>
</html>`;
}
