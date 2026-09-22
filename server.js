// server.js - TikTok Sudoku LIVE (all-in-one deployment build)
// This single file contains the whole backend: the Sudoku engine, the chat
// message parser, the game state manager, the TikTok LIVE connector, and
// the Express + Socket.IO server that ties it all together.

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// ---------------------------------------------------------------------------
// 0. CRASH PREVENTION - these two handlers make sure that one bad comment,
//    one weird TikTok event, or any unexpected error NEVER takes the whole
//    server down. We just log it and keep going.
// ---------------------------------------------------------------------------
process.on("uncaughtException", function (err) {
  console.error("[uncaughtException - server kept running]", err);
});
process.on("unhandledRejection", function (err) {
  console.error("[unhandledRejection - server kept running]", err);
});

// ---------------------------------------------------------------------------
// 1. SUDOKU ENGINE
// ---------------------------------------------------------------------------
function isValidPlacement(board, row, col, value) {
  for (var i = 0; i < 9; i++) {
    if (board[row][i] === value) return false;
    if (board[i][col] === value) return false;
  }
  var boxRow = Math.floor(row / 3) * 3;
  var boxCol = Math.floor(col / 3) * 3;
  for (var r = 0; r < 3; r++) {
    for (var c = 0; c < 3; c++) {
      if (board[boxRow + r][boxCol + c] === value) return false;
    }
  }
  return true;
}

function shuffledDigits() {
  var nums = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (var i = nums.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = nums[i]; nums[i] = nums[j]; nums[j] = tmp;
  }
  return nums;
}

function generateSolvedBoard() {
  var board = [];
  for (var i = 0; i < 9; i++) board.push([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  function fill(pos) {
    if (pos === 81) return true;
    var row = Math.floor(pos / 9);
    var col = pos % 9;
    var digits = shuffledDigits();
    for (var i = 0; i < digits.length; i++) {
      var value = digits[i];
      if (isValidPlacement(board, row, col, value)) {
        board[row][col] = value;
        if (fill(pos + 1)) return true;
        board[row][col] = 0;
      }
    }
    return false;
  }
  fill(0);
  return board;
}

function generatePuzzle(difficulty) {
  var solution = generateSolvedBoard();
  var puzzle = solution.map(function (row) { return row.slice(); });
  var clueCounts = { easy: 42, medium: 32, hard: 26 };
  var clues = clueCounts[difficulty] || clueCounts.medium;
  var cellsToRemove = 81 - clues;
  var positions = [];
  for (var i = 0; i < 81; i++) positions.push(i);
  for (var j = positions.length - 1; j > 0; j--) {
    var k = Math.floor(Math.random() * (j + 1));
    var tmp = positions[j]; positions[j] = positions[k]; positions[k] = tmp;
  }
  var removed = 0;
  for (var p = 0; p < positions.length && removed < cellsToRemove; p++) {
    var row = Math.floor(positions[p] / 9);
    var col = positions[p] % 9;
    puzzle[row][col] = 0;
    removed++;
  }
  return { puzzle: puzzle, solution: solution };
}

// ---------------------------------------------------------------------------
// 2. CHAT PARSER - recognizes "A5 7" style algebraic-notation guesses.
//    Also tolerant of "A5:7", "A5,7", "A5-7" and extra words around it.
// ---------------------------------------------------------------------------
var CELL_GUESS_REGEX = /\b([A-I])\s*[-:,]?\s*([1-9])[\s,:\-]+([1-9])\b/i;

function parseGuess(text) {
  if (!text || typeof text !== "string") return null;
  var match = text.match(CELL_GUESS_REGEX);
  if (!match) return null;
  var rowLetter = match[1].toUpperCase();
  var col = parseInt(match[2], 10);
  var num = parseInt(match[3], 10);
  var row = rowLetter.charCodeAt(0) - 65;
  if (row < 0 || row > 8) return null;
  if (col < 1 || col > 9) return null;
  if (num < 1 || num > 9) return null;
  return { row: row, col: col - 1, num: num, coordLabel: rowLetter + col };
}

// ---------------------------------------------------------------------------
// 3. GAME STATE
// ---------------------------------------------------------------------------
function coordLabel(row, col) {
  return String.fromCharCode(65 + row) + (col + 1);
}

function createGameState() {
  var state = {
    mode: "offline",
    puzzle: null,
    solution: null,
    board: null,
    givenMask: null,
    solved: false,
    scores: {},
    rawEventCount: 0,
    lastReceived: null
  };

  function reset(difficulty) {
    var built = generatePuzzle(difficulty || "medium");
    state.puzzle = built.puzzle;
    state.solution = built.solution;
    state.board = built.puzzle.map(function (row) { return row.slice(); });
    state.givenMask = built.puzzle.map(function (row) {
      return row.map(function (v) { return v !== 0; });
    });
    state.solved = false;
    state.scores = {};
  }
  reset("medium");

  function ensurePlayer(uniqueId, displayName) {
    if (!state.scores[uniqueId]) {
      state.scores[uniqueId] = { name: displayName || uniqueId, correct: 0, wrong: 0, points: 0 };
    } else if (displayName) {
      state.scores[uniqueId].name = displayName;
    }
  }

  function checkSolved() {
    for (var r = 0; r < 9; r++) {
      for (var c = 0; c < 9; c++) {
        if (state.board[r][c] !== state.solution[r][c]) return false;
      }
    }
    return true;
  }

  function applyGuess(row, col, num, uniqueId, displayName) {
    if (state.givenMask[row][col]) {
      return { status: "given", coord: coordLabel(row, col) };
    }
    if (state.board[row][col] === state.solution[row][col] && state.board[row][col] !== 0) {
      return { status: "already-solved", coord: coordLabel(row, col) };
    }
    ensurePlayer(uniqueId, displayName);
    var correct = state.solution[row][col] === num;
    if (correct) {
      state.board[row][col] = num;
      state.scores[uniqueId].correct += 1;
      state.scores[uniqueId].points += 10;
      var solvedNow = checkSolved();
      if (solvedNow) state.solved = true;
      return { status: "correct", coord: coordLabel(row, col), num: num, solved: solvedNow };
    }
    state.scores[uniqueId].wrong += 1;
    return { status: "wrong", coord: coordLabel(row, col), num: num };
  }

  function getLeaderboard(limit) {
    var entries = Object.keys(state.scores).map(function (id) {
      var s = state.scores[id];
      return { uniqueId: id, name: s.name, correct: s.correct, wrong: s.wrong, points: s.points };
    });
    entries.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      return b.correct - a.correct;
    });
    return entries.slice(0, limit || 10);
  }

  function getPublicState() {
    return {
      mode: state.mode,
      board: state.board,
      givenMask: state.givenMask,
      solved: state.solved,
      rawEventCount: state.rawEventCount,
      lastReceived: state.lastReceived,
      leaderboard: getLeaderboard(10)
    };
  }

  return {
    state: state,
    reset: reset,
    applyGuess: applyGuess,
    getLeaderboard: getLeaderboard,
    getPublicState: getPublicState
  };
}

// ---------------------------------------------------------------------------
// 4. TIKTOK LIVE CONNECTOR - loaded dynamically so this works whether the
//    installed package ships as CommonJS or an ES module, and wrapped so a
//    failure here only shows a friendly status message instead of crashing.
// ---------------------------------------------------------------------------
function createTikTokConnector(onChat, onStatus, onRawEvent) {
  var TikTokLiveConnection = null;
  var WebcastEvent = null;
  var activeConnection = null;
  var retryCount = 0;
  var MAX_RETRIES = 3;

  async function loadLibrary() {
    if (TikTokLiveConnection) return;
    var lib = await import("tiktok-live-connector");
    var mod = lib && lib.default ? Object.assign({}, lib, lib.default) : lib;
    TikTokLiveConnection = mod.TikTokLiveConnection || mod.WebcastPushConnection;
    WebcastEvent = mod.WebcastEvent;
    if (!TikTokLiveConnection) {
      throw new Error("Could not find a connection class in the tiktok-live-connector package.");
    }
  }

  function extractChatFields(data) {
    if (!data) return null;
    var text = null;
    if (typeof data.comment === "string") text = data.comment;
    else if (typeof data.text === "string") text = data.text;
    else if (typeof data.message === "string") text = data.message;
    else if (data.content && typeof data.content.text === "string") text = data.content.text;
    if (text === null) return null;

    var uniqueId = "unknown";
    if (data.user && data.user.uniqueId) uniqueId = data.user.uniqueId;
    else if (data.user && data.user.id) uniqueId = data.user.id;
    else if (data.uniqueId) uniqueId = data.uniqueId;
    else if (data.userId) uniqueId = data.userId;

    var nickname = uniqueId;
    if (data.user && data.user.nickname) nickname = data.user.nickname;
    else if (data.user && data.user.displayName) nickname = data.user.displayName;
    else if (data.nickname) nickname = data.nickname;

    return { text: String(text), uniqueId: String(uniqueId), nickname: String(nickname) };
  }

  function wireEvents(connection) {
    var chatEventName = (WebcastEvent && WebcastEvent.CHAT) || "chat";
    connection.on(chatEventName, function (data) {
      try {
        console.log("[TikTok raw chat event]", JSON.stringify(data).slice(0, 500));
        onRawEvent(data);
        var extracted = extractChatFields(data);
        if (extracted) onChat(extracted);
      } catch (err) {
        console.error("[chat handler error - swallowed, server kept running]", err);
      }
    });
    connection.on("disconnected", function () {
      try { onStatus("disconnected", "Disconnected from TikTok LIVE."); } catch (e) {}
    });
    connection.on("streamEnd", function () {
      try { onStatus("disconnected", "The TikTok LIVE stream ended."); } catch (e) {}
    });
    connection.on("error", function (err) {
      try { onStatus("error", "Runtime error: " + (err && err.message ? err.message : err)); } catch (e) {}
    });
  }

  async function connect(username, signApiKey) {
    if (!signApiKey) {
      onStatus("error", "Missing Sign API Key. Get a free one at eulerstream.com and paste it in above.");
      return;
    }
    try {
      onStatus("connecting", "Loading TikTok connector library...");
      await loadLibrary();
      onStatus("connecting", "Connecting to @" + username + " ...");
      activeConnection = new TikTokLiveConnection(username, { signApiKey: signApiKey });
      wireEvents(activeConnection);
      var result = await activeConnection.connect();
      retryCount = 0;
      var roomId = result && result.roomId ? result.roomId : "";
      onStatus("connected", "Connected! Room ID: " + roomId);
    } catch (err) {
      var message = err && err.message ? err.message : String(err);
      onStatus("error", "Connection failed: " + message);
      await retry(username, signApiKey);
    }
  }

  async function retry(username, signApiKey) {
    if (retryCount >= MAX_RETRIES) {
      onStatus("error", "Gave up after " + MAX_RETRIES + " tries. Double-check the username and Sign API Key, then click Connect again.");
      retryCount = 0;
      return;
    }
    retryCount++;
    var delayMs = 1500 * retryCount;
    onStatus("retrying", "Retry " + retryCount + " of " + MAX_RETRIES + " in " + (delayMs / 1000) + "s...");
    await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
    await connect(username, signApiKey);
  }

  function disconnect() {
    try {
      if (activeConnection) activeConnection.disconnect();
    } catch (err) {
      console.error("[disconnect error - swallowed]", err);
    }
    activeConnection = null;
    onStatus("disconnected", "Disconnected.");
  }

  return { connect: connect, disconnect: disconnect };
}

// ---------------------------------------------------------------------------
// 5. EXPRESS + SOCKET.IO SERVER
// ---------------------------------------------------------------------------
var app = express();
app.use(express.static(path.join(__dirname, "public")));

var httpServer = http.createServer(app);
var io = new Server(httpServer);

var game = createGameState();

function broadcastState() {
  io.emit("state", game.getPublicState());
}

// Wraps a handler so a thrown error is logged, never crashes the server.
function safe(fn) {
  return function () {
    try {
      fn.apply(null, arguments);
    } catch (err) {
      console.error("[handler error - swallowed, server kept running]", err);
    }
  };
}

function processComment(text, uniqueId, nickname, source) {
  game.state.rawEventCount += 1;
  game.state.lastReceived = { uniqueId: uniqueId, nickname: nickname, text: text, source: source, at: Date.now() };
  io.emit("diagnostics", { rawEventCount: game.state.rawEventCount, lastReceived: game.state.lastReceived });

  var parsed = parseGuess(text);
  if (!parsed) {
    io.emit("guessResult", { uniqueId: uniqueId, nickname: nickname, text: text, status: "unparsed" });
    return;
  }
  var result = game.applyGuess(parsed.row, parsed.col, parsed.num, uniqueId, nickname);
  io.emit("guessResult", {
    uniqueId: uniqueId,
    nickname: nickname,
    text: text,
    coord: parsed.coordLabel,
    num: parsed.num,
    status: result.status,
    solved: result.solved
  });
  broadcastState();
  if (result.status === "correct" && result.solved) {
    io.emit("puzzleSolved", { leaderboard: game.getLeaderboard(10) });
  }
}

var tiktok = createTikTokConnector(
  function onChat(fields) {
    processComment(fields.text, fields.uniqueId, fields.nickname, "tiktok-live");
  },
  function onStatus(state, message) {
    io.emit("liveStatus", { state: state, message: message });
  },
  function onRawEvent() {
    // raw events are already logged to the server console inside the connector
  }
);

var FAKE_VIEWER_NAMES = ["SudokuFan", "LiveViewer", "ChatMaster", "PuzzlePro", "NightOwl", "QuickSolver"];

io.on("connection", function (socket) {
  console.log("[client connected]", socket.id);
  socket.emit("state", game.getPublicState());
  socket.emit("liveStatus", { state: "idle", message: "Not connected." });

  socket.on("host:setMode", safe(function (payload) {
    if (!payload || !payload.mode) return;
    game.state.mode = payload.mode;
    broadcastState();
  }));

  socket.on("host:connectLive", safe(function (payload) {
    if (!payload) return;
    tiktok.connect(String(payload.username || "").replace("@", ""), String(payload.signApiKey || ""));
  }));

  socket.on("host:disconnectLive", safe(function () {
    tiktok.disconnect();
  }));

  socket.on("host:newPuzzle", safe(function (payload) {
    var difficulty = payload && payload.difficulty ? payload.difficulty : "medium";
    game.reset(difficulty);
    broadcastState();
  }));

  socket.on("host:comment", safe(function (payload) {
    if (!payload || !payload.text) return;
    processComment(payload.text, "host", "Host (You)", "host-console");
  }));

  socket.on("offline:guess", safe(function (payload) {
    if (!payload || !payload.text) return;
    processComment(payload.text, "offline-player", "You", "offline");
  }));

  socket.on("test:simulate", safe(function (payload) {
    var text = payload && payload.text ? payload.text : null;
    var name = FAKE_VIEWER_NAMES[Math.floor(Math.random() * FAKE_VIEWER_NAMES.length)] + Math.floor(Math.random() * 999);
    if (!text) {
      var row = Math.floor(Math.random() * 9);
      var col = Math.floor(Math.random() * 9);
      var useRealAnswer = Math.random() < 0.4;
      var num = useRealAnswer ? game.state.solution[row][col] : (Math.floor(Math.random() * 9) + 1);
      text = String.fromCharCode(65 + row) + (col + 1) + " " + num;
    }
    processComment(text, "fake-" + name, name, "test-mode");
  }));

  socket.on("disconnect", function () {
    console.log("[client disconnected]", socket.id);
  });
});

var PORT = process.env.PORT || 3000;
httpServer.listen(PORT, function () {
  console.log("TikTok Sudoku LIVE server running on port " + PORT);
});
