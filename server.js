import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import path from "path";
import {
  TikTokLiveConnection,
  WebcastEvent,
  ControlEvent,
  SignConfig,
} from "tiktok-live-connector";
import { generatePuzzle, DIFFICULTIES } from "./lib/sudoku.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const EULER_KEY =
  process.env.EULERSTREAM_API_KEY || process.env.SIGN_API_KEY || "";
if (EULER_KEY) SignConfig.apiKey = EULER_KEY;

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// One session per host browser (the phone that is going live).
const sessions = new Map();

// -- Comment parsing ---------------------------------------------------------
// Accepts any of: "R3C5 7", "r3c5=7", "3 5 7", "3,5,7", "357".
function parseGuess(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();

  let m = t.match(/r\s*([1-9])\s*c\s*([1-9])\D*([1-9])/);
  if (m) return { row: +m[1] - 1, col: +m[2] - 1, val: +m[3] };

  m = t.match(/\b([1-9])\D+([1-9])\D+([1-9])\b/);
  if (m) return { row: +m[1] - 1, col: +m[2] - 1, val: +m[3] };

  m = t.match(/\b([1-9])([1-9])([1-9])\b/);
  if (m) return { row: +m[1] - 1, col: +m[2] - 1, val: +m[3] };

  return null;
}

// -- Game state --------------------------------------------------------------
function createGame(socket, difficulty) {
  const g = generatePuzzle(difficulty);
  return {
    socket,
    username: null,
    connection: null,
    demo: false,
    demoTimer: null,
    difficulty,
    points: g.points,
    puzzle: g.puzzle,
    solution: g.solution,
    given: g.given,
    filled: g.puzzle.slice(),
    solvedBy: new Array(81).fill(null),
    scores: new Map(), // userId -> { name, displayId, avatar, points, solves }
    startedAt: Date.now(),
    solved: false,
  };
}

function remainingCells(session) {
  let n = 0;
  for (let i = 0; i < 81; i++) if (session.filled[i] === 0) n++;
  return n;
}

function leaderboard(session, top = 12) {
  return [...session.scores.values()]
    .sort((a, b) => b.points - a.points || b.solves - a.solves)
    .slice(0, top);
}

function statsOf(session) {
  const remaining = remainingCells(session);
  return {
    remaining,
    filled: 81 - remaining,
    total: 81,
    players: session.scores.size,
    difficulty: session.difficulty,
  };
}

function fullState(session) {
  return {
    given: session.given,
    filled: session.filled,
    difficulty: session.difficulty,
    points: session.points,
    solved: session.solved,
    stats: statsOf(session),
    leaderboard: leaderboard(session),
  };
}

function sendState(session) {
  session.socket.emit("game:state", fullState(session));
}

// -- Applying a guess --------------------------------------------------------
function applyGuess(session, guess, user) {
  if (session.solved) return;
  const { row, col, val } = guess;
  if (row < 0 || row > 8 || col < 0 || col > 8 || val < 1 || val > 9) return;
  const idx = row * 9 + col;
  if (session.given[idx]) return; // locked clue
  if (session.filled[idx] !== 0) return; // already solved

  if (session.solution[idx] !== val) {
    session.socket.emit("guess:wrong", {
      name: user.name,
      row: row + 1,
      col: col + 1,
      val,
    });
    return;
  }

  session.filled[idx] = val;
  session.solvedBy[idx] = user.userId;

  let score = session.scores.get(user.userId);
  if (!score) {
    score = {
      name: user.name,
      displayId: user.displayId,
      avatar: user.avatar,
      points: 0,
      solves: 0,
    };
    session.scores.set(user.userId, score);
  }
  score.points += session.points;
  score.solves += 1;
  score.name = user.name;
  if (user.avatar) score.avatar = user.avatar;

  session.socket.emit("cell:filled", {
    index: idx,
    row: row + 1,
    col: col + 1,
    value: val,
    points: session.points,
    solver: { name: user.name, displayId: user.displayId, avatar: user.avatar },
  });
  session.socket.emit("leaderboard", leaderboard(session));
  session.socket.emit("stats", statsOf(session));

  if (remainingCells(session) === 0) {
    session.solved = true;
    stopDemo(session);
    session.socket.emit("game:solved", {
      winner: leaderboard(session)[0] || null,
      leaderboard: leaderboard(session),
      seconds: Math.round((Date.now() - session.startedAt) / 1000),
    });
  }
}

function handleComment(session, c) {
  const guess = parseGuess(c.text);
  if (!guess) return;
  applyGuess(session, guess, c);
}

// -- TikTok LIVE connection --------------------------------------------------
function friendlyError(err) {
  const name = err?.constructor?.name || "";
  const msg = String(err?.message || err || "");
  if (name === "UserOfflineError" || /offline|not.*live/i.test(msg)) {
    return "That account is not live right now. Start your TikTok LIVE, then reconnect.";
  }
  if (/sign|api key|euler|unauthor/i.test(msg)) {
    return "Sign server rejected the request. Check the EulerStream API key on the server.";
  }
  return msg || "Could not connect to TikTok LIVE.";
}

async function connectTikTok(session, username) {
  const socket = session.socket;
  session.username = username;

  if (!EULER_KEY) {
    socket.emit("tiktok:status", {
      status: "error",
      username,
      message:
        "Server is missing the EULERSTREAM_API_KEY. Add it in Render, then reconnect. (Or use Demo mode.)",
    });
    return;
  }

  socket.emit("tiktok:status", { status: "connecting", username });

  let conn;
  try {
    conn = new TikTokLiveConnection(username, { signApiKey: EULER_KEY });
  } catch (err) {
    socket.emit("tiktok:status", {
      status: "error",
      username,
      message: friendlyError(err),
    });
    return;
  }
  session.connection = conn;

  conn.on(WebcastEvent.CHAT, (data) => {
    handleComment(session, {
      text: data?.content || "",
      name: data?.user?.nickname || data?.user?.displayId || "viewer",
      displayId: data?.user?.displayId || "",
      userId: data?.user?.id || data?.user?.displayId || `anon-${Math.random()}`,
      avatar: data?.user?.avatarThumb?.urlList?.[0] || "",
    });
  });

  conn.on(ControlEvent.CONNECTED, () =>
    socket.emit("tiktok:status", { status: "connected", username })
  );
  conn.on(ControlEvent.DISCONNECTED, () =>
    socket.emit("tiktok:status", { status: "disconnected", username })
  );
  conn.on(WebcastEvent.STREAM_END, () =>
    socket.emit("tiktok:status", { status: "ended", username })
  );
  conn.on(ControlEvent.ERROR, (err) =>
    socket.emit("tiktok:status", {
      status: "error",
      username,
      message: friendlyError(err),
    })
  );

  try {
    await conn.connect();
  } catch (err) {
    socket.emit("tiktok:status", {
      status: "error",
      username,
      message: friendlyError(err),
    });
  }
}

// -- Demo mode ---------------------------------------------------------------
const DEMO_VIEWERS = [
  "puzzle_panda", "night_owl", "sudoku_sam", "quick_quinn", "mila.plays",
  "the_real_deej", "grid_goblin", "aya_solves", "kev.exe", "luna_logic",
  "brainy_bea", "tomtom_99", "zaraz", "9x9_ninja", "captain_clue",
];

function randomDemoUser() {
  const id = DEMO_VIEWERS[Math.floor(Math.random() * DEMO_VIEWERS.length)];
  return {
    name: id,
    displayId: id,
    userId: `demo-${id}`,
    avatar: "",
  };
}

function startDemo(session, speed = 1800) {
  stopDemo(session);
  session.demo = true;
  session.demoTimer = setInterval(() => {
    if (session.solved) return stopDemo(session);
    const empties = [];
    for (let i = 0; i < 81; i++) if (session.filled[i] === 0) empties.push(i);
    if (empties.length === 0) return;
    const idx = empties[Math.floor(Math.random() * empties.length)];
    const user = randomDemoUser();
    // 25% of the time simulate a wrong answer for realism.
    const wrong = Math.random() < 0.25;
    const val = wrong
      ? ((session.solution[idx] % 9) + 1)
      : session.solution[idx];
    handleComment(session, {
      text: `${Math.floor(idx / 9) + 1} ${(idx % 9) + 1} ${val}`,
      ...user,
    });
  }, Math.max(400, speed));
}

function stopDemo(session) {
  if (session?.demoTimer) {
    clearInterval(session.demoTimer);
    session.demoTimer = null;
  }
}

function teardown(session) {
  if (!session) return;
  stopDemo(session);
  if (session.connection) {
    try {
      session.connection.disconnect();
    } catch {}
    session.connection = null;
  }
}

// -- Socket wiring -----------------------------------------------------------
io.on("connection", (socket) => {
  socket.emit("server:info", {
    hasKey: Boolean(EULER_KEY),
    difficulties: Object.fromEntries(
      Object.entries(DIFFICULTIES).map(([k, v]) => [k, v.label])
    ),
  });

  socket.on("host:start", ({ username, difficulty, demo } = {}) => {
    teardown(sessions.get(socket.id));
    const diff = DIFFICULTIES[difficulty] ? difficulty : "medium";
    const session = createGame(socket, diff);
    sessions.set(socket.id, session);

    const clean = String(username || "").trim().replace(/^@+/, "");
    sendState(session);

    if (demo) {
      session.demo = true;
      socket.emit("tiktok:status", {
        status: "demo",
        username: clean || "demo",
      });
      startDemo(session);
      return;
    }
    connectTikTok(session, clean);
  });

  socket.on("host:new", ({ difficulty } = {}) => {
    const prev = sessions.get(socket.id);
    if (!prev) return;
    const diff = DIFFICULTIES[difficulty] ? difficulty : prev.difficulty;
    const wasDemo = prev.demo;
    const username = prev.username;
    const scores = prev.scores; // keep the running leaderboard across puzzles
    teardown(prev);

    const session = createGame(socket, diff);
    session.scores = scores;
    session.username = username;
    session.demo = wasDemo;
    sessions.set(socket.id, session);
    sendState(session);

    if (wasDemo) {
      startDemo(session);
    } else if (prev.connection || username) {
      // Re-attach to the same live using a fresh connection.
      if (username) connectTikTok(session, username);
    }
  });

  socket.on("host:resetScores", () => {
    const session = sessions.get(socket.id);
    if (!session) return;
    session.scores = new Map();
    socket.emit("leaderboard", []);
    socket.emit("stats", statsOf(session));
  });

  socket.on("demo:speed", ({ speed } = {}) => {
    const session = sessions.get(socket.id);
    if (session?.demo) startDemo(session, Number(speed) || 1800);
  });

  socket.on("host:stop", () => {
    teardown(sessions.get(socket.id));
    sessions.delete(socket.id);
  });

  socket.on("disconnect", () => {
    teardown(sessions.get(socket.id));
    sessions.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`[v0] Sudoku LIVE running on http://localhost:${PORT}`);
  console.log(`[v0] EulerStream key ${EULER_KEY ? "detected" : "NOT set (demo mode only)"}`);
});
