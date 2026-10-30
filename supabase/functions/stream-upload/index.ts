// Proxies the TUS creation request so the Cloudflare API token never reaches the browser.
// Deploy with Supabase JWT verification disabled; this function validates the user itself.
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CLOUDFLARE_ACCOUNT_ID = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? "";
const CLOUDFLARE_STREAM_TOKEN = Deno.env.get("CLOUDFLARE_STREAM_TOKEN") ?? "";
const SITE_URL = Deno.env.get("SITE_URL") ?? "*";
const MAX_UPLOAD_MB = Number(Deno.env.get("MAX_VIDEO_MB") ?? "1024");
const MAX_DURATION_SECONDS = Number(Deno.env.get("MAX_STREAM_DURATION_SECONDS") ?? "3600");

const cors = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, tus-resumable, upload-length, upload-metadata",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "Location, stream-media-id, Tus-Resumable",
};
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { ...cors, ...(body == null ? {} : { "Content-Type": "application/json" }), ...headers },
  });
const fail = (status: number, code: string, message: string) =>
  reply(status, { error: { code, message } });

function decodeMetadata(header: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const pair of header.split(",")) {
    const [key, encoded = ""] = pair.trim().split(/\s+/, 2);
    if (key) values.set(key, encoded ? atob(encoded) : "");
  }
  return values;
}

async function profileRows(jwt: string, query: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?${query}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) throw new Error("Could not verify your upload permissions.");
  return await response.json();
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return reply(204, null);
  if (req.method !== "POST" && req.method !== "DELETE") return fail(405, "method", "Use POST or DELETE.");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_STREAM_TOKEN) {
    return fail(500, "setup", "Cloudflare Stream uploads are not configured.");
  }

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return fail(401, "signin", "Sign in to upload a video.");
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!userResponse.ok) return fail(401, "signin", "Your session ended. Sign in again.");
  const user = await userResponse.json();
  const userId = String(user.id ?? "");

  if (req.method === "DELETE") {
    let uid = "";
    try { uid = String((await req.json()).uid ?? ""); } catch { /* Invalid request below. */ }
    if (!/^[0-9a-f]{32}$/i.test(uid)) return fail(400, "uid", "The video identifier is invalid.");
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CLOUDFLARE_ACCOUNT_ID)}/stream/${uid}`;
    const details = await fetch(url, { headers: { Authorization: `Bearer ${CLOUDFLARE_STREAM_TOKEN}` } });
    if (!details.ok) return fail(502, "cloudflare", "Cloudflare could not verify the video for deletion.");
    const video = await details.json();
    if (video.result?.meta?.creatorId !== userId) return fail(403, "owner", "You can only delete videos you uploaded.");
    const removed = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${CLOUDFLARE_STREAM_TOKEN}` } });
    if (!removed.ok) return fail(502, "cloudflare", "Cloudflare could not delete the video. Try again.");
    return reply(200, { ok: true });
  }

  const uploadLength = Number(req.headers.get("Upload-Length"));
  if (!Number.isSafeInteger(uploadLength) || uploadLength <= 0 || uploadLength > MAX_UPLOAD_MB * 1048576) {
    return fail(413, "size", "That video is larger than the upload limit.");
  }
  let metadata: Map<string, string>;
  try { metadata = decodeMetadata(req.headers.get("Upload-Metadata") ?? ""); }
  catch { return fail(400, "metadata", "The upload metadata is invalid."); }
  const ownerId = metadata.get("ownerId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(ownerId)) return fail(400, "owner", "Choose a profile to post this video to.");

  let profiles: Record<string, unknown>[], owners: Record<string, unknown>[];
  try {
    profiles = await profileRows(jwt, `user_id=eq.${encodeURIComponent(userId)}&select=id,is_model,is_founder`);
    owners = await profileRows(jwt, `id=eq.${encodeURIComponent(ownerId)}&manager_id=eq.${encodeURIComponent(userId)}&select=id`);
  } catch (e) {
    return fail(503, "permissions", e instanceof Error ? e.message : "Could not verify your upload permissions.");
  }
  const profile = profiles[0];
  if (!profile || !(profile.is_model || profile.is_founder)) return fail(403, "permission", "Only verified models and the founder can upload.");
  if (!owners.length) return fail(403, "owner", "You can only post to a profile or channel you manage.");

  const suppliedDuration = Number(metadata.get("maxDurationSeconds"));
  if (Number.isFinite(suppliedDuration) && suppliedDuration > MAX_DURATION_SECONDS) {
    return fail(413, "duration", `Videos must be no longer than ${MAX_DURATION_SECONDS} seconds.`);
  }
  const maxDuration = Number.isFinite(suppliedDuration) && suppliedDuration > 0
    ? Math.min(MAX_DURATION_SECONDS, Math.ceil(suppliedDuration))
    : MAX_DURATION_SECONDS;
  metadata.set("maxDurationSeconds", String(maxDuration));
  metadata.set("creatorId", userId);
  const uploadMetadata = [...metadata].map(([key, value]) => `${key} ${btoa(value)}`).join(",");

  const cloudflareResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CLOUDFLARE_ACCOUNT_ID)}/stream?direct_user=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_STREAM_TOKEN}`,
        "Tus-Resumable": req.headers.get("Tus-Resumable") ?? "1.0.0",
        "Upload-Length": String(uploadLength),
        "Upload-Metadata": uploadMetadata,
      },
    },
  );
  if (!cloudflareResponse.ok) {
    const detail = (await cloudflareResponse.text()).slice(0, 500);
    console.error("Cloudflare Stream upload URL request failed", cloudflareResponse.status, detail);
    return fail(502, "cloudflare", "Cloudflare could not start this video upload. Try again.");
  }
  const location = cloudflareResponse.headers.get("Location");
  if (!location) return fail(502, "cloudflare", "Cloudflare did not return an upload destination.");
  return reply(cloudflareResponse.status, null, {
    Location: location,
    "Tus-Resumable": cloudflareResponse.headers.get("Tus-Resumable") ?? "1.0.0",
    "stream-media-id": cloudflareResponse.headers.get("stream-media-id") ?? "",
  });
}

if (import.meta.main) Deno.serve(handle);
