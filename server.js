// server.js - TikTok Sudoku LIVE (all-in-one deployment build)
// This single file contains the whole backend: the Sudoku engine, the chat
// message parser, the game state manager, the TikTok LIVE connector, and
// the Express + Socket.IO server that ties it all together.

const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// Loads variables from a local ".env" file (EULERSTREAM_SIGN_API_KEY,
// TIKTOK_USERNAME, PORT) into process.env when running on your own computer.
// Wrapped in a try/catch so a missing/corrupt .env or a missing dotenv
// package never crashes the server - Render's own dashboard variables don't
// need this at all, since Render injects them directly into process.env.
try {
  require("dotenv").config();
} catch (err) {
  console.warn("[dotenv] Could not load .env file (this is fine on Render): " + (err && err.message ? err.message : err));
}

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
// 0b. TIKTOK LIVE DEFAULTS - read from environment variables (set in a local
//     .env file for testing, and in Render's Environment tab for the live
//     deployment) so the host does not have to paste the Sign API Key into
//     the website every single time. The key itself is never sent to the
//     browser - only whether a default is configured.
// ---------------------------------------------------------------------------
var DEFAULT_TIKTOK_USERNAME = String(process.env.TIKTOK_USERNAME || "").replace("@", "").trim();
var DEFAULT_SIGN_API_KEY = String(process.env.EULERSTREAM_SIGN_API_KEY || "").trim();

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

function generatePuzzle(clues) {
  var solution = generateSolvedBoard();
  var puzzle = solution.map(function (row) { return row.slice(); });
  if (!clues || clues < 17) clues = 30;
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
// 1b. PUZZLE BANK - pre-generates a large pool of puzzles for each difficulty
//     (at least 100 apiece) at server startup, so hitting "New Puzzle" during
//     a live show is instant and the audience sees a lot of variety instead
//     of the same few boards. Puzzles are drawn from a shuffled queue that is
//     reshuffled once the whole bank has been used, so every puzzle in the
//     bank is seen once before any repeats.
// ---------------------------------------------------------------------------
var DIFFICULTIES = ["very-easy", "easy", "moderate", "hard", "very-hard", "extreme", "extremely-hard"];
var CLUE_COUNTS = {
  "very-easy": 48,
  "easy": 42,
  "moderate": 36,
  "hard": 30,
  "very-hard": 26,
  "extreme": 23,
  "extremely-hard": 20
};
var DEFAULT_DIFFICULTY = "moderate";
var PUZZLES_PER_DIFFICULTY = 200;
var puzzleBank = {};
var puzzleDrawQueue = {};

function buildPuzzleBank() {
  var startedAt = Date.now();
  DIFFICULTIES.forEach(function (difficulty) {
    var clues = CLUE_COUNTS[difficulty];
    var list = [];
    for (var i = 0; i < PUZZLES_PER_DIFFICULTY; i++) {
      list.push(generatePuzzle(clues));
    }
    puzzleBank[difficulty] = list;
    puzzleDrawQueue[difficulty] = [];
  });
  console.log(
    "[puzzle bank] generated " + PUZZLES_PER_DIFFICULTY + " puzzles each for " +
    DIFFICULTIES.join(", ") + " in " + (Date.now() - startedAt) + "ms"
  );
}
buildPuzzleBank();

function shuffledIndices(count) {
  var arr = [];
  for (var i = 0; i < count; i++) arr.push(i);
  for (var j = arr.length - 1; j > 0; j--) {
    var k = Math.floor(Math.random() * (j + 1));
    var tmp = arr[j]; arr[j] = arr[k]; arr[k] = tmp;
  }
  return arr;
}

function drawPuzzle(difficulty) {
  if (!puzzleBank[difficulty] || puzzleBank[difficulty].length === 0) difficulty = DEFAULT_DIFFICULTY;
  if (!puzzleDrawQueue[difficulty] || puzzleDrawQueue[difficulty].length === 0) {
    puzzleDrawQueue[difficulty] = shuffledIndices(puzzleBank[difficulty].length);
  }
  var idx = puzzleDrawQueue[difficulty].pop();
  return puzzleBank[difficulty][idx];
}

// ---------------------------------------------------------------------------
// 2. CHAT PARSER - recognizes "A5 7" style algebraic-notation guesses.
//
// DESIGN (rewritten to be separator-agnostic instead of separator-enumerated):
// The old version required the space between the column digit and the
// number to be one of a hand-picked list of characters (space, comma,
// colon, equals, hyphen, later period). That list can never be complete -
// different phones/keyboards/IMEs insert different auto-punctuation
// (periods, arrows, ellipses, emoji, double spaces, etc.) when a viewer
// double-taps space or their autocorrect "helps". Any character left off
// the list meant a perfectly-typed "A5 7" could still come out unparsed.
//
// So instead of asking "was the separator one of these N characters?", the
// parser now asks the more robust question: "ignoring anything that isn't
// a letter or a digit, is there an A-I followed by two digits 1-9?" -
// i.e. ANY run of non-alphanumeric characters (or nothing at all) between
// the row letter and the two digits is accepted as a separator. This
// covers every separator the old list covered, plus anything else a
// keyboard, emoji, or copy-paste artifact could ever insert, without
// needing to keep guessing at new characters to add.
//
// It still requires the row letter and the two digits to be genuinely
// adjacent (only punctuation/symbols/emoji/whitespace between them, never
// other letters or digits) so it won't start matching unrelated chatter.
//
// Full-width digits/letters and invisible formatting characters (common on
// some phone keyboards/emoji, especially in Asia) are stripped/normalized
// to plain ASCII before matching.
// ---------------------------------------------------------------------------
var NON_ALNUM = "[^A-Za-z0-9]";
// Row letter, then any junk (or none), then the column digit, then AT LEAST
// ONE piece of junk (this is what makes it "not the compact form"), then
// the value digit.
var CELL_GUESS_REGEX = new RegExp("\\b([A-I])" + NON_ALNUM + "*([1-9])" + NON_ALNUM + "+([1-9])\\b", "i");
// Compact form: letter immediately followed by exactly two digits, e.g. "A57".
var CELL_GUESS_COMPACT_REGEX = /\b([A-I])([1-9])([1-9])\b/i;

function normalizeGuessText(text) {
  return text
    // Zero-width spaces/joiners, BOM, bidi control marks, word joiner,
    // and emoji variation selectors - all invisible, all seen in the wild
    // in real chat payloads, none of them should ever break a match.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\uFE0E\uFE0F]/g, "")
    .replace(/[\uFF10-\uFF19]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30); })
    .replace(/[\uFF21-\uFF3A]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFF21 + 0x41); })
    .replace(/[\uFF41-\uFF5A]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFF41 + 0x61); });
}

function parseGuess(text) {
  if (!text || typeof text !== "string") return null;
  var cleaned = normalizeGuessText(text);
  var match = cleaned.match(CELL_GUESS_REGEX);
  if (!match) match = cleaned.match(CELL_GUESS_COMPACT_REGEX);
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
// 2b. SELF-TEST - runs at server startup (not on every request) against a
//     wide battery of real-world-shaped inputs, so any future edit to the
//     regexes above that breaks parsing is caught LOUDLY in the logs the
//     moment the server boots, instead of silently shipping and being
//     discovered days later from "wrong format" reports. This is the
//     failsafe: a regression here is a startup-log error, not a mystery.
// ---------------------------------------------------------------------------
function runParseGuessSelfTest() {
  var mustParse = [
    ["A5 7", "A5", 7], ["a5 7", "A5", 7], ["A5,7", "A5", 7], ["A5:7", "A5", 7],
    ["A5-7", "A5", 7], ["A5=7", "A5", 7], ["A57", "A5", 7], ["A5.7", "A5", 7],
    ["A5. 7", "A5", 7], ["A5  7", "A5", 7], ["A5   7.", "A5", 7], ["A5 7!", "A5", 7],
    ["A5 7?", "A5", 7], ["A5->7", "A5", 7], ["A5...7", "A5", 7], ["A5~7", "A5", 7],
    ["A5 7 😄", "A5", 7], ["😄A5 7", "A5", 7], ["A5😄7", "A5", 7], [" A5 7 ", "A5", 7],
    ["row A5 7 please", "A5", 7], ["I9 9", "I9", 9], ["b3 4", "B3", 4],
    ["A5\t7", "A5", 7], ["A5\n7", "A5", 7], ["my guess: A5 7!!", "A5", 7],
    ["A5，7", "A5", 7] // full-width comma - falls through to junk class fine
  ];
  var mustNotParse = ["hello everyone", "J5 7", "A0 7", "A5 0", "just chatting", ""];

  var failures = 0;
  mustParse.forEach(function (t) {
    var res = parseGuess(t[0]);
    if (!res || res.coordLabel !== t[1] || res.num !== t[2]) {
      failures++;
      console.error("[parseGuess self-test FAILED] expected " + JSON.stringify(t) + " got " + JSON.stringify(res));
    }
  });
  mustNotParse.forEach(function (t) {
    var res = parseGuess(t);
    if (res) {
      failures++;
      console.error("[parseGuess self-test FAILED] expected null for " + JSON.stringify(t) + " got " + JSON.stringify(res));
    }
  });
  if (failures === 0) {
    console.log("[parseGuess self-test] all " + (mustParse.length + mustNotParse.length) + " cases passed.");
  } else {
    console.error("[parseGuess self-test] " + failures + " case(s) FAILED - see above. The chat parser needs attention.");
  }
}
runParseGuessSelfTest();

// ---------------------------------------------------------------------------
// 3. GAME STATE
// ---------------------------------------------------------------------------
// How many rows each leaderboard sends to the screen (same limits the Memory
// game uses). Viewers with 0 points are never listed.
var LEADERBOARD_ROUND_LIMIT = 500;
var LEADERBOARD_ALLTIME_LIMIT = 1000;

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
    scores: {},           // this round only - reset every new puzzle
    allTimeScores: {},    // every puzzle, ever - saved to cloud/disk (see section 3b)
    rawEventCount: 0,
    lastReceived: null,
    lastDifficulty: DEFAULT_DIFFICULTY,
    autoNextRound: false, // when true, a new puzzle starts automatically after each solve
    configured: false,    // true once a host has changed a setting (or a saved round was restored) since the server started
    roundStartTime: Date.now(), // used to show elapsed solve time - there is NO time limit
    solveTimeMs: null
  };

  function reset(difficulty) {
    difficulty = difficulty || state.lastDifficulty || DEFAULT_DIFFICULTY;
    state.lastDifficulty = difficulty;
    var built = drawPuzzle(difficulty);
    state.puzzle = built.puzzle;
    state.solution = built.solution;
    state.board = built.puzzle.map(function (row) { return row.slice(); });
    state.givenMask = built.puzzle.map(function (row) {
      return row.map(function (v) { return v !== 0; });
    });
    state.solved = false;
    state.scores = {};
    state.roundStartTime = Date.now();
    state.solveTimeMs = null;
  }
  reset(DEFAULT_DIFFICULTY);

  function setAutoNext(enabled) {
    state.autoNextRound = !!enabled;
  }

  function ensurePlayer(uniqueId, displayName, avatarUrl) {
    if (!state.scores[uniqueId]) {
      state.scores[uniqueId] = { name: displayName || uniqueId, avatar: avatarUrl || null, correct: 0, wrong: 0, points: 0 };
    } else {
      if (displayName) state.scores[uniqueId].name = displayName;
      if (avatarUrl) state.scores[uniqueId].avatar = avatarUrl;
    }
    if (!state.allTimeScores[uniqueId]) {
      state.allTimeScores[uniqueId] = { name: displayName || uniqueId, avatar: avatarUrl || null, correct: 0, wrong: 0, points: 0 };
    } else {
      if (displayName) state.allTimeScores[uniqueId].name = displayName;
      if (avatarUrl) state.allTimeScores[uniqueId].avatar = avatarUrl;
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

  function applyGuess(row, col, num, uniqueId, displayName, avatarUrl) {
    if (state.givenMask[row][col]) {
      return { status: "given", coord: coordLabel(row, col) };
    }
    if (state.board[row][col] === state.solution[row][col] && state.board[row][col] !== 0) {
      return { status: "already-solved", coord: coordLabel(row, col) };
    }
    ensurePlayer(uniqueId, displayName, avatarUrl);
    var correct = state.solution[row][col] === num;
    if (correct) {
      state.board[row][col] = num;
      // 1 point per correct guess - both for this round and the all-time total.
      state.scores[uniqueId].correct += 1;
      state.scores[uniqueId].points += 1;
      state.allTimeScores[uniqueId].correct += 1;
      state.allTimeScores[uniqueId].points += 1;
      var solvedNow = checkSolved();
      if (solvedNow) {
        state.solved = true;
        // No time limit in this game - we only record how long it took to
        // solve, purely for information/bragging rights.
        state.solveTimeMs = Date.now() - state.roundStartTime;
      }
      return { status: "correct", coord: coordLabel(row, col), num: num, solved: solvedNow };
    }
    state.scores[uniqueId].wrong += 1;
    state.allTimeScores[uniqueId].wrong += 1;
    return { status: "wrong", coord: coordLabel(row, col), num: num };
  }

  // ---- Hints / Reveals (host-triggered, never award any player points) --
  function markSolvedIfNeeded() {
    var solvedNow = checkSolved();
    if (solvedNow && !state.solved) {
      state.solved = true;
      state.solveTimeMs = Date.now() - state.roundStartTime;
    }
    return solvedNow;
  }

  function findUnsolvedCells(withinBox) {
    var cells = [];
    var rStart = 0, rEnd = 9, cStart = 0, cEnd = 9;
    if (withinBox) {
      rStart = withinBox.row; rEnd = withinBox.row + 3;
      cStart = withinBox.col; cEnd = withinBox.col + 3;
    }
    for (var r = rStart; r < rEnd; r++) {
      for (var c = cStart; c < cEnd; c++) {
        if (!state.givenMask[r][c] && state.board[r][c] !== state.solution[r][c]) {
          cells.push({ row: r, col: c });
        }
      }
    }
    return cells;
  }

  // Reveals one random still-unsolved cell (the "smaller box" hint).
  function revealCell() {
    if (state.solved) return { revealed: 0, justSolved: false };
    var candidates = findUnsolvedCells(null);
    if (!candidates.length) return { revealed: 0, justSolved: false };
    var pick = candidates[Math.floor(Math.random() * candidates.length)];
    state.board[pick.row][pick.col] = state.solution[pick.row][pick.col];
    var solvedNow = markSolvedIfNeeded();
    return { revealed: 1, coord: coordLabel(pick.row, pick.col), justSolved: solvedNow };
  }

  // Reveals a whole random 3x3 box that still has unsolved cells in it
  // (the "bigger box" reveal).
  function revealBox() {
    if (state.solved) return { revealed: 0, justSolved: false };
    var boxOrder = shuffledIndices(9);
    var target = null;
    for (var i = 0; i < boxOrder.length; i++) {
      var boxRow = Math.floor(boxOrder[i] / 3) * 3;
      var boxCol = (boxOrder[i] % 3) * 3;
      var cells = findUnsolvedCells({ row: boxRow, col: boxCol });
      if (cells.length) { target = cells; break; }
    }
    if (!target) return { revealed: 0, justSolved: false };
    target.forEach(function (cell) {
      state.board[cell.row][cell.col] = state.solution[cell.row][cell.col];
    });
    var solvedNow = markSolvedIfNeeded();
    return { revealed: target.length, justSolved: solvedNow };
  }

  // Reveals the entire board - instantly ends the round.
  function revealBoard() {
    if (state.solved) return { revealed: 0, justSolved: false };
    var revealedCount = findUnsolvedCells(null).length;
    for (var r = 0; r < 9; r++) {
      for (var c = 0; c < 9; c++) {
        state.board[r][c] = state.solution[r][c];
      }
    }
    state.solved = true;
    state.solveTimeMs = Date.now() - state.roundStartTime;
    return { revealed: revealedCount, justSolved: true };
  }

  function buildLeaderboard(scoresObj, limit) {
    var entries = Object.keys(scoresObj).map(function (id) {
      var s = scoresObj[id];
      return { uniqueId: id, name: s.name, avatar: s.avatar || null, correct: s.correct, wrong: s.wrong, points: s.points };
    }).filter(function (entry) {
      // A viewer who has only guessed wrong so far has nothing to show.
      return entry.points > 0;
    });
    entries.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      return b.correct - a.correct;
    });
    // No default cap - the round leaderboard shows every scorer, and the
    // all-time leaderboard sends everyone too (the UI shows the top ~20 at
    // a glance and scrolls for the rest). Pass an explicit limit to cap it.
    return entries.slice(0, limit || Infinity);
  }

  function getLeaderboard(limit) {
    return buildLeaderboard(state.scores, limit || LEADERBOARD_ROUND_LIMIT);
  }

  function getAllTimeLeaderboard(limit) {
    return buildLeaderboard(state.allTimeScores, limit || LEADERBOARD_ALLTIME_LIMIT);
  }

  function getPublicState() {
    return {
      mode: state.mode,
      board: state.board,
      givenMask: state.givenMask,
      solved: state.solved,
      rawEventCount: state.rawEventCount,
      lastReceived: state.lastReceived,
      leaderboard: getLeaderboard(),
      allTimeLeaderboard: getAllTimeLeaderboard(),
      autoNextRound: state.autoNextRound,
      lastDifficulty: state.lastDifficulty,
      roundStartTime: state.roundStartTime,
      solveTimeMs: state.solveTimeMs
    };
  }

  return {
    state: state,
    reset: reset,
    applyGuess: applyGuess,
    revealCell: revealCell,
    revealBox: revealBox,
    revealBoard: revealBoard,
    setAutoNext: setAutoNext,
    getLeaderboard: getLeaderboard,
    getAllTimeLeaderboard: getAllTimeLeaderboard,
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
  var SignConfig = null;
  var activeConnection = null;
  var retryCount = 0;
  var MAX_INITIAL_RETRIES = 3;

  // ---- Connection-health tracking -----------------------------------------
  // The single biggest real-world failure mode of this kind of reverse-
  // engineered WebSocket connection is a "zombie" connection: the socket
  // never receives a clean close, so the library never fires 'disconnected'
  // or 'error', and the host console keeps showing "Connected!" forever even
  // though no viewer comment is getting through any more. The only reliable
  // way to catch this is to track when ANY data last arrived (not just chat -
  // the viewer-count/"roomUser" event alone pings in constantly on a healthy
  // connection) and force a fresh reconnect if it's gone quiet for too long.
  var desiredConnected = false; // true once the host asks to connect, until they explicitly disconnect
  var lastUsername = null;
  var lastSignApiKey = null;
  var lastActivityAt = 0;
  var reconnectTimer = null;
  var watchdogTimer = null;
  var reconnectAttempt = 0;
  var isConnecting = false; // guards against two connect() calls racing each other

  var WATCHDOG_CHECK_MS = 20000;    // how often we check for a stalled connection
  var WATCHDOG_STALE_MS = 120000;   // no data AT ALL for this long while "connected" = assume it's dead
  var RECONNECT_BASE_DELAY_MS = 3000;
  var RECONNECT_MAX_DELAY_MS = 30000;
  var RATE_LIMIT_DEFAULT_COOLDOWN_MS = 60000; // used when a 429 doesn't tell us how long to wait

  // ---------------------------------------------------------------------
  // FAILSAFE LOGGING: root-caused a real incident where the console only
  // ever showed `[TikTok connector] first time seeing event: "error"` on
  // repeat, with the actual reason invisible - because the underlying
  // error was only ever handed to onStatus() (which goes to the browser),
  // never to console.error(). That made a real bug (see below) look like
  // an unexplainable mystery from the Render logs alone.
  //
  // This helper is now the ONLY place that reports a connector failure,
  // and it always prints everything the error object has - message, name,
  // any HTTP status/retry-after info the library attaches, and the stack -
  // so the real cause is on the screen (Render logs) the moment it happens,
  // not just in a toast that scrolled away.
  // ---------------------------------------------------------------------
  function describeError(err) {
    if (!err) return { message: "Unknown error (no error object was provided).", retryAfterMs: null };
    var parts = [];
    var name = err.name || (err.constructor && err.constructor.name) || "Error";
    var message = err.message || String(err);
    parts.push(name + ": " + message);

    // tiktok-live-connector's SignatureRateLimitError (and similar) attach
    // rate-limit metadata under a few different possible shapes depending
    // on version. We check all of them rather than assuming one.
    var retryAfterMs = null;
    var candidates = [
      err.retryAfter, err.retry_after,
      err.response && err.response.headers && err.response.headers["retry-after"],
      err.headers && err.headers["retry-after"]
    ];
    for (var i = 0; i < candidates.length; i++) {
      var v = candidates[i];
      if (v !== undefined && v !== null && !isNaN(Number(v))) {
        retryAfterMs = Number(v) * 1000;
        parts.push("retry-after: " + v + "s");
        break;
      }
    }
    if (err.code) parts.push("code: " + err.code);
    if (err.response && err.response.status) parts.push("http status: " + err.response.status);

    var isRateLimit =
      /rate ?limit/i.test(name) || /rate ?limit/i.test(message) ||
      (err.response && err.response.status === 429) ||
      /429/.test(message);

    return {
      message: parts.join(" | "),
      retryAfterMs: retryAfterMs,
      isRateLimit: isRateLimit,
      stack: err.stack || null
    };
  }

  function reportFailure(context, err) {
    var info = describeError(err);
    // Always goes to the Render/console logs, in full - this is the fix for
    // "the real reason never showed up anywhere".
    console.error("[TikTok connector] " + context + ": " + info.message);
    if (info.stack) console.error(info.stack);
    return info;
  }

  async function loadLibrary() {
    if (TikTokLiveConnection) return;
    var lib = await import("tiktok-live-connector");
    var mod = lib && lib.default ? Object.assign({}, lib, lib.default) : lib;
    TikTokLiveConnection = mod.TikTokLiveConnection || mod.WebcastPushConnection;
    WebcastEvent = mod.WebcastEvent;
    SignConfig = mod.SignConfig || null;
    if (!TikTokLiveConnection) {
      throw new Error("Could not find a connection class in the tiktok-live-connector package.");
    }
  }

  // Pulls plain text out of whatever shape a "comment"-like field turns out
  // to be. Most of the time it's a plain string, but some payload variants
  // (rich text with mentions/stickers) represent it as an array of text
  // "runs" (e.g. [{type:"text", text:"A5 7"}]) or a single nested object
  // instead. Handling those here means a correctly-typed guess never gets
  // silently dropped just because it arrived in an unexpected wrapper.
  function coerceCommentText(value) {
    if (value === null || typeof value === "undefined") return null;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      var joined = value
        .map(function (part) {
          if (typeof part === "string") return part;
          if (part && typeof part.text === "string") return part.text;
          if (part && typeof part.content === "string") return part.content;
          return "";
        })
        .join("");
      return joined || null;
    }
    if (typeof value === "object") {
      if (typeof value.text === "string") return value.text;
      if (typeof value.content === "string") return value.content;
    }
    return null;
  }

  function extractChatFields(data) {
    if (!data) return null;
    var text = coerceCommentText(data.comment) ||
      coerceCommentText(data.text) ||
      coerceCommentText(data.message) ||
      coerceCommentText(data.content);
    // NOTE: this used to `return null` right here if no text field was
    // found, which silently discarded the WHOLE event - uniqueId, nickname,
    // everything - and meant it never showed up anywhere, not even as an
    // "unparsed" entry. Now we keep going and still return what we found,
    // with text left null; the caller treats a null text as an unparsed
    // guess but still counts and displays the event.

    // The exact shape of "who sent this" has changed across tiktok-live-
    // connector releases (nested under `.user`, flattened onto the message
    // itself, or both at once depending on version) so every known spot is
    // tried, in order, before giving up and lumping the viewer in as
    // "unknown" (their guess still counts, it just won't show a name).
    var uniqueId = "unknown";
    if (data.user && data.user.uniqueId) uniqueId = data.user.uniqueId;
    else if (data.user && data.user.id) uniqueId = data.user.id;
    else if (data.uniqueId) uniqueId = data.uniqueId;
    else if (data.userId) uniqueId = data.userId;

    var nickname = uniqueId;
    if (data.user && data.user.nickname) nickname = data.user.nickname;
    else if (data.user && data.user.nickName) nickname = data.user.nickName;
    else if (data.user && data.user.displayName) nickname = data.user.displayName;
    else if (data.nickname) nickname = data.nickname;
    else if (data.nickName) nickname = data.nickName;

    // TikTok's live-connector library has shipped several different shapes
    // for the viewer's profile picture across versions, so we try each of
    // the known spots and fall back to null (the client then draws a
    // generated circular initials avatar instead).
    var avatarUrl = null;
    function firstUrl(obj) {
      if (!obj) return null;
      if (typeof obj === "string") return obj;
      if (Array.isArray(obj) && obj.length) return obj[0];
      if (obj.urlList && obj.urlList.length) return obj.urlList[0];
      if (obj.url && Array.isArray(obj.url) && obj.url.length) return obj.url[0];
      if (obj.url && typeof obj.url === "string") return obj.url;
      if (obj.urls && obj.urls.length) return obj.urls[0];
      return null;
    }
    if (data.user) {
      avatarUrl = firstUrl(data.user.profilePicture) ||
        firstUrl(data.user.avatarThumbnail) ||
        firstUrl(data.user.avatarMedium) ||
        firstUrl(data.user.avatarLarger) ||
        (typeof data.user.avatarUrl === "string" ? data.user.avatarUrl : null) ||
        (typeof data.user.profilePictureUrl === "string" ? data.user.profilePictureUrl : null);
    }
    if (!avatarUrl && typeof data.avatarUrl === "string") avatarUrl = data.avatarUrl;
    if (!avatarUrl && typeof data.profilePictureUrl === "string") avatarUrl = data.profilePictureUrl;

    return { text: text === null ? null : String(text), uniqueId: String(uniqueId), nickname: String(nickname), avatarUrl: avatarUrl ? String(avatarUrl) : null };
  }

  // ---------------------------------------------------------------------
  // FAILSAFE: message de-duplication by a real ID, not object identity.
  //
  // The previous version used a WeakSet keyed on the raw event OBJECT to
  // avoid double-processing the same comment when it happened to fire
  // under two different event-name aliases. That only works if the
  // decoder always hands out a brand-new object per message - if any
  // version of the library ever reuses/mutates a buffer object across
  // consecutive messages (a common performance pattern in binary/protobuf
  // decoders), object-identity dedup would silently treat a second,
  // genuinely different comment as "already seen" and drop it. That is a
  // plausible explanation for "a correctly-formatted guess just never
  // showed up at all" - it wouldn't even a leave a console trace.
  //
  // This replaces it with dedup by the message's own ID (whichever field
  // the payload actually has), which is correct either way: it still
  // collapses true duplicate deliveries (a known behavior of at-least-once
  // WebSocket delivery, and of binding the same handler to multiple event
  // aliases), but it can never mistake two different comments for the same
  // one. IDs are remembered for a short TTL and the table is capped, so
  // this can never grow unbounded across a long stream.
  // ---------------------------------------------------------------------
  var seenMessageIds = new Map(); // id -> timestamp seen
  var DEDUP_TTL_MS = 15000;
  var DEDUP_MAX_ENTRIES = 2000;

  function extractMessageId(data) {
    if (!data) return null;
    var candidates = [
      data.msgId, data.messageId, data.id,
      data.common && data.common.msgId,
      data.common && data.common.msg_id
    ];
    for (var i = 0; i < candidates.length; i++) {
      var v = candidates[i];
      if (v !== undefined && v !== null && v !== "") return String(v);
    }
    return null; // no id available - caller falls back to processing it (never silently drops without one)
  }

  function isDuplicateMessage(id) {
    if (!id) return false; // nothing to key on - don't guess, just process it
    var now = Date.now();
    if (seenMessageIds.has(id)) {
      seenMessageIds.set(id, now); // refresh so a burst of true dupes stays deduped
      return true;
    }
    seenMessageIds.set(id, now);
    // Trim occasionally rather than every call - cheap amortized cleanup.
    if (seenMessageIds.size > DEDUP_MAX_ENTRIES) {
      for (var key of seenMessageIds.keys()) {
        if (now - seenMessageIds.get(key) > DEDUP_TTL_MS) seenMessageIds.delete(key);
      }
    }
    return false;
  }

  // FAILSAFE: full per-message payload dumps (JSON.stringify + two
  // console.log calls per comment) are useful while diagnosing a parsing
  // problem, but under a real, bursty live audience they add real CPU cost
  // on every single message - exactly when the event loop is busiest and
  // least able to spare it. Left on unconditionally, that's a plausible
  // contributor to "some correctly-formatted guesses just never registered"
  // under load. They're now opt-in via CHAT_DEBUG_LOG=true (set it in
  // Render's Environment tab, or a local .env, whenever you need to see
  // the raw payloads again) and OFF by default. The lightweight, always-on
  // path (rawEventCount/lastReceived/diagnostics panel) is untouched and
  // costs only a property assignment - that's the normal way to see what's
  // coming in.
  var CHAT_DEBUG_LOG = /^(1|true|yes)$/i.test(String(process.env.CHAT_DEBUG_LOG || ""));

  function markActivity() {
    lastActivityAt = Date.now();
  }

  // Newer tiktok-live-connector versions decode several protobuf fields
  // (userId, msgId, roomId, etc.) as native BigInt. JSON.stringify() throws
  // a hard TypeError ("Do not know how to serialize a BigInt") the instant
  // it meets one of those fields - it does not skip it or stringify it as
  // a number. A BigInt-aware replacer avoids that crash.
  function safeStringifyForLog(data) {
    try {
      return JSON.stringify(data, function (key, value) {
        return typeof value === "bigint" ? value.toString() : value;
      }).slice(0, 500);
    } catch (e) {
      return "[could not stringify chat payload for logging: " + (e && e.message ? e.message : e) + "]";
    }
  }

  // We previously bet everything on a single event name (WebcastEvent.CHAT,
  // falling back to the literal "chat"). If a future/older library build
  // fires chat messages under a different name than we expect, that single
  // listener silently never fires. So we bind the exact same handler to
  // every plausible alias: whatever WebcastEvent.CHAT resolves to, the
  // literal "chat", any other WebcastEvent key with "CHAT" in its name, and
  // a couple of literal names seen in other library forks.
  function collectChatAliases() {
    var aliases = ["chat"];
    if (WebcastEvent) {
      Object.keys(WebcastEvent).forEach(function (key) {
        if (!/chat/i.test(key)) return;
        var val = WebcastEvent[key];
        if (val && aliases.indexOf(val) === -1) aliases.push(val);
      });
    }
    ["WebcastChatMessage", "chatMessage", "member:chat"].forEach(function (name) {
      if (aliases.indexOf(name) === -1) aliases.push(name);
    });
    return aliases;
  }

  function wireEvents(connection) {
    // Diagnostic: logs the very first time we see each distinct event name
    // this connection ever emits. Confirmed working: Render logs showed
    // "chat" firing with real WebcastChatMessage payloads.
    try {
      var originalEmit = connection.emit.bind(connection);
      var seenEventNames = {};
      connection.emit = function (eventName) {
        if (!seenEventNames[eventName]) {
          seenEventNames[eventName] = true;
          console.log("[TikTok connector] first time seeing event: \"" + eventName + "\"");
        }
        return originalEmit.apply(null, arguments);
      };
    } catch (e) {
      console.error("[TikTok connector] could not install event-name logger - swallowed", e);
    }

    var chatAliases = collectChatAliases();
    chatAliases.forEach(function (chatEventName) {
      connection.on(chatEventName, function (data) {
        // See "FAILSAFE: message de-duplication by a real ID" above for why
        // this replaced the old WeakSet-by-object-identity check.
        var msgId = extractMessageId(data);
        if (isDuplicateMessage(msgId)) return;
      // THE REAL BUG, FOUND FROM YOUR LOGS: chat events were confirmed
      // arriving (you saw "[TikTok raw chat event]" lines), but the
      // diagnostics counter never moved. That only happens if
      // extractChatFields() was returning null for every one of them - and
      // the old code only called onChat()/incremented the counter
      // `if (extracted)`, so a real, arriving-but-unparseable event was
      // completely invisible from the UI. There was no way to tell "nothing
      // is arriving" apart from "things are arriving but failing to parse."
      //
      // Fix, in two parts:
      //   1. extractChatFields() below now NEVER returns null - if it can't
      //      find comment text, it still returns the uniqueId/nickname it
      //      found (or "unknown") with text left null, and parseGuess()
      //      already handles null text fine (reports "unparsed").
      //   2. onChat() is now called UNCONDITIONALLY for every real event,
      //      so rawEventCount/lastReceived in the Settings panel will light
      //      up for every single chat event that reaches this handler -
      //      giving you a true, unambiguous signal from now on.
      markActivity();

      var extracted = null;
      try {
        extracted = extractChatFields(data);
      } catch (err) {
        console.error("[chat extraction error - swallowed, server kept running]", err);
      }

      try {
        onChat(extracted || { text: null, uniqueId: "unknown", nickname: "unknown", avatarUrl: null });
      } catch (err) {
        console.error("[onChat handler error - swallowed, server kept running]", err);
      }

      try {
        onRawEvent(data);
      } catch (err) {
        console.error("[onRawEvent error - swallowed, server kept running]", err);
      }

      // Full payload dumps are opt-in (CHAT_DEBUG_LOG=true) - see the note
      // above CHAT_DEBUG_LOG's definition. They stay available for the next
      // time something needs diagnosing, without costing anything on every
      // single comment during a normal live show.
      if (CHAT_DEBUG_LOG) {
        try {
          console.log(
            "[chat field probe] topLevelKeys=" + JSON.stringify(Object.keys(data || {})) +
            " typeof(data.comment)=" + typeof (data && data.comment) +
            " data.comment=" + JSON.stringify(data && data.comment) +
            " typeof(data.user)=" + typeof (data && data.user) +
            " userKeys=" + JSON.stringify(data && data.user ? Object.keys(data.user) : null) +
            " data.user.uniqueId=" + JSON.stringify(data && data.user && data.user.uniqueId)
          );
        } catch (err) {
          console.error("[chat field probe error - swallowed]", err && err.message ? err.message : err);
        }

        try {
          console.log("[TikTok raw chat event]", safeStringifyForLog(data));
        } catch (err) {
          console.error("[chat debug log error - swallowed, server kept running]", err);
        }
      }
      });
    });

    // These don't need to be parsed - they only exist here so the watchdog
    // below can tell a genuinely healthy-but-quiet chat (no one has typed a
    // guess in a while, but viewer-count/like/join pings keep arriving)
    // apart from a truly dead connection (nothing at all arrives, ever,
    // because the underlying WebSocket died without a clean close event -
    // a well-known failure mode of unofficial/reverse-engineered TikTok
    // WebSocket libraries). Wrapped individually so an unknown/renamed event
    // in a future library version can never throw or block the others.
    ["roomUser", "member", "like", "social", "gift", "rawData", "decodedData", "websocketData"].forEach(function (name) {
      try { connection.on(name, markActivity); } catch (e) {}
    });

    connection.on("disconnected", function (info) {
      try {
        var reasonSuffix = info && info.reason ? " (" + info.reason + ")" : "";
        console.log("[TikTok connector] disconnected event" + reasonSuffix);
        onStatus("disconnected", "Disconnected from TikTok LIVE." + reasonSuffix);
      } catch (e) {}
      scheduleReconnect("the connection was closed");
    });
    connection.on("streamEnd", function () {
      try { onStatus("disconnected", "The TikTok LIVE stream ended. Watching for it to start again..."); } catch (e) {}
      scheduleReconnect("the stream ended");
    });
    connection.on("error", function (err) {
      var info = reportFailure("runtime error event", err);
      try { onStatus("error", "Runtime error: " + info.message); } catch (e) {}
      scheduleReconnect(info.isRateLimit ? "EulerStream rate-limited the request" : "a runtime error", info);
    });
  }

  // ---- Watchdog: catches a "zombie" connection --------------------------
  // If the status says "Connected!" but literally nothing has arrived from
  // TikTok - not a chat message, not a viewer-count update, nothing - for
  // more than WATCHDOG_STALE_MS, the underlying socket is almost certainly
  // dead without ever having fired a 'disconnected' or 'error' event. This
  // is exactly the situation described as "status shows connected but
  // guesses stop working": the fix is to notice it ourselves and force a
  // fresh reconnect instead of waiting forever for an event that will never
  // come.
  function stopWatchdog() {
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  }

  function startWatchdog() {
    stopWatchdog();
    watchdogTimer = setInterval(function () {
      if (!desiredConnected || !activeConnection) return;
      var quietForMs = Date.now() - lastActivityAt;
      if (quietForMs > WATCHDOG_STALE_MS) {
        console.error("[TikTok watchdog] no data at all for " + Math.round(quietForMs / 1000) + "s while marked connected - forcing a reconnect");
        try { onStatus("retrying", "Connection went quiet - reconnecting..."); } catch (e) {}
        try { activeConnection.disconnect(); } catch (e) {}
        activeConnection = null;
        stopWatchdog();
        scheduleReconnect("no data was arriving");
      }
    }, WATCHDOG_CHECK_MS);
  }

  // ---- Reconnect scheduling ------------------------------------------------
  // Handles both "the connection dropped mid-stream" (watchdog/disconnected/
  // error above) and "the streamer isn't live yet / the first connect
  // attempt failed" (retry() below) with the same backing timer, so the game
  // can recover on its own - the whole point of "fully automated" - without
  // the host needing to notice and click Connect again.
  function cancelReconnectTimer() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }

  function scheduleReconnect(reasonPhrase, errorInfo) {
    if (!desiredConnected) return; // the host explicitly disconnected - stay off
    cancelReconnectTimer();
    reconnectAttempt++;
    var delayMs = Math.min(RECONNECT_BASE_DELAY_MS * reconnectAttempt, RECONNECT_MAX_DELAY_MS);

    // FAILSAFE: a rate-limit response means "you are asking too often, slow
    // down" - retrying on the same short linear schedule as a normal
    // dropped connection just re-triggers the same limit and can spin
    // forever (this was the actual cause of the incident this was written
    // after: a library bug turned 429s into opaque errors, and the old
    // schedule kept re-hitting the limit every few seconds). If the
    // provider told us how long to wait, honor that exactly; otherwise use
    // a much longer fixed cooldown for rate limits specifically.
    if (errorInfo && errorInfo.isRateLimit) {
      delayMs = errorInfo.retryAfterMs && errorInfo.retryAfterMs > 0
        ? errorInfo.retryAfterMs + 1000 // small buffer past what the server asked for
        : Math.max(RATE_LIMIT_DEFAULT_COOLDOWN_MS, delayMs);
    }

    try {
      onStatus("retrying", "Lost connection (" + reasonPhrase + "). Reconnecting in " + Math.round(delayMs / 1000) + "s...");
    } catch (e) {}
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      if (!desiredConnected) return;
      connect(lastUsername, lastSignApiKey, true);
    }, delayMs);
  }

  async function connect(username, signApiKey, isAutoReconnect) {
    // FAILSAFE: guard against overlapping connect() calls. Without this, a
    // host double-clicking Connect, or a manual click landing at the same
    // moment as a scheduled auto-reconnect, could open two TikTokLiveConnection
    // sockets at once - which burns twice the EulerStream sign requests for
    // one game and makes rate-limit errors (see below) more likely, not less.
    if (isConnecting) {
      console.warn("[TikTok connector] connect() called while a connection attempt was already in progress - ignoring the extra call.");
      return;
    }
    isConnecting = true;

    username = username || lastUsername || DEFAULT_TIKTOK_USERNAME;
    signApiKey = signApiKey || lastSignApiKey || DEFAULT_SIGN_API_KEY;
    lastUsername = username;
    lastSignApiKey = signApiKey;
    desiredConnected = true;
    cancelReconnectTimer();
    stopWatchdog();
    if (activeConnection) {
      try { activeConnection.disconnect(); } catch (e) {}
      activeConnection = null;
    }

    if (!signApiKey) {
      isConnecting = false;
      onStatus("error", "Missing Sign API Key. Get a free one at eulerstream.com and paste it in above, or set EULERSTREAM_SIGN_API_KEY in the environment.");
      return;
    }
    if (!username) {
      isConnecting = false;
      onStatus("error", "Missing TikTok username.");
      return;
    }
    try {
      onStatus("connecting", isAutoReconnect ? "Reconnecting to @" + username + " ..." : "Loading TikTok connector library...");
      await loadLibrary();
      if (SignConfig) SignConfig.apiKey = signApiKey; // covers versions that only read the global config
      onStatus("connecting", "Connecting to @" + username + " ...");
      var connection = new TikTokLiveConnection(username, { signApiKey: signApiKey });
      wireEvents(connection);
      var result = await connection.connect();
      activeConnection = connection;
      retryCount = 0;
      reconnectAttempt = 0;
      markActivity();
      startWatchdog();
      var roomId = result && result.roomId ? result.roomId : "";
      onStatus("connected", "Connected! Room ID: " + roomId);
    } catch (err) {
      var info = reportFailure("connect() failed for @" + username, err);
      onStatus("error", "Connection failed: " + info.message);
      if (isAutoReconnect) {
        scheduleReconnect("the reconnect attempt failed", info);
      } else if (info.isRateLimit) {
        // Don't burn the quick-retry budget hammering a rate limit three
        // times in a row - go straight to the slower cooldown schedule.
        scheduleReconnect("EulerStream rate-limited the request", info);
      } else {
        await retry(username, signApiKey);
      }
    } finally {
      isConnecting = false;
    }
  }

  async function retry(username, signApiKey) {
    if (retryCount >= MAX_INITIAL_RETRIES) {
      onStatus("error", "Gave up after " + MAX_INITIAL_RETRIES + " quick tries. Still watching in the background - it will connect on its own once @" + username + " goes live, or double-check the username/Sign API Key and click Connect again.");
      retryCount = 0;
      // Keep trying slowly forever in the background instead of giving up
      // for good - this is what lets the show "just start" the moment the
      // host goes live, with nobody needing to come back and click Connect.
      scheduleReconnect("the streamer may not be live yet");
      return;
    }
    retryCount++;
    var delayMs = 1500 * retryCount;
    onStatus("retrying", "Retry " + retryCount + " of " + MAX_INITIAL_RETRIES + " in " + (delayMs / 1000) + "s...");
    await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
    await connect(username, signApiKey);
  }

  function disconnect() {
    desiredConnected = false;
    isConnecting = false;
    cancelReconnectTimer();
    stopWatchdog();
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

// A plain, unauthenticated health-check endpoint. Render's free tier spins
// a web service down after a period of no incoming HTTP requests - pointing
// a free external monitor (e.g. UptimeRobot, cron-job.org) at
// "https://your-app.onrender.com/healthz" every 5-10 minutes while you're
// live keeps the dyno awake and the TikTok connection alive between rounds.
app.get("/healthz", function (req, res) {
  res.json({ ok: true, uptimeSeconds: process.uptime(), storage: getStorageStatus() });
});

// Downloads the whole all-time leaderboard as a JSON file. Keep a copy after
// big streams - the Settings panel can restore it in one tap if the server's
// storage is ever wiped (see README.md).
app.get("/api/alltime-backup", function (req, res) {
  var envelope = {
    app: "tiktok-sudoku-live",
    v: 2,
    savedAt: Date.now(),
    exportedAt: new Date().toISOString(),
    players: game.state.allTimeScores
  };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="sudoku-alltime-scores-' + new Date().toISOString().slice(0, 10) + '.json"');
  res.setHeader("Cache-Control", "no-store");
  res.send(JSON.stringify(envelope, null, 1));
});

// ---------------------------------------------------------------------------
// 5b. AVATAR PROXY - makes each viewer's REAL TikTok profile photo load
//     reliably, everywhere it's shown (live guess toast, both leaderboards,
//     the always-on scoreboard, round-end popups).
//
// WHY THIS EXISTS: TikTok's photo CDN (p16-sign.tiktokcdn-us.com and similar
// hosts) is hotlink-protected - it can refuse a request that arrives with a
// browser's normal Referer header pointing at a different site (this app's
// own domain), which is exactly what happens when the frontend sets an
// <img src="..."> straight to that CDN URL. When that happens the request
// fails silently and every single viewer's photo falls back to the
// generated colored-initials circle - not because the photo URL is wrong,
// but because the CDN never let the browser have it. Routing the request
// through this server instead (same-origin fetch, then re-served as this
// app's own image) sidesteps that entirely: the CDN sees a plain server-to-
// server request with no cross-site Referer to object to.
// A small in-memory cache keeps repeat requests (the same viewer guessing
// several times) cheap and fast without re-fetching TikTok every time.
var AVATAR_CACHE_MAX_ENTRIES = 500;
var AVATAR_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
var AVATAR_FETCH_TIMEOUT_MS = 6000;
var AVATAR_MAX_BYTES = 3 * 1024 * 1024; // 3 MB - a profile photo is never this big; refuse anything larger
var avatarProxyCache = new Map(); // url -> { buf, contentType, ts }

// Only ever proxy TikTok/ByteDance's own CDN hosts - never an arbitrary
// URL a viewer's display name or chat text might smuggle in. Anything else
// is refused outright (this is not a general-purpose open proxy).
var ALLOWED_AVATAR_HOST_SUFFIXES = [
  ".tiktokcdn.com",
  ".tiktokcdn-us.com",
  ".tiktokcdn-eu.com",
  ".ibytedtos.com",
  ".ibyteimg.com",
  ".byteimg.com",
  ".muscdn.com",
  ".tiktokv.com",
  ".tiktokv.us"
];
function isAllowedAvatarHost(hostname) {
  hostname = String(hostname || "").toLowerCase();
  for (var i = 0; i < ALLOWED_AVATAR_HOST_SUFFIXES.length; i++) {
    var suffix = ALLOWED_AVATAR_HOST_SUFFIXES[i];
    if (hostname === suffix.slice(1) || hostname.endsWith(suffix)) return true;
  }
  return false;
}
function pruneAvatarCacheIfNeeded() {
  if (avatarProxyCache.size <= AVATAR_CACHE_MAX_ENTRIES) return;
  // Drop the oldest entries first (Map preserves insertion order).
  var toDrop = avatarProxyCache.size - AVATAR_CACHE_MAX_ENTRIES;
  var it = avatarProxyCache.keys();
  for (var i = 0; i < toDrop; i++) {
    var k = it.next();
    if (k.done) break;
    avatarProxyCache.delete(k.value);
  }
}

app.get("/avatar", async function (req, res) {
  try {
    var raw = req.query.u;
    if (!raw || typeof raw !== "string") return res.status(400).end();
    var target;
    try {
      target = new URL(raw);
    } catch (e) {
      return res.status(400).end();
    }
    if (target.protocol !== "https:" || !isAllowedAvatarHost(target.hostname)) {
      return res.status(403).end();
    }

    var cached = avatarProxyCache.get(raw);
    if (cached && (Date.now() - cached.ts) < AVATAR_CACHE_TTL_MS) {
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("Cache-Control", "public, max-age=21600"); // 6h - a phone/browser can reuse this itself too
      return res.end(cached.buf);
    }

    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, AVATAR_FETCH_TIMEOUT_MS);
    var upstream;
    try {
      upstream = await fetch(target.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; TikTokSudokuLive/1.0)" }
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream || !upstream.ok) return res.status(502).end();
    var contentType = upstream.headers.get("content-type") || "";
    if (contentType.indexOf("image/") !== 0) return res.status(415).end();

    var arrayBuf = await upstream.arrayBuffer();
    if (arrayBuf.byteLength > AVATAR_MAX_BYTES) return res.status(413).end();
    var buf = Buffer.from(arrayBuf);

    avatarProxyCache.set(raw, { buf: buf, contentType: contentType, ts: Date.now() });
    pruneAvatarCacheIfNeeded();

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=21600");
    res.end(buf);
  } catch (err) {
    // Any failure (timeout, DNS, aborted, etc.) just means "no photo" -
    // the frontend already falls back to the generated initials avatar
    // whenever an <img> fails to load, so a plain error status is enough.
    res.status(502).end();
  }
});

// Cache-Control headers below make sure that every time you redeploy, phones
// and browsers always fetch the newest index.html/style.css/game.js instead
// of silently reusing an old cached copy from a previous deploy.
app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  lastModified: false,
  setHeaders: function (res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}));

var httpServer = http.createServer(app);
// maxHttpBufferSize is raised so a big all-time backup file can be uploaded
// from Settings (the default 1 MB limit could reject it).
var io = new Server(httpServer, { maxHttpBufferSize: 5e6 });

// ---------------------------------------------------------------------------
// 3b. SCORE STORAGE - keeps the all-time leaderboard AND the round in
//     progress safe across sleeps, restarts and new deploys.
//
// WHY THIS EXISTS (read this if points ever "disappear"):
// Render's own documentation says a FREE web service has an ephemeral
// filesystem: anything written to local disk is lost every time the service
// redeploys, restarts OR SPINS DOWN after ~15 idle minutes. Earlier versions
// of this game (and the Memory game) saved the all-time scores to a local
// file and wrongly assumed it survived a sleep/wake cycle. It does not - so
// on the free plan the file could vanish at exactly the moment the host
// came back to stream, which looks like "my leaderboard forgot everyone".
//
// The real fix is to keep the scores somewhere that is NOT this server's
// disk. This file now supports two layers, used together:
//
//   1. CLOUD (recommended, free): a Redis database reached over plain HTTPS
//      (Upstash Redis works on its free plan). Turn it on by setting
//      UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN on Render - see
//      README.md. Scores then survive sleeps, restarts and redeploys.
//   2. LOCAL FILE (automatic, always on): ./data/*.json (or DATA_DIR). Still
//      useful on your own computer, on a paid Render disk, and as a second
//      copy - but on Render's free plan it is best-effort only.
//
// What gets saved:
//   - alltime-scores  : every viewer's all-time totals
//   - round-state     : the puzzle on screen, which cells are filled, this
//                       round's scores and the host's game settings, so a
//                       restart in the middle of a round resumes it instead
//                       of throwing the round (and its points) away.
//
// Safety rules baked in:
//   - Files are written atomically (temp file, then rename) with a .bak copy,
//     so a crash mid-write can never leave a half-written scores file.
//   - Saves are THROTTLED (at most one every few seconds while people score,
//     and a busy chat cannot starve them) and happen IMMEDIATELY when a
//     puzzle is solved, on reset, and on shutdown.
//   - If the cloud is configured but unreachable when the server starts, we
//     NEVER overwrite the cloud copy with an empty table. Cloud writes stay
//     paused until we can read it, then any points earned in the meantime
//     are merged in on top of it.
// ---------------------------------------------------------------------------
var DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
var ALLTIME_SCORES_FILE = path.join(DATA_DIR, "alltime-scores.json");
var ROUND_STATE_FILE = path.join(DATA_DIR, "round-state.json");
var STORAGE_PREFIX = String(process.env.STORAGE_KEY_PREFIX || "sudoku-live").trim() || "sudoku-live";
// KV_REST_API_* are the names Vercel KV / Upstash-marketplace integrations use.
var CLOUD_URL = String(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").trim().replace(/\/+$/, "");
var CLOUD_TOKEN = String(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "").trim();
var CLOUD_ENABLED = !!(CLOUD_URL && CLOUD_TOKEN);

var SAVE_INTERVAL_MS = 3000;          // max one save per this long while people are scoring
var SAVE_RETRY_MS = 15000;            // wait this long before retrying a failed cloud save
var CLOUD_TIMEOUT_MS = 6000;          // give up on one cloud request after this long
var CLOUD_RECOVERY_INTERVAL_MS = 20000;
var MAX_ALLTIME_SAVED = 3000;         // most players kept in the saved all-time table
var MAX_ALLTIME_AVATARS_SAVED = 300;  // only the top players keep their photo URL in the saved copy
var MAX_CLOUD_PAYLOAD_CHARS = 800000; // stay well under typical 1 MB request limits

var persist = {
  bootDone: false,
  allTimeDirty: false,
  roundDirty: false,
  timer: null,
  inFlight: null,
  lastSaveFailed: false,
  lastSavedAt: null,
  lastError: null,
  fileOk: true,
  cloudOk: null,               // null = not tried yet, true/false = result of the latest cloud call
  cloudWriteBlocked: false,    // true while the cloud could not be read at startup (see rules above)
  baseline: null,              // copy of the all-time table at startup while blocked
  resetWhileBlocked: false,
  recoveryTimer: null,
  lastLoggedError: "",
  lastLoggedAt: 0
};

function logThrottled(message) {
  var now = Date.now();
  if (message === persist.lastLoggedError && now - persist.lastLoggedAt < 60000) return;
  persist.lastLoggedError = message;
  persist.lastLoggedAt = now;
  console.warn(message);
}

function errMsg(err) {
  return err && err.message ? err.message : String(err);
}

// Some TikTok handles could be "__proto__" or "constructor" - as plain
// object keys those would corrupt the score tables, so they get a prefix.
function safeId(id) {
  id = String(id === null || typeof id === "undefined" ? "unknown" : id);
  if (id === "__proto__" || id === "constructor" || id === "prototype") return "@" + id;
  return id;
}

// ---- Local files (atomic writes + .bak fallback) ---------------------------
function readJsonFileSafe(file) {
  var candidates = [file, file + ".bak"];
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (fs.existsSync(candidates[i])) {
        return JSON.parse(fs.readFileSync(candidates[i], "utf8"));
      }
    } catch (err) {
      console.warn("[storage] could not read " + candidates[i] + " (" + errMsg(err) + ")" + (i === 0 ? " - trying the backup copy" : ""));
    }
  }
  return null;
}

function writeJsonFileAtomic(file, obj) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  var tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj), "utf8");
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
  } catch (e) { /* the backup copy is a bonus - never block a save on it */ }
  fs.renameSync(tmp, file);
}

// ---- Cloud (Redis over HTTPS, e.g. Upstash) --------------------------------
async function cloudCommand(args) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, CLOUD_TIMEOUT_MS);
  try {
    var res = await fetch(CLOUD_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + CLOUD_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: controller.signal
    });
    var text = await res.text();
    var body = null;
    try { body = JSON.parse(text); } catch (e) { body = null; }
    if (!res.ok || !body || body.error) {
      throw new Error("cloud storage answered HTTP " + res.status + ": " + ((body && body.error) || text.slice(0, 120)));
    }
    return body.result;
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("cloud storage did not answer within " + (CLOUD_TIMEOUT_MS / 1000) + "s");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function cloudGetJson(name) {
  var result = await cloudCommand(["GET", STORAGE_PREFIX + ":" + name]);
  if (result === null || typeof result === "undefined") return null;
  return JSON.parse(String(result));
}

async function cloudSetJson(name, obj) {
  var text = JSON.stringify(obj);
  if (text.length > MAX_CLOUD_PAYLOAD_CHARS && obj && obj.players) {
    // Too big for one request: drop every photo URL (they re-fill as viewers chat).
    var slim = { v: obj.v, savedAt: obj.savedAt, players: {} };
    Object.keys(obj.players).forEach(function (id) {
      var r = obj.players[id];
      slim.players[id] = { name: r.name, avatar: null, correct: r.correct, wrong: r.wrong, points: r.points };
    });
    text = JSON.stringify(slim);
  }
  await cloudCommand(["SET", STORAGE_PREFIX + ":" + name, text]);
}

function sleepMs(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function withRetries(fn, attempts, delayMs) {
  var lastErr = null;
  for (var i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleepMs(delayMs);
    }
  }
  throw lastErr;
}

// ---- Score-table helpers ----------------------------------------------------
function toCount(v) {
  var n = Math.floor(Number(v));
  return isFinite(n) && n > 0 ? n : 0;
}

// Turns anything read from disk/cloud/an uploaded backup into a clean table.
// Players with 0 points are dropped (a viewer who only ever guessed wrong has
// nothing to show on a leaderboard).
function sanitizeScoreTable(raw, keepZero) {
  var out = {};
  if (!raw || typeof raw !== "object") return out;
  Object.keys(raw).forEach(function (rawId) {
    var r = raw[rawId];
    if (!r || typeof r !== "object") return;
    var points = toCount(r.points);
    if (points <= 0 && !keepZero) return;
    var id = safeId(rawId).slice(0, 100);
    out[id] = {
      name: String(r.name || id).slice(0, 60),
      avatar: (typeof r.avatar === "string" && r.avatar) ? r.avatar.slice(0, 600) : null,
      correct: toCount(r.correct),
      wrong: toCount(r.wrong),
      points: points
    };
  });
  return out;
}

function cloneTable(table) {
  return sanitizeScoreTable(table, true);
}

// Accepts the current envelope ({v, savedAt, players}), a downloaded backup
// (same shape) or the plain { id: {...} } table older versions wrote.
function parseAllTimeEnvelope(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.v === "number" && raw.players && typeof raw.players === "object") {
    return { savedAt: Number(raw.savedAt) || 0, players: sanitizeScoreTable(raw.players, false) };
  }
  return { savedAt: 0, players: sanitizeScoreTable(raw, false) };
}

function compactAllTimeForSave(table) {
  var ids = Object.keys(table);
  ids.sort(function (a, b) {
    var A = table[a], B = table[b];
    if (B.points !== A.points) return B.points - A.points;
    return B.correct - A.correct;
  });
  var out = {};
  ids.slice(0, MAX_ALLTIME_SAVED).forEach(function (id, i) {
    var r = table[id];
    if (!(r.points > 0)) return;
    out[id] = {
      name: r.name,
      avatar: i < MAX_ALLTIME_AVATARS_SAVED ? (r.avatar || null) : null,
      correct: r.correct,
      wrong: r.wrong,
      points: r.points
    };
  });
  return out;
}

function buildAllTimeEnvelope(table) {
  return { v: 2, savedAt: Date.now(), players: compactAllTimeForSave(table) };
}

// Backup import: for each viewer keep whichever total is higher, so
// restoring an older backup can never lower anyone's score.
function mergeMax(target, incoming) {
  var touched = 0;
  Object.keys(incoming).forEach(function (id) {
    var inc = incoming[id];
    var cur = target[id];
    if (!cur) {
      target[id] = { name: inc.name, avatar: inc.avatar, correct: inc.correct, wrong: inc.wrong, points: inc.points };
      touched++;
    } else if (inc.points > cur.points || inc.correct > cur.correct || inc.wrong > cur.wrong) {
      cur.points = Math.max(cur.points, inc.points);
      cur.correct = Math.max(cur.correct, inc.correct);
      cur.wrong = Math.max(cur.wrong, inc.wrong);
      if (!cur.avatar && inc.avatar) cur.avatar = inc.avatar;
      touched++;
    }
  });
  return touched;
}

// Used when the cloud only became reachable AFTER the server started: keep
// everything the cloud already had, and add on top only what was earned here
// since startup (memory minus the startup baseline).
function mergeWithDelta(remote, mem, base) {
  var out = cloneTable(remote);
  Object.keys(mem).forEach(function (id) {
    var m = mem[id];
    var b = base[id] || { points: 0, correct: 0, wrong: 0 };
    if (!out[id]) {
      out[id] = { name: m.name, avatar: m.avatar || null, correct: m.correct, wrong: m.wrong, points: m.points };
      return;
    }
    out[id].points += Math.max(0, m.points - (b.points || 0));
    out[id].correct += Math.max(0, m.correct - (b.correct || 0));
    out[id].wrong += Math.max(0, m.wrong - (b.wrong || 0));
    if (m.name) out[id].name = m.name;
    if (m.avatar) out[id].avatar = m.avatar;
  });
  Object.keys(out).forEach(function (id) { if (!(out[id].points > 0)) delete out[id]; });
  return out;
}

// ---- Round snapshot (the puzzle on screen + this round's scores) -----------
function isNumberGrid(g, min, max) {
  return Array.isArray(g) && g.length === 9 && g.every(function (row) {
    return Array.isArray(row) && row.length === 9 && row.every(function (v) {
      return Number.isInteger(v) && v >= min && v <= max;
    });
  });
}
function isBoolGrid(g) {
  return Array.isArray(g) && g.length === 9 && g.every(function (row) {
    return Array.isArray(row) && row.length === 9 && row.every(function (v) { return typeof v === "boolean"; });
  });
}

function buildRoundSnapshot() {
  var s = game.state;
  var elapsed = (s.solved && typeof s.solveTimeMs === "number") ? s.solveTimeMs : Math.max(0, Date.now() - s.roundStartTime);
  return {
    v: 1,
    savedAt: Date.now(),
    puzzle: s.puzzle,
    solution: s.solution,
    board: s.board,
    givenMask: s.givenMask,
    solved: s.solved,
    scores: s.scores,
    lastDifficulty: s.lastDifficulty,
    elapsedMs: elapsed,
    solveTimeMs: s.solveTimeMs,
    mode: s.mode,
    autoNextRound: s.autoNextRound,
    autoNextDelayMs: autoNextDelayMs
  };
}

// Returns true only if the snapshot passes every sanity check; otherwise the
// game simply keeps the fresh puzzle it already started with.
function restoreRoundSnapshot(snap) {
  if (!snap || typeof snap !== "object") return false;
  if (!isNumberGrid(snap.puzzle, 0, 9) || !isNumberGrid(snap.solution, 1, 9) ||
      !isNumberGrid(snap.board, 0, 9) || !isBoolGrid(snap.givenMask)) return false;
  var allMatch = true;
  for (var r = 0; r < 9; r++) {
    for (var c = 0; c < 9; c++) {
      var given = snap.puzzle[r][c] !== 0;
      if (snap.givenMask[r][c] !== given) return false;
      if (given && snap.puzzle[r][c] !== snap.solution[r][c]) return false;
      if (snap.board[r][c] !== 0 && snap.board[r][c] !== snap.solution[r][c]) return false;
      if (given && snap.board[r][c] !== snap.puzzle[r][c]) return false;
      if (snap.board[r][c] !== snap.solution[r][c]) allMatch = false;
    }
  }
  var s = game.state;
  s.puzzle = snap.puzzle;
  s.solution = snap.solution;
  s.board = snap.board;
  s.givenMask = snap.givenMask;
  s.solved = allMatch;
  s.scores = sanitizeScoreTable(snap.scores, true);
  if (DIFFICULTIES.indexOf(snap.lastDifficulty) !== -1) s.lastDifficulty = snap.lastDifficulty;
  var elapsed = (typeof snap.elapsedMs === "number" && snap.elapsedMs >= 0) ? snap.elapsedMs : 0;
  // The clock only counts time the game was actually running, not the time
  // the server spent asleep.
  s.roundStartTime = Date.now() - elapsed;
  s.solveTimeMs = allMatch ? (typeof snap.solveTimeMs === "number" ? snap.solveTimeMs : elapsed) : null;
  if (["offline", "test", "live"].indexOf(snap.mode) !== -1) s.mode = snap.mode;
  s.autoNextRound = !!snap.autoNextRound;
  if (typeof snap.autoNextDelayMs === "number") setAutoNextDelaySeconds(snap.autoNextDelayMs / 1000);
  return true;
}

// ---- Saving ---------------------------------------------------------------
function markAllTimeDirty() { persist.allTimeDirty = true; scheduleSave(); }
function markRoundDirty() { persist.roundDirty = true; scheduleSave(); }

function scheduleSave(delayMs) {
  if (!persist.bootDone || persist.timer) return;
  persist.timer = setTimeout(function () {
    persist.timer = null;
    flushSaves();
  }, typeof delayMs === "number" ? delayMs : SAVE_INTERVAL_MS);
}

async function runSave(doAll, doRound) {
  var failed = false;
  var allEnvelope = doAll ? buildAllTimeEnvelope(game.state.allTimeScores) : null;
  var roundSnap = doRound ? buildRoundSnapshot() : null;

  // 1. Local files - synchronous and fast, so they are written first.
  if (doAll) {
    try { writeJsonFileAtomic(ALLTIME_SCORES_FILE, allEnvelope); persist.fileOk = true; } catch (err) {
      persist.fileOk = false;
      logThrottled("[storage] could not write " + ALLTIME_SCORES_FILE + ": " + errMsg(err));
    }
  }
  if (doRound) {
    try { writeJsonFileAtomic(ROUND_STATE_FILE, roundSnap); persist.fileOk = true; } catch (err) {
      persist.fileOk = false;
      logThrottled("[storage] could not write " + ROUND_STATE_FILE + ": " + errMsg(err));
    }
  }

  // 2. Cloud.
  if (CLOUD_ENABLED && !persist.cloudWriteBlocked) {
    try {
      if (doAll) await cloudSetJson("alltime", allEnvelope);
      if (doRound) await cloudSetJson("round", roundSnap);
      persist.cloudOk = true;
      persist.lastError = null;
      persist.lastSavedAt = Date.now();
    } catch (err) {
      failed = true;
      persist.cloudOk = false;
      persist.lastError = errMsg(err);
      if (doAll) persist.allTimeDirty = true;   // try again next round of saves
      if (doRound) persist.roundDirty = true;
      logThrottled("[storage] cloud save failed (will retry): " + errMsg(err));
    }
  } else if (!CLOUD_ENABLED && persist.fileOk) {
    persist.lastSavedAt = Date.now();
  }
  persist.lastSaveFailed = failed;
}

// Runs any pending save right now. Saves never overlap: if one is already in
// progress this waits for it, then saves whatever changed in the meantime.
function flushSaves() {
  if (persist.timer) { clearTimeout(persist.timer); persist.timer = null; }
  if (!persist.bootDone) return Promise.resolve();
  if (persist.inFlight) return persist.inFlight.then(function () { return flushSaves(); });
  if (!persist.allTimeDirty && !persist.roundDirty) return Promise.resolve();
  var doAll = persist.allTimeDirty;
  var doRound = persist.roundDirty;
  persist.allTimeDirty = false;
  persist.roundDirty = false;
  var p = runSave(doAll, doRound)
    .catch(function (err) { logThrottled("[storage] unexpected save error: " + errMsg(err)); })
    .then(function () {
      persist.inFlight = null;
      if (persist.allTimeDirty || persist.roundDirty) scheduleSave(persist.lastSaveFailed ? SAVE_RETRY_MS : 250);
    });
  persist.inFlight = p;
  return p;
}

// Called for moments that must never wait for the throttle (a puzzle was
// just solved, the host reset something, the server is shutting down).
function saveEverythingNow() {
  persist.allTimeDirty = true;
  persist.roundDirty = true;
  return flushSaves();
}

// ---- Cloud recovery (only used if the cloud was down at startup) ----------
function startCloudRecovery() {
  if (persist.recoveryTimer) return;
  persist.recoveryTimer = setInterval(function () {
    tryCloudRecovery().catch(function (err) {
      logThrottled("[storage] cloud still unreachable - scores are safe on this server meanwhile (" + errMsg(err) + ")");
    });
  }, CLOUD_RECOVERY_INTERVAL_MS);
}

async function tryCloudRecovery() {
  var raw = await cloudGetJson("alltime");   // throws while unreachable
  var remote = {};
  if (raw && !persist.resetWhileBlocked) {
    var parsed = parseAllTimeEnvelope(raw);
    remote = parsed ? parsed.players : {};
  }
  game.state.allTimeScores = mergeWithDelta(remote, game.state.allTimeScores, persist.baseline || {});
  persist.cloudWriteBlocked = false;
  persist.cloudOk = true;
  persist.baseline = null;
  persist.resetWhileBlocked = false;
  clearInterval(persist.recoveryTimer);
  persist.recoveryTimer = null;
  console.log("[storage] cloud storage is reachable again - scores merged and synced.");
  saveEverythingNow();
  broadcastState();
}

// ---- Startup: load whatever was saved, cloud first ------------------------
async function bootStorage() {
  var fileAll = parseAllTimeEnvelope(readJsonFileSafe(ALLTIME_SCORES_FILE));
  var fileRound = readJsonFileSafe(ROUND_STATE_FILE);
  var cloudAll = null;
  var cloudRound = null;
  var cloudReadOk = true;

  if (CLOUD_ENABLED) {
    console.log("[storage] cloud storage configured (" + CLOUD_URL.replace(/^https?:\/\//, "").split("/")[0] + ") - loading saved scores...");
    try {
      var results = await Promise.all([
        withRetries(function () { return cloudGetJson("alltime"); }, 2, 1000),
        withRetries(function () { return cloudGetJson("round"); }, 2, 1000)
      ]);
      cloudAll = results[0];
      cloudRound = results[1];
      persist.cloudOk = true;
    } catch (err) {
      cloudReadOk = false;
      persist.cloudOk = false;
      persist.lastError = errMsg(err);
      console.error("[storage] COULD NOT READ cloud storage at startup: " + errMsg(err) +
        " - cloud saving is paused (so nothing is overwritten) and will retry automatically.");
    }
  } else {
    console.warn("[storage] no cloud storage configured - scores are kept in a local file only. " +
      "On Render's FREE plan that file is erased whenever the service sleeps, restarts or redeploys. See README.md.");
  }

  // ---- all-time scores ----
  var cloudAllParsed = cloudAll ? parseAllTimeEnvelope(cloudAll) : null;
  var chosenAll = null;
  var allSource = "none";
  if (cloudReadOk && cloudAllParsed && (!fileAll || cloudAllParsed.savedAt >= fileAll.savedAt)) {
    chosenAll = cloudAllParsed; allSource = "cloud";
  } else if (fileAll) {
    chosenAll = fileAll; allSource = "file";
  }
  game.state.allTimeScores = chosenAll ? chosenAll.players : {};
  console.log("[storage] all-time scores: loaded " + Object.keys(game.state.allTimeScores).length +
    " player(s) from " + (allSource === "none" ? "nowhere (starting fresh)" : allSource));

  // ---- round in progress ----
  var candidates = [];
  if (cloudReadOk && cloudRound && typeof cloudRound === "object") candidates.push({ snap: cloudRound, source: "cloud" });
  if (fileRound && typeof fileRound === "object") candidates.push({ snap: fileRound, source: "file" });
  candidates.sort(function (a, b) { return (Number(b.snap.savedAt) || 0) - (Number(a.snap.savedAt) || 0); });
  var restored = false;
  for (var i = 0; i < candidates.length && !restored; i++) {
    if (restoreRoundSnapshot(candidates[i].snap)) {
      restored = true;
      // A show was already set up before the restart - leave those settings alone.
      game.state.configured = true;
      console.log("[storage] round in progress restored from " + candidates[i].source + " (" +
        Object.keys(game.state.scores).length + " scorer(s) this round" + (game.state.solved ? ", already solved" : "") + ")");
    }
  }
  if (!restored && candidates.length) console.warn("[storage] a saved round was found but failed its checks - starting a fresh puzzle.");

  // ---- cloud bookkeeping ----
  if (CLOUD_ENABLED) {
    if (!cloudReadOk) {
      persist.cloudWriteBlocked = true;
      persist.baseline = cloneTable(game.state.allTimeScores);
      startCloudRecovery();
    } else if (allSource !== "cloud" && Object.keys(game.state.allTimeScores).length) {
      persist.allTimeDirty = true;   // seed an empty cloud with what we already have
    }
  }
  persist.bootDone = true;
  if (restored) persist.roundDirty = false;
  if (persist.allTimeDirty || persist.roundDirty) scheduleSave(500);
}

function getStorageStatus() {
  return {
    cloudConfigured: CLOUD_ENABLED,
    cloudOk: CLOUD_ENABLED ? persist.cloudOk : null,
    cloudPaused: !!persist.cloudWriteBlocked,
    fileOk: persist.fileOk,
    lastSavedAt: persist.lastSavedAt,
    lastError: persist.lastError,
    players: Object.keys(game.state.allTimeScores).length
  };
}

var game = createGameState();

// Flush on a normal shutdown (Render redeploying / spinning down) so the last
// few seconds of scoring are not lost, then actually exit. (Adding a SIGTERM
// listener removes Node's default "exit" behavior, so we must exit ourselves.)
var shuttingDown = false;
function shutdownAndSave(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[shutdown] " + signal + " received - saving scores before exit...");
  var finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    process.exit(0);
  }
  if (!persist.bootDone) { finish(); return; }   // never save a not-yet-loaded (empty) game
  setTimeout(finish, 6000);                      // never hang forever waiting on the network
  saveEverythingNow().then(finish, finish);
}
process.on("SIGTERM", function () { shutdownAndSave("SIGTERM"); });
process.on("SIGINT", function () { shutdownAndSave("SIGINT"); });

// ---- Test Mode bot auto-solve -----------------------------------------
// When enabled, a small set of fake "bot" viewers keep answering random
// unsolved cells (mostly correctly) until the puzzle is complete, so the
// host can watch a full round play out hands-free while testing.
var BOT_TICK_MS = 700;
var BOT_CORRECT_CHANCE = 0.85;
var BOT_IDENTITIES = [
  { uniqueId: "bot-alpha", name: "Bot Alpha" },
  { uniqueId: "bot-bravo", name: "Bot Bravo" },
  { uniqueId: "bot-charlie", name: "Bot Charlie" },
  { uniqueId: "bot-delta", name: "Bot Delta" }
];
var botAutoSolveEnabled = false;
var botAutoSolveTimer = null;

function botTick() {
  var candidates = [];
  for (var r = 0; r < 9; r++) {
    for (var c = 0; c < 9; c++) {
      if (!game.state.givenMask[r][c] && game.state.board[r][c] !== game.state.solution[r][c]) {
        candidates.push([r, c]);
      }
    }
  }
  if (!candidates.length) return; // nothing to solve right now (solved, or between puzzles)
  var cell = candidates[Math.floor(Math.random() * candidates.length)];
  var row = cell[0], col = cell[1];
  var bot = BOT_IDENTITIES[Math.floor(Math.random() * BOT_IDENTITIES.length)];
  var useCorrect = Math.random() < BOT_CORRECT_CHANCE;
  var num = useCorrect ? game.state.solution[row][col] : (Math.floor(Math.random() * 9) + 1);
  var text = coordLabel(row, col) + " " + num;
  processComment(text, bot.uniqueId, bot.name, "test-bot", null);
}

function setBotAutoSolveEnabled(enabled) {
  botAutoSolveEnabled = !!enabled;
  if (botAutoSolveTimer) {
    clearInterval(botAutoSolveTimer);
    botAutoSolveTimer = null;
  }
  if (botAutoSolveEnabled) {
    botAutoSolveTimer = setInterval(function () {
      try { botTick(); } catch (err) { console.error("[bot tick error - swallowed]", err); }
    }, BOT_TICK_MS);
  }
}

// Everything the screen needs in one object. Used for the first message a
// newly-opened page receives AND for every later broadcast.
function buildClientState() {
  var publicState = game.getPublicState();
  publicState.botAutoSolveEnabled = botAutoSolveEnabled;
  publicState.autoNextDelaySeconds = autoNextDelayMs / 1000;
  publicState.configured = !!game.state.configured;
  publicState.storage = getStorageStatus();
  return publicState;
}

function broadcastState() {
  io.emit("state", buildClientState());
}

// True once anyone has filled a cell (or scored) in the puzzle on screen.
function roundHasProgress() {
  if (Object.keys(game.state.scores).length > 0) return true;
  for (var r = 0; r < 9; r++) {
    for (var c = 0; c < 9; c++) {
      if (game.state.board[r][c] !== game.state.puzzle[r][c]) return true;
    }
  }
  return false;
}

// Tells one screen (or everyone) something happened - shown as a small
// message at the top of the page.
function hostNotice(target, ok, message) {
  (target || io).emit("hostNotice", { ok: !!ok, message: message });
}

// Wraps a handler so a thrown error is logged, never crashes the server.
// Handlers marked isHostAction also record that a host has set this server
// run up, which stops a browser's "saved default" from overriding it later
// (see host:applyDefaults below).
function safe(fn, isHostAction) {
  return function () {
    try {
      if (isHostAction) game.state.configured = true;
      fn.apply(null, arguments);
    } catch (err) {
      console.error("[handler error - swallowed, server kept running]", err);
    }
  };
}

// ---- Auto Next Round --------------------------------------------------
// When enabled, a fresh puzzle (same difficulty, drawn from the puzzle
// bank) starts automatically a short while after the current one is
// solved, so a live show can keep rolling without the host touching
// anything. It can be toggled on/off at any time from the settings drawer.
var DEFAULT_AUTO_NEXT_DELAY_MS = 10000; // time to show the round results before auto-starting
var MIN_AUTO_NEXT_DELAY_MS = 3000;
var MAX_AUTO_NEXT_DELAY_MS = 300000;
var autoNextDelayMs = DEFAULT_AUTO_NEXT_DELAY_MS; // host-configurable, see host:setAutoNextDelay
var autoNextTimer = null;

function cancelAutoNext() {
  if (autoNextTimer) {
    clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
}

function setAutoNextDelaySeconds(seconds) {
  var ms = Math.round((typeof seconds === "number" && !isNaN(seconds) ? seconds : DEFAULT_AUTO_NEXT_DELAY_MS / 1000) * 1000);
  if (ms < MIN_AUTO_NEXT_DELAY_MS) ms = MIN_AUTO_NEXT_DELAY_MS;
  if (ms > MAX_AUTO_NEXT_DELAY_MS) ms = MAX_AUTO_NEXT_DELAY_MS;
  autoNextDelayMs = ms;
}

function scheduleAutoNext() {
  cancelAutoNext();
  io.emit("autoNextCountdown", { seconds: Math.round(autoNextDelayMs / 1000) });
  autoNextTimer = setTimeout(function () {
    autoNextTimer = null;
    game.reset(game.state.lastDifficulty);
    markRoundDirty();
    broadcastState();
  }, autoNextDelayMs);
}

// Shared by both viewer guesses and host reveals: whenever an action just
// completed the puzzle, tell everyone and (optionally) queue the next round.
function emitPuzzleSolvedIfNeeded(justSolved) {
  if (!justSolved) return;
  // Never trust the throttle for the moment a round ends - the winning
  // points are written to disk/cloud right now.
  saveEverythingNow();
  io.emit("puzzleSolved", {
    leaderboard: game.getLeaderboard(),
    allTimeLeaderboard: game.getAllTimeLeaderboard(),
    solveTimeMs: game.state.solveTimeMs
  });
  if (game.state.autoNextRound) scheduleAutoNext();
}

// Remembers the last-known avatar for each viewer id, so a viewer's photo
// stays attached to their wrong/unparsed guesses too, not just correct ones
// (those don't otherwise touch the score tables where avatars are stored).
var avatarCache = Object.create(null);

function processComment(text, uniqueId, nickname, source, avatarUrl) {
  if (text === null || typeof text === "undefined") text = "";
  uniqueId = safeId(uniqueId);
  if (avatarUrl) avatarCache[uniqueId] = avatarUrl;
  var knownAvatar = avatarUrl || avatarCache[uniqueId] || null;

  // Parse BEFORE building the diagnostics payload, so the Diagnostics panel
  // can show exactly what the parser saw and what it did with it - this is
  // what makes "wrong format" reports debuggable from the screen itself
  // instead of requiring a trip to the Render server logs.
  var parsed = parseGuess(text);

  game.state.rawEventCount += 1;
  game.state.lastReceived = {
    uniqueId: uniqueId,
    nickname: nickname,
    text: text,
    source: source,
    at: Date.now(),
    parsedCoord: parsed ? parsed.coordLabel : null,
    parsedNum: parsed ? parsed.num : null
  };
  io.emit("diagnostics", { rawEventCount: game.state.rawEventCount, lastReceived: game.state.lastReceived });

  if (!parsed) {
    io.emit("guessResult", { uniqueId: uniqueId, nickname: nickname, avatar: knownAvatar, text: text, status: "unparsed" });
    return;
  }
  var result = game.applyGuess(parsed.row, parsed.col, parsed.num, uniqueId, nickname, knownAvatar);
  if (result.status === "correct") {
    // Points changed: queue a save of the all-time table AND the round.
    markAllTimeDirty();
    markRoundDirty();
  }
  io.emit("guessResult", {
    uniqueId: uniqueId,
    nickname: nickname,
    avatar: knownAvatar,
    text: text,
    coord: parsed.coordLabel,
    num: parsed.num,
    status: result.status,
    solved: result.solved
  });
  broadcastState();
  emitPuzzleSolvedIfNeeded(result.status === "correct" && result.solved);
}

var liveConnectionState = "idle"; // last state reported by the TikTok connector
var liveConnectionMessage = "Not connected."; // ...and its human-readable message

var tiktok = createTikTokConnector(
  function onChat(fields) {
    processComment(fields.text, fields.uniqueId, fields.nickname, "tiktok-live", fields.avatarUrl);
  },
  function onStatus(state, message) {
    liveConnectionState = state;
    liveConnectionMessage = message;
    io.emit("liveStatus", { state: state, message: message });
  },
  function onRawEvent() {
    // raw events are already logged to the server console inside the connector
  }
);

var FAKE_VIEWER_NAMES = ["SudokuFan", "LiveViewer", "ChatMaster", "PuzzlePro", "NightOwl", "QuickSolver"];

io.on("connection", function (socket) {
  console.log("[client connected]", socket.id);
  socket.emit("state", buildClientState());
  socket.emit("liveStatus", { state: liveConnectionState, message: liveConnectionMessage });
  // Tell the client whether a Sign API Key / username are already
  // configured on the server, so it can skip asking the host to type them
  // in. The actual key value is never sent to the browser.
  socket.emit("liveConfig", {
    hasDefaultSignApiKey: !!DEFAULT_SIGN_API_KEY,
    defaultUsername: DEFAULT_TIKTOK_USERNAME || ""
  });

  socket.on("host:setMode", safe(function (payload) {
    if (!payload || ["offline", "test", "live"].indexOf(payload.mode) === -1) return;
    game.state.mode = payload.mode;
    markRoundDirty();
    broadcastState();
  }, true));

  socket.on("host:connectLive", safe(function (payload) {
    payload = payload || {};
    var username = String(payload.username || "").replace("@", "").trim() || DEFAULT_TIKTOK_USERNAME;
    var signApiKey = String(payload.signApiKey || "").trim() || DEFAULT_SIGN_API_KEY;
    tiktok.connect(username, signApiKey);
  }, true));

  socket.on("host:disconnectLive", safe(function () {
    tiktok.disconnect();
  }, true));

  socket.on("host:newPuzzle", safe(function (payload) {
    var difficulty = payload && payload.difficulty ? payload.difficulty : game.state.lastDifficulty;
    cancelAutoNext();
    game.reset(difficulty);
    markRoundDirty();
    flushSaves();
    broadcastState();
  }, true));

  socket.on("host:revealCell", safe(function () {
    var result = game.revealCell();
    markRoundDirty();
    broadcastState();
    emitPuzzleSolvedIfNeeded(result.justSolved);
  }, true));

  socket.on("host:revealBox", safe(function () {
    var result = game.revealBox();
    markRoundDirty();
    broadcastState();
    emitPuzzleSolvedIfNeeded(result.justSolved);
  }, true));

  socket.on("host:revealBoard", safe(function () {
    var result = game.revealBoard();
    markRoundDirty();
    broadcastState();
    emitPuzzleSolvedIfNeeded(result.justSolved);
  }, true));

  socket.on("host:setBotAutoSolve", safe(function (payload) {
    setBotAutoSolveEnabled(!!(payload && payload.enabled));
    broadcastState();
  }, true));

  socket.on("host:setAutoNext", safe(function (payload) {
    var enabled = !!(payload && payload.enabled);
    game.setAutoNext(enabled);
    if (!enabled) cancelAutoNext();
    else if (game.state.solved && !autoNextTimer) scheduleAutoNext();
    markRoundDirty();
    broadcastState();
  }, true));

  // Lets the host customize how long (in seconds) the game waits after a
  // puzzle is solved before automatically starting the next one, when
  // Auto Next Round is on. Clamped to a sane range; broadcast to everyone
  // so every connected screen's settings input stays in sync.
  socket.on("host:setAutoNextDelay", safe(function (payload) {
    var seconds = payload && typeof payload.seconds !== "undefined" ? parseFloat(payload.seconds) : NaN;
    setAutoNextDelaySeconds(seconds);
    markRoundDirty();
    broadcastState();
  }, true));

  // ---- Reset scores (host) ------------------------------------------------
  // "This round" only clears the table for the puzzle on screen; the points
  // those viewers already banked in the all-time table are untouched.
  socket.on("host:resetRoundScores", safe(function () {
    game.state.scores = {};
    markRoundDirty();
    flushSaves();
    broadcastState();
    hostNotice(io, true, "This round's leaderboard was reset.");
  }, true));

  // "All-time" clears the saved table everywhere (memory, disk and cloud).
  socket.on("host:resetAllTimeScores", safe(function () {
    game.state.allTimeScores = {};
    if (persist.cloudWriteBlocked) persist.resetWhileBlocked = true;
    persist.baseline = persist.cloudWriteBlocked ? {} : null;
    markAllTimeDirty();
    flushSaves();
    broadcastState();
    hostNotice(io, true, "The all-time leaderboard was reset.");
  }, true));

  // ---- Restore an all-time backup file (see /api/alltime-backup) -----------
  socket.on("host:importAllTimeScores", safe(function (payload) {
    var raw = payload && payload.json;
    var parsed = null;
    try { parsed = (typeof raw === "string") ? JSON.parse(raw) : raw; } catch (e) { parsed = null; }
    var envelope = parseAllTimeEnvelope(parsed);
    if (!envelope || !Object.keys(envelope.players).length) {
      hostNotice(socket, false, "That file has no scores in it - nothing was restored.");
      return;
    }
    var touched = mergeMax(game.state.allTimeScores, envelope.players);
    markAllTimeDirty();
    flushSaves();
    broadcastState();
    hostNotice(io, true, "Backup restored: " + touched + " viewer(s) added or raised. Nobody's total was lowered.");
  }, true));

  // "Save & Apply as Default" from the browser: applied ONCE, and only while
  // nobody has set this server run up yet (e.g. right after Render woke it
  // up). Opening the page on a second device in the middle of a show can
  // therefore never reset the puzzle or the points that are on screen.
  socket.on("host:applyDefaults", safe(function (p) {
    p = p || {};
    if (game.state.configured) return;
    game.state.configured = true;
    var liveActive = ["connecting", "connected", "retrying"].indexOf(liveConnectionState) !== -1;
    if (!liveActive && ["offline", "test", "live"].indexOf(p.mode) !== -1) game.state.mode = p.mode;
    if (typeof p.autoNextRound === "boolean") game.setAutoNext(p.autoNextRound);
    if (typeof p.autoNextDelaySeconds === "number" && !isNaN(p.autoNextDelaySeconds)) setAutoNextDelaySeconds(p.autoNextDelaySeconds);
    if (typeof p.botAutoSolveEnabled === "boolean") setBotAutoSolveEnabled(p.botAutoSolveEnabled);
    if (DIFFICULTIES.indexOf(p.difficulty) !== -1 && p.difficulty !== game.state.lastDifficulty) {
      if (roundHasProgress()) {
        // Points are already on the board - never throw them away for a
        // saved preference. The new difficulty is used for the next puzzle.
        game.state.lastDifficulty = p.difficulty;
      } else {
        cancelAutoNext();
        game.reset(p.difficulty);
      }
    }
    markRoundDirty();
    broadcastState();
  }));

  socket.on("host:comment", safe(function (payload) {
    if (!payload || !payload.text) return;
    processComment(payload.text, "host", "Host (You)", "host-console", null);
  }));

  socket.on("offline:guess", safe(function (payload) {
    if (!payload || !payload.text) return;
    processComment(payload.text, "offline-player", "You", "offline", null);
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
    processComment(text, "fake-" + name, name, "test-mode", null);
  }));

  socket.on("disconnect", function () {
    console.log("[client disconnected]", socket.id);
  });
});

// ---------------------------------------------------------------------------
// 6. START UP - load saved scores FIRST, then open the door.
// ---------------------------------------------------------------------------
var PORT = process.env.PORT || 3000;

function startListening() {
  httpServer.listen(PORT, function () {
    console.log("TikTok Sudoku LIVE server running on port " + PORT);

    // If the round we restored was already solved and Auto Next Round is on,
    // carry on with the next puzzle instead of sitting on the old one.
    if (game.state.solved && game.state.autoNextRound) scheduleAutoNext();

    // If a username AND a Sign API Key are both configured via environment
    // variables (.env locally, or Render's Environment tab), connect to TikTok
    // LIVE automatically as soon as the server boots - including right after a
    // Render free-tier spin-down - instead of waiting for the host to open the
    // page and click Connect. The host can always disconnect/reconnect
    // manually from Settings afterwards; this only covers the very first
    // connection of a fresh process.
    if (DEFAULT_TIKTOK_USERNAME && DEFAULT_SIGN_API_KEY) {
      console.log("[startup] TIKTOK_USERNAME and EULERSTREAM_SIGN_API_KEY are both set - connecting automatically...");
      game.state.mode = "live";
      tiktok.connect(DEFAULT_TIKTOK_USERNAME, DEFAULT_SIGN_API_KEY);
    }
  });
}

bootStorage()
  .catch(function (err) {
    // Even if loading fails completely, the game must still start.
    console.error("[storage] startup load failed - starting with an empty leaderboard:", err);
    persist.bootDone = true;
  })
  .then(startListening);
