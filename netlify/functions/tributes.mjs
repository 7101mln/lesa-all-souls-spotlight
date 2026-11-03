import { getStore } from "@netlify/blobs";

// Newly Honored Witnesses: shared list, stored separately from the candle counters.
const KEY = "list";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const MAX = 1000;
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export default async (req) => {
  const store = getStore({ name: "tributes", consistency: "strong" });

  if (req.method === "GET") {
    const data = (await store.get(KEY, { type: "json" })) || { tributes: [] };
    return json(data);
  }

  if (req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const entry = {
      slug: clip(b.slug, 100),
      name: clip(b.name, 80),
      year: clip(String(b.year ?? ""), 4) || null,
      memory: clip(b.memory, 300),
      by: clip(b.by, 60),
      createdAt: Number.isFinite(b.createdAt) ? b.createdAt : Date.now(),
    };
    entry.id = entry.slug;
    if (!SLUG_RE.test(entry.slug) || !entry.name || !entry.by) return json({ error: "invalid" }, 400);

    for (let attempt = 0; attempt < 8; attempt++) {
      const cur = await store.getWithMetadata(KEY, { type: "json" });
      const data = cur ? cur.data : { tributes: [] };
      const dup = data.tributes.some(
        (t) => t.slug === entry.slug || t.name.toLowerCase() === entry.name.toLowerCase()
      );
      if (dup) return json(data); // already present: idempotent
      if (data.tributes.length >= MAX) return json({ error: "limit" }, 400);
      data.tributes.unshift(entry);
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

export const config = { path: "/api/tributes" };
