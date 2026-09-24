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
