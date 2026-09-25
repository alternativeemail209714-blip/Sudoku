# v3.1.0 — real TikTok profile photos now load reliably, everywhere they're shown

## The bug

Every place a viewer's picture appears - the live guess toast, the round
leaderboard, the all-time leaderboard, the always-on scoreboard under the
board, and the round-end popups - already drew a real circle (CSS
`border-radius: 50%`) and already preferred the real TikTok photo URL the
connector reports for that viewer, generated colored initials only as a
fallback. So on paper this was already correct. The actual failure was one
level below that: the `<img>` tag was pointed straight at TikTok's own
photo CDN (`p16-sign.tiktokcdn-us.com` and similar hosts), and that CDN is
hotlink-protected - it can refuse a request that shows up with a browser
`Referer` header pointing at a different site, which is exactly what an
`<img src="https://p16-sign...">` on this app's own page sends. When the
CDN refuses, the request fails silently, `<img>`'s `error` event fires, and
the code correctly falls back to the generated initials circle - just for
*every single viewer*, all the time, because the real photo request was
never actually succeeding in the first place. From the host's chair that
looks exactly like "it's showing the wrong/generic image instead of their
real TikTok picture."

## The fix

Real TikTok photo URLs are no longer requested directly by the browser.
`server.js` now exposes `/avatar?u=<the real photo URL>`, which fetches the
photo server-to-server (no cross-site `Referer` for TikTok's CDN to object
to), verifies it's actually an image, caches it in memory for 6 hours so
repeat guesses from the same viewer are instant, and re-serves it from this
app's own origin. `game.js`'s single shared `makeAvatarImg()` - already
used by every leaderboard, the toast, the scoreboard, and the round-end
popups - now points at that proxy instead of the raw CDN URL, so the fix
applies everywhere a photo is shown at once. The proxy only ever accepts
TikTok/ByteDance's own CDN hosts (an allow-list, not an open proxy), and
any failure - CDN outage, expired signed URL, timeout - still falls back to
the generated initials circle exactly as before, so there's never a broken-
image icon either way.

---

# v3.0.0 — real leaderboard persistence, restored across everything (Render free-plan safe), plus what the Memory game already had

## What "keep points like the Memory game" actually required

The Memory game and this Sudoku game both saved `allTimeScores` to a local
JSON file (`./data/alltime-scores.json`) and both documented the same honest
caveat: Render's own docs confirm a **free** web service has an **ephemeral
filesystem** — anything written to local disk is erased on every redeploy,
restart, **or spin-down** (the free plan sleeps after ~15 idle minutes).
That means the "fix" both games shipped only ever protected against one
narrow case (a clean sleep→wake with the same on-disk state intact) and
never against the case hosts actually run into: waking up after Render
wiped the disk. Neither game could keep points "like the other one" because
neither actually solved persistence — they solved persistence *only until
the free plan did what its own documentation says it does*.

This build fixes that properly, then carries over the other Memory-game
features that make sense for Sudoku.

## 1. Real persistence: cloud storage (free), with the local file kept as a second copy

- New, optional: point the game at a free cloud key-value store (Upstash
  Redis's free plan, reached over plain HTTPS — no new library, just two
  environment variables: `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN`). See **README.md → "Keep scores forever"** for
  the two-minute setup. With this set, the all-time leaderboard and the
  round in progress survive sleep, restart, **and a brand-new deploy** —
  the one case the old file-only approach could never cover on the free
  plan.
- Without it, the game still works exactly as before: scores go to
  `./data/*.json` (or `DATA_DIR` on a paid Persistent Disk), which is fine
  on your own computer or a paid plan, but is erased by Render's free plan
  under the conditions above. Settings now says which of these two states
  you're in, in plain words, instead of leaving it to find out the hard way.
- If the cloud is configured but unreachable the moment the server starts,
  the game **never overwrites the cloud copy with an empty table** — cloud
  saving pauses, the local copy keeps working, and once the cloud answers
  again, anything earned in the meantime is merged in on top of whatever
  was already there (never counted twice, never below what was already
  saved).
- Every save (local file and cloud) is atomic — written to a temp file
  and renamed into place, with a `.bak` copy kept — so a crash mid-write
  can never corrupt the scores file. A damaged file falls back to its
  backup automatically; a genuinely unreadable file starts fresh rather
  than crashing the server.

## 2. The round in progress is now saved too, not just all-time totals

Previously, only `allTimeScores` was ever saved — a mid-puzzle sleep/restart
lost the puzzle on screen, who had filled in what, and everyone's **this
round** points, even though all-time was fine. Now the puzzle, the filled
cells, this round's scores, and the game's settings (mode, difficulty, Auto
Next Round) are saved right alongside all-time, and restored together on
the next boot — the stopwatch even picks up from the real elapsed time
rather than counting the downtime. A saved round is only restored if it
passes a full sanity check against Sudoku's own rules (every given cell
matches the puzzle, every filled cell matches the real solution, nothing
contradicts anything); anything that doesn't check out is discarded in
favor of a fresh puzzle rather than risking a corrupted board.

## 3. Saves happen when it actually matters, not just "eventually"

- The moment a puzzle is **solved**, both tables are written immediately —
  no debounce window where a crash right after the winning guess could lose
  it.
- A steady stream of correct guesses (a fast audience, or Auto-Solve bots)
  no longer gets starved by the save timer resetting on every guess — saves
  now happen on a fixed cadence no matter how busy chat is.
- `SIGTERM` (a normal Render redeploy) now actually **saves and exits**
  instead of only registering a handler that saved but never allowed the
  process to end — the previous version could leave an old process
  lingering instead of shutting down cleanly.

## 4. Reset This Round / Reset All-Time (new, from the Memory game)

Settings has a new **Reset Scores** box, and the Leaderboards window (the
trophy button) has a matching **Reset scores in this tab** button that
resets whichever tab is open. Both ask for confirmation first and can't be
undone. Resetting "This Round" only clears the current puzzle's scores —
nobody's all-time total is touched. Resetting "All-Time" clears the saved
table everywhere (memory, disk, and cloud).

## 5. Always-on scoreboard under the board (new, from the Memory game)

A small "This Round" / "All-Time" top-5 scoreboard now sits directly under
the grid, in both normal view and Full Screen. It's part of the game
screen itself, not the collapsible Leaderboard & Activity panel, so there's
always a live, unmissable confirmation that points are being counted —
with nothing to open, no toast to catch before it disappears.

## 6. Download / restore a scores backup (new — Sudoku didn't have an equivalent before)

Settings → **Score Storage & Backup** can download the current all-time
leaderboard as a JSON file at any time, and restore one later. Restoring
a backup only ever **raises** a viewer's total (or adds them if they're
new) — it can never lower anyone's score, so it's safe to use even if the
live table has since moved on. This is the safety net for the case neither
game handled before: a host on the free plan with no cloud storage set up
who wants real insurance against a wipe.

## 7. Everything else that could actually go wrong, hardened

- A TikTok id that happens to be the literal text `__proto__` or
  `constructor` used to be a real risk for any plain-object score table
  (it could silently corrupt the table's prototype); ids like that are now
  safely prefixed before ever being used as a key.
- Leaderboards (this round and all-time) now leave out anyone with 0
  points — someone who has only ever guessed wrong no longer clutters a
  leaderboard they never scored on.
- A "Save & Apply as Default" from one device could previously reset the
  puzzle and points already on screen if a second phone loaded the page
  mid-show with a different saved difficulty. That can no longer happen:
  once a server run is "configured" (a host changed something, chat has
  already scored, or a saved round was restored), later saved-default
  requests are ignored for anything that would touch the running puzzle;
  the *next* puzzle still picks up the new saved difficulty.
- Tapping "New Puzzle" while the current round already has points now asks
  for confirmation first (all-time points are never at risk either way) —
  it no longer silently discards a round's worth of scoring on a stray tap.
- The all-time leaderboard now sends up to 1,000 players and the round
  leaderboard up to 500 (matching the Memory game), instead of an unbounded
  list.
- `/healthz` and a new small message bar (used for reset/backup
  confirmations) both now report real, current information instead of
  nothing — useful for both the host and for whatever uptime monitor is
  pinging the free plan awake.

## Honest caveats, stated plainly (Settings shows the current one live)

- **No cloud storage configured:** scores are saved to a local file only.
  On Render's **free** plan, Render's own documentation confirms that file
  is erased on every sleep, restart, or new deploy. This is the same
  caveat both games always had — now stated up front in Settings instead
  of only in CHANGES.md.
- **Cloud storage configured:** scores survive sleep, restart, and new
  deploys. If the cloud service itself has an outage, saving pauses
  automatically (nothing is lost or overwritten) and resumes on its own —
  Settings shows this state too.
- Either way, downloading a backup after a big stream (Settings → Score
  Storage & Backup) is a free, permanent insurance policy that doesn't
  depend on either storage layer staying up.

---

# v2.9.1 — the actual root cause: wrong folder layout, so none of the previous fixes could ever load

## What was really going on

After the v2.9.0 fix still didn't work, I stopped trusting my own read of the
game logic and checked the one thing that would explain *every* previous
fix appearing to do nothing no matter what changed: whether the server can
actually find and serve the files being edited.

`server.js` has always served the frontend with:

```js
app.use(express.static(path.join(__dirname, "public"), { ... }));
```

There is no other route that serves `index.html`, `game.js`, or `style.css` -
this is the only way they ever reach a browser. It requires those three
files to live in a `public/` subfolder next to `server.js`.

But the files in this project were sitting at the project **root**, as
siblings of `server.js` - not inside `public/`. With no `public/` folder
present, that static-file middleware had nothing to serve, so requests for
`/game.js` and `/style.css` (and `/` itself, since `express.static` serves
`index.html` for the directory root) would 404. Whatever the app was
actually running in the browser, it was not this code - which is exactly
consistent with round-leaderboard fixes, all-time-persistence fixes, and
panel-visibility fixes all appearing to change nothing: the server had no
way to hand out the file any of those fixes lived in.

Telling confirmation: `README.md`'s own v1.8 changelog entry already
documents fixing this *exact* mismatch once before -
`"Folder layout fixed for deployment: index.html/style.css/game.js now
live in a 'public' subfolder, matching how the server actually serves
them (this was a mismatch in the previous download)."` - so this is a
regression back to a bug that had already been identified and fixed once
before, not a new one.

## The fix

`index.html`, `game.js`, and `style.css` now live in `public/`, matching
`server.js`'s `express.static(path.join(__dirname, "public"))` exactly:

```
project/
  server.js
  package.json
  render.yaml
  public/
    index.html
    game.js
    style.css
```

Verified by resolving `path.join(__dirname, "public")` from `server.js`'s
own location and confirming all three files exist there (`node -c` also
re-run clean on both `server.js` and `public/game.js`). If you deploy this
folder as-is - keeping `public/` intact, not flattening it again - every
fix from v2.8.0 and v2.9.0 below should now actually be running in your
browser for the first time.

**If you still see stale behavior after this deploy:** do a hard refresh
(Ctrl/Cmd+Shift+R) or open in a private/incognito window once, in case your
browser cached the old 404 response or an old asset from before this fix -
the `Cache-Control: no-store` headers already in `server.js` prevent this
going forward, but a page loaded before this deploy may have cached
something under the old, broken routing.

---

# v2.9.0 — "leaderboards still look uncredited at round end" fix

## The actual bug this time

I re-audited every line involved in scoring end to end — `applyGuess` in
`server.js`, the `state` broadcast, and the `puzzleSolved` broadcast — and
the server-side counting was correct the whole time (v2.8.0 fixed the
separate all-time-across-restarts problem). So the question became: if the
numbers are right on the server, why would a host ever see "no points" in
**both** leaderboards at round end, in **both** normal and Full Screen view?

Found it in `index.html` / `game.js`: the **"Leaderboard & Activity" panel
— which is where both the round leaderboard and the all-time leaderboard
live — was hard-coded `hidden` on every single page load**, and nothing in
the code ever opened it automatically or remembered that a host had opened
it before. The only other place points show up is the round-end popup,
which auto-dismisses itself after a timer. Put those two together: unless
a host happened to (a) click the "Leaderboard & Activity" toggle every time
they loaded the page, and (b) be looking at exactly the right moment before
the popup auto-hid, they would see the round end and genuinely nothing
leaderboard-shaped on screen — even though the server had scored every
guess correctly the entire time. Full Screen mode didn't change this at
all, because Full Screen just makes the same `.app-shell` fill the screen —
it's the same DOM, same hidden panel, same bug.

## The fix

- The Leaderboard & Activity panel is now **open by default** on every
  load, in both normal and Full Screen view.
- If a host does choose to collapse it, that choice is now remembered
  (`localStorage`) instead of silently reverting to hidden next time.
- Added a second, always-visible readout — a small "🏆 N pts this round"
  badge right above the board, next to the connection status — that's
  independent of the collapsible panel entirely and updates live off the
  same `state` broadcast the leaderboards use. Even with the panel closed
  or the round-end popup missed, there's now always at least one on-screen
  place confirming points are being counted in real time.
- The trophy button in the top toolbar already opened a leaderboard modal
  fed by the same live data (this wasn't new), which is worth knowing
  about too - it's an always-accurate way to check either leaderboard on
  demand, panel state or timers aside.

---

# v2.8.0 — "points not counted in leaderboards" fix

## The bug

Round-by-round, points were always being counted correctly the whole time —
`applyGuess` in `server.js` increments both `state.scores` (this round) and
`state.allTimeScores` (all-time) on every correct guess, and every "state"
broadcast recomputes both leaderboards fresh from those objects. That part
was never broken, and you can confirm it yourself: watch the leaderboard
panel during a single, uninterrupted round — it updates immediately.

The real problem is that **`state.allTimeScores` only ever lived in the
server's RAM.** It was never written anywhere else. So the moment the Node
process restarts for *any* reason, it comes back as an empty object and
every viewer's all-time total is gone — silently, with no error anywhere.

The single most common way that happens: Render's **free** plan spins the
whole service down after roughly 15 minutes with no incoming traffic, and
spins a brand-new process back up on the next visit. A host who streams
once a day (or takes a break mid-stream) comes back to a fully reset
all-time board. From the host's chair, that looks exactly like "points
aren't being counted" — even though every point genuinely was counted
while the process was alive. The per-round leaderboard doesn't show this
symptom because it's *supposed* to reset every round; the all-time one
isn't, which is exactly why losing it is so noticeable.

## The fix

`state.allTimeScores` is now persisted to a JSON file (`./data/alltime-scores.json`
by default), loaded back in at startup, and re-saved (debounced, ~3s after
the last correct guess so a burst of scoring doesn't hammer the disk) every
time someone scores. It's also flushed on a normal shutdown/redeploy signal
so the last few seconds aren't lost to the debounce timer not having fired
yet.

**Honest caveat:** Render's free plan filesystem is *ephemeral* — this file
survives the server restarting on the same deployed instance (including the
free-tier spin-down/spin-up cycle this bug is mostly about), but it is
still wiped on a brand-new deploy. If you want the all-time board to survive
redeploys too, you need a real Persistent Disk, which requires moving off
the free plan — see the commented-out block in `render.yaml` for exactly
what to uncomment and which env var (`DATA_DIR`) to set. Left as-is on the
free plan, this is a real, meaningful improvement (survives the everyday
spin-down case that was actually happening) — not a 100% guarantee across
every possible restart.

---

# What changed in the previous build — "correct guess still says wrong format / some guesses never register" fix

## The one thing outside the code entirely — check this first

TikTok's own LIVE comment filters can silently withhold a comment before it
is ever broadcast to anyone, including to this app. This is well documented
by TikTok itself and by creators: **Settings → Comments → Filtered**, then
turn OFF:
- **Spam filter**
- **Potentially unkind words**

The spam filter in particular is a strong suspect here: many different
viewers all typing short, near-identical text like `A5 7` in a short window
is exactly the shape of message TikTok's spam heuristic is built to catch.
When that happens, the comment never reaches the Webcast feed this app reads
from at all — it won't show up as "wrong format," it won't show up as
anything, on either the Diagnostics panel or the Render logs, because it
genuinely never arrived. No code change can see a comment TikTok itself
decided not to broadcast. This is the single highest-leverage fix available
and it takes 10 seconds to check in your Live settings before going live.

## What I actually changed in the code

**1. Broader comment-text extraction.** Some chat payload shapes represent
the comment as an array of text "runs" (used for messages with mentions or
stickers mixed in) or a nested object instead of a plain string. The old
extractor only handled plain strings, so a guess arriving in one of those
shapes would come through as `text: null` — silently unparseable, showing
as "wrong format" even though a human would say it was typed correctly.
`extractChatFields` now unwraps arrays/objects to find the actual text
either way.

**2. Fixed a de-duplication bug that could drop a genuinely different,
correctly-formatted guess.** The chat handler is deliberately bound to
several possible event-name aliases (in case a library version fires chat
under a different name than expected), and it needs to avoid double-
processing the same message if two aliases both fire for it. The previous
build did this by remembering the raw JavaScript *object* it had already
seen (a `WeakSet`). That only works if the library always hands out a
brand-new object per message. If any version reuses or mutates a buffer
object across consecutive messages internally (a common performance
pattern in binary/protobuf decoders), object-identity dedup would treat a
second, completely different comment as "already handled" and drop it
without a trace — a plausible explanation for "a correctly-formatted guess
just never showed up at all." This is now deduplicated by the message's own
ID field instead (falling back to "don't guess, just process it" when no ID
is present), which can still collapse true duplicate deliveries but can
never mistake two different comments for the same one.

**3. Per-message debug logging is now opt-in, not always-on.** Every single
chat comment was triggering a full `JSON.stringify` of the raw payload plus
two `console.log` calls, unconditionally. That's fine at low volume, but
under a real bursty audience (which is exactly when you most need every
comment to be processed promptly) it adds real, avoidable CPU cost on the
single-threaded Node event loop, right when it can least afford it. This is
now controlled by an environment variable, **`CHAT_DEBUG_LOG`** — leave it
unset (default) for normal live use, and set it to `true` in Render's
Environment tab (or your local `.env`) whenever you need to see full raw
payloads again to diagnose something. The lightweight always-on path
(rawEventCount / Diagnostics panel "Last Received" line) is untouched — it
still updates for every message, at effectively no cost.

## Also carried forward from the previous fix
- `tiktok-live-connector` stays pinned to `2.5.0` (fixes the EulerStream
  429/rate-limit crash from the last round).
- Every connector failure still logs its full reason to the Render console,
  not just the browser status line.
- Rate-limit failures still back off on their own schedule (honoring
  `retry-after` when given) instead of hammering the limit every few
  seconds.

## An honest note on "100%"
Because this connects through TikTok's internal Webcast feed rather than an
official, TikTok-provided API for this purpose, there is no configuration
that can *guarantee* literally zero missed comments — TikTok's own client-
side filtering (above) and the unofficial nature of the feed itself are
both acknowledged, permanent limitations of this approach, not bugs in this
codebase. What's in this build is everything on the code side that can
realistically be tightened, plus the one TikTok-side setting most likely to
be silently eating guesses.
