/*
  The Stash: site settings.
  1. In Supabase, click Connect at the top of your project (or open
     Settings > API Keys).
  2. Paste your Project URL and your Publishable key (starts with
     sb_publishable_) below. An older "anon" key also works until Supabase
     retires those keys at the end of 2026.
  The publishable key is meant to be public; your database rules
  (supabase/schema.sql) are what keep accounts and data safe.
  Never put a secret key (sb_secret_...) or service_role key here.
*/
window.STASH_CONFIG = {
  SUPABASE_URL: "https://xetgnwljpvzbuntvtyxz.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_ZgH3Eno0zNTIjgxXF4eKiQ_nVpzHAa0", // the publishable (or legacy anon) key

  // Supabase's provider name for X sign-in. "x" matches the "X / Twitter (OAuth 2.0)"
  // provider. Only use "twitter" if you turned on the older "Twitter (OAuth 1.0a)" one.
  X_PROVIDER: "x",

  // Where people email for help. Shown in the site footer.
  SUPPORT_EMAIL: "southofsomewhere@icloud.com",

  // Largest video someone can upload to Cloudflare Stream, in MB.
  MAX_VIDEO_MB: 1024,
  // Maximum duration reserved when a video cannot be measured by the upload browser.
  // This must not exceed MAX_STREAM_DURATION_SECONDS on the stream-upload function.
  MAX_STREAM_DURATION_SECONDS: 3600,
  // The code only from your Cloudflare Stream HLS URL (without customer- or the domain).
  STREAM_CUSTOMER_CODE: "dy0ubenn9wvkbxll",

  // Largest video the "From X" importer will bring in, in MB. Keep it matching the
  // MAX_X_IMPORT_MB secret on the import-x function (512 if you haven't set one).
  MAX_X_IMPORT_MB: 512,

  // The Stash is an adult site: visitors must confirm they're 18+ before seeing anything.
  ADULT_CONTENT: true,

  // Shown on the /2257/ records page. Fill these in with your real details before launch
  // (have a lawyer check them).
  RECORDS_CUSTODIAN: "",        // e.g. "Jane Doe, Custodian of Records"
  RECORDS_ADDRESS: ""           // e.g. "123 Example St, Suite 4, City, ST 00000, USA"
};
