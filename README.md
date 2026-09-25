# TikTok Sudoku LIVE - Deployment Ready

> **Before you go live:** open the TikTok app → Live settings → **Comments →
> Filtered**, and turn OFF **Spam filter** and **Potentially unkind words**.
> TikTok's own filters can silently withhold a comment before it ever
> reaches this app - especially many viewers typing similar short guesses
> like `A5 7` in a burst, which looks like spam to TikTok. See CHANGES.md
> for the full explanation.

This folder is the complete, finished app. You do not need to edit any code.
Full version history (what changed and why) lives in `CHANGES.md` - this
file only covers setup and day-to-day use.

Quick reference:
- Build Command: `npm install`
- Start Command: `npm start`
- Render sets the `PORT` environment variable automatically - do not hardcode a port.

## First time: put it online

1. Create a new empty repository on GitHub.
2. Upload everything from this folder to it. Keep the `public` folder as it is.
3. Go to Render.com, click **New +**, then **Web Service**, and pick that repository.
4. Use these settings:
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free is fine
5. Click **Create Web Service**. Render gives you a link like `https://your-game.onrender.com`.

## Run it on your own computer first (recommended)

1. Open a terminal in this folder.
2. Run: `npm install`
3. Run: `npm start`
4. Open http://localhost:3000 in your browser.

To use your TikTok key locally, copy `env.example` to a new file named
`.env` and fill it in. Never upload `.env` - it's already in `.gitignore`.

## TikTok LIVE Sign API Key setup (so you don't retype it every time)

1. On Render.com, open your Web Service.
2. Go to the **Environment** tab.
3. Add a variable named `EULERSTREAM_SIGN_API_KEY` with your key from eulerstream.com.
4. (Optional) Add `TIKTOK_USERNAME` with your TikTok username if you always
   stream from the same account, so it's pre-filled too.
5. Save - Render will redeploy automatically.

Once that's set, the Live Mode panel in Settings will no longer ask for a
Sign API Key at all - just enter your TikTok username and tap Connect.

## Keep scores forever (recommended, free, 2 minutes)

By default, the all-time leaderboard is saved to a file inside the game's
own folder. On Render's **free** plan, Render's own documentation confirms
that file is erased every time the service **sleeps, restarts, or is
redeployed** - which is exactly what a free plan does after ~15 minutes of
no visitors. That's the same limitation the Memory game has too; a local
file on a free plan is never truly permanent no matter which game uses it.

The fix is to add a small, free cloud database that the game talks to over
plain HTTPS. This takes about two minutes and needs no credit card:

1. Go to **https://console.upstash.com** and sign up (free).
2. Click **Create Database**, give it any name, pick any region, and choose
   the **free** plan. Click Create.
3. On the database's page, open the **REST API** tab. You'll see two values:
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
4. On Render, open your Web Service → **Environment** tab, and add both of
   those exact names with the values Upstash showed you. Save - Render
   redeploys automatically.
5. Open Settings → **Score Storage & Backup** in the game. It should now say
   "Cloud storage connected."

With this set, the all-time leaderboard and the round currently on screen
both survive sleeping, restarting, **and brand-new deploys**. Without it,
the game still works fine - it just keeps that one, documented risk on
Render's free plan.

Either way, it's worth downloading a backup (Settings → Score Storage &
Backup → **Download Backup**) after a big stream. Restoring a backup later
never lowers anyone's score - it only raises a viewer's total or adds them
if they're new - so it's a safe insurance policy no matter which storage
option you're using.

## Reset scores

Settings → **Reset Scores** has **Reset This Round** and **Reset All-Time**
(each asks you to confirm first). The trophy Leaderboards window also has a
**Reset scores in this tab** button that resets whichever tab is open.
Resetting the round clears everyone's points for this puzzle only - it
never touches anyone's all-time total. Neither reset can be undone (a
downloaded backup can restore all-time if needed).

## Playing the game

- Viewers type an answer as a coordinate plus a number, e.g. `A5 7` puts a
  **7** in **Row A, Column 5**. Rows are letters A-I, columns are numbers 1-9.
- The always-on scoreboard under the board shows the top 5 for This Round
  and All-Time at all times, in normal view and Full Screen.
- Tap the trophy for the full Leaderboards window (This Round / All-Time tabs).
- Tap **Leaderboard & Activity** under the board for diagnostics (what the
  server last received and how it was read), full leaderboards, and recent
  answers.
- **Host Console** at the bottom lets you type guesses yourself. Tap
  **Hide** to tuck it away, and the floating **Console** button to bring it back.
- Turn on **Auto Next Round** in Settings and a new puzzle starts a few
  seconds after each solve.
- In Settings → Test, turn on **Auto-Solve (Bots)** to watch a full round
  play out on its own.

### Hints and reveals (host only, nobody gets points)

- **Reveal 1 Cell**: fills in one random unsolved cell.
- **Reveal 3×3 Box**: fills in a whole box at once.
- **Reveal Whole Board**: instantly completes the puzzle (asks for
  confirmation first, since it ends the round).

### Save & Apply as Default

Tap **Save & Apply as Default** in Settings once your setup is right. It
remembers theme, mode, difficulty, Auto Next Round (and its delay),
Bot Auto-Solve, and your TikTok username on this device, and re-applies
that snapshot automatically the next time the page loads - but **only** if
nobody has already set this particular server run up (for example, right
after Render wakes from sleep with a restored round already on screen).
Opening the page on a second phone mid-show can never reset an
already-running puzzle or its points. Use **Clear saved default** to forget it.

## Difficulty levels

| Level | Name            | Clues given |
|-------|-----------------|-------------|
| 1     | Very Easy       | 48          |
| 2     | Easy            | 42          |
| 3     | Moderate        | 36          |
| 4     | Hard            | 30          |
| 5     | Very Hard       | 26          |
| 6     | Extreme         | 23          |
| 7     | Extremely Hard  | 20          |

## Keep it awake while you stream

Render's free plan puts the game to sleep after about 15 minutes with no
visitors, which also drops the TikTok connection. Point a free monitor such
as UptimeRobot or cron-job.org at `https://your-game.onrender.com/healthz`
every 5-10 minutes while you stream.

## If something looks wrong

- **A viewer's guess never shows up:** check the TikTok Spam filter setting
  at the top of this page first.
- **The first load is slow:** free Render games go to sleep. Wait about 30 seconds.
- **All-time scores reset unexpectedly:** open Settings → Score Storage &
  Backup and check what it says. If it says cloud storage isn't set up,
  see "Keep scores forever" above - that's the one documented gap on
  Render's free plan. If cloud storage says connected but something still
  looks wrong, restoring your latest downloaded backup will bring points
  back without lowering anyone's total.
- **Run it on your own computer first:** see "Run it on your own computer"
  above.
- **The `_gitignore` file:** if you use git on your computer, rename it to
  `.gitignore`. On the GitHub website you can leave it as it is.
- **Want more changes?** Upload this folder back to Claude and say what you want.

## What's inside this folder

```
project/
  server.js          the whole backend (Sudoku engine, chat parser, storage, TikTok connector)
  package.json
  render.yaml         Render deployment config + cloud/disk setup notes
  env.example         copy to .env for local runs
  .gitignore          (uploaded as "_gitignore" - see above)
  CHANGES.md          full version history
  README.md           this file
  public/
    index.html
    game.js
    style.css
```
