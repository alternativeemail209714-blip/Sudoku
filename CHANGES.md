# What changed in this build — connection failsafe fix

## The actual root cause of "Lost connection (the reconnect attempt failed)"

Your Render logs showed `[TikTok connector] first time seeing event: "error"`
firing over and over, but never *why*. That was the real problem: the old
code only sent the error's message to the on-screen status line, never to
`console.error`, so the true reason never reached the Render logs you were
looking at.

Once the real error text is exposed (see below), the cause turns out to be
a confirmed bug in **`tiktok-live-connector@2.4.4`**, the exact version
your `package.json` was pinned to:

- When EulerStream's sign server returns an HTTP 429 (a short-term rate
  limit — separate from your monthly key quota, which is why the quota
  looked fine), the library's own rate-limit error object crashes while
  building itself, because it reads the response headers off the wrong
  place. Instead of a clear "you're rate-limited, wait Ns" error, you get
  a bare `TypeError: Cannot read properties of undefined (reading
  'retry-after')`.
- That opaque error is what you saw. The old reconnect logic didn't
  recognize it as a rate limit, so it kept retrying every few seconds —
  which re-triggered the same 429, forever. That's the retry loop in your
  logs.
- This was fixed upstream in `tiktok-live-connector@2.5.0` (released
  2026-09-16). Source:
  https://github.com/zerodytrash/TikTok-Live-Connector/releases/tag/v2.5.0
  and the bug report: https://github.com/zerodytrash/TikTok-Live-Connector/issues/330

## The fix (three parts, so this fails loudly and recovers correctly instead of looping blind)

**1. Dependency bump.** `package.json` now pins `tiktok-live-connector` to
`2.5.0`, which fixes the crash and correctly attaches `retry-after` /
`x-ratelimit-reset` to rate-limit errors.

**2. Every connector failure is now logged in full, always.** A new
`reportFailure()` helper in `server.js` is the single place all connector
errors go through. It always prints the error's name, message, HTTP
status, and any retry-after value to the Render console (`console.error`),
in addition to the on-screen status line. If something unexpected ever
goes wrong again, you'll be able to read exactly what happened straight
from the Render logs — no more guessing from a bare `"error"` event name.

**3. Rate limits get their own backoff, not the generic one.** Previously
every failure (dropped socket, stream ended, runtime error, rate limit)
used the same short linear backoff (3s, 6s, 9s... capped at 30s). That's
fine for a dropped socket, but it's the wrong response to "you're asking
too often" — it just re-triggers the same limit. Now, when a failure is
recognized as a rate limit, the reconnector either waits exactly as long
as the server's `retry-after` says, or falls back to a fixed 60s cooldown
if none is given — instead of hammering it every few seconds.

**4. Guarded against overlapping connections.** `connect()` now ignores a
second call while one is already in flight (e.g. a host double-click
landing at the same moment as an automatic reconnect), so the game never
opens two TikTok sockets at once for the same session, which would waste
sign-server requests and make rate limits more likely, not less.

Nothing about the Sudoku engine, the chat parser, or the game logic was
touched — those were already confirmed working in the previous build.

## Also unchanged from the previous cleanup
`lib-sudoku.js` and `public-app.js` are still left out of this folder —
they're unused by the running app (see the previous CHANGES.md entry for
why); nothing `require`s or `import`s either of them.
