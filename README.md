# TikTok Sudoku LIVE - Deployment Ready

v2.0 changes:
  - Top toolbar's Difficulty control is no longer a text dropdown that
    could get cut off on narrow phones - it's now a small icon button
    showing a colored, numbered badge (1 = Very Easy, green, through
    7 = Extremely Hard, dark red). Tap it to open a floating menu listing
    every difficulty by name; only the badge shows in the toolbar itself,
    so it can never overflow or get clipped again.
  - Game title in the top toolbar shortened to "SUDOKU Live" so there's
    more room for the toolbar's buttons on small screens.
  - 6 new color themes: Cream, Sky Blue, Meadow Green, Blossom Pink,
    Lavender Violet and Honey Gold, alongside the existing Dark and
    Light - 8 themes in total. Every color (background, panels, text,
    both accent colors, grid cells, buttons, warnings, etc.) is themed,
    and each palette was chosen for solid text/background contrast so
    every letter, number and label stays easy to read. Pick a theme from
    the grid of swatches in Settings, or from a new matching dropdown in
    the top toolbar (next to Full Screen) - same "just a symbol" style as
    the difficulty dropdown: a small two-tone color circle in the
    toolbar, full theme names in the menu. Your choice is remembered on
    this device.
  - Settings now has a "Save & Apply Settings" button at the bottom of
    the drawer. Every field already saved itself as soon as it changed,
    but this gives an explicit, reassuring way to commit everything at
    once (it also flushes any field you were still typing in) and shows
    a short "Settings saved & applied" confirmation.

v1.9 changes:
  - Host Console now hides completely when collapsed - no strip left
    behind at the bottom of the screen. A small floating "Console"
    button appears in the bottom-right corner instead; tap it to bring
    the input bar back. Remembered per device, same as before.
  - Top toolbar (title + all 8 buttons/dropdown) now always stays on a
    single row - in the normal view AND in Full Screen - including on
    typical Android phone widths. Everything shrinks progressively as
    the screen narrows (smaller icons, smaller difficulty dropdown,
    "TikTok" trimmed from the title on the narrowest phones); on the
    very narrowest devices the row scrolls sideways within itself
    rather than ever wrapping to a second line.

v1.8 changes:
  - Floating Window Timing (in Settings, below Auto Next Round): lets you
    customize exactly how long each floating window stays on screen -
    the live guess toast, the "This Round's Top Scorers" window, and the
    "All-Time Top Scorers" window - plus how many seconds until the next
    round automatically starts. Each has its own sensible default, and a
    "Reset to Defaults" button puts all four back at once. The toast and
    round-end window durations are remembered on your device; the next-
    round delay is shared with every viewer, since it controls the
    actual game.
  - A live countdown ("Next round starts in Ns...") now also appears
    inside the round-end floating window itself, in addition to the
    banner above the board, so it's easy to see exactly when the next
    puzzle is about to begin.
  - The Leaderboard button in the top toolbar now opens a centered
    floating window with "This Round" / "All-Time" tabs, instead of just
    scrolling down to the panel below the board.
  - Gold/silver/bronze medals now show for 1st/2nd/3rd place everywhere
    a leaderboard is shown - the round-end windows, the new Leaderboard
    floating window, and the in-page leaderboard panels.
  - Puzzle bank doubled: each difficulty now has 200 unique pre-generated
    puzzles (1,400 total) instead of 100, so there's even more variety
    before anything repeats.
  - Folder layout fixed for deployment: index.html/style.css/game.js now
    live in a "public" subfolder, matching how the server actually serves
    them (this was a mismatch in the previous download).

v1.7 changes:
  - Live guess toast area now reserves a fixed slot of space at all times,
    so the board no longer gets pushed up/down every time a toast appears
    or disappears. Only one toast shows at a time - a new incoming guess
    immediately replaces whatever is currently showing instead of stacking.
  - Top toolbar (next to Full Screen and Settings) now also has: a
    difficulty dropdown, a New Puzzle button, a Leaderboard button, and
    one button each for Reveal 1 Cell / Reveal 3x3 Box / Reveal Whole
    Board - all in addition to the same controls still living in
    Settings (the two stay in sync).
  - This Round's Top Scorers (shown when a puzzle is solved) now lists
    every viewer who scored that round, no matter how many there are. The
    All-Time Leaderboard (both in the round-end popup and in the
    Leaderboard & Activity panel) shows roughly the top 20 at a glance and
    scrolls to reveal everyone else who has ever scored.
  - TikTok LIVE connecting no longer requires typing in the EulerStream
    Sign API Key every time. Set EULERSTREAM_SIGN_API_KEY (and optionally
    TIKTOK_USERNAME) as environment variables - see "TikTok LIVE Sign API
    Key setup" below - and the Live Mode panel will skip asking for the
    key, only asking for your TikTok username if one wasn't also set.

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

## TikTok LIVE Sign API Key setup (so you don't retype it every time)

Your EulerStream Sign API Key has already been filled in for you in the
local ".env" file in this folder, so it works right away when you run the
app on your own computer (npm start). It has NOT been written into any of
the website's code, and ".env" is listed in .gitignore, so it will not be
uploaded when you push this folder to GitHub - your key stays private.

Because ".env" doesn't get pushed to GitHub, Render needs the same key set
separately in its own dashboard:
  1. On Render.com, open your Web Service.
  2. Go to the "Environment" tab.
  3. Add a variable named EULERSTREAM_SIGN_API_KEY with your key as the
     value (the same one already in your local .env file).
  4. (Optional) Add TIKTOK_USERNAME with your TikTok username if you
     always stream from the same account, so it's pre-filled too.
  5. Save - Render will redeploy automatically.

Once that's set, the Live Mode panel in Settings will no longer ask for a
Sign API Key at all - just enter your TikTok username and tap Connect.

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
