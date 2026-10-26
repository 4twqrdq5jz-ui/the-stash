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
  SUPABASE_URL: "https://YOUR_PROJECT_ID.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_PUBLISHABLE_KEY", // the publishable (or legacy anon) key

  // Supabase's provider name for X/Twitter sign-in. Use "twitter" unless your
  // Supabase dashboard lists X under a different provider name (for example "x").
  X_PROVIDER: "twitter",

  // Where people email to get a channel. Shown on "Get a channel" buttons.
  SUPPORT_EMAIL: "support@thestash.gay",

  // Largest video someone can upload, in MB. Keep this at or below the
  // "videos" bucket limit set in schema.sql and your Supabase plan's upload limit.
  MAX_VIDEO_MB: 50
};
