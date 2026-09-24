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

  // ---- Theme (Dark / Light / Cream / Sky Blue / Meadow Green /
  //      Blossom Pink / Lavender Violet / Honey Gold) --------------------
  // Defaults to the viewer's OS/browser preference (dark or light only);
  // an explicit choice of any of the 8 themes is remembered on this device
  // (localStorage) and always wins from then on. Picking a theme is
  // available both from Settings (a grid of cards) and from the compact
  // dropdown in the top toolbar - both stay in sync.
  var THEME_STORAGE_KEY = "sudokuLiveTheme";
  var THEME_META = {
    dark:     { label: "Dark" },
    light:    { label: "Light" },
    cream:    { label: "Cream" },
    sky:      { label: "Sky Blue" },
    meadow:   { label: "Meadow Green" },
    blossom:  { label: "Blossom Pink" },
    lavender: { label: "Lavender Violet" },
    honey:    { label: "Honey Gold" }
  };
  var themeChoiceButtons = document.querySelectorAll(".theme-choice-btn");
  var themeDropdownIcon = document.getElementById("themeDropdownIcon");
  var themeDropdownBtn = document.getElementById("themeDropdownBtn");
  var themeDropdownMenu = document.getElementById("themeDropdownMenu");

  function updateThemeUI(key) {
    themeChoiceButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-theme-choice") === key);
    });
    if (themeDropdownMenu) {
      themeDropdownMenu.querySelectorAll("li").forEach(function (li) {
        var active = li.getAttribute("data-value") === key;
        li.classList.toggle("dd-active", active);
        li.setAttribute("aria-selected", active ? "true" : "false");
      });
    }
    if (themeDropdownIcon) themeDropdownIcon.className = "theme-swatch swatch-" + key;
    var label = THEME_META[key] ? THEME_META[key].label : key;
    if (themeDropdownBtn) {
      themeDropdownBtn.title = "Theme: " + label;
      themeDropdownBtn.setAttribute("aria-label", "Theme: " + label);
    }
  }

  function applyTheme(theme) {
    if (THEME_META[theme]) {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    updateThemeUI(theme);
  }

  function getEffectiveThemeKey() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr && THEME_META[attr]) return attr;
    var prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    return prefersLight ? "light" : "dark";
  }

  function selectTheme(choice) {
    if (!THEME_META[choice]) return;
    applyTheme(choice);
    try { localStorage.setItem(THEME_STORAGE_KEY, choice); } catch (e) { /* storage unavailable - ignore */ }
  }
  themeChoiceButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      selectTheme(btn.getAttribute("data-theme-choice"));
    });
  });
  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_STORAGE_KEY); } catch (e) { /* ignore */ }
    if (saved && THEME_META[saved]) {
      applyTheme(saved);
    } else {
      // No explicit choice saved yet - follow the OS/browser preference,
      // and just reflect that in the UI without persisting it, so it can
      // keep following system changes until the viewer picks explicitly.
      updateThemeUI(getEffectiveThemeKey());
    }
  })();

  // ---- Top-toolbar custom dropdowns (generic open/close machinery) -------
  // Shared by the difficulty dropdown and the theme dropdown: only one can
  // be open at a time, both close on an outside click, on Escape, or after
  // an option is picked.
  var openToolbarDropdowns = [];
  function closeAllToolbarDropdowns() {
    openToolbarDropdowns.forEach(function (d) { d.close(); });
  }
  function setupToolbarDropdown(rootId, btnId, menuId, onSelect) {
    var root = document.getElementById(rootId);
    var btn = document.getElementById(btnId);
    var menu = document.getElementById(menuId);
    if (!root || !btn || !menu) return null;

    // The toolbar row (.top-bar-actions) needs `overflow-x: auto` so it can
    // scroll sideways on narrow phones - but per the CSS overflow spec, an
    // element that clips one axis also clips the other, so the menu was
    // being silently cut off the moment it tried to open below the button.
    // Moving the menu out and positioning it with `fixed` (computed fresh
    // from the button's on-screen position every time it opens) sidesteps
    // that clipping entirely.
    //
    // IMPORTANT: it must be moved to inside .app-shell, NOT document.body.
    // The Fullscreen API only renders descendants of the element that's
    // actually fullscreened (.app-shell here) - anything living outside
    // that subtree, like a menu parked directly on <body>, is invisible
    // while fullscreen is active even though `position: fixed` still
    // "works" in the sense of computing a screen position. That's why
    // both dropdowns previously broke only in Full Screen mode.
    (document.querySelector(".app-shell") || document.body).appendChild(menu);

    function positionMenu() {
      var rect = btn.getBoundingClientRect();
      var menuWidth = Math.max(menu.offsetWidth, 176);
      var left = rect.right - menuWidth;
      if (left < 8) left = 8;
      var top = rect.bottom + 6;
      menu.style.left = left + "px";
      menu.style.top = top + "px";
      var maxTop = window.innerHeight - 12;
      if (top > maxTop) menu.style.top = maxTop + "px";
    }
    function close() {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
    function open() {
      closeAllToolbarDropdowns();
      menu.hidden = false;
      positionMenu();
      btn.setAttribute("aria-expanded", "true");
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menu.hidden) open(); else close();
    });
    menu.addEventListener("click", function (e) { e.stopPropagation(); });
    menu.querySelectorAll('li[role="option"]').forEach(function (li) {
      li.addEventListener("click", function () {
        close();
        onSelect(li.getAttribute("data-value"));
      });
    });
    window.addEventListener("resize", function () {
      if (!menu.hidden) positionMenu();
    });
    var entry = { close: close, root: root, menu: menu };
    openToolbarDropdowns.push(entry);
    return entry;
  }
  document.addEventListener("click", function (e) {
    openToolbarDropdowns.forEach(function (d) {
      if (!d.root.contains(e.target) && !d.menu.contains(e.target)) d.close();
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAllToolbarDropdowns();
  });

  setupToolbarDropdown("themeDropdown", "themeDropdownBtn", "themeDropdownMenu", selectTheme);

  // ---- Host console collapse/expand ----------------------------------
  // Lets the host hide the bottom console (input + Send) to reclaim
  // screen space once they're done using it manually. Remembered on
  // this device between visits.
  var HOST_CONSOLE_STORAGE_KEY = "sudokuLiveHostConsoleCollapsed";
  var hostConsoleBar = document.getElementById("hostConsoleBar");
  var hostConsoleRow = document.getElementById("hostConsoleRow");
  var hostConsoleToggle = document.getElementById("hostConsoleToggle");
  var hostConsoleShowBtn = document.getElementById("hostConsoleShowBtn");

  function updateHostConsoleOffset() {
    if (!hostConsoleBar) return;
    // offsetHeight is naturally 0 once the bar is display:none (collapsed),
    // so the board reclaims that space automatically.
    document.documentElement.style.setProperty("--host-console-offset", hostConsoleBar.offsetHeight + "px");
  }
  function setHostConsoleCollapsed(collapsed) {
    hostConsoleBar.classList.toggle("collapsed", collapsed);
    hostConsoleRow.hidden = collapsed;
    if (hostConsoleShowBtn) hostConsoleShowBtn.hidden = !collapsed;
    try { localStorage.setItem(HOST_CONSOLE_STORAGE_KEY, collapsed ? "1" : "0"); } catch (e) { /* ignore */ }
    updateHostConsoleOffset();
  }
  hostConsoleToggle.addEventListener("click", function () {
    setHostConsoleCollapsed(true);
  });
  if (hostConsoleShowBtn) {
    hostConsoleShowBtn.addEventListener("click", function () {
      setHostConsoleCollapsed(false);
    });
  }
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
  var roundPointsMiniEl = document.getElementById("roundPointsMini");
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
  // FIX: this used to default to collapsed on every single page load, with
  // nothing anywhere ever opening it automatically and no memory of the
  // host's choice. The round and all-time leaderboards live inside this
  // panel - they were being scored correctly by the server the whole time,
  // but a host who never happened to click this toggle open would never
  // see either leaderboard update and would reasonably report "points
  // aren't being counted." It's now open by default (both on first visit
  // AND every visit after, in both normal and Full Screen view, since
  // Full Screen is the same DOM, not a separate page), and if a host does
  // choose to collapse it, that choice is remembered on this device instead
  // of silently reverting to collapsed on the next reload.
  var DETAILS_OPEN_STORAGE_KEY = "sudokuLiveDetailsOpen";
  var detailsToggle = document.getElementById("detailsToggle");
  var detailsPanel = document.getElementById("detailsPanel");
  var detailsOpen = true;
  function setDetailsOpen(open) {
    detailsOpen = open;
    detailsPanel.hidden = !open;
    detailsPanel.style.display = open ? "flex" : "none";
    detailsToggle.innerHTML = open
      ? "&#9650; Hide Leaderboard &amp; Activity"
      : "&#9660; Leaderboard &amp; Activity";
    try { localStorage.setItem(DETAILS_OPEN_STORAGE_KEY, open ? "1" : "0"); } catch (e) { /* ignore */ }
  }
  detailsToggle.addEventListener("click", function () {
    setDetailsOpen(!detailsOpen);
  });
  (function initDetailsPanel() {
    var saved = null;
    try { saved = localStorage.getItem(DETAILS_OPEN_STORAGE_KEY); } catch (e) { /* ignore */ }
    // Only a previously-saved explicit "closed" ("0") keeps it collapsed;
    // anything else (nothing saved yet, or a saved "1") opens it. This is
    // the reverse default of the old behavior on purpose.
    setDetailsOpen(saved !== "0");
  })();

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

  // Sums every player's points from the round leaderboard and reflects it
  // in the always-visible top-of-board badge (see roundPointsMiniEl) - a
  // second, impossible-to-collapse confirmation that guesses are being
  // scored, independent of the Leaderboard & Activity panel's open/closed
  // state and identical in normal and Full Screen view.
  function updateRoundPointsMini(list) {
    if (!roundPointsMiniEl) return;
    var total = (list || []).reduce(function (sum, entry) { return sum + (entry.points || 0); }, 0);
    roundPointsMiniEl.innerHTML = "&#127942; " + total + " pt" + (total === 1 ? "" : "s") + " this round";
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
    updateRoundPointsMini(state.leaderboard);
    lastLeaderboardData.round = state.leaderboard || [];
    lastLeaderboardData.allTime = state.allTimeLeaderboard || [];
    if (leaderboardOverlayEl && !leaderboardOverlayEl.hidden) renderLeaderboardModalLists();
    rawEventCountEl.textContent = String(state.rawEventCount);
    if (state.lastReceived) {
      lastReceivedEl.textContent = formatLastReceived(state.lastReceived);
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
    applyHostDefaultsOnce(state);
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

  // Shows exactly what the server's parser did with the most recent comment
  // (parsed to a coordinate, or not recognized) right on screen, so a
  // "wrong format" report can be diagnosed by looking at the page instead
  // of digging through server logs.
  function formatLastReceived(lr) {
    // Assigned via .textContent below, never .innerHTML, so no HTML-escaping
    // is needed here - the browser treats it as plain text either way.
    var base = (lr.nickname || lr.uniqueId || "viewer") + ": " + String(lr.text == null ? "" : lr.text);
    if (lr.parsedCoord) {
      return base + "  →  read as " + lr.parsedCoord + " = " + lr.parsedNum;
    }
    return base + "  →  NOT recognized as a coordinate";
  }

  socket.on("diagnostics", function (diag) {
    rawEventCountEl.textContent = String(diag.rawEventCount);
    if (diag.lastReceived) {
      lastReceivedEl.textContent = formatLastReceived(diag.lastReceived);
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
  var DIFFICULTY_META = {
    "very-easy":      { level: 1, label: "Very Easy" },
    "easy":           { level: 2, label: "Easy" },
    "moderate":       { level: 3, label: "Moderate" },
    "hard":           { level: 4, label: "Hard" },
    "very-hard":      { level: 5, label: "Very Hard" },
    "extreme":        { level: 6, label: "Extreme" },
    "extremely-hard": { level: 7, label: "Extremely Hard" }
  };
  var difficultySelectEl = document.getElementById("difficultySelect");
  var difficultyDropdownIcon = document.getElementById("difficultyDropdownIcon");
  var difficultyDropdownBtn = document.getElementById("difficultyDropdownBtn");
  var difficultyDropdownMenu = document.getElementById("difficultyDropdownMenu");
  var currentDifficulty = "moderate";

  function syncDifficultySelects(value) {
    if (!value || !DIFFICULTY_META[value]) return;
    currentDifficulty = value;
    if (difficultySelectEl && difficultySelectEl.value !== value) difficultySelectEl.value = value;
    var meta = DIFFICULTY_META[value];
    if (difficultyDropdownIcon) {
      difficultyDropdownIcon.className = "diff-badge level-" + meta.level;
      difficultyDropdownIcon.textContent = meta.level;
    }
    if (difficultyDropdownBtn) {
      difficultyDropdownBtn.title = "Difficulty: " + meta.label;
      difficultyDropdownBtn.setAttribute("aria-label", "Difficulty: " + meta.label);
    }
    if (difficultyDropdownMenu) {
      difficultyDropdownMenu.querySelectorAll("li").forEach(function (li) {
        var active = li.getAttribute("data-value") === value;
        li.classList.toggle("dd-active", active);
        li.setAttribute("aria-selected", active ? "true" : "false");
      });
    }
  }
  if (difficultySelectEl) {
    difficultySelectEl.addEventListener("change", function () {
      syncDifficultySelects(difficultySelectEl.value);
    });
  }
  setupToolbarDropdown("difficultyDropdown", "difficultyDropdownBtn", "difficultyDropdownMenu", syncDifficultySelects);

  // ---- New puzzle controls (settings drawer button + top toolbar button) --
  function triggerNewPuzzle() {
    socket.emit("host:newPuzzle", { difficulty: currentDifficulty });
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

  // ---- Save & Apply Settings button ----------------------------------------
  // Every individual field in this drawer already saves itself as soon as
  // it changes (theme, timing, difficulty, toggles) - this button is the
  // explicit "I'm done, commit everything now" action the host can tap for
  // confidence. It flushes any field that's still focused (so its change
  // event fires even if the host clicks straight from typing), re-persists
  // everything currently in memory, and shows a short confirmation.
  var saveSettingsBtnEl = document.getElementById("saveSettingsBtn");
  var saveSettingsConfirmEl = document.getElementById("saveSettingsConfirm");
  var saveSettingsConfirmTimer = null;
  function showSaveConfirm(message) {
    if (!saveSettingsConfirmEl) return;
    saveSettingsConfirmEl.textContent = message;
    saveSettingsConfirmEl.hidden = false;
    if (saveSettingsConfirmTimer) clearTimeout(saveSettingsConfirmTimer);
    saveSettingsConfirmTimer = setTimeout(function () {
      saveSettingsConfirmEl.hidden = true;
    }, 2500);
  }
  function flushFocusedField() {
    if (document.activeElement && document.activeElement !== document.body && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
  }
  if (saveSettingsBtnEl) {
    saveSettingsBtnEl.addEventListener("click", function () {
      flushFocusedField();
      saveTimingPrefs(timingPrefs);
      try { localStorage.setItem(THEME_STORAGE_KEY, getEffectiveThemeKey()); } catch (e) { /* ignore */ }
      try { localStorage.setItem(HOST_CONSOLE_STORAGE_KEY, hostConsoleBar.classList.contains("collapsed") ? "1" : "0"); } catch (e) { /* ignore */ }
      showSaveConfirm("\u2713 Settings saved & applied");
    });
  }

  // ---- Save & Apply as Default ---------------------------------------------
  // Bundles the host-level preferences - theme, mode, difficulty, Auto Next
  // Round (and its delay), Bot Auto-Solve, and TikTok username - into one
  // snapshot saved on this device. Every time this page loads, that snapshot
  // is re-applied automatically, so the host never has to reconfigure the
  // dashboard by hand again - even after the server process itself restarts
  // and loses its in-memory game state (e.g. a Render free-tier spin-down
  // between streams), since the snapshot lives in the browser, not the
  // server. Applying a saved difficulty that differs from whatever puzzle
  // is currently loaded does start a fresh puzzle at that difficulty - this
  // is called out in the on-screen hint next to the button.
  var DEFAULTS_STORAGE_KEY = "sudokuLiveHostDefaultsV1";
  var hostDefaultsApplied = false;

  function saveHostDefaults() {
    var defaults = {
      theme: getEffectiveThemeKey(),
      mode: currentMode,
      difficulty: currentDifficulty,
      autoNextRound: !!autoNextToggleEl.checked,
      autoNextDelaySeconds: autoNextDelayInputEl ? parseFloat(autoNextDelayInputEl.value) : undefined,
      botAutoSolveEnabled: botAutoSolveToggleEl ? !!botAutoSolveToggleEl.checked : false
    };
    var usernameInput = document.getElementById("tiktokUsername");
    if (usernameInput && usernameInput.value.trim()) {
      defaults.tiktokUsername = usernameInput.value.trim();
    }
    try { localStorage.setItem(DEFAULTS_STORAGE_KEY, JSON.stringify(defaults)); } catch (e) { /* storage unavailable - ignore */ }
    return defaults;
  }

  function loadHostDefaults() {
    try {
      var raw = localStorage.getItem(DEFAULTS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // Runs once, the first time a "state" broadcast arrives after this page
  // loads - applying any saved default that differs from what the server
  // currently has, so a freshly (re)started server picks the host's chosen
  // setup right back up.
  function applyHostDefaultsOnce(state) {
    if (hostDefaultsApplied) return;
    hostDefaultsApplied = true;
    var defaults = loadHostDefaults();
    if (!defaults) return;

    if (defaults.mode && defaults.mode !== state.mode) {
      showMode(defaults.mode);
      socket.emit("host:setMode", { mode: defaults.mode });
    }
    if (typeof defaults.autoNextRound === "boolean" && defaults.autoNextRound !== !!state.autoNextRound) {
      autoNextToggleEl.checked = defaults.autoNextRound;
      socket.emit("host:setAutoNext", { enabled: defaults.autoNextRound });
      if (!defaults.autoNextRound) clearAutoNextCountdown();
    }
    if (typeof defaults.autoNextDelaySeconds === "number" && !isNaN(defaults.autoNextDelaySeconds) &&
        defaults.autoNextDelaySeconds !== state.autoNextDelaySeconds) {
      if (autoNextDelayInputEl) autoNextDelayInputEl.value = defaults.autoNextDelaySeconds;
      socket.emit("host:setAutoNextDelay", { seconds: defaults.autoNextDelaySeconds });
    }
    if (botAutoSolveToggleEl && typeof defaults.botAutoSolveEnabled === "boolean" &&
        defaults.botAutoSolveEnabled !== !!state.botAutoSolveEnabled) {
      botAutoSolveToggleEl.checked = defaults.botAutoSolveEnabled;
      socket.emit("host:setBotAutoSolve", { enabled: defaults.botAutoSolveEnabled });
    }
    if (defaults.difficulty && DIFFICULTY_META[defaults.difficulty]) {
      if (defaults.difficulty !== state.lastDifficulty) {
        syncDifficultySelects(defaults.difficulty);
        socket.emit("host:newPuzzle", { difficulty: defaults.difficulty });
      } else {
        syncDifficultySelects(defaults.difficulty);
      }
    }
    if (defaults.tiktokUsername) {
      var usernameInput = document.getElementById("tiktokUsername");
      if (usernameInput && !usernameInput.value) usernameInput.value = defaults.tiktokUsername;
    }
  }

  var saveDefaultSettingsBtnEl = document.getElementById("saveDefaultSettingsBtn");
  if (saveDefaultSettingsBtnEl) {
    saveDefaultSettingsBtnEl.addEventListener("click", function () {
      flushFocusedField();
      saveTimingPrefs(timingPrefs);
      try { localStorage.setItem(THEME_STORAGE_KEY, getEffectiveThemeKey()); } catch (e) { /* ignore */ }
      try { localStorage.setItem(HOST_CONSOLE_STORAGE_KEY, hostConsoleBar.classList.contains("collapsed") ? "1" : "0"); } catch (e) { /* ignore */ }
      saveHostDefaults();
      showSaveConfirm("\u2713 Saved as default - will auto-load every time");
    });
  }

  var clearDefaultSettingsBtnEl = document.getElementById("clearDefaultSettingsBtn");
  if (clearDefaultSettingsBtnEl) {
    clearDefaultSettingsBtnEl.addEventListener("click", function () {
      try { localStorage.removeItem(DEFAULTS_STORAGE_KEY); } catch (e) { /* ignore */ }
      showSaveConfirm("Saved default cleared");
    });
  }

})();
