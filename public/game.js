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

  // ---- Theme (Dark / Light) -------------------------------------------
  // Defaults to the viewer's OS/browser preference; an explicit choice
  // here is remembered on this device (localStorage) and always wins.
  var THEME_STORAGE_KEY = "sudokuLiveTheme";
  var themeButtons = document.querySelectorAll(".theme-btn");

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    themeButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-theme-choice") === theme);
    });
  }
  themeButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var choice = btn.getAttribute("data-theme-choice");
      applyTheme(choice);
      try { localStorage.setItem(THEME_STORAGE_KEY, choice); } catch (e) { /* storage unavailable - ignore */ }
    });
  });
  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_STORAGE_KEY); } catch (e) { /* ignore */ }
    if (saved === "light" || saved === "dark") {
      applyTheme(saved);
    } else {
      var prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
      themeButtons.forEach(function (btn) {
        btn.classList.toggle("active", btn.getAttribute("data-theme-choice") === (prefersLight ? "light" : "dark"));
      });
    }
  })();

  // ---- Host console collapse/expand ----------------------------------
  // Lets the host hide the bottom console (input + Send) to reclaim
  // screen space once they're done using it manually. Remembered on
  // this device between visits.
  var HOST_CONSOLE_STORAGE_KEY = "sudokuLiveHostConsoleCollapsed";
  var hostConsoleBar = document.getElementById("hostConsoleBar");
  var hostConsoleRow = document.getElementById("hostConsoleRow");
  var hostConsoleToggle = document.getElementById("hostConsoleToggle");

  function updateHostConsoleOffset() {
    if (!hostConsoleBar) return;
    document.documentElement.style.setProperty("--host-console-offset", hostConsoleBar.offsetHeight + "px");
  }
  function setHostConsoleCollapsed(collapsed) {
    hostConsoleBar.classList.toggle("collapsed", collapsed);
    hostConsoleRow.hidden = collapsed;
    hostConsoleToggle.innerHTML = collapsed ? "&#9650; Show" : "&#9660; Hide";
    hostConsoleToggle.setAttribute("aria-label", collapsed ? "Show host console" : "Hide host console");
    try { localStorage.setItem(HOST_CONSOLE_STORAGE_KEY, collapsed ? "1" : "0"); } catch (e) { /* ignore */ }
    updateHostConsoleOffset();
  }
  hostConsoleToggle.addEventListener("click", function () {
    setHostConsoleCollapsed(!hostConsoleBar.classList.contains("collapsed"));
  });
  window.addEventListener("resize", updateHostConsoleOffset);
  (function initHostConsoleCollapse() {
    var saved = null;
    try { saved = localStorage.getItem(HOST_CONSOLE_STORAGE_KEY); } catch (e) { /* ignore */ }
    setHostConsoleCollapsed(saved === "1");
  })();

  // ---- Full Screen toggle --------------------------------------------------
  // Uses the standard Fullscreen API (with vendor-prefixed fallbacks for
  // older Safari/IE/Edge). The board itself never stretches to fill the
  // screen - it keeps its own square aspect ratio and just gets a slightly
  // higher max size on big fullscreen displays (see style.css). If the
  // browser doesn't support the Fullscreen API at all (some mobile browsers
  // in an embedded webview), the button is hidden instead of doing nothing.
  var fullscreenBtn = document.getElementById("fullscreenBtn");
  var appShellEl = document.querySelector(".app-shell");

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
  }

  function updateFullscreenBtn() {
    if (!fullscreenBtn) return;
    var active = isFullscreen();
    fullscreenBtn.classList.toggle("active", active);
    fullscreenBtn.innerHTML = active ? "&#10005;" : "&#9974;";
    fullscreenBtn.title = active ? "Exit Full Screen" : "Full Screen";
    fullscreenBtn.setAttribute("aria-label", active ? "Exit Full Screen" : "Full Screen");
  }

  function requestFullscreenOn(el) {
    var request = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!request) return;
    try { request.call(el); } catch (e) { /* ignore - some browsers require a fresh user gesture */ }
  }

  function exitFullscreenNow() {
    var exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (!exit) return;
    try { exit.call(document); } catch (e) { /* already out of fullscreen */ }
  }

  if (fullscreenBtn) {
    var target = appShellEl || document.documentElement;
    var fsSupported = !!(
      target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen
    );
    if (!fsSupported) {
      fullscreenBtn.hidden = true;
    } else {
      fullscreenBtn.addEventListener("click", function () {
        if (isFullscreen()) exitFullscreenNow();
        else requestFullscreenOn(target);
      });
      document.addEventListener("fullscreenchange", function () { updateFullscreenBtn(); setViewportHeight(); });
      document.addEventListener("webkitfullscreenchange", function () { updateFullscreenBtn(); setViewportHeight(); });
      document.addEventListener("msfullscreenchange", function () { updateFullscreenBtn(); setViewportHeight(); });
      updateFullscreenBtn();
    }
  }

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
  var liveStatusMiniEl = document.getElementById("liveStatusMini");
  var stopwatchEl = document.getElementById("stopwatch");
  var autoNextCountdownEl = document.getElementById("autoNextCountdown");
  var autoNextToggleEl = document.getElementById("autoNextToggle");
  var allTimeLeaderboardListEl = document.getElementById("allTimeLeaderboardList");

  var currentMode = "offline";

  // ---- Avatars (real TikTok photo when known, generated initials otherwise) --
  function hashStringToHue(str) {
    var hash = 0;
    str = String(str || "?");
    for (var i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash % 360;
  }
  function initialsFor(name) {
    var trimmed = String(name || "?").trim();
    if (!trimmed) return "?";
    var parts = trimmed.split(/\s+/);
    var initials = parts[0].charAt(0);
    if (parts.length > 1) initials += parts[parts.length - 1].charAt(0);
    return initials.toUpperCase();
  }
  function generatedAvatarDataUri(seed, name) {
    var hue = hashStringToHue(seed || name);
    var bg = "hsl(" + hue + ", 55%, 45%)";
    var initials = initialsFor(name);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="32" fill="' + bg + '"/>' +
      '<text x="32" y="41" font-family="Segoe UI, Arial, sans-serif" font-size="26" ' +
      'font-weight="700" fill="#ffffff" text-anchor="middle">' + initials + '</text></svg>';
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }
  function makeAvatarImg(avatarUrl, uniqueId, name, sizeClass) {
    var img = document.createElement("img");
    img.className = "avatar-circle" + (sizeClass ? " " + sizeClass : "");
    img.alt = "";
    img.loading = "lazy";
    var fallback = generatedAvatarDataUri(uniqueId, name);
    img.src = avatarUrl || fallback;
    // A real TikTok photo URL can occasionally fail to load (expired CDN
    // link, offline, etc.) - fall back to the generated avatar instead of
    // showing a broken image icon.
    img.addEventListener("error", function () {
      if (img.src !== fallback) img.src = fallback;
    });
    return img;
  }

  // ---- Stopwatch (informational only - there is NO time limit) ------------
  // The clock just tells everyone how long the current puzzle has taken so
  // far. Once solved, it freezes on the server-reported solve time.
  var roundStartTime = null;
  var roundIsSolved = false;
  var roundSolveTimeMs = null;

  function formatDuration(ms) {
    if (ms == null || ms < 0 || isNaN(ms)) ms = 0;
    var totalSeconds = Math.floor(ms / 1000);
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  function tickStopwatch() {
    if (!roundStartTime) return;
    var elapsed = (roundIsSolved && roundSolveTimeMs != null)
      ? roundSolveTimeMs
      : (Date.now() - roundStartTime);
    stopwatchEl.innerHTML = "&#9201; " + formatDuration(elapsed);
  }
  setInterval(tickStopwatch, 500);

  // ---- Auto Next Round countdown banner ------------------------------------
  var autoNextCountdownTimer = null;
  function clearAutoNextCountdown() {
    if (autoNextCountdownTimer) {
      clearInterval(autoNextCountdownTimer);
      autoNextCountdownTimer = null;
    }
    autoNextCountdownEl.hidden = true;
  }
  function startAutoNextCountdown(seconds) {
    var remaining = Math.max(0, Math.round(seconds));
    clearAutoNextCountdown();
    autoNextCountdownEl.hidden = false;
    autoNextCountdownEl.textContent = "Next puzzle starts in " + remaining + "s...";
    autoNextCountdownTimer = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        clearAutoNextCountdown();
        return;
      }
      autoNextCountdownEl.textContent = "Next puzzle starts in " + remaining + "s...";
    }, 1000);
  }

  // ---- Settings drawer open/close -----------------------------------------
  // NOTE: we set element.style.display directly (an inline style) rather than
  // only toggling the "hidden" attribute. Inline styles always win over any
  // class in a stylesheet (short of !important), so this cannot be silently
  // overridden by CSS again in the future - closing is now guaranteed to work.
  var settingsOverlay = document.getElementById("settingsOverlay");
  function openSettings() {
    settingsOverlay.hidden = false;
    settingsOverlay.style.display = "flex";
  }
  function closeSettings() {
    settingsOverlay.hidden = true;
    settingsOverlay.style.display = "none";
  }
  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("closeSettingsBtn").addEventListener("click", closeSettings);
  document.getElementById("settingsBackdrop").addEventListener("click", closeSettings);

  // ---- Leaderboard / diagnostics collapse ----------------------------------
  var detailsToggle = document.getElementById("detailsToggle");
  var detailsPanel = document.getElementById("detailsPanel");
  var detailsOpen = false;
  function setDetailsOpen(open) {
    detailsOpen = open;
    detailsPanel.hidden = !open;
    detailsPanel.style.display = open ? "flex" : "none";
    detailsToggle.innerHTML = open
      ? "&#9650; Hide Leaderboard &amp; Activity"
      : "&#9660; Leaderboard &amp; Activity";
  }
  detailsToggle.addEventListener("click", function () {
    setDetailsOpen(!detailsOpen);
  });

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
    var corner = document.createElement("div");
    corner.className = "grid-cell grid-label";
    gridEl.appendChild(corner);
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

  function renderScoreListInto(listEl, list) {
    listEl.innerHTML = "";
    (list || []).forEach(function (entry) {
      var li = document.createElement("li");
      li.appendChild(makeAvatarImg(entry.avatar, entry.uniqueId, entry.name));
      var span = document.createElement("span");
      span.textContent = entry.name + " - " + entry.points + " pt" + (entry.points === 1 ? "" : "s");
      li.appendChild(span);
      listEl.appendChild(li);
    });
  }

  function renderLeaderboard(list) {
    renderScoreListInto(leaderboardListEl, list);
  }

  function renderAllTimeLeaderboard(list) {
    renderScoreListInto(allTimeLeaderboardListEl, list);
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

  // ---- Live guess toast area (the gap between the chat-format hint and
  //      the status/timer row) - a floating pill per incoming guess. -----
  var liveGuessToastAreaEl = document.getElementById("liveGuessToastArea");
  var MAX_TOASTS = 4;
  var TOAST_LIFETIME_MS = 4200;

  function pushGuessToast(cls, avatarUrl, uniqueId, name, detailText, pointsText) {
    var toast = document.createElement("div");
    toast.className = "guess-toast " + cls;
    toast.appendChild(makeAvatarImg(avatarUrl, uniqueId, name));
    var nameSpan = document.createElement("span");
    nameSpan.className = "guess-name";
    nameSpan.textContent = name;
    toast.appendChild(nameSpan);
    var detailSpan = document.createElement("span");
    detailSpan.className = "guess-detail";
    detailSpan.textContent = detailText;
    toast.appendChild(detailSpan);
    if (pointsText) {
      var ptSpan = document.createElement("span");
      ptSpan.className = "guess-points";
      ptSpan.textContent = pointsText;
      toast.appendChild(ptSpan);
    }
    liveGuessToastAreaEl.appendChild(toast);
    while (liveGuessToastAreaEl.children.length > MAX_TOASTS) {
      liveGuessToastAreaEl.removeChild(liveGuessToastAreaEl.firstChild);
    }
    setTimeout(function () {
      toast.classList.add("leaving");
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 350);
    }, TOAST_LIFETIME_MS);
  }

  // ---- Round-end floating windows: round top scorers, then all-time ----
  var roundEndOverlayEl = document.getElementById("roundEndOverlay");
  var roundEndTitleEl = document.getElementById("roundEndTitle");
  var roundEndListEl = document.getElementById("roundEndList");
  var roundEndCloseBtn = document.getElementById("roundEndCloseBtn");
  var roundEndTimers = [];

  function clearRoundEndTimers() {
    roundEndTimers.forEach(function (t) { clearTimeout(t); });
    roundEndTimers = [];
  }
  function hideRoundEndOverlay() {
    clearRoundEndTimers();
    roundEndOverlayEl.hidden = true;
  }
  roundEndCloseBtn.addEventListener("click", hideRoundEndOverlay);

  function renderRoundEndList(list) {
    roundEndListEl.innerHTML = "";
    var top = (list || []).slice(0, 5);
    if (!top.length) {
      var empty = document.createElement("li");
      empty.textContent = "No scorers yet.";
      roundEndListEl.appendChild(empty);
      return;
    }
    top.forEach(function (entry, idx) {
      var li = document.createElement("li");
      var rank = document.createElement("span");
      rank.className = "round-end-rank";
      rank.textContent = "#" + (idx + 1);
      li.appendChild(rank);
      li.appendChild(makeAvatarImg(entry.avatar, entry.uniqueId, entry.name, "lg"));
      var nameSpan = document.createElement("span");
      nameSpan.className = "round-end-name";
      nameSpan.textContent = entry.name;
      li.appendChild(nameSpan);
      var ptSpan = document.createElement("span");
      ptSpan.className = "round-end-points";
      ptSpan.textContent = entry.points + " pt" + (entry.points === 1 ? "" : "s");
      li.appendChild(ptSpan);
      roundEndListEl.appendChild(li);
    });
  }

  function showRoundEndOverlay(title, list) {
    roundEndTitleEl.textContent = title;
    renderRoundEndList(list);
    roundEndOverlayEl.hidden = false;
  }

  // Shows the round's top scorers first, then automatically swaps to the
  // all-time top scorers a few seconds later, then auto-dismisses. The X
  // button (or clicking outside via close) can dismiss it early any time.
  function showRoundEndSequence(roundList, allTimeList) {
    clearRoundEndTimers();
    showRoundEndOverlay("This Round's Top Scorers", roundList);
    roundEndTimers.push(setTimeout(function () {
      showRoundEndOverlay("All-Time Top Scorers", allTimeList);
      roundEndTimers.push(setTimeout(function () {
        roundEndOverlayEl.hidden = true;
      }, 5000));
    }, 5000));
  }

  var MINI_LABELS = {
    idle: "Offline",
    connecting: "Connecting...",
    connected: "LIVE",
    retrying: "Retrying...",
    disconnected: "Offline",
    error: "Error"
  };

  function updateLiveStatusMini(state) {
    liveStatusMiniEl.className = "live-status-mini status-" + state;
    liveStatusMiniEl.innerHTML = "&#9679; " + (MINI_LABELS[state] || state);
  }

  // ---- Socket listeners ---------------------------------------------------
  socket.on("state", function (state) {
    renderBoard(state.board, state.givenMask);
    renderLeaderboard(state.leaderboard);
    renderAllTimeLeaderboard(state.allTimeLeaderboard);
    rawEventCountEl.textContent = String(state.rawEventCount);
    if (state.lastReceived) {
      lastReceivedEl.textContent = state.lastReceived.nickname + ": " + state.lastReceived.text;
    }
    solvedBannerEl.hidden = !state.solved;
    showMode(state.mode);

    // Stopwatch: reflects the server's round start time. No time limit -
    // this is purely informational (and freezes at solve time once solved).
    roundStartTime = state.roundStartTime || null;
    roundIsSolved = !!state.solved;
    roundSolveTimeMs = (typeof state.solveTimeMs === "number") ? state.solveTimeMs : null;
    tickStopwatch();
    if (!state.solved) clearAutoNextCountdown();

    autoNextToggleEl.checked = !!state.autoNextRound;
    if (botAutoSolveToggleEl) botAutoSolveToggleEl.checked = !!state.botAutoSolveEnabled;
    if (state.lastDifficulty) {
      var difficultySelectEl = document.getElementById("difficultySelect");
      if (difficultySelectEl && difficultySelectEl.value !== state.lastDifficulty) {
        difficultySelectEl.value = state.lastDifficulty;
      }
    }
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
      addFeedItem(name + " placed " + res.num + " at " + res.coord + " (+1)", "feed-correct");
      pushGuessToast("toast-correct", res.avatar, res.uniqueId, name, "placed " + res.num + " at " + res.coord, "+1");
    } else if (res.status === "wrong") {
      addFeedItem(name + " tried " + res.num + " at " + res.coord + " (wrong)", "feed-wrong");
      pushGuessToast("toast-wrong", res.avatar, res.uniqueId, name, "wrong answer at " + res.coord);
    } else if (res.status === "given") {
      addFeedItem(name + " tried " + res.coord + " but it is a pre-filled clue", "feed-info");
      pushGuessToast("toast-info", res.avatar, res.uniqueId, name, res.coord + " already answered");
    } else if (res.status === "already-solved") {
      addFeedItem(name + " tried " + res.coord + " but it is already solved", "feed-info");
      pushGuessToast("toast-info", res.avatar, res.uniqueId, name, res.coord + " already answered");
    } else if (res.status === "unparsed") {
      // Not a recognized coordinate format - now surfaced in the live toast
      // feed too (per request) instead of being ignored silently.
      pushGuessToast("toast-format", res.avatar, res.uniqueId, name, "wrong format - try e.g. A5 7");
    }
  });

  socket.on("puzzleSolved", function (data) {
    data = data || {};
    var timeText = (typeof data.solveTimeMs === "number") ? " in " + formatDuration(data.solveTimeMs) : "";
    solvedBannerEl.hidden = false;
    solvedBannerEl.textContent = "SOLVED" + timeText + "!";
    addFeedItem("PUZZLE SOLVED by the audience" + timeText + "!", "feed-correct");
    if (data.leaderboard) renderLeaderboard(data.leaderboard);
    if (data.allTimeLeaderboard) renderAllTimeLeaderboard(data.allTimeLeaderboard);
    roundIsSolved = true;
    if (typeof data.solveTimeMs === "number") roundSolveTimeMs = data.solveTimeMs;
    tickStopwatch();
    showRoundEndSequence(data.leaderboard, data.allTimeLeaderboard);
  });

  socket.on("autoNextCountdown", function (data) {
    startAutoNextCountdown(data && data.seconds ? data.seconds : 10);
  });

  socket.on("liveStatus", function (status) {
    liveStatusEl.textContent = status.message;
    liveStatusEl.className = "status-line status-" + status.state;
    updateLiveStatusMini(status.state);
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

  // ---- Auto Next Round toggle -------------------------------------------
  autoNextToggleEl.addEventListener("change", function () {
    socket.emit("host:setAutoNext", { enabled: autoNextToggleEl.checked });
    if (!autoNextToggleEl.checked) clearAutoNextCountdown();
  });

  // ---- New puzzle controls ---------------------------------------------------
  document.getElementById("newPuzzleBtn").addEventListener("click", function () {
    var difficulty = document.getElementById("difficultySelect").value;
    socket.emit("host:newPuzzle", { difficulty: difficulty });
    solvedBannerEl.hidden = true;
    clearAutoNextCountdown();
    hideRoundEndOverlay();
    closeSettings();
  });

  // ---- Hints & Reveals ---------------------------------------------------
  document.getElementById("revealCellBtn").addEventListener("click", function () {
    socket.emit("host:revealCell");
  });
  document.getElementById("revealBoxBtn").addEventListener("click", function () {
    socket.emit("host:revealBox");
  });
  document.getElementById("revealBoardBtn").addEventListener("click", function () {
    if (window.confirm("Reveal the entire board? This instantly ends the round.")) {
      socket.emit("host:revealBoard");
    }
  });

  // ---- Test mode: bot auto-solve ------------------------------------------
  var botAutoSolveToggleEl = document.getElementById("botAutoSolveToggle");
  botAutoSolveToggleEl.addEventListener("change", function () {
    socket.emit("host:setBotAutoSolve", { enabled: botAutoSolveToggleEl.checked });
  });

})();
