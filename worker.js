const TRAINING_DOC_URL = "https://docs.google.com/document/d/1DhOgDF50lSf9apOvZDI4BgFju26APOTbIWW2yEZgFGA/export?format=txt";

const FUNDRAISER_URL = "https://pages.lls.org/tnt/team/yourway27/JScott";
const FUNDRAISING_GOAL = 50000;

function dpMoneyNumber(v) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g,""));
  return Number.isFinite(n) ? n : null;
}

function dpRaisedFromPage(source) {
  const s = String(source || "")
    .replace(/&quot;/g,'"').replace(/&#34;/g,'"')
    .replace(/&amp;/g,'&').replace(/&nbsp;/g,' ');

  // LLS/TNT pages have changed markup over time, so check several explicit
  // "raised" representations instead of grabbing an arbitrary dollar amount.
  const patterns = [
    /["'](?:amountRaised|amount_raised|raisedAmount|raised_amount|totalRaised|total_raised)["']\s*[:=]\s*["']?\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:amount\s+raised|total\s+raised|raised\s+so\s+far)[\s\S]{0,180}?\$\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:raised|of\s+\$?50,?000)/i,
    /(?:raised|fundraising)[^0-9$]{0,80}\$\s*([\d,]+(?:\.\d{1,2})?)/i
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (!m) continue;
    const n = dpMoneyNumber(m[1]);
    if (n !== null && n >= 0 && n <= 10000000) return n;
  }
  return null;
}

async function dpFundraising(request, env) {
  let fallback = { goal:FUNDRAISING_GOAL, amount_raised:0, fundraiser_url:FUNDRAISER_URL, live:false };

  // Existing JSON remains the safety fallback so a third-party page change
  // never breaks the rest of the website.
  try {
    const u = new URL("/fundraising.json", request.url);
    const r = await env.ASSETS.fetch(new Request(u, request));
    if (r.ok) {
      const j = await r.json();
      fallback = {
        goal:Number(j.goal || FUNDRAISING_GOAL),
        amount_raised:Number(j.amount_raised || 0),
        fundraiser_url:j.fundraiser_url || FUNDRAISER_URL,
        live:false
      };
    }
  } catch (_) {}

  try {
    const r = await fetch(FUNDRAISER_URL, {
      headers:{
        "Accept":"text/html,application/xhtml+xml",
        "User-Agent":"Mozilla/5.0 (compatible; DistancePending/1.0; +https://distancepending.com)"
      },
      cf:{cacheTtl:300,cacheEverything:true}
    });
    if (!r.ok) throw new Error("fundraiser HTTP "+r.status);
    const raised = dpRaisedFromPage(await r.text());
    if (raised === null) throw new Error("raised amount not found");
    return {...fallback, amount_raised:raised, live:true};
  } catch (e) {
    return fallback;
  }
}

const GITHUB_JOURNAL_API = "https://api.github.com/repos/distancepending/Distance-Pendimg/contents/journal?ref=main";

function parseFrontmatter(text) {
  const normalized = String(text || "").replace(/\r/g, "");
  if (!normalized.startsWith("---\n")) return { body: normalized };
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) return { body: normalized };
  const head = normalized.slice(4, end).split("\n");
  const data = {};
  for (const line of head) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (/^-?\d+(?:\.\d+)?$/.test(value)) value = Number(value);
    data[m[1]] = value;
  }
  data.body = normalized.slice(end + 4).replace(/^\n+/, "");
  return data;
}

async function getJournal() {
  const listResponse = await fetch(GITHUB_JOURNAL_API, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "DistancePending/1.0"
    },
    cf: { cacheTtl: 60, cacheEverything: true }
  });
  if (!listResponse.ok) throw new Error(`GitHub journal list returned ${listResponse.status}`);
  const files = (await listResponse.json()).filter(x => x.type === "file" && /\.md$/i.test(x.name));
  const entries = await Promise.all(files.map(async file => {
    const r = await fetch(file.download_url, { cf: { cacheTtl: 60, cacheEverything: true } });
    if (!r.ok) throw new Error(`Journal file ${file.name} returned ${r.status}`);
    const entry=parseFrontmatter(await r.text());
    entry.slug=file.name.replace(/\.md$/i,'').replace(/^\d{4}-\d{2}-\d{2}-/,'');
    return entry;
  }));
  return entries;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);


    if (url.pathname === "/api/fundraising") {
      const data = await dpFundraising(request, env);
      return Response.json(data, { headers:{
        "Cache-Control":"public, max-age=300",
        "Access-Control-Allow-Origin":"*"
      }});
    }

    if (url.pathname === "/api/training-plan") {
      try {
        const response = await fetch(TRAINING_DOC_URL, { headers: { "User-Agent": "DistancePending/1.0" } });
        if (!response.ok) return new Response("Training plan unavailable", { status: 502 });
        return new Response(await response.text(), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60" } });
      } catch (error) {
        return new Response("Training plan unavailable", { status: 502 });
      }
    }

    if (url.pathname === "/api/journal") {
      try {
        return Response.json(await getJournal(), { headers: { "Cache-Control": "public, max-age=60" } });
      } catch (error) {
        return Response.json({ error: "Journal unavailable" }, { status: 502 });
      }
    }

    if (url.pathname.startsWith("/journal/")) {
      const root=new URL("/",url.origin);
      return env.ASSETS.fetch(new Request(root,request));
    }
    return env.ASSETS.fetch(request);
  }
};
