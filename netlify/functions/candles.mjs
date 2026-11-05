import { getStore } from "@netlify/blobs";

const KEY = "totals-reset-2026-11-02";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_KEYS = 3000;
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req) => {
  const store = getStore({ name: "candles", consistency: "strong" });

  if (req.method === "GET") {
    const data = (await store.get(KEY, { type: "json" })) || { total: 0, counts: {} };
    return json(data);
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    // Single { slug } or batch { slugs: [...] }; each listed name gets exactly +1.
    let slugs = Array.isArray(body.slugs) ? body.slugs : [body.slug];
    slugs = [...new Set(slugs)];
    if (slugs.length < 1 || slugs.length > 1000) return json({ error: "bad slugs" }, 400);
    if (!slugs.every((x) => typeof x === "string" && SLUG_RE.test(x))) return json({ error: "bad slug" }, 400);

    // Atomic read-modify-write using ETag compare-and-swap, with retries.
    for (let attempt = 0; attempt < 8; attempt++) {
      const cur = await store.getWithMetadata(KEY, { type: "json" });
      const data = cur ? cur.data : { total: 0, counts: {} };
      const fresh = slugs.filter((x) => !(x in data.counts)).length;
      if (fresh && Object.keys(data.counts).length + fresh > MAX_KEYS) return json({ error: "limit" }, 400);
      for (const x of slugs) data.counts[x] = (data.counts[x] || 0) + 1;
      data.total = (data.total || 0) + slugs.length;
      const res = cur
        ? await store.setJSON(KEY, data, { onlyIfMatch: cur.etag })
        : await store.setJSON(KEY, data, { onlyIfNew: true });
      if (res.modified) return json(data);
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 80));
    }
    return json({ error: "busy" }, 503);
  }
  return json({ error: "method" }, 405);
};

export const config = { path: "/api/candles" };
