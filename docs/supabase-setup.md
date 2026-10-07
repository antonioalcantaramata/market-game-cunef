# Connecting the game to Supabase

Step-by-step guide to give the published game its database, so that the panel, the projector and the students' phones work.

- **Time:** about 20 minutes.
- **Cost:** free (Supabase Free plan, GitHub Pages).
- **You need:** access to the GitHub repository [antonioalcantaramata/market-game-cunef](https://github.com/antonioalcantaramata/market-game-cunef).

The site is already published at **https://antonioalcantaramata.github.io/market-game-cunef/**. Right now it shows *"The app is not connected to a database"*. That message disappears when you finish step 6.

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **Start your project** and sign in. Signing in with GitHub is the quickest.
2. **New project**:
   - **Organization:** your personal one (create it if asked; choose the **Free** plan).
   - **Project name:** `market-game-cunef`.
   - **Database password:** click *Generate* and save it somewhere safe. The game never uses it, but you may need it for database maintenance.
   - **Region:** an EU region, e.g. *West EU (Ireland)* or *Central EU (Frankfurt)*.
   - If you are offered security options such as automatic RLS or exposing new tables, leave the defaults. The SQL in step 2 sets the permissions explicitly.
3. **Create new project** and wait 1–2 minutes until the dashboard says the project is ready.

## 2. Create the tables and the game logic

1. In the left menu open **SQL Editor** → **New query**.
2. Copy the **whole** file [`supabase/schema.sql`](https://raw.githubusercontent.com/antonioalcantaramata/market-game-cunef/main/supabase/schema.sql). That link opens the raw text: select all and copy.
3. Paste it into the editor and click **Run**.
   - If Supabase warns that the query has *destructive operations*, confirm with **Run this query**. Those are only the lines that clean up older versions; they do nothing on a new project.
   - Expected result: **"Success. No rows returned"**.

This file is safe to run again at any time, for example after an update to the game. It replaces the functions and keeps all the data.

## 3. Set the instructor password

In the same SQL Editor, in a new query, run (with your own password, at least 4 characters):

```sql
select set_admin_password('choose-a-password');
```

- This is the password for the game's **Instructor panel**. It is not the database password from step 1.
- Running it again with another password changes it and logs out every open panel.
- It can only be set from here; nobody can change it from the website.

## 4. Copy the project URL and the public key

In **Project Settings** (gear icon) → **API Keys**, or the **Connect** button at the top of the dashboard:

| What                      | Where it looks like                                                                                     | You will paste it as  |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------- |
| **Project URL**     | `https://abcdefghijklmnop.supabase.co`                                                                | `SUPABASE_URL`      |
| **Publishable key** | `sb_publishable_…`. On older projects use the **anon public** key, which starts with `eyJ…` | `SUPABASE_ANON_KEY` |

Both are **public by design**: they end up in the website's code, and that is fine. The SQL from step 2 only lets the browser call the game's functions.

> ⚠️ Never use the **secret** / **service_role** key. It bypasses every protection.

Also check **Project Settings → Data API**: the Data API must be **enabled**, with `public` among the *exposed schemas*. That is the default.

## 5. Optional: test the database from the terminal

Replace the URL and the key, then run:

```bash
URL=https://abcdefghijklmnop.supabase.co
KEY=sb_publishable_xxxxxxxx   # or the eyJ… anon key

# Public function used by the projector: should print []
curl -s -X POST "$URL/rest/v1/rpc/screen_sessions" -H "apikey: $KEY" -H "Content-Type: application/json" -d '{}'

# Instructor login: should print {"token": "…"}
curl -s -X POST "$URL/rest/v1/rpc/admin_login" -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d '{"p_password":"choose-a-password"}'
```

If you see an error instead, check the troubleshooting table at the end.

## 6. Give the two values to GitHub and republish

1. In the repository on GitHub: **Settings → Secrets and variables → Actions**.
2. Open the **Variables** tab (not *Secrets*) → **New repository variable**, twice:

   - Name `SUPABASE_URL`, value: the Project URL.
   - Name `SUPABASE_ANON_KEY`, value: the publishable (or anon) key.

   The names must be exactly these, in capitals.
3. Republish: **Actions** tab → **Deploy to GitHub Pages** → **Run workflow** (button on the right) → **Run workflow**. Re-running the last run also works.
4. Wait about 2 minutes until the run shows a green tick.

The values are copied into the site when it is built. If you ever change them, run the workflow again.

## 7. Check that everything works

Open **https://antonioalcantaramata.github.io/market-game-cunef/**:

1. **Instructor panel** (link at the bottom) → your password → create a session, e.g. 4 teams.
2. In another window: **Projector screen** → choose the session → it shows the QR code.
3. On a **real phone** (Wi-Fi or mobile data), scan the QR code, or open the site and type a team code from the panel. The team should appear as *joined* on the projector.
4. In the panel, **Open** the practice round, send a price from the phone, then **Close & clear market**. The results should appear on the phone and the projector.

If all this works, everything is connected. You can delete this test session's data by simply ignoring it: the projector lists sessions newest first.

## 8. Optional: load the demo game into Supabase

To have a full game to show without students (the same one you saw locally), run from the `market-game` folder on your Mac:

```bash
SUPABASE_URL=https://abcdefghijklmnop.supabase.co \
SUPABASE_ANON_KEY=sb_publishable_xxxxxxxx \
ADMIN_PASSWORD=choose-a-password \
node scripts/seed-demo.mjs
```

It creates «Demo · full game» and «Demo · after Part 1» and prints their links (add `https://antonioalcantaramata.github.io/market-game-cunef` in front). To download all the CSV files of any session at once:

```bash
SUPABASE_URL=… SUPABASE_ANON_KEY=… ADMIN_PASSWORD=… \
node scripts/export-session.mjs <session-id> <folder>
```

---

## Troubleshooting

| What you see                                                    | Cause                                                                         | Fix                                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| *"The app is not connected to a database"*                    | The GitHub variables are missing or the site was not rebuilt                  | Step 6: check both names, then**Run workflow** again                                |
| *"Could not find the function public.… in the schema cache"* | `schema.sql` was not run, or Supabase has not noticed the new functions yet | Run step 2 again. If it persists, run`notify pgrst, 'reload schema';` in the SQL Editor |
| *"permission denied for function …"*                         | The last part of`schema.sql` (the permissions) did not run                  | Run the**whole** file again (step 2)                                                |
| *"No instructor password yet"*                                | Step 3 is missing                                                             | Run`select set_admin_password('…');`                                                   |
| *"Wrong password"*                                            | Wrong panel password                                                          | Set a new one with step 3                                                                 |
| *"Invalid API key"* or a 401 error                            | Wrong key in`SUPABASE_ANON_KEY` (a secret key, an old key, a typo)          | Copy the publishable/anon key again (step 4), then step 6                                 |
| The site is a GitHub 404 page                                   | Pages is not set to*GitHub Actions*, or the deploy failed                   | **Settings → Pages → Source: GitHub Actions**, then run the workflow              |
| Everything stopped working after some days                      | Supabase**pauses free projects after about a week without activity**    | Open the Supabase dashboard and click**Restore project**; it takes a few minutes    |
| Supabase's*Security Advisor* lists warnings about functions   | Informational notes about internal helper functions                           | They can be ignored: the tables are closed and only the game's functions are callable     |
