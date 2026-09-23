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

  // ---- Floating window timing preferences ---------------------------------
  // Customizable display durations for the live guess toast and the two
  // round-end floating windows (this round's scorers, then all-time), plus
  // how long until the next round auto-starts. The first three are purely
  // cosmetic and remembered on this device only; the next-round delay is
  // shared with every viewer, so changing it talks to the server.
  var TIMING_DEFAULTS = {
    toastSeconds: 4.2,
    roundWindowSeconds: 5,
    allTimeWindowSeconds: 5,
    autoNextDelaySeconds: 10
  };
  var TIMING_STORAGE_KEY = "sudokuLiveTiming";
  function loadTimingPrefs() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(TIMING_STORAGE_KEY) || "null"); } catch (e) { /* ignore */ }
    return {
      toastSeconds: (saved && typeof saved.toastSeconds === "number") ? saved.toastSeconds : TIMING_DEFAULTS.toastSeconds,
      roundWindowSeconds: (saved && typeof saved.roundWindowSeconds === "number") ? saved.roundWindowSeconds : TIMING_DEFAULTS.roundWindowSeconds,
      allTimeWindowSeconds: (saved && typeof saved.allTimeWindowSeconds === "number") ? saved.allTimeWindowSeconds : TIMING_DEFAULTS.allTimeWindowSeconds
    };
  }
  function saveTimingPrefs(prefs) {
    try { localStorage.setItem(TIMING_STORAGE_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }
  var timingPrefs = loadTimingPrefs();

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
  var roundEndCountdownEl = document.getElementById("roundEndCountdown");
  function clearAutoNextCountdown() {
    if (autoNextCountdownTimer) {
      clearInterval(autoNextCountdownTimer);
      autoNextCountdownTimer = null;
    }
    autoNextCountdownEl.hidden = true;
    if (roundEndCountdownEl) roundEndCountdownEl.hidden = true;
  }
  function updateAutoNextCountdownText(remaining) {
    autoNextCountdownEl.textContent = "Next puzzle starts in " + remaining + "s...";
    if (roundEndCountdownEl) {
      roundEndCountdownEl.hidden = false;
      roundEndCountdownEl.textContent = "Next round starts in " + remaining + "s...";
    }
  }
  function startAutoNextCountdown(seconds) {
    var remaining = Math.max(0, Math.round(seconds));
    clearAutoNextCountdown();
    autoNextCountdownEl.hidden = false;
    updateAutoNextCountdownText(remaining);
    autoNextCountdownTimer = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        clearAutoNextCountdown();
        return;
      }
      updateAutoNextCountdownText(remaining);
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

  // ---- Rank badges: gold/silver/bronze medals for 1st/2nd/3rd place ------
  function rankBadge(idx) {
    if (idx === 0) return "\uD83E\uDD47"; // gold medal
    if (idx === 1) return "\uD83E\uDD48"; // silver medal
    if (idx === 2) return "\uD83E\uDD49"; // bronze medal
    return "#" + (idx + 1);
  }

  function renderScoreListInto(listEl, list) {
    listEl.innerHTML = "";
    (list || []).forEach(function (entry, idx) {
      var li = document.createElement("li");
      var rank = document.createElement("span");
      rank.className = "inline-rank" + (idx < 3 ? " inline-rank-medal" : "");
      rank.textContent = rankBadge(idx);
      li.appendChild(rank);
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
  // The area has a fixed, reserved height (see style.css) so the board
  // never gets pushed up/down as toasts appear and disappear, and only one
  // toast is ever shown at a time - a new one immediately replaces
  // whatever is currently showing instead of stacking up.
  var liveGuessToastAreaEl = document.getElementById("liveGuessToastArea");
  var TOAST_LIFETIME_MS = Math.round(timingPrefs.toastSeconds * 1000);
  var toastHideTimer = null;

  function clearCurrentToast() {
    if (toastHideTimer) { clearTimeout(toastHideTimer); toastHideTimer = null; }
    while (liveGuessToastAreaEl.firstChild) {
      liveGuessToastAreaEl.removeChild(liveGuessToastAreaEl.firstChild);
    }
  }

  function pushGuessToast(cls, avatarUrl, uniqueId, name, detailText, pointsText) {
    clearCurrentToast();
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
    toastHideTimer = setTimeout(function () {
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

  // Shared by the round-end floating window and the Leaderboard floating
  // window: renders a ranked list into any <ol>, with gold/silver/bronze
  // medals for the top 3 places.
  function renderRankedList(listEl, list, capped) {
    listEl.innerHTML = "";
    listEl.classList.toggle("capped-20", !!capped);
    var top = list || [];
    if (!top.length) {
      var empty = document.createElement("li");
      empty.textContent = "No scorers yet.";
      listEl.appendChild(empty);
      return;
    }
    top.forEach(function (entry, idx) {
      var li = document.createElement("li");
      var rank = document.createElement("span");
      rank.className = "round-end-rank" + (idx < 3 ? " round-end-rank-medal" : "");
      rank.textContent = rankBadge(idx);
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
      listEl.appendChild(li);
    });
  }

  function showRoundEndOverlay(title, list, capped) {
    roundEndTitleEl.textContent = title;
    renderRankedList(roundEndListEl, list, capped);
    roundEndOverlayEl.hidden = false;
  }

  // Shows the round's top scorers first (everyone who scored, however
  // many that is), then automatically swaps to the all-time top scorers
  // (shown ~20 at a time, scrollable for the rest) after a customizable
  // delay, then auto-dismisses after another customizable delay. The X
  // button (or clicking outside) can dismiss it early any time. Both
  // delays come from timingPrefs (Settings -> Floating Window Timing).
  function showRoundEndSequence(roundList, allTimeList) {
    clearRoundEndTimers();
    showRoundEndOverlay("This Round's Top Scorers", roundList, false);
    var roundMs = Math.round(timingPrefs.roundWindowSeconds * 1000);
    var allTimeMs = Math.round(timingPrefs.allTimeWindowSeconds * 1000);
    roundEndTimers.push(setTimeout(function () {
      showRoundEndOverlay("All-Time Top Scorers", allTimeList, true);
      roundEndTimers.push(setTimeout(function () {
        roundEndOverlayEl.hidden = true;
      }, allTimeMs));
    }, roundMs));
  }

  // ---- Leaderboard floating window (opened from the top-toolbar trophy) ---
  // Centrally located, tabbed between "This Round" and "All-Time". Stays in
  // sync live: whenever fresh leaderboard data arrives, re-render it if the
  // window happens to be open.
  var leaderboardOverlayEl = document.getElementById("leaderboardOverlay");
  var leaderboardModalCloseBtn = document.getElementById("leaderboardModalCloseBtn");
  var leaderboardModalRoundListEl = document.getElementById("leaderboardModalRoundList");
  var leaderboardModalAllTimeListEl = document.getElementById("leaderboardModalAllTimeList");
  var lbModalTabs = document.querySelectorAll(".lb-modal-tab");
  var lastLeaderboardData = { round: [], allTime: [] };

  function renderLeaderboardModalLists() {
    renderRankedList(leaderboardModalRoundListEl, lastLeaderboardData.round, false);
    renderRankedList(leaderboardModalAllTimeListEl, lastLeaderboardData.allTime, true);
  }
  function openLeaderboardModal() {
    renderLeaderboardModalLists();
    leaderboardOverlayEl.hidden = false;
  }
  function closeLeaderboardModal() {
    leaderboardOverlayEl.hidden = true;
  }
  if (leaderboardModalCloseBtn) leaderboardModalCloseBtn.addEventListener("click", closeLeaderboardModal);
  lbModalTabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      lbModalTabs.forEach(function (b) { b.classList.toggle("active", b === btn); });
      var tab = btn.getAttribute("data-lb-tab");
      leaderboardModalRoundListEl.hidden = tab !== "round";
      leaderboardModalAllTimeListEl.hidden = tab !== "alltime";
    });
  });

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
    lastLeaderboardData.round = state.leaderboard || [];
    lastLeaderboardData.allTime = state.allTimeLeaderboard || [];
    if (leaderboardOverlayEl && !leaderboardOverlayEl.hidden) renderLeaderboardModalLists();
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
    syncDifficultySelects(state.lastDifficulty);
    if (autoNextDelayInputEl && typeof state.autoNextDelaySeconds === "number" && document.activeElement !== autoNextDelayInputEl) {
      autoNextDelayInputEl.value = state.autoNextDelaySeconds;
    }
  });

  // ---- TikTok LIVE config - lets the host skip re-entering the Sign API
  //      Key when one is already set on the server (see server.js / .env).
  socket.on("liveConfig", function (cfg) {
    cfg = cfg || {};
    var signApiKeyInput = document.getElementById("signApiKey");
    var usernameInput = document.getElementById("tiktokUsername");
    var hintDefault = document.getElementById("liveKeyHintDefault");
    var hintManual = document.getElementById("liveKeyHintManual");
    if (cfg.hasDefaultSignApiKey) {
      signApiKeyServerConfigured = true;
      if (signApiKeyInput) signApiKeyInput.hidden = true;
      if (hintDefault) hintDefault.hidden = false;
      if (hintManual) hintManual.hidden = true;
    } else {
      signApiKeyServerConfigured = false;
      if (signApiKeyInput) signApiKeyInput.hidden = false;
      if (hintDefault) hintDefault.hidden = true;
      if (hintManual) hintManual.hidden = false;
    }
    if (cfg.defaultUsername && usernameInput && !usernameInput.value) {
      usernameInput.value = cfg.defaultUsername;
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
  // signApiKeyServerConfigured is set by the "liveConfig" socket listener
  // above: true when EULERSTREAM_SIGN_API_KEY is already set on the server,
  // in which case the host only needs to supply their TikTok username.
  var signApiKeyServerConfigured = false;
  document.getElementById("connectLiveBtn").addEventListener("click", function () {
    var username = document.getElementById("tiktokUsername").value.trim();
    var signApiKey = document.getElementById("signApiKey").value.trim();
    if (!username) {
      alert("Please enter your TikTok username.");
      return;
    }
    if (!signApiKeyServerConfigured && !signApiKey) {
      alert("Please enter your EulerStream Sign API Key.");
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

  // ---- Difficulty select sync (settings drawer <-> top toolbar) -----------
  var difficultySelectEl = document.getElementById("difficultySelect");
  var difficultySelectTopEl = document.getElementById("difficultySelectTop");
  function syncDifficultySelects(value) {
    if (!value) return;
    if (difficultySelectEl && difficultySelectEl.value !== value) difficultySelectEl.value = value;
    if (difficultySelectTopEl && difficultySelectTopEl.value !== value) difficultySelectTopEl.value = value;
  }
  if (difficultySelectEl) {
    difficultySelectEl.addEventListener("change", function () {
      syncDifficultySelects(difficultySelectEl.value);
    });
  }
  if (difficultySelectTopEl) {
    difficultySelectTopEl.addEventListener("change", function () {
      syncDifficultySelects(difficultySelectTopEl.value);
    });
  }

  // ---- New puzzle controls (settings drawer button + top toolbar button) --
  function triggerNewPuzzle() {
    var difficulty = (difficultySelectTopEl || difficultySelectEl).value;
    socket.emit("host:newPuzzle", { difficulty: difficulty });
    solvedBannerEl.hidden = true;
    clearAutoNextCountdown();
    hideRoundEndOverlay();
    closeSettings();
  }
  document.getElementById("newPuzzleBtn").addEventListener("click", triggerNewPuzzle);
  document.getElementById("newPuzzleTopBtn").addEventListener("click", triggerNewPuzzle);

  // ---- Hints & Reveals (settings drawer buttons + top toolbar buttons) ----
  function triggerRevealCell() { socket.emit("host:revealCell"); }
  function triggerRevealBox() { socket.emit("host:revealBox"); }
  function triggerRevealBoard() {
    if (window.confirm("Reveal the entire board? This instantly ends the round.")) {
      socket.emit("host:revealBoard");
    }
  }
  document.getElementById("revealCellBtn").addEventListener("click", triggerRevealCell);
  document.getElementById("revealBoxBtn").addEventListener("click", triggerRevealBox);
  document.getElementById("revealBoardBtn").addEventListener("click", triggerRevealBoard);
  document.getElementById("revealCellTopBtn").addEventListener("click", triggerRevealCell);
  document.getElementById("revealBoxTopBtn").addEventListener("click", triggerRevealBox);
  document.getElementById("revealBoardTopBtn").addEventListener("click", triggerRevealBoard);

  // ---- Leaderboard top toolbar button --------------------------------------
  // Opens the centrally located Leaderboards floating window (This Round /
  // All-Time tabs), rather than just scrolling to the inline panel.
  document.getElementById("leaderboardTopBtn").addEventListener("click", openLeaderboardModal);

  // ---- Floating window timing controls -------------------------------------
  var toastDurationInputEl = document.getElementById("toastDurationInput");
  var roundWindowDurationInputEl = document.getElementById("roundWindowDurationInput");
  var allTimeWindowDurationInputEl = document.getElementById("allTimeWindowDurationInput");
  var autoNextDelayInputEl = document.getElementById("autoNextDelayInput");
  var resetTimingBtnEl = document.getElementById("resetTimingBtn");

  function applyTimingInputsFromPrefs() {
    if (toastDurationInputEl) toastDurationInputEl.value = timingPrefs.toastSeconds;
    if (roundWindowDurationInputEl) roundWindowDurationInputEl.value = timingPrefs.roundWindowSeconds;
    if (allTimeWindowDurationInputEl) allTimeWindowDurationInputEl.value = timingPrefs.allTimeWindowSeconds;
  }
  applyTimingInputsFromPrefs();

  function clampNumber(value, fallback, min, max) {
    var n = parseFloat(value);
    if (isNaN(n)) n = fallback;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  if (toastDurationInputEl) {
    toastDurationInputEl.addEventListener("change", function () {
      var v = clampNumber(toastDurationInputEl.value, TIMING_DEFAULTS.toastSeconds, 1, 20);
      toastDurationInputEl.value = v;
      timingPrefs.toastSeconds = v;
      TOAST_LIFETIME_MS = Math.round(v * 1000);
      saveTimingPrefs(timingPrefs);
    });
  }
  if (roundWindowDurationInputEl) {
    roundWindowDurationInputEl.addEventListener("change", function () {
      var v = clampNumber(roundWindowDurationInputEl.value, TIMING_DEFAULTS.roundWindowSeconds, 2, 60);
      roundWindowDurationInputEl.value = v;
      timingPrefs.roundWindowSeconds = v;
      saveTimingPrefs(timingPrefs);
    });
  }
  if (allTimeWindowDurationInputEl) {
    allTimeWindowDurationInputEl.addEventListener("change", function () {
      var v = clampNumber(allTimeWindowDurationInputEl.value, TIMING_DEFAULTS.allTimeWindowSeconds, 2, 60);
      allTimeWindowDurationInputEl.value = v;
      timingPrefs.allTimeWindowSeconds = v;
      saveTimingPrefs(timingPrefs);
    });
  }
  // The next-round delay is shared across every connected viewer, so it is
  // sent to the server (which clamps, stores, and broadcasts it back) rather
  // than only saved locally.
  if (autoNextDelayInputEl) {
    autoNextDelayInputEl.addEventListener("change", function () {
      var v = clampNumber(autoNextDelayInputEl.value, TIMING_DEFAULTS.autoNextDelaySeconds, 3, 300);
      autoNextDelayInputEl.value = v;
      socket.emit("host:setAutoNextDelay", { seconds: v });
    });
  }
  if (resetTimingBtnEl) {
    resetTimingBtnEl.addEventListener("click", function () {
      timingPrefs = {
        toastSeconds: TIMING_DEFAULTS.toastSeconds,
        roundWindowSeconds: TIMING_DEFAULTS.roundWindowSeconds,
        allTimeWindowSeconds: TIMING_DEFAULTS.allTimeWindowSeconds
      };
      TOAST_LIFETIME_MS = Math.round(timingPrefs.toastSeconds * 1000);
      saveTimingPrefs(timingPrefs);
      applyTimingInputsFromPrefs();
      if (autoNextDelayInputEl) autoNextDelayInputEl.value = TIMING_DEFAULTS.autoNextDelaySeconds;
      socket.emit("host:setAutoNextDelay", { seconds: TIMING_DEFAULTS.autoNextDelaySeconds });
    });
  }

  // ---- Test mode: bot auto-solve ------------------------------------------
  var botAutoSolveToggleEl = document.getElementById("botAutoSolveToggle");
  botAutoSolveToggleEl.addEventListener("change", function () {
    socket.emit("host:setBotAutoSolve", { enabled: botAutoSolveToggleEl.checked });
  });

})();
