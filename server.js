// server.js - TikTok Sudoku LIVE (all-in-one deployment build)
// This single file contains the whole backend: the Sudoku engine, the chat
// message parser, the game state manager, the TikTok LIVE connector, and
// the Express + Socket.IO server that ties it all together.

const path = require("path");
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
    allTimeScores: {},    // persists across every puzzle for the life of the server
    rawEventCount: 0,
    lastReceived: null,
    lastDifficulty: DEFAULT_DIFFICULTY,
    autoNextRound: false, // when true, a new puzzle starts automatically after each solve
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
    return buildLeaderboard(state.scores, limit);
  }

  function getAllTimeLeaderboard(limit) {
    return buildLeaderboard(state.allTimeScores, limit);
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

  var WATCHDOG_CHECK_MS = 20000;    // how often we check for a stalled connection
  var WATCHDOG_STALE_MS = 120000;   // no data AT ALL for this long while "connected" = assume it's dead
  var RECONNECT_BASE_DELAY_MS = 3000;
  var RECONNECT_MAX_DELAY_MS = 30000;

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

  function extractChatFields(data) {
    if (!data) return null;
    var text = null;
    if (typeof data.comment === "string") text = data.comment;
    else if (typeof data.text === "string") text = data.text;
    else if (typeof data.message === "string") text = data.message;
    else if (data.content && typeof data.content.text === "string") text = data.content.text;
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

    var processedChatObjects = typeof WeakSet !== "undefined" ? new WeakSet() : null;

    var chatAliases = collectChatAliases();
    chatAliases.forEach(function (chatEventName) {
      connection.on(chatEventName, function (data) {
        if (processedChatObjects && data && typeof data === "object") {
          if (processedChatObjects.has(data)) return;
          processedChatObjects.add(data);
        }
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

      // Untruncated field probe - tells us, beyond doubt, exactly what shape
      // this library version's chat payload actually has. The old 500-char
      // JSON.stringify slice was cutting off right after the "common"
      // metadata block, before ever reaching "comment"/"user" - so it could
      // never actually prove whether those fields existed or not.
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
        onStatus("disconnected", "Disconnected from TikTok LIVE." + reasonSuffix);
      } catch (e) {}
      scheduleReconnect("the connection was closed");
    });
    connection.on("streamEnd", function () {
      try { onStatus("disconnected", "The TikTok LIVE stream ended. Watching for it to start again..."); } catch (e) {}
      scheduleReconnect("the stream ended");
    });
    connection.on("error", function (err) {
      try { onStatus("error", "Runtime error: " + (err && err.message ? err.message : err)); } catch (e) {}
      scheduleReconnect("a runtime error");
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

  function scheduleReconnect(reasonPhrase) {
    if (!desiredConnected) return; // the host explicitly disconnected - stay off
    cancelReconnectTimer();
    reconnectAttempt++;
    var delayMs = Math.min(RECONNECT_BASE_DELAY_MS * reconnectAttempt, RECONNECT_MAX_DELAY_MS);
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
      onStatus("error", "Missing Sign API Key. Get a free one at eulerstream.com and paste it in above, or set EULERSTREAM_SIGN_API_KEY in the environment.");
      return;
    }
    if (!username) {
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
      var message = err && err.message ? err.message : String(err);
      onStatus("error", "Connection failed: " + message);
      if (isAutoReconnect) {
        scheduleReconnect("the reconnect attempt failed");
      } else {
        await retry(username, signApiKey);
      }
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
  res.json({ ok: true, uptimeSeconds: process.uptime() });
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
var io = new Server(httpServer);

var game = createGameState();

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

function broadcastState() {
  var publicState = game.getPublicState();
  publicState.botAutoSolveEnabled = botAutoSolveEnabled;
  publicState.autoNextDelaySeconds = autoNextDelayMs / 1000;
  io.emit("state", publicState);
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
    broadcastState();
  }, autoNextDelayMs);
}

// Shared by both viewer guesses and host reveals: whenever an action just
// completed the puzzle, tell everyone and (optionally) queue the next round.
function emitPuzzleSolvedIfNeeded(justSolved) {
  if (!justSolved) return;
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
var avatarCache = {};

function processComment(text, uniqueId, nickname, source, avatarUrl) {
  if (text === null || typeof text === "undefined") text = "";
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

var tiktok = createTikTokConnector(
  function onChat(fields) {
    processComment(fields.text, fields.uniqueId, fields.nickname, "tiktok-live", fields.avatarUrl);
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
  var initialState = game.getPublicState();
  initialState.botAutoSolveEnabled = botAutoSolveEnabled;
  initialState.autoNextDelaySeconds = autoNextDelayMs / 1000;
  socket.emit("state", initialState);
  socket.emit("liveStatus", { state: "idle", message: "Not connected." });
  // Tell the client whether a Sign API Key / username are already
  // configured on the server, so it can skip asking the host to type them
  // in. The actual key value is never sent to the browser.
  socket.emit("liveConfig", {
    hasDefaultSignApiKey: !!DEFAULT_SIGN_API_KEY,
    defaultUsername: DEFAULT_TIKTOK_USERNAME || ""
  });

  socket.on("host:setMode", safe(function (payload) {
    if (!payload || !payload.mode) return;
    game.state.mode = payload.mode;
    broadcastState();
  }));

  socket.on("host:connectLive", safe(function (payload) {
    payload = payload || {};
    var username = String(payload.username || "").replace("@", "").trim() || DEFAULT_TIKTOK_USERNAME;
    var signApiKey = String(payload.signApiKey || "").trim() || DEFAULT_SIGN_API_KEY;
    tiktok.connect(username, signApiKey);
  }));

  socket.on("host:disconnectLive", safe(function () {
    tiktok.disconnect();
  }));

  socket.on("host:newPuzzle", safe(function (payload) {
    var difficulty = payload && payload.difficulty ? payload.difficulty : game.state.lastDifficulty;
    cancelAutoNext();
    game.reset(difficulty);
    broadcastState();
  }));

  socket.on("host:revealCell", safe(function () {
    var result = game.revealCell();
    broadcastState();
    emitPuzzleSolvedIfNeeded(result.justSolved);
  }));

  socket.on("host:revealBox", safe(function () {
    var result = game.revealBox();
    broadcastState();
    emitPuzzleSolvedIfNeeded(result.justSolved);
  }));

  socket.on("host:revealBoard", safe(function () {
    var result = game.revealBoard();
    broadcastState();
    emitPuzzleSolvedIfNeeded(result.justSolved);
  }));

  socket.on("host:setBotAutoSolve", safe(function (payload) {
    setBotAutoSolveEnabled(!!(payload && payload.enabled));
    broadcastState();
  }));

  socket.on("host:setAutoNext", safe(function (payload) {
    var enabled = !!(payload && payload.enabled);
    game.setAutoNext(enabled);
    if (!enabled) cancelAutoNext();
    broadcastState();
  }));

  // Lets the host customize how long (in seconds) the game waits after a
  // puzzle is solved before automatically starting the next one, when
  // Auto Next Round is on. Clamped to a sane range; broadcast to everyone
  // so every connected screen's settings input stays in sync.
  socket.on("host:setAutoNextDelay", safe(function (payload) {
    var seconds = payload && typeof payload.seconds !== "undefined" ? parseFloat(payload.seconds) : NaN;
    setAutoNextDelaySeconds(seconds);
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

var PORT = process.env.PORT || 3000;
httpServer.listen(PORT, function () {
  console.log("TikTok Sudoku LIVE server running on port " + PORT);

  // If a username AND a Sign API Key are both configured via environment
  // variables (.env locally, or Render's Environment tab), connect to TikTok
  // LIVE automatically as soon as the server boots - including right after a
  // Render free-tier spin-down - instead of waiting for the host to open the
  // page and click Connect. The host can always disconnect/reconnect
  // manually from Settings afterwards; this only covers the very first
  // connection of a fresh process.
  if (DEFAULT_TIKTOK_USERNAME && DEFAULT_SIGN_API_KEY) {
    console.log("[startup] TIKTOK_USERNAME and EULERSTREAM_SIGN_API_KEY are both set - connecting automatically...");
    tiktok.connect(DEFAULT_TIKTOK_USERNAME, DEFAULT_SIGN_API_KEY);
  }
});
