// game.js - runs in the browser. Talks to the server over Socket.IO.
(function () {
  "use strict";

  // ---- Mobile-safe viewport height (avoid raw 100vh on phones) ----------
  function setViewportHeight() {
    var vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty("--vh", vh + "px");
  }
  window.addEventListener("resize", setViewportHeight);
  setViewportHeight();

  var socket = io();

  // ---- DOM refs -----------------------------------------------------------
  var modeBtns = document.querySelectorAll(".mode-btn");
  var panels = {
    live: document.querySelector('[data-panel="live"]'),
    test: document.querySelector('[data-panel="test"]'),
    offline: document.querySelector('[data-panel="offline"]')
  };
  var gridEl = document.getElementById("sudokuGrid");
  var rawEventCountEl = document.getElementById("rawEventCount");
  var lastReceivedEl = document.getElementById("lastReceived");
  var leaderboardListEl = document.getElementById("leaderboardList");
  var feedListEl = document.getElementById("feedList");
  var solvedBannerEl = document.getElementById("solvedBanner");
  var liveStatusEl = document.getElementById("liveStatus");

  var currentMode = "offline";

  // ---- Mode switching -------------------------------------------------------
  function showMode(mode) {
    currentMode = mode;
    modeBtns.forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
    });
    Object.keys(panels).forEach(function (key) {
      if (!panels[key]) return;
      panels[key].hidden = key !== mode;
    });
  }
  modeBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var mode = btn.getAttribute("data-mode");
      showMode(mode);
      socket.emit("host:setMode", { mode: mode });
    });
  });

  // ---- Grid rendering ---------------------------------------------------
  function coordLabel(row, col) {
    var rowLetter = String.fromCharCode(65 + row);
    return rowLetter + (col + 1);
  }

  function renderBoard(board, givenMask) {
    gridEl.innerHTML = "";
    // corner blank cell
    var corner = document.createElement("div");
    corner.className = "grid-cell grid-label";
    gridEl.appendChild(corner);
    // column headers 1-9
    for (var c = 0; c < 9; c++) {
      var colHead = document.createElement("div");
      colHead.className = "grid-cell grid-label";
      colHead.textContent = String(c + 1);
      gridEl.appendChild(colHead);
    }
    for (var r = 0; r < 9; r++) {
      var rowHead = document.createElement("div");
      rowHead.className = "grid-cell grid-label";
      rowHead.textContent = String.fromCharCode(65 + r);
      gridEl.appendChild(rowHead);
      for (var cc = 0; cc < 9; cc++) {
        var cell = document.createElement("div");
        var classes = ["grid-cell"];
        var value = board[r][cc];
        var isGiven = givenMask[r][cc];
        if (isGiven) classes.push("given");
        else if (value !== 0) classes.push("correct");
        if (cc === 2 || cc === 5) classes.push("thick-right");
        if (r === 2 || r === 5) classes.push("thick-bottom");
        cell.className = classes.join(" ");
        cell.textContent = value === 0 ? "" : String(value);
        cell.title = coordLabel(r, cc);
        (function (label) {
          cell.addEventListener("click", function () {
            var input = document.getElementById("hostConsoleInput");
            input.value = label + " ";
            input.focus();
          });
        })(coordLabel(r, cc));
        gridEl.appendChild(cell);
      }
    }
  }

  function renderLeaderboard(list) {
    leaderboardListEl.innerHTML = "";
    list.forEach(function (entry) {
      var li = document.createElement("li");
      li.textContent = entry.name + " - " + entry.points + " pts (" + entry.correct + " correct)";
      leaderboardListEl.appendChild(li);
    });
  }

  function addFeedItem(text, cls) {
    var li = document.createElement("li");
    li.textContent = text;
    if (cls) li.className = cls;
    feedListEl.insertBefore(li, feedListEl.firstChild);
    while (feedListEl.children.length > 40) {
      feedListEl.removeChild(feedListEl.lastChild);
    }
  }

  // ---- Socket listeners ---------------------------------------------------
  socket.on("state", function (state) {
    renderBoard(state.board, state.givenMask);
    renderLeaderboard(state.leaderboard);
    rawEventCountEl.textContent = String(state.rawEventCount);
    if (state.lastReceived) {
      lastReceivedEl.textContent = state.lastReceived.nickname + ": " + state.lastReceived.text;
    }
    solvedBannerEl.hidden = !state.solved;
    showMode(state.mode);
  });

  socket.on("diagnostics", function (diag) {
    rawEventCountEl.textContent = String(diag.rawEventCount);
    if (diag.lastReceived) {
      lastReceivedEl.textContent = diag.lastReceived.nickname + ": " + diag.lastReceived.text;
    }
  });

  socket.on("guessResult", function (res) {
    var name = res.nickname || res.uniqueId || "viewer";
    if (res.status === "correct") {
      addFeedItem(name + " solved " + res.coord + " = " + res.num + " (+10)", "feed-correct");
    } else if (res.status === "wrong") {
      addFeedItem(name + " tried " + res.coord + " = " + res.num + " (wrong)", "feed-wrong");
    } else if (res.status === "given") {
      addFeedItem(name + " tried " + res.coord + " but it is a pre-filled clue", "feed-info");
    } else if (res.status === "already-solved") {
      addFeedItem(name + " tried " + res.coord + " but it is already solved", "feed-info");
    } else if (res.status === "unparsed") {
      // not a valid coordinate guess - ignore silently in the feed to avoid spam
    }
  });

  socket.on("puzzleSolved", function () {
    solvedBannerEl.hidden = false;
    addFeedItem("PUZZLE SOLVED by the audience!", "feed-correct");
  });

  socket.on("liveStatus", function (status) {
    liveStatusEl.textContent = status.message;
    liveStatusEl.className = "status-line status-" + status.state;
  });

  // ---- Live mode controls -------------------------------------------------
  document.getElementById("connectLiveBtn").addEventListener("click", function () {
    var username = document.getElementById("tiktokUsername").value.trim();
    var signApiKey = document.getElementById("signApiKey").value.trim();
    if (!username || !signApiKey) {
      alert("Please enter both your TikTok username and your EulerStream Sign API Key.");
      return;
    }
    socket.emit("host:connectLive", { username: username, signApiKey: signApiKey });
  });
  document.getElementById("disconnectLiveBtn").addEventListener("click", function () {
    socket.emit("host:disconnectLive");
  });

  // ---- Test mode controls ---------------------------------------------------
  document.getElementById("simulateBtn").addEventListener("click", function () {
    socket.emit("test:simulate", {});
  });
  document.getElementById("testCustomBtn").addEventListener("click", function () {
    var input = document.getElementById("testCustomText");
    var text = input.value.trim();
    if (!text) return;
    socket.emit("test:simulate", { text: text });
    input.value = "";
  });

  // ---- Offline mode controls -----------------------------------------------
  function submitOffline() {
    var input = document.getElementById("offlineGuessInput");
    var text = input.value.trim();
    if (!text) return;
    socket.emit("offline:guess", { text: text });
    input.value = "";
  }
  document.getElementById("offlineGuessBtn").addEventListener("click", submitOffline);
  document.getElementById("offlineGuessInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") submitOffline();
  });

  // ---- Host console (works in every mode) -----------------------------------
  function submitHostConsole() {
    var input = document.getElementById("hostConsoleInput");
    var text = input.value.trim();
    if (!text) return;
    socket.emit("host:comment", { text: text });
    input.value = "";
  }
  document.getElementById("hostConsoleBtn").addEventListener("click", submitHostConsole);
  document.getElementById("hostConsoleInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") submitHostConsole();
  });

  // ---- New puzzle controls ---------------------------------------------------
  document.getElementById("newPuzzleBtn").addEventListener("click", function () {
    var difficulty = document.getElementById("difficultySelect").value;
    socket.emit("host:newPuzzle", { difficulty: difficulty });
    solvedBannerEl.hidden = true;
  });

})();
