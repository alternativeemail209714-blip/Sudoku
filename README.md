# TikTok Sudoku LIVE - Deployment Ready

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
