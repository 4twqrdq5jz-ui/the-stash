# The Stash

A gay adult video site for adults 18+. Anyone 18 or older can watch without an account. With an account, people can upload, comment, like, follow people, subscribe to channels, build playlists and earn achievements.

**Profiles, channels and models.**
- Everyone gets a personal profile, which people *follow*.
- Channels are profiles people *subscribe* to. Only the founding account **@daphuq_** can create them, from the **Admin** page.
- Members can apply to be **models** from the Model tab on their profile. They send their legal name, date of birth, a photo of their ID and a selfie holding it. You review each one on the Admin page.
- Only verified models (and the founding account) can upload.
- Every upload needs a declaration that everyone in it was 18+ when filmed, consented to filming and publishing, and is tagged.
- A video stays private until every tagged model approves. Models can remove themselves at any time.

Sign-in options are email and password (with a weak/fair/strong meter and confirm field), Google, and X.

## What's in this folder

| Path | What it is |
| --- | --- |
| `index.html` | Home page with the newest videos |
| `login/` | The full-page sign-in and sign-up screen at **thestash.gay/login** |
| `watch/` | The video player page (`/watch/?v=…`) |
| `upload/` | The upload page |
| `profile/` (people and channels), `library/`, `subscriptions/`, `playlist/`, `search/` | The other pages |
| `assets/config.js` | **The only file you need to edit**: your Supabase keys |
| `assets/login-bg.svg` | The login page background. Swap in your own image (see below) |
| `supabase/schema.sql` | Database tables, security rules, storage buckets and support tools |
| `supabase/functions/import-x/` | The server function that imports videos from X posts |
| `supabase/reset.sql` | Only if you ran an older version: wipes the old tables so the new schema can install |

The site is plain HTML, CSS and JavaScript with no build step. Supabase (free tier is fine to start) stores the accounts, data and videos.

---

## 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project. Save the database password somewhere safe.
2. Open `supabase/schema.sql` in a text editor. Near the top, replace `YOUR_EMAIL@example.com` with the email you'll sign up with as **@daphuq_**. Only an account with that email can take the username daphuq_.
3. In Supabase, open **SQL Editor**, then **New query**. Paste in all of `schema.sql` and click **Run**. You should see "Success". If you ran an older version of The Stash before, run `reset.sql` first.
4. Click **Connect** at the top of your project, or open **Settings**, then **API Keys**. Copy the **Project URL** and the **Publishable key** (starts with `sb_publishable_`) into `assets/config.js`. If there's no publishable key yet, click **Create new API keys** first. Never paste a secret key there. Also set `SUPPORT_EMAIL` there to the inbox where channel requests should go.
5. Once the site is live, sign up with your founder email and pick the username `daphuq_`. Your profile gets the Founder badge and the support tools.

## 2. Set up sign-in

Open **Authentication** in Supabase.

**URL Configuration**
- **Site URL:** `https://thestash.gay`
- **Redirect URLs:** add `https://thestash.gay/**`. While testing on your computer, also add `http://localhost:8000/**`.

**Email** (on by default)
- Under **Providers**, open **Email**. Leave **Confirm email** on so people verify their address.
- Supabase's built-in email sender is limited to a few emails per hour. Before launch, add your own email service under **Project Settings**, then **Authentication**, then **SMTP Settings**. Resend, Postmark and SendGrid all work.
- Optional: in **Providers**, then **Email**, set the minimum password length to 8 to match the site's meter.

**Google**
1. In [Google Cloud Console](https://console.cloud.google.com), create a project. Go to **APIs & Services**, then **OAuth consent screen**, and fill it in.
2. Go to **Credentials**, then **Create credentials**, then **OAuth client ID**, and choose **Web application**.
3. Under **Authorized redirect URIs**, add the callback URL shown on Supabase's Google provider page. It looks like `https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback`.
4. Paste the client ID and secret into Supabase under **Providers**, then **Google**, and enable it.

**X**
1. In the [X Developer Portal](https://developer.x.com), create a project and app.
2. Under **User authentication settings**, turn on **OAuth 2.0**, set the type to **Web App**, and turn on **Request email from users**. Add the callback URL shown on Supabase's **X / Twitter (OAuth 2.0)** provider page, and set the website URL to `https://thestash.gay`.
3. Copy the **Client ID** and **Client Secret** from **Keys and tokens** into Supabase under **X / Twitter (OAuth 2.0)**, and turn it on. Use the OAuth 2.0 provider, not the older "Twitter (OAuth 1.0a)" one.
4. `assets/config.js` already uses the matching provider name, `x`.

Until Google or X is switched on, those buttons show "sign-in isn't switched on yet" instead of failing silently.

Google and X both publish official sign-in button artwork and branding rules. The buttons here use plain lettered marks, so you can swap in their official assets if you'd like.

## 3. Turn on importing from X (optional)

People can paste a link to one of their own X posts on the upload page and the video comes straight in. The browser can't download from X by itself, so a small Supabase Edge Function in `supabase/functions/import-x` does it.

It only imports posts written by the X account linked to the person's Stash account, so people can't re-post other people's videos.

1. Finish the **X (Twitter)** sign-in setup in step 2 above.
2. In Supabase, go to **Authentication**, then **Sign In / Providers**, and turn on **Allow manual linking**. This lets people who signed up with email connect their X account from the upload page.
3. Install the [Supabase CLI](https://supabase.com/docs/guides/cli). Then, from this folder, run:
   ```
   supabase login
   supabase link --project-ref YOUR_PROJECT_ID
   supabase functions deploy import-x --no-verify-jwt
   ```
   The `--no-verify-jwt` part matters. Supabase's built-in login check rejects the browser's CORS preflight request, so imports fail with "blocked by CORS policy". The function checks who's signed in itself. `supabase/config.toml` also sets this, so later deploys keep it off.

   No CLI? In the Supabase dashboard, open **Edge Functions**, then **Deploy a new function**, then **Via Editor**. Name it `import-x`, paste in the contents of `supabase/functions/import-x/index.ts`, and deploy. Then open the function's **Details** or settings and turn off **Verify JWT**.
4. Optional but recommended: add an X API key if you have X API access. The function uses the official X API when the token is present and falls back to X's public embed data otherwise. That fallback works for public posts today, but X can change it without notice, and it leaves out age-restricted posts. For adult or sensitive posts, a bearer token is effectively required because imports fail with "can't be imported yet" without it. To add one:
   1. In the [X Developer Console](https://console.x.com), open the app you made for X sign-in.
   2. Add credits. X now charges pay-per-use: reading a post costs about $0.005, so $5 covers roughly 1,000 imports.
   3. Under **Keys and tokens**, generate a **Bearer Token** and copy it.
   4. Save it as a secret on the function with `supabase secrets set X_BEARER_TOKEN=paste_token_here`, or in the dashboard under **Edge Functions**, then **Secrets**, as a new secret named `X_BEARER_TOKEN`.

   No redeploy is needed after adding a secret.
5. Optional: X imports are capped at 512 MB. To change that, run `supabase secrets set MAX_X_IMPORT_MB=…` and set the same number as `MAX_X_IMPORT_MB` in `assets/config.js`.

## 4. Try it on your computer

Pages link with paths like `/assets/...`, so serve the folder rather than double-clicking the files. From inside this folder, run:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## 5. Put it online at thestash.gay

Any static host works. Netlify, Vercel and Cloudflare Pages are all free to start. With Netlify, for example:

1. Drag this whole folder onto [app.netlify.com/drop](https://app.netlify.com/drop).
2. In **Domain management**, add `thestash.gay` and follow the DNS instructions at your domain registrar.

`thestash.gay/login`, `/upload`, `/watch` and `/profile` work because each one is a folder with its own `index.html`. `404.html` handles broken links.

---

## The Admin page (founding account)

Sign in as @daphuq_ and open **Admin** in the sidebar or account menu.

- **Model applications:** view each applicant's ID and selfie through private links that expire after 5 minutes. Approve only if the ID is genuine, shows they're 18 or older, and matches the selfie. If you reject, the applicant sees your reason.
- **Reports:** anyone can report a video, even without an account. Reports about minors or non-consent are listed first. You can delete the video from here, or mark the report resolved.
- **Categories:** add, rename or remove categories. They also have an **Add category** button on the Categories page.
- **Channels:** create a channel. You run it unless you enter a member's username. On a profile, the Admin box can also turn a profile into a channel and back, or change who runs a channel.
- **Models:** see every verified model and remove model status.

The database itself checks all of these, so only the founding account can use them.

## Running an adult site: before you launch

These aren't legal advice, but they're the things that most often shut adult sites down.

- **Hosting:** Netlify allows legal adult content. Supabase's acceptable use policy bans "obscene" or "objectionable" content and lets it suspend accounts it considers a risk. Email Supabase and get written confirmation before you launch. If they say no, keep the code and move video storage to an adult-friendly host.
- **Viewer age checks:** a click-through "I'm 18" screen isn't enough everywhere. A growing number of US states, the UK (Online Safety Act) and parts of the EU require real age verification, such as an ID check or face age estimation. Use an age-verification provider for those regions, or block them.
- **Performer records:** in the US, 18 U.S.C. § 2257 requires age and identity records for everyone in sexually explicit content, kept by a named custodian. The model applications here collect ID and a selfie, but have a lawyer confirm your record keeping meets the rules.
- **Payments:** if you ever charge, most mainstream processors won't handle adult sites. Adult-specialist processors do, and they have their own verification and moderation rules.
- **Takedowns:** respond fast to reports about minors or non-consent. Remove first, then investigate. In the US, child sexual abuse material must be reported to NCMEC's CyberTipline.

## Customizing

- **Login background:** put your image at `assets/login-bg.jpg`. Then in `assets/app.css`, change `login-bg.svg` to `login-bg.jpg` in the `.login-bg` rule. Use a wide image, at least 1920 px across. A dark overlay is added automatically so the sign-in card stays readable.
- **Video size limit (1 GB):** the site and the `videos` bucket allow uploads up to 1 GB. Supabase's free plan caps every file at 50 MB, so for bigger videos:
  1. Upgrade to **Pro**.
  2. In **Settings**, then **Storage**, raise the **Upload file size limit** to 1 GB.

  Large files upload in 6 MB pieces and pick up where they left off if the connection drops.
- **Video types:** any video file can be uploaded: MP4, MOV, MKV, AVI, WebM, WMV and more. Browsers can only play some formats, though. MP4 (H.264) plays everywhere, MOV usually works, and MKV, AVI and WMV often don't. The upload page warns the uploader when their browser can't play a file.
- **Quality options:** the player's settings menu lists every quality a video has. Uploads come in as one quality. To offer 1080p, 720p and 480p versions you need a transcoding service such as Mux or Cloudflare Stream, or a server running ffmpeg. Store the extra files in the `videos` bucket and list them in the video's `sources` column, like `[{"label":"720p","path":"…"}]`, and they'll appear in the menu.
- **Adult mode** is on (`ADULT_CONTENT: true` in `assets/config.js`). It adds:
  - an 18+ entry screen
  - an 18+ box on sign-up
  - an RTA label that parental-control filters recognize
  - an adults-only notice in the footer
  - a 2257 statement page at `/2257/`. Fill in `RECORDS_CUSTODIAN` and `RECORDS_ADDRESS` in `assets/config.js` for it.
- **Banners:** people can pick one of 8 built-in banners or upload their own. The built-in ones are drawn in `assets/core.js` (search for `BANNERS`), so you can add or change designs there.
- **Thumbnails:** when someone picks a video, a frame from a random moment is chosen and kept as the thumbnail. They can pick another random moment or upload their own image.
- **Player:** the video page uses The Stash's own player. Keyboard shortcuts:

  | Key | Action |
  | --- | --- |
  | Space or K | Play or pause |
  | J / L | Back or forward 10 seconds |
  | ← / → | Back or forward 5 seconds |
  | M | Mute |
  | F | Full screen |
  | 0–9 | Jump to 0% through 90% |

  The speed menu goes from 0.25× to 2×, and volume and mute are remembered between visits.
- **Recommended and autoplay:** the column next to the player favors the same creator, accounts you follow or subscribe to, similar titles, popular videos and newer uploads. With Autoplay on, the next recommendation starts after a 5-second countdown, which you can cancel. Playlists always play in order.
- **Anniversaries:** profiles show when someone joined. On the anniversary of that date, the profile shows a celebration banner and a "🎂 1 year" badge next to their name everywhere. The person also gets a dismissible note on the home page. Achievements unlock at 1, 2 and 5 years.
- **Video formats:** MP4 and WebM. MP4 (H.264) plays in every browser.

## How data is kept safe

- Everyone can read public content, so watching never needs an account.
- Only the founding account can make or convert channels, and nobody can give themselves the Founder badge.
- People can only create, change or delete their own profile, the channels they run, their videos, likes, follows, subscriptions and playlists. They can only upload into their own storage folder.
- Comments can be deleted by their author or by the owner of the video they're on.
- These rules are enforced by the database itself (row level security in `schema.sql`), not just by the website.
- Passwords are handled entirely by Supabase Auth and never touch your pages.

## Things to know

- People can sign in with their **email or username** plus password. A username sign-in is checked inside the database, which only hands back the account's email when the password is right, so emails are never exposed. After 8 wrong passwords for one username, username sign-in for it pauses for 15 minutes; email sign-in still works. Password reset links always go by email. Already ran `schema.sql`? Run it again to add username sign-in. It's safe to re-run.
- Usernames must be 3 to 24 characters using lowercase letters, numbers, `_` and `.`. They're unique regardless of case. People who sign in with Google or X pick a username on their first visit.
- Deleting a video also removes its comments, likes and playlist entries.
