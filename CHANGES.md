# What changed in this build — "correct guess still says wrong format / some guesses never register" fix

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
