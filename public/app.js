/* global io */
(function () {
  "use strict";

  const socket = io();

  // ---- element refs ----
  const $ = (id) => document.getElementById(id);
  const loginView = $("login");
  const gameView = $("game");
  const loginForm = $("login-form");
  const usernameInput = $("username");
  const loginNote = $("login-note");
  const goLiveBtn = $("go-live");
  const tryDemoBtn = $("try-demo");

  const board = $("board");
  const statusPill = $("status-pill");
  const statusText = $("status-text");
  const hostName = $("host-name");
  const statRemaining = $("stat-remaining");
  const statPlayers = $("stat-players");
  const progressFill = $("progress-fill");
  const lbList = $("lb-list");
  const lbDiff = $("lb-diff");
  const toastLayer = $("toast-layer");

  const winView = $("win");
  const winWinner = $("win-winner");
  const winTime = $("win-time");
  const winLb = $("win-lb");
  const winNext = $("win-next");

  const sheet = $("sheet");
  const openSettings = $("open-settings");
  const sheetClose = $("sheet-close");
  const sheetDiff = $("sheet-diff");
  const demoControls = $("demo-controls");
  const demoSpeed = $("demo-speed");
  const btnNew = $("btn-new");
  const btnResetScores = $("btn-reset-scores");
  const btnEnd = $("btn-end");

  const DIFF_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" };

  let difficulty = "medium";
  let isDemo = false;
  let hasKey = true;
  let cells = []; // 81 cell elements
  let currentGiven = new Array(81).fill(false);

  // ---- difficulty segmented controls ----
  function wireSeg(container, onPick) {
    container.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".seg-btn").forEach((b) => {
          b.classList.remove("is-active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("is-active");
        btn.setAttribute("aria-checked", "true");
        onPick(btn.dataset.diff);
      });
    });
  }
  wireSeg($("difficulty"), (d) => (difficulty = d));

  // ---- board build ----
  function buildBoard() {
    board.innerHTML = "";
    cells = [];

    // top-left corner
    board.appendChild(document.createElement("div")).className = "axis";
    // column headers 1..9
    for (let c = 1; c <= 9; c++) {
      const a = document.createElement("div");
      a.className = "axis";
      a.textContent = c;
      board.appendChild(a);
    }
    // rows
    for (let r = 0; r < 9; r++) {
      const rowLabel = document.createElement("div");
      rowLabel.className = "axis";
      rowLabel.textContent = r + 1;
      board.appendChild(rowLabel);
      for (let c = 0; c < 9; c++) {
        const idx = r * 9 + c;
        const cell = document.createElement("div");
        cell.className = "cell";
        if (c === 2 || c === 5) cell.classList.add("br");
        if (r === 2 || r === 5) cell.classList.add("bb");
        cells[idx] = cell;
        board.appendChild(cell);
      }
    }
  }

  function renderBoard(state) {
    currentGiven = state.given;
    for (let i = 0; i < 81; i++) {
      const cell = cells[i];
      const v = state.filled[i];
      cell.classList.remove("given", "filled", "pop", "flash");
      if (v === 0) {
        cell.textContent = "";
      } else {
        cell.textContent = v;
        cell.classList.add(state.given[i] ? "given" : "filled");
      }
    }
  }

  function renderLeaderboard(list) {
    if (!list || list.length === 0) {
      lbList.innerHTML =
        '<li class="lb-empty">No solves yet — first correct answer takes the lead.</li>';
      return;
    }
    lbList.innerHTML = "";
    list.forEach((p, i) => {
      lbList.appendChild(lbRow(p, i));
    });
  }

  function lbRow(p, i) {
    const li = document.createElement("li");
    li.className = "lb-item" + (i < 3 ? " top" + (i + 1) : "");
    const initial = (p.name || "?").charAt(0).toUpperCase();
    const av = p.avatar
      ? `<img class="lb-av" src="${p.avatar}" alt="" referrerpolicy="no-referrer" />`
      : `<span class="lb-av">${initial}</span>`;
    li.innerHTML =
      `<span class="lb-rank">${i + 1}</span>` +
      av +
      `<span class="lb-name">${escapeHtml(p.name)}` +
      `<br><span class="lb-solves">${p.solves} solved</span></span>` +
      `<span class="lb-pts">${p.points}</span>`;
    return li;
  }

  function renderStats(stats) {
    statRemaining.textContent = stats.remaining;
    statPlayers.textContent = stats.players;
    const pct = (stats.filled / stats.total) * 100;
    progressFill.style.width = pct + "%";
    lbDiff.textContent = DIFF_LABEL[stats.difficulty] || stats.difficulty;
  }

  // ---- toasts ----
  function toast(html, wrong) {
    const el = document.createElement("div");
    el.className = "toast" + (wrong ? " wrong" : "");
    el.innerHTML = html;
    toastLayer.appendChild(el);
    setTimeout(() => el.remove(), 3200);
    // keep at most 3 on screen
    while (toastLayer.children.length > 3) toastLayer.firstChild.remove();
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[m]);
  }

  // ---- status pill ----
  function setStatus(status, username, message) {
    statusPill.classList.remove("is-live", "is-warn");
    if (username) hostName.textContent = "@" + username;
    let text = message || "";
    switch (status) {
      case "connecting":
        text = "Connecting…";
        break;
      case "connected":
        statusPill.classList.add("is-live");
        text = "LIVE";
        break;
      case "demo":
        statusPill.classList.add("is-warn");
        text = "DEMO";
        break;
      case "disconnected":
        statusPill.classList.add("is-warn");
        text = "Reconnecting…";
        break;
      case "ended":
        statusPill.classList.add("is-warn");
        text = "Stream ended";
        break;
      case "error":
        statusPill.classList.add("is-warn");
        text = "Offline";
        break;
    }
    statusText.textContent = text;
    if (status === "error" && message) toast(escapeHtml(message), true);
  }

  // ---- socket events ----
  socket.on("server:info", (info) => {
    hasKey = info.hasKey;
    if (!hasKey) {
      loginNote.hidden = false;
      loginNote.classList.add("info");
      loginNote.innerHTML =
        "No EulerStream key on the server yet, so real TikTok chat is disabled. " +
        "You can still run <b>Demo mode</b>. Add EULERSTREAM_API_KEY on Render to go fully live.";
    }
  });

  socket.on("game:state", (state) => {
    difficulty = state.difficulty;
    renderBoard(state);
    renderStats(state.stats);
    renderLeaderboard(state.leaderboard);
    winView.hidden = true;
    syncSheetDiff();
  });

  socket.on("cell:filled", (d) => {
    const cell = cells[d.index];
    if (cell) {
      cell.textContent = d.value;
      cell.classList.add("filled");
      cell.classList.remove("pop", "flash");
      void cell.offsetWidth; // restart animation
      cell.classList.add("pop", "flash");
    }
    toast(
      `<span class="tname">@${escapeHtml(d.solver.name)}</span>&nbsp;` +
        `R${d.row}C${d.col} = ${d.value}&nbsp;<span class="tpts">+${d.points}</span>`
    );
  });

  socket.on("guess:wrong", (d) => {
    toast(
      `<span class="tname">@${escapeHtml(d.name)}</span>&nbsp;tried R${d.row}C${d.col} = ${d.val}`,
      true
    );
  });

  socket.on("leaderboard", renderLeaderboard);
  socket.on("stats", renderStats);

  socket.on("tiktok:status", (d) => setStatus(d.status, d.username, d.message));

  socket.on("game:solved", (d) => {
    if (d.winner) {
      winWinner.innerHTML =
        `<span class="crown">👑</span> @${escapeHtml(d.winner.name)} — ${d.winner.points} pts`;
    } else {
      winWinner.textContent = "Great game!";
    }
    const mins = Math.floor(d.seconds / 60);
    const secs = d.seconds % 60;
    winTime.textContent = `Completed in ${mins}m ${secs}s`;
    winLb.innerHTML = "";
    (d.leaderboard || []).slice(0, 5).forEach((p, i) => winLb.appendChild(lbRow(p, i)));
    winView.hidden = false;
  });

  socket.on("connect_error", () => setStatus("error", null, "Connection lost"));

  // ---- start flow ----
  function startSession(demo) {
    const username = usernameInput.value.trim().replace(/^@+/, "");
    if (!demo && !username) {
      loginNote.hidden = false;
      loginNote.classList.remove("info");
      loginNote.textContent = "Enter your TikTok username to go live.";
      usernameInput.focus();
      return;
    }
    isDemo = !!demo;
    loginView.hidden = true;
    gameView.hidden = false;
    demoControls.hidden = !demo;
    hostName.textContent = "@" + (username || "demo");
    socket.emit("host:start", { username, difficulty, demo: !!demo });
  }

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    startSession(false);
  });
  tryDemoBtn.addEventListener("click", () => startSession(true));

  usernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.nativeEvent?.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      startSession(false);
    }
  });

  // ---- settings sheet ----
  function openSheet() {
    syncSheetDiff();
    demoControls.hidden = !isDemo;
    sheet.hidden = false;
  }
  function closeSheet() {
    sheet.hidden = true;
  }
  function syncSheetDiff() {
    sheetDiff.querySelectorAll(".seg-btn").forEach((b) => {
      const active = b.dataset.diff === difficulty;
      b.classList.toggle("is-active", active);
    });
  }
  openSettings.addEventListener("click", openSheet);
  sheetClose.addEventListener("click", closeSheet);
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) closeSheet();
  });
  wireSeg(sheetDiff, (d) => (difficulty = d));

  btnNew.addEventListener("click", () => {
    socket.emit("host:new", { difficulty });
    closeSheet();
  });
  btnResetScores.addEventListener("click", () => {
    socket.emit("host:resetScores");
  });
  btnEnd.addEventListener("click", () => {
    socket.emit("host:stop");
    closeSheet();
    gameView.hidden = true;
    loginView.hidden = false;
  });
  winNext.addEventListener("click", () => {
    socket.emit("host:new", { difficulty });
    winView.hidden = true;
  });
  demoSpeed.addEventListener("change", () => {
    socket.emit("demo:speed", { speed: Number(demoSpeed.value) });
  });

  buildBoard();
})();
