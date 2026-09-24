# What I changed in this build

## 1. "Wrong format" fix (server.js, chat parser)
The coordinate parser (`CELL_GUESS_REGEX`) accepted space, comma, colon,
equals and hyphen as separators between the column digit and the number,
but not a period (`.`). Several mobile keyboards auto-insert a period when
someone double-taps the space bar mid-message, so a viewer who typed a
perfectly correct `A5 7` could have it arrive at the server as `A5. 7` or
`A5.7` - and that was being rejected as "wrong format" even though nothing
was wrong with what they typed. `.` is now accepted as a separator
everywhere the others are, so this class of false "wrong format" should go
away.

If you still see genuinely correct guesses flagged as wrong format after
this, the fastest way to pin it down is to watch the Render logs while it
happens - the server already logs a line like:

```
[chat field probe] ... data.comment=" the exact text it received "
```

for every single incoming comment. That will show you the literal raw text
the server is working with, which tells you immediately whether it's a
parsing issue or the comment itself arrived garbled/altered before it ever
reached the parser (e.g. TikTok's own auto-translate rewriting it).

## 2. Removed two unused files that were part of the upload but not part of
   the running app, since they'd only cause confusion later:
- **public-app.js** - an older prototype front-end. It talks a completely
  different Socket.IO protocol (`host:start`, `game:state`, etc.) than the
  current `server.js` speaks (`host:comment`, `state`, `guessResult`, etc.)
  and isn't referenced anywhere - `public/index.html` loads `/game.js`,
  not `/app.js`. Harmless to leave out.
- **lib-sudoku.js** - a standalone ES-module Sudoku engine that nothing
  `require`s or `import`s. `server.js` has its own self-contained puzzle
  generator built in (see section "1. SUDOKU ENGINE" near the top of the
  file), so this file was dead code.
- I also left the stale `pnpm-lock.yaml` out. It specified a different
  `tiktok-live-connector` version (2.5.0) than `package.json`'s exact pin
  (2.4.4), and `render.yaml`'s build command is `npm install` anyway, which
  ignores pnpm lockfiles entirely - so it was inert but misleading to keep
  around.

Nothing else was changed. Deploy this folder as-is.
