# Sudoku LIVE

Interactive Sudoku for **TikTok LIVE**. Your audience solves the board straight from the live chat — fully automated. You go live from a single phone, log in with your TikTok username, and every correct answer in chat fills the board and scores points on a live leaderboard.

Built to run **100% free**: GitHub + Render free tier + a free EulerStream API key.

---

## How your audience plays

While you are live, viewers type an answer in the TikTok chat. The app understands several formats:

| They type | Meaning |
| --------- | ------- |
| `3 5 7`   | row 3, column 5 is **7** |
| `R3C5 7`  | same thing |
| `r3c5=7`  | same thing |
| `357`     | same thing |

- Rows are numbered **1–9 top to bottom**, columns **1–9 left to right** (the numbers are shown on the board so viewers can see them on stream).
- The **first person** to answer a cell correctly gets the points. Wrong answers are ignored.
- Points per correct cell: Easy **5**, Medium **10**, Hard **15**.
- When the whole board is solved, a winner screen shows the top solver, then you tap **Next Puzzle** to keep the room going.

## Going live from one phone

1. Open your deployed app in the phone's browser.
2. Type your TikTok **username** and pick a difficulty.
3. Start your **TikTok LIVE**, then tap **Connect & Go Live** in the app.
4. Share your screen / show the browser on your live. That's it — comments now drive the board automatically.

> Tip: use **Try Demo** anytime to rehearse. Demo mode simulates viewers answering, so you can practice with no TikTok connection.

---

## Deploy for free (GitHub + Render)

### 1. Get a free EulerStream API key
Real TikTok LIVE chat requires a signing key (this is what connects to TikTok safely).

1. Go to **https://www.eulerstream.com** and create a free account.
2. Open the dashboard and copy your **API key**.

### 2. Put this project on GitHub
1. Create a new repository on **github.com**.
2. Upload this whole folder (or push it with git). Do **not** upload `node_modules` or `.env` — they are already in `.gitignore`.

### 3. Deploy on Render
1. Go to **https://render.com** and sign in with GitHub.
2. Click **New → Web Service** and select your repository.
3. Render reads `render.yaml` automatically. If it asks, use:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Plan:** Free
4. Under **Environment**, add a variable:
   - Key: `EULERSTREAM_API_KEY`
   - Value: *(the key from step 1)*
5. Click **Create Web Service**. When it finishes, open the `.onrender.com` URL on your phone.

### About the free tier
Render's free web service sleeps after ~15 minutes with no traffic and takes ~1 minute to wake up. During a live session there is constant traffic, so it stays awake. Just open the app a minute before you go live so it's warm.

---

## Run locally (optional)

```bash
npm install
# optional: enable real TikTok chat
echo "EULERSTREAM_API_KEY=your_key_here" > .env
npm start
```

Then open http://localhost:3000. Without a key, **Demo mode** still works.

> Note: `.env` is loaded by your host (Render). For local runs you can also set the variable inline: `EULERSTREAM_API_KEY=your_key npm start`.

---

## What's inside

```
server.js          Express + Socket.IO server, TikTok LIVE connection, game logic
lib/sudoku.js      Sudoku generator with guaranteed unique solutions
public/            The streaming UI (login, board, leaderboard, controls)
render.yaml        One-click Render config
.env.example       Environment variable template
```

- **Backend:** Node.js, Express, Socket.IO, [`tiktok-live-connector`](https://www.npmjs.com/package/tiktok-live-connector).
- **Frontend:** plain HTML/CSS/JS (no build step) — loads instantly on mobile.
- The EulerStream key stays on the **server only** and is never exposed to viewers.

## Notes

- You and your friend can each deploy your own copy, or share one deployment — each browser that logs in runs its own independent game bound to whatever TikTok username it enters.
- The account you enter must actually be **live** on TikTok when you connect, or you'll see "that account is not live right now." Start the LIVE first, then connect.
