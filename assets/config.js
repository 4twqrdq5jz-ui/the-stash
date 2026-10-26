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

  // Largest video someone can upload, in MB (1024 = 1 GB). Files over 50 MB need
  // Supabase's Pro plan, with the project's upload limit raised to match
  // (Settings > Storage). Keep this at or below the "videos" bucket limit in schema.sql.
  MAX_VIDEO_MB: 5000000,

  // The Stash is an adult site: visitors must confirm they're 18+ before seeing anything.
  ADULT_CONTENT: true,

  // Shown on the /2257/ records page. Fill these in with your real details before launch
  // (have a lawyer check them).
  RECORDS_CUSTODIAN: "",        // e.g. "Jane Doe, Custodian of Records"
  RECORDS_ADDRESS: ""           // e.g. "123 Example St, Suite 4, City, ST 00000, USA"
};
