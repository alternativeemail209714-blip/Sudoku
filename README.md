# TikTok Sudoku LIVE - Deployment Ready

v1.6 changes:
  - Hints & Reveals (in Settings): "Reveal 1 Cell" fills in one random
    unsolved cell, "Reveal 3x3 Box" fills in a whole box at once, and
    "Reveal Whole Board" instantly completes the puzzle (asks for
    confirmation first, since it ends the round). None of these award any
    points to viewers - they're host-only tools.
  - Difficulty now has 7 levels instead of 3: Very Easy, Easy, Moderate,
    Hard, Very Hard, Extreme, and Extremely Hard. Each level has its own
    bank of at least 100 pre-generated puzzles (700 total), built fresh
    every time the server starts.
  - Test Mode has a new "Auto-Solve (Bots)" toggle: turn it on and a
    small rotating cast of bots will keep answering random cells on their
    own (mostly correctly, occasionally wrong for realism) until the
    puzzle is completed - handy for watching a full round play out, or
    for load-testing, without touching the console yourself.

v1.5 changes:
  - Fixed a bug where the Light theme looked half-broken (dark patches
    around the edges) while in Full Screen mode. The browser's fullscreen
    "backdrop" layer, which sits behind the fullscreened app, was always
    plain black by default and wasn't matching the chosen theme - it is
    now explicitly themed too.
  - Round-end floating windows: right when a puzzle is solved, a floating
    window shows that round's top scorers (circular TikTok profile photo,
    name, points), then automatically swaps to a second floating window
    showing the All-Time top scorers. Close either early with the X.
  - Live guess feed: a new floating pill appears in the gap between the
    "Chat format" hint and the status/timer row for every incoming guess,
    showing the viewer's circular photo, name and what happened - a
    correct guess (+1), a wrong answer, a coordinate that was already
    answered, or an unrecognized/wrong format.
  - Leaderboards (this round and all-time) now show each viewer's
    circular TikTok profile photo next to their name. When a real photo
    isn't available (Test/Offline/Host modes, or if TikTok doesn't supply
    one), a generated circular avatar with the viewer's initials is used
    instead so the layout always looks the same.


This folder is the exact, finished app. Push this whole folder to GitHub and deploy
it on Render.com as a "Web Service".

Quick reference:
- Build Command: npm install
- Start Command: npm start
- Render sets the PORT environment variable automatically - do not hardcode a port.

To run it on your own computer first (recommended before deploying):
  1. Open a terminal in this folder.
  2. Run: npm install
  3. Run: npm start
  4. Open http://localhost:3000 in your browser.

v1.4 changes:
  - Easier-on-the-eyes color palette: the neon pink/cyan and near-black
    background have been softened, and every text/background pairing was
    checked against WCAG contrast guidelines. A Light theme is now also
    available (Settings -> Theme), and the app follows the viewer's OS
    dark/light preference automatically until they pick one manually
    (their choice is remembered on that device).
  - Host Console is now collapsible: tap "Hide" next to "Host Console" at
    the bottom of the screen to tuck the input bar away and reclaim
    space; tap "Show" to bring it back. Remembered per device.

v1.3 changes:
  - Full Screen button (top-right, next to the gear icon): puts the app in
    true browser full screen - handy when the dashboard is displayed on a
    TV, a second monitor, or captured in OBS for a stream. The board never
    stretches to fill the screen; it keeps its own square proportions and
    just gets a bit bigger and more readable on large displays.

v1.2 changes:
  - Auto Next Round: a toggle in Settings that, when on, automatically starts
    a new puzzle (same difficulty) about 10 seconds after the current one is
    solved, so a live show can keep rolling hands-free. Turn it off anytime
    to go back to manually clicking "New Puzzle".
  - Big puzzle bank: at least 100 unique puzzles are pre-generated for each
    difficulty (Easy / Medium / Hard) when the server starts, so "New
    Puzzle" is instant and the audience sees a lot of variety before any
    puzzle repeats.
  - No time limit: the game never cuts a round short. A small stopwatch on
    the board just counts up so everyone can see how long the puzzle has
    taken, and freezes on the exact solve time once it's finished - it's
    purely informational.
  - Scoring simplified to 1 point per correct guess. Each round shows "This
    Round" scores, and there is now a persistent "All-Time Leaderboard"
    that keeps a running total across every puzzle for as long as the
    server has been running.

v1.1 changes:
  - Chat parser is more forgiving: "A5 7", "A5,7", "A5:7", "A5-7" and even
    "A57" (no separator at all) are all accepted. Full-width digits/letters
    from some mobile keyboards are also normalized automatically.
  - The on-screen feed no longer shows an "=" sign, so viewers copying what
    they see on stream will not accidentally type an unsupported format.
  - The dashboard is now mobile-first: only the board, a one-line hint, a
    mini status dot, and the host console show by default. Mode switching,
    TikTok connect fields, Test tools, difficulty and New Puzzle all live
    behind the gear icon so the board stays big and centered on a phone.
