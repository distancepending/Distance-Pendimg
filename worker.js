const TRAINING_DOC_URL = "https://docs.google.com/document/d/1DhOgDF50lSf9apOvZDI4BgFju26APOTbIWW2yEZgFGA/export?format=txt";
const FUNDRAISER_URL = "https://pages.lls.org/tnt/team/yourway27/JScott";
const FUNDRAISING_GOAL = 50000;

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


function decodeEntities(text) {
  return String(text || "")
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function numberFromMoney(value) {
  const n = Number(String(value || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractRaisedAmount(html) {
  const text = decodeEntities(html);

  // Prefer explicit machine-readable fundraising fields.
  const patterns = [
    /"amountRaised"\s*:\s*"?\$?([\d,]+(?:\.\d{1,2})?)/i,
    /"amount_raised"\s*:\s*"?\$?([\d,]+(?:\.\d{1,2})?)/i,
    /"raisedAmount"\s*:\s*"?\$?([\d,]+(?:\.\d{1,2})?)/i,
    /"raised"\s*:\s*"?\$?([\d,]+(?:\.\d{1,2})?)/i,
    /(?:amount\s+raised|raised\s+so\s+far|total\s+raised)[^$0-9]{0,120}\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:raised|of\s+\$?[\d,]+\s+(?:goal|raised))/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const amount = numberFromMoney(match[1]);
    if (amount != null && amount >= 0 && amount <= 10000000) return amount;
  }
  return null;
}

async function getFundraising(request, env) {
  let fallback = { goal: FUNDRAISING_GOAL, amount_raised: 0, fundraiser_url: FUNDRAISER_URL };

  // Preserve the existing fundraising.json as a safe fallback.
  try {
    const localUrl = new URL("/fundraising.json", request.url);
    const local = await env.ASSETS.fetch(new Request(localUrl, request));
    if (local.ok) {
      const data = await local.json();
      fallback = {
        goal: Number(data.goal || FUNDRAISING_GOAL),
        amount_raised: Number(data.amount_raised || 0),
        fundraiser_url: data.fundraiser_url || FUNDRAISER_URL
      };
    }
  } catch (_) {}

  try {
    const response = await fetch(FUNDRAISER_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DistancePending/1.0; +https://distancepending.com)",
        "Accept": "text/html,application/xhtml+xml"
      },
      cf: { cacheTtl: 300, cacheEverything: true }
    });
    if (!response.ok) throw new Error(`Fundraiser returned ${response.status}`);

    const amount = extractRaisedAmount(await response.text());
    if (amount == null) throw new Error("Raised amount not found in fundraiser page");

    return {
      goal: fallback.goal || FUNDRAISING_GOAL,
      amount_raised: amount,
      fundraiser_url: fallback.fundraiser_url || FUNDRAISER_URL,
      live: true
    };
  } catch (error) {
    return { ...fallback, live: false };
  }
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);


    if (url.pathname === "/api/fundraising") {
      const data = await getFundraising(request, env);
      return Response.json(data, {
        headers: { "Cache-Control": "public, max-age=300" }
      });
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
