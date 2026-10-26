# The Stash

A video site where anyone can watch without an account. With an account, people can upload, comment, like, follow people, subscribe to channels, build playlists and earn achievements.

**Profiles and channels.** Everyone gets a personal profile, which people *follow*. A channel is a special kind of profile that people *subscribe* to. Members can't make channels themselves: they email support (the "Get a channel" links), and the founding account **@daphuq_** creates the channel or converts their profile using the built-in support tools.

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

**X (Twitter)**
1. In the [X Developer Portal](https://developer.x.com), create a project and app.
2. Under **User authentication settings**, turn on OAuth, set the type to **Web App**, and add the same Supabase callback URL. Set the website URL to `https://thestash.gay`.
3. Copy the keys into Supabase's X/Twitter provider and enable it.
4. `assets/config.js` uses the provider name `twitter`. If your Supabase dashboard lists X under a different provider name, change `X_PROVIDER` to match.

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
   supabase functions deploy import-x
   ```
4. Optional but more reliable: if you have X API access, add your bearer token with `supabase secrets set X_BEARER_TOKEN=your_token`. The function uses the official X API when the token is there. Without it, it falls back to X's public embed data. That works for public posts today, but X can change it without notice.
5. Optional: if you raised the video size limit, run `supabase secrets set MAX_VIDEO_MB=…` to match.

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

## Handling channel requests (founding account)

Requests arrive as emails to `SUPPORT_EMAIL`, already filled in with the member's username.

- **"Turn my profile into a channel":** open their profile while signed in as @daphuq_. In the Support box, click **Turn into a channel**. Their followers become subscribers. **Turn back into a personal profile** reverses it.
- **"I'd like a new channel":** click **Create a channel profile**. It's in the Support box on any profile, or **Support tools** in your account menu. Enter the channel's username and name, and the member who will run it. That member can then edit the channel and choose it under **Post to** when uploading.
- **Change who runs a channel:** on a standalone channel's profile, use **Change who runs it**.

These tools are checked by the database, so only the founding account can use them.

## Customizing

- **Login background:** put your image at `assets/login-bg.jpg`. Then in `assets/app.css`, change `login-bg.svg` to `login-bg.jpg` in the `.login-bg` rule. Use a wide image, at least 1920 px across. A dark overlay is added automatically so the sign-in card stays readable.
- **Video size limit:** the default is 50 MB, which is the per-file limit on Supabase's free plan. To raise it, move to a paid Supabase plan, then update both `MAX_VIDEO_MB` in `assets/config.js` and the `videos` bucket's `file_size_limit` in `schema.sql`. Re-run that `insert into storage.buckets …` statement after changing it.
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
