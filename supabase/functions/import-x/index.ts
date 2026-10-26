// The Stash: import a video from an X (Twitter) post.
// Deploy:  supabase functions deploy import-x
// Optional secret for the official X API:  supabase secrets set X_BEARER_TOKEN=...
//
// Only imports posts written by the X account linked to the signed-in Stash
// account, so people can bring in their own videos but not other people's.

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
function serverKey(): string {
  // Prefer the new secret key; fall back to the legacy service_role key.
  try { const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); if (keys.default) return keys.default; } catch { /* ignore */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const SERVICE_KEY = serverKey();
const X_BEARER = Deno.env.get("X_BEARER_TOKEN") ?? "";
const MAX_MB = Number(Deno.env.get("MAX_VIDEO_MB") ?? "50");
const ALLOWED_ORIGIN = Deno.env.get("SITE_URL") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (status: number, code: string, message: string) => reply(status, { error: { code, message } });

type Found = { author: string; text: string; duration: number; variants: { url: string; bitrate: number }[] };

export function parsePostUrl(raw: string): { user: string; id: string } | null {
  let u: URL;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|mobile|m)\./, "");
  if (!["x.com", "twitter.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com"].includes(host)) return null;
  const m = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/);
  return m ? { user: m[1], id: m[2] } : null;
}

export function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

function cleanText(t: string): string {
  return String(t || "").replace(/https:\/\/t\.co\/\w+/g, "").replace(/\s+/g, " ").trim();
}

async function fromOfficialApi(id: string): Promise<Found | null> {
  const url = `https://api.x.com/2/tweets/${id}?expansions=attachments.media_keys,author_id&media.fields=type,variants,duration_ms&user.fields=username&tweet.fields=text,note_tweet`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${X_BEARER}` } });
  if (!r.ok) return null;
  const j = await r.json();
  const media = (j.includes?.media ?? []).find((m: any) => m.type === "video" || m.type === "animated_gif");
  const author = j.includes?.users?.[0]?.username ?? "";
  if (!j.data) return null;
  return {
    author, text: cleanText(j.data.note_tweet?.text ?? j.data.text),
    duration: Math.round((media?.duration_ms ?? 0) / 1000),
    variants: (media?.variants ?? []).filter((v: any) => v.content_type === "video/mp4").map((v: any) => ({ url: v.url, bitrate: v.bit_rate ?? 0 })),
  };
}

async function fromSyndication(id: string): Promise<Found | null> {
  const r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${syndicationToken(id)}`, { headers: { "User-Agent": "Mozilla/5.0 (TheStash importer)" } });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || !j.user) return null;
  const media = (j.mediaDetails ?? []).find((m: any) => m.type === "video" || m.type === "animated_gif");
  return {
    author: j.user.screen_name ?? "", text: cleanText(j.text),
    duration: Math.round((media?.video_info?.duration_millis ?? 0) / 1000),
    variants: (media?.video_info?.variants ?? []).filter((v: any) => v.content_type === "video/mp4").map((v: any) => ({ url: v.url, bitrate: v.bitrate ?? 0 })),
  };
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return fail(405, "method", "Use POST.");
  if (!SUPABASE_URL || !SERVICE_KEY) return fail(500, "setup", "The import function isn't configured.");

  // who is asking
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return fail(401, "signin", "Sign in to import videos.");
  const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: SERVICE_KEY } });
  if (!ur.ok) return fail(401, "signin", "Your session ended. Sign in again.");
  const user = await ur.json();
  const xIdentity = (user.identities ?? []).find((i: any) => i.provider === "twitter" || i.provider === "x");
  const linked = String(xIdentity?.identity_data?.user_name ?? xIdentity?.identity_data?.preferred_username ?? "").toLowerCase();
  if (!linked) return fail(403, "not_linked", "Connect your X account to import your posts.");

  // which post
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const post = parsePostUrl(body?.url ?? "");
  if (!post) return fail(400, "bad_link", "That isn't a link to an X post. It should look like https://x.com/you/status/123…");

  let found: Found | null = null;
  try { if (X_BEARER) found = await fromOfficialApi(post.id); } catch { found = null; }
  try { if (!found) found = await fromSyndication(post.id); } catch { found = null; }
  if (!found) return fail(404, "not_found", "That post couldn't be found. It may be private, deleted, or age-restricted.");
  if (found.author.toLowerCase() !== linked) return fail(403, "not_yours", `You can only import your own posts. This one is by @${found.author}, and your linked X account is @${linked}.`);
  const variants = found.variants.filter(v => /^https:\/\/video\.twimg\.com\//.test(v.url)).sort((a, b) => b.bitrate - a.bitrate);
  if (!variants.length) return fail(422, "no_video", "That post doesn't have a video.");

  // largest version that fits the limit
  const max = MAX_MB * 1048576;
  let chosen: { url: string; size: number } | null = null;
  for (const v of variants) {
    const h = await fetch(v.url, { method: "HEAD" }).catch(() => null);
    const size = Number(h?.headers.get("content-length") ?? "0");
    if (h?.ok && size > 0 && size <= max) { chosen = { url: v.url, size }; break; }
  }
  if (!chosen) return fail(413, "too_large", `Every version of that video is over the ${MAX_MB} MB limit.`);

  const vr = await fetch(chosen.url);
  if (!vr.ok) return fail(502, "download", "X didn't send the video. Try again in a minute.");
  const bytes = new Uint8Array(await vr.arrayBuffer());
  if (bytes.byteLength > max) return fail(413, "too_large", `That video is over the ${MAX_MB} MB limit.`);

  const path = `${user.id}/x-${post.id}-${crypto.randomUUID().slice(0, 8)}.mp4`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/videos/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "video/mp4", "x-upsert": "false" },
    body: bytes,
  });
  if (!up.ok) return fail(502, "storage", "The video couldn't be saved. Try again.");

  return reply(200, { path, title: found.text.slice(0, 100), description: found.text, duration: found.duration, author: found.author, size: bytes.byteLength });
}

if (typeof Deno !== "undefined" && (Deno as any).serve) (Deno as any).serve(handle);
