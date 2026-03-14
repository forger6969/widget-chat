/**
 * AI Chat Widget v2.0
 * ───────────────────────────────────────────────────────────────
 * Подключение (одна строка):
 *
 *   (async () => {
 *     const m = await import("https://your-domain.com/widget.js");
 *     m.default({ serverUrl: "https://your-domain.com" });
 *   })();
 *
 * Или через <script type="module">:
 *   import init from "https://your-domain.com/widget.js";
 *   init({ serverUrl: "https://your-domain.com", title: "Поддержка" });
 *
 * Или через window.AIWidgetConfig + <script src="widget.js">:
 *   window.AIWidgetConfig = { serverUrl: "...", title: "..." };
 */

function initAIWidget(userConfig = {}) {
  // ── Защита от повторной инициализации ──────────────────────────────────
  if (window.__AIWidgetInitialized) return window.AIWidget;
  window.__AIWidgetInitialized = true;

  // ── Конфигурация ───────────────────────────────────────────────────────
  const cfg = Object.assign(
    {
      serverUrl: "http://localhost:4500", // URL бэкенда
      title:     "AI Assistant",
      position:  "bottom-right",         // bottom-right | bottom-left
    },
    window.AIWidgetConfig || {},
    userConfig
  );

  // Убираем trailing slash
  cfg.serverUrl = cfg.serverUrl.replace(/\/$/, "");

  // ── CSS виджета (внутри Shadow DOM — нет конфликтов) ───────────────────
  const WIDGET_CSS = `
    :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: block; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    #fab {
      position: fixed; width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none; cursor: pointer;
      box-shadow: 0 4px 20px rgba(102,126,234,.5);
      display: flex; align-items: center; justify-content: center;
      z-index: 2147483646;
      transition: transform .2s ease, box-shadow .2s ease; outline: none;
    }
    #fab:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(102,126,234,.65); }
    #fab:active { transform: scale(.95); }
    #fab svg { width: 26px; height: 26px; fill: #fff; }
    #fab-badge {
      position: absolute; top: -3px; right: -3px; width: 18px; height: 18px;
      border-radius: 50%; background: #ff4757; color: #fff; font-size: 11px;
      font-weight: 700; display: flex; align-items: center; justify-content: center;
      opacity: 0; transform: scale(0); transition: opacity .2s, transform .2s;
    }
    #fab-badge.on { opacity: 1; transform: scale(1); }

    #popup {
      position: fixed; width: 360px; height: 520px;
      background: #fff; border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,.18), 0 4px 20px rgba(0,0,0,.12);
      display: flex; flex-direction: column; overflow: hidden;
      z-index: 2147483647; pointer-events: none;
      opacity: 0; transform: scale(.85) translateY(20px);
      transition: opacity .25s cubic-bezier(.34,1.56,.64,1), transform .25s cubic-bezier(.34,1.56,.64,1);
    }
    #popup.open { opacity: 1; transform: scale(1) translateY(0); pointer-events: all; }

    /* Header */
    #header {
      background: linear-gradient(135deg, #667eea, #764ba2);
      padding: 12px 14px; display: flex; align-items: center;
      gap: 10px; cursor: grab; user-select: none; flex-shrink: 0;
    }
    #header:active { cursor: grabbing; }
    .h-avatar { width: 34px; height: 34px; border-radius: 50%; background: rgba(255,255,255,.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .h-avatar svg { width: 18px; height: 18px; fill: #fff; }
    .h-info { flex: 1; min-width: 0; }
    .h-title { color: #fff; font-size: 14px; font-weight: 700; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .h-sub { font-size: 11px; color: rgba(255,255,255,.75); display: flex; align-items: center; gap: 4px; margin-top: 2px; flex-wrap: wrap; }
    .h-dot { width: 6px; height: 6px; border-radius: 50%; background: #2ecc71; display: inline-block; flex-shrink: 0; }
    .h-dot.thinking { background: #f39c12; animation: pulse 1s infinite; }
    .h-dot.offline { background: #bbb; }
    .h-timer { font-size: 10px; color: rgba(255,255,255,.9); font-family: monospace; background: rgba(0,0,0,.15); padding: 2px 6px; border-radius: 6px; margin-left: auto; }
    .h-timer.low { background: rgba(231,76,60,.4); animation: pulse 1s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
    .h-btn { background: rgba(255,255,255,.18); border: none; border-radius: 8px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background .15s; flex-shrink: 0; outline: none; }
    .h-btn:hover { background: rgba(255,255,255,.3); }
    .h-btn svg { width: 14px; height: 14px; fill: #fff; }

    .screen { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .screen.hidden { display: none; }

    /* ── Login / Register ── */
    #login-screen, #reg-screen {
      align-items: center; justify-content: center;
      padding: 24px 22px; gap: 14px; background: #fafbff;
    }
    .l-logo { width: 58px; height: 58px; border-radius: 18px; background: linear-gradient(135deg,#667eea,#764ba2); display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 20px rgba(102,126,234,.35); }
    .l-logo svg { width: 32px; height: 32px; fill: #fff; }
    .l-title { font-size: 18px; font-weight: 700; color: #1a1a2e; text-align: center; }
    .l-sub { font-size: 12px; color: #888; text-align: center; line-height: 1.5; }
    .f-group { width: 100%; display: flex; flex-direction: column; gap: 4px; }
    .f-label { font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: .5px; }
    .f-input { width: 100%; padding: 10px 13px; border: 1.5px solid #e0e0ee; border-radius: 12px; font-size: 13.5px; color: #1a1a2e; background: #fff; outline: none; transition: border-color .2s, box-shadow .2s; }
    .f-input:focus { border-color: #667eea; box-shadow: 0 0 0 3px rgba(102,126,234,.12); }
    .f-input::placeholder { color: #aaa; }
    .f-err { font-size: 12px; color: #e74c3c; min-height: 15px; text-align: center; }
    .btn-p { width: 100%; padding: 11px; background: linear-gradient(135deg,#667eea,#764ba2); border: none; border-radius: 12px; color: #fff; font-size: 13.5px; font-weight: 600; cursor: pointer; transition: opacity .15s, transform .15s; outline: none; }
    .btn-p:hover { opacity: .92; }
    .btn-p:active { transform: scale(.98); }
    .l-toggle { font-size: 12px; color: #888; text-align: center; }
    .l-toggle a { color: #667eea; cursor: pointer; font-weight: 600; }

    /* ── Chat screen ── */
    #chat-screen { background: #f7f8fc; }
    .user-bar { padding: 7px 13px; background: #fff; border-bottom: 1px solid #ebebf5; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .user-bar-name { font-size: 12px; color: #888; font-weight: 500; }
    .user-bar-name span { color: #667eea; font-weight: 700; }
    .btn-out { font-size: 11px; color: #aaa; background: none; border: none; cursor: pointer; padding: 2px 7px; border-radius: 6px; transition: background .15s, color .15s; outline: none; }
    .btn-out:hover { background: #fee; color: #e74c3c; }

    /* Expired banner */
    #expired-bar { display: none; padding: 8px 14px; background: #fff3cd; border-bottom: 1px solid #ffc107; font-size: 12px; color: #856404; text-align: center; flex-shrink: 0; }
    #expired-bar.on { display: block; }

    /* Screen share bar */
    #share-bar { display: none; padding: 7px 13px; background: #fff; border-bottom: 1px solid #ebebf5; align-items: center; justify-content: space-between; flex-shrink: 0; gap: 8px; }
    #share-bar.on { display: flex; }
    .share-bar-left { display: flex; align-items: center; gap: 7px; font-size: 12px; color: #555; }
    .share-live-dot { width: 7px; height: 7px; border-radius: 50%; background: #ff4757; animation: pulse 1s infinite; flex-shrink: 0; }
    .btn-share-toggle { font-size: 11px; padding: 4px 10px; border-radius: 7px; border: none; cursor: pointer; font-weight: 600; transition: background .15s; }
    .btn-share-start { background: linear-gradient(135deg,#667eea,#764ba2); color: #fff; }
    .btn-share-stop { background: #fce4ec; color: #c62828; }

    /* Waiting banner (chat mode) */
    #waiting-bar { display: none; padding: 8px 14px; background: #e3f2fd; border-bottom: 1px solid #90caf9; font-size: 12px; color: #1565c0; text-align: center; flex-shrink: 0; }
    #waiting-bar.on { display: block; }

    #messages { flex: 1; overflow-y: auto; padding: 14px 12px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; }
    #messages::-webkit-scrollbar { width: 4px; }
    #messages::-webkit-scrollbar-thumb { background: #ddd; border-radius: 4px; }
    #empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; opacity: .45; }
    #empty-state svg { width: 38px; height: 38px; fill: #667eea; }
    #empty-state p { font-size: 13px; color: #888; text-align: center; }

    .msg { display: flex; gap: 8px; align-items: flex-start; width: 100%; }
    .msg.anim { animation: msgIn .22s cubic-bezier(.34,1.56,.64,1); }
    @keyframes msgIn { from { opacity: 0; transform: translateY(8px) scale(.96); } to { opacity: 1; transform: none; } }
    .msg.user { flex-direction: row-reverse; }
    .msg-av { width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; margin-top: 2px; }
    .msg.user .msg-av { background: linear-gradient(135deg,#667eea,#764ba2); color: #fff; }
    .msg.ai .msg-av, .msg.admin .msg-av { background: linear-gradient(135deg,#43e97b,#38f9d7); color: #fff; }
    .msg-av svg { width: 13px; height: 13px; fill: #fff; }
    .msg-content { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
    .msg.user .msg-content { align-items: flex-end; }
    .msg-bub { max-width: 260px; padding: 9px 12px; border-radius: 17px; font-size: 13px; line-height: 1.55; word-break: break-word; white-space: pre-wrap; }
    .msg.user .msg-bub { background: linear-gradient(135deg,#667eea,#764ba2); color: #fff; border-bottom-right-radius: 5px; }
    .msg.ai .msg-bub, .msg.admin .msg-bub { background: #fff; color: #1a1a2e; border-bottom-left-radius: 5px; box-shadow: 0 2px 8px rgba(0,0,0,.07); }
    .msg.error .msg-bub { background: #fff0f0; color: #e74c3c; border: 1px solid #ffd0d0; }
    .msg-label { font-size: 10px; color: #aaa; padding: 0 4px; }
    .msg.admin .msg-label { color: #667eea; font-weight: 600; }

    .typing { display: flex; gap: 4px; align-items: center; padding: 11px 13px; }
    .t-dot { width: 6px; height: 6px; border-radius: 50%; background: #bbb; animation: typing 1.2s infinite ease-in-out; }
    .t-dot:nth-child(2) { animation-delay: .2s; }
    .t-dot:nth-child(3) { animation-delay: .4s; }
    @keyframes typing { 0%,80%,100% { transform: scale(1); opacity: .5; } 40% { transform: scale(1.3); opacity: 1; } }

    #input-area { padding: 10px 12px; background: #fff; border-top: 1px solid #ebebf5; display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0; }
    #msg-input { flex: 1; padding: 9px 12px; border: 1.5px solid #e0e0ee; border-radius: 13px; font-size: 13px; font-family: inherit; color: #1a1a2e; background: #f7f8fc; outline: none; resize: none; max-height: 110px; min-height: 38px; line-height: 1.45; transition: border-color .2s, box-shadow .2s; overflow-y: auto; }
    #msg-input:focus { border-color: #667eea; background: #fff; box-shadow: 0 0 0 3px rgba(102,126,234,.1); }
    #msg-input::placeholder { color: #aaa; }
    #send-btn { width: 38px; height: 38px; border-radius: 11px; background: linear-gradient(135deg,#667eea,#764ba2); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: opacity .15s, transform .15s; outline: none; }
    #send-btn:hover { opacity: .9; }
    #send-btn:active { transform: scale(.9); }
    #send-btn:disabled { opacity: .35; cursor: not-allowed; }
    #send-btn svg { width: 17px; height: 17px; fill: #fff; }

    /* ── Resize handle ── */
    #resize-handle {
      position: absolute; bottom: 0; right: 0;
      width: 22px; height: 22px;
      cursor: nwse-resize;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; transition: opacity .2s; z-index: 10;
      border-radius: 0 0 18px 0;
    }
    #popup:hover #resize-handle { opacity: 0.35; }
    #resize-handle:hover { opacity: 1 !important; }
    #resize-handle svg { width: 12px; height: 12px; fill: #999; pointer-events: none; }

    @media (max-width: 480px) {
      #popup { width: calc(100vw - 16px) !important; height: 72vh !important; border-radius: 18px 18px 0 0 !important; }
    }
  `;

  // ── SVG-иконки ─────────────────────────────────────────────────────────
  const I = {
    chat: `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    minus: `<svg viewBox="0 0 24 24"><path d="M19 13H5v-2h14v2z"/></svg>`,
    send:  `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
    bot:   `<svg viewBox="0 0 24 24"><path d="M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zm-2 10H6V7h12v12zm-9-6c-.83 0-1.5-.67-1.5-1.5S8.17 10 9 10s1.5.67 1.5 1.5S9.83 13 9 13zm6 0c-.83 0-1.5-.67-1.5-1.5S14.17 10 15 10s1.5.67 1.5 1.5S15.83 13 15 13z"/></svg>`,
    user:  `<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
    empty: `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`,
  };

  // ── Создание Shadow DOM ─────────────────────────────────────────────────
  const host = document.createElement("div");
  host.id = "ai-widget-host";
  host.style.cssText = "position:fixed;z-index:2147483640;top:0;left:0;width:0;height:0;";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = WIDGET_CSS;
  shadow.appendChild(style);

  // ── FAB ────────────────────────────────────────────────────────────────
  const isLeft = cfg.position === "bottom-left";
  const fab = document.createElement("button");
  fab.id = "fab";
  fab.innerHTML = I.chat + `<span id="fab-badge"></span>`;
  fab.style.cssText = isLeft ? "bottom:24px;left:24px;" : "bottom:24px;right:24px;";
  shadow.appendChild(fab);

  // ── Popup ──────────────────────────────────────────────────────────────
  const popup = document.createElement("div");
  popup.id = "popup";
  popup.style.cssText = isLeft ? `bottom:90px;left:24px;` : `bottom:90px;right:24px;`;
  popup.innerHTML = `
    <div id="header">
      <div class="h-avatar">${I.bot}</div>
      <div class="h-info">
        <div class="h-title">${cfg.title}</div>
        <div class="h-sub"><span class="h-dot" id="status-dot"></span><span id="status-text">Онлайн</span></div>
      </div>
      <span class="h-timer" id="h-timer" style="display:none"></span>
      <button class="h-btn" id="min-btn" title="Свернуть">${I.minus}</button>
      <button class="h-btn" id="close-btn" title="Закрыть">${I.close}</button>
    </div>

    <!-- Login -->
    <div id="login-screen" class="screen">
      <div class="l-logo">${I.bot}</div>
      <div class="l-title">Добро пожаловать!</div>
      <div class="l-sub">Войдите, чтобы начать</div>
      <div class="f-group"><label class="f-label">Имя пользователя</label><input class="f-input" id="l-user" type="text" placeholder="username" autocomplete="username"/></div>
      <div class="f-group"><label class="f-label">Пароль</label><input class="f-input" id="l-pass" type="password" placeholder="••••••••" autocomplete="current-password"/></div>
      <div class="f-err" id="l-err"></div>
      <button class="btn-p" id="l-btn">Войти</button>
    </div>

    <!-- Chat -->
    <div id="chat-screen" class="screen hidden">
      <div class="user-bar">
        <span class="user-bar-name">Вы: <span id="uname">—</span></span>
        <button class="btn-out" id="logout-btn">Выйти</button>
      </div>
      <div id="expired-bar">⏰ Время доступа истекло. История сохранена — запись недоступна.</div>
      <div id="waiting-bar">⏳ Ожидайте — оператор подключится к вашему чату...</div>
      <div id="share-bar">
        <div class="share-bar-left"><span class="share-live-dot" id="share-dot" style="display:none"></span><span id="share-label">Поделиться экраном с оператором</span></div>
        <button class="btn-share-toggle btn-share-start" id="share-btn">📱 Показать</button>
      </div>
      <div id="messages">
        <div id="empty-state">${I.empty}<p>Начните общение!</p></div>
      </div>
      <div id="input-area">
        <textarea id="msg-input" placeholder="Напишите сообщение…" rows="1"></textarea>
        <button id="send-btn">${I.send}</button>
      </div>
    </div>
    <div id="resize-handle" title="Перетяни влево/вправо для изменения размера">
      <svg viewBox="0 0 12 12"><path d="M10 2L2 10M6 2L2 6M10 6L6 10" stroke="#999" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>
    </div>
  `;
  shadow.appendChild(popup);

  // ── Ссылки ─────────────────────────────────────────────────────────────
  const $ = (id) => shadow.getElementById(id);
  const fabEl      = fab;
  const fabBadge   = $("fab-badge");
  const statusDot  = $("status-dot");
  const statusText = $("status-text");
  const hTimer     = $("h-timer");

  // ── Состояние ──────────────────────────────────────────────────────────
  let st = {
    isOpen:    false,
    token:     localStorage.getItem("aw_token"),
    user:      null,           // { id, username, accessType, remainingSeconds }
    messages:  [],
    unread:    0,
    isExpired: false,
    isThinking: false,
    ws:        null,
    wsReconnecting: false,
    timerInterval: null,
    remaining: 0,              // секунды
  };

  // ── Утилиты ────────────────────────────────────────────────────────────
  function fmtRemaining(sec) {
    if (!sec || sec === Infinity) return "";
    if (sec <= 0) return "Истекло";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}ч ${m}м`;
    if (m > 0) return `${m}м ${s}с`;
    return `${s}с`;
  }

  function esc(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  async function apiFetch(method, path, body) {
    const opts = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(st.token ? { Authorization: `Bearer ${st.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    };
    const r = await fetch(cfg.serverUrl + path, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { code: data.error });
    return data;
  }

  // ── Open / Close ────────────────────────────────────────────────────────
  function openWidget() {
    st.isOpen = true;
    st.unread = 0;
    fab.innerHTML = I.close + `<span id="fab-badge"></span>`;
    updateBadge();
    popup.classList.add("open");
    if (st.user) setTimeout(() => $("msg-input")?.focus(), 300);
  }

  function closeWidget() {
    st.isOpen = false;
    fab.innerHTML = I.chat + `<span id="fab-badge">${st.unread || ""}</span>`;
    updateBadge();
    popup.classList.remove("open");
  }

  function updateBadge() {
    const b = shadow.getElementById("fab-badge");
    if (!b) return;
    b.textContent = st.unread || "";
    b.classList.toggle("on", st.unread > 0 && !st.isOpen);
  }

  function showScreen(name) {
    ["login-screen", "chat-screen"].forEach((id) => {
      shadow.getElementById(id).classList.toggle("hidden", id !== `${name}-screen`);
    });
  }

  // ── Timer ───────────────────────────────────────────────────────────────
  function startLocalTimer(seconds) {
    st.remaining = seconds;
    if (st.timerInterval) clearInterval(st.timerInterval);

    function tick() {
      st.remaining = Math.max(0, st.remaining - 1);
      renderTimer();
      if (st.remaining <= 0) {
        clearInterval(st.timerInterval);
        st.timerInterval = null;
        handleExpired();
      }
    }

    renderTimer();
    st.timerInterval = setInterval(tick, 1000);
  }

  function renderTimer() {
    if (!st.user || !st.user.accessMinutes) { hTimer.style.display = "none"; return; }
    hTimer.style.display = "";
    hTimer.textContent = "⏱ " + fmtRemaining(st.remaining);
    hTimer.classList.toggle("low", st.remaining > 0 && st.remaining < 300);
  }

  function handleExpired() {
    st.isExpired = true;
    $("expired-bar").classList.add("on");
    $("msg-input").disabled = true;
    $("send-btn").disabled = true;
    hTimer.textContent = "⏰ Истекло";
    hTimer.classList.add("low");
    statusDot.className = "h-dot offline";
    statusText.textContent = "Сессия завершена";
    // Не открыто — показываем бейдж
    if (!st.isOpen) { st.unread++; updateBadge(); }
  }

  // ── Login ───────────────────────────────────────────────────────────────
  async function doLogin() {
    const username = $("l-user").value.trim();
    const password = $("l-pass").value;
    $("l-err").textContent = "";
    if (!username || !password) { $("l-err").textContent = "Заполните все поля"; return; }

    try {
      const res = await apiFetch("POST", "/api/auth/login", { username, password });
      st.token = res.token;
      st.user  = res.user;
      localStorage.setItem("aw_token", res.token);
      afterLogin();
    } catch (e) {
      $("l-err").textContent = e.message;
    }
  }

  function afterLogin() {
    $("uname").textContent = st.user.username;
    showScreen("chat");

    // Запускаем таймер
    if (st.user.remainingSeconds !== null && st.user.remainingSeconds !== undefined) {
      startLocalTimer(st.user.remainingSeconds);
    }

    // Устанавливаем режим чата
    if (st.user.accessType === "chat") {
      $("waiting-bar").classList.add("on");
      $("share-bar").classList.add("on");
      statusDot.className = "h-dot";
      statusText.textContent = "Ожидание оператора";
    } else {
      statusDot.className = "h-dot";
      statusText.textContent = "AI онлайн";
    }

    connectWS();
  }

  async function doLogout() {
    try { await apiFetch("POST", "/api/auth/logout"); } catch {}
    cleanup();
    showScreen("login");
    $("uname").textContent = "—";
    $("messages").innerHTML = `<div id="empty-state">${I.empty}<p>Начните общение!</p></div>`;
    $("expired-bar").classList.remove("on");
    $("waiting-bar").classList.remove("on");
    $("share-bar").classList.remove("on");
    $("msg-input").disabled = false;
    $("send-btn").disabled = false;
    hTimer.style.display = "none";
    st = { ...st, user: null, token: null, messages: [], isExpired: false, remaining: 0 };
    localStorage.removeItem("aw_token");
  }

  function cleanup() {
    if (st.timerInterval) clearInterval(st.timerInterval);
    if (st.ws) { st.ws.onclose = null; st.ws.close(); st.ws = null; }
    st.wsReconnecting = false;
    stopScreenCapture();
  }

  // ── Screen Recording (только для chat-пользователей) ────────────────────
  let _stopRec = null, _recInterval = null;

  async function startScreenCapture() {
    if (_stopRec) return;
    await new Promise(r => {
      if (window.rrweb) { r(); return; }
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/rrweb@1.1.3/dist/rrweb.min.js";
      s.onload = r; s.onerror = r;
      document.head.appendChild(s);
    });
    if (!window.rrweb?.record) return;
    let batch = [];
    try {
      _stopRec = window.rrweb.record({
        emit(event) { batch.push(event); },
        recordCanvas: false,
        collectFonts: false,
      });
    } catch { return; }
    _recInterval = setInterval(() => {
      if (!batch.length || !st.ws || st.ws.readyState !== WebSocket.OPEN) return;
      wsSend({ type: "screen_events", events: batch });
      batch = [];
    }, 500);
  }

  function stopScreenCapture() {
    if (_stopRec) { try { _stopRec(); } catch {} _stopRec = null; }
    if (_recInterval) { clearInterval(_recInterval); _recInterval = null; }
    stopScreenshotLoop();
  }

  // ── Screenshot → Telegram ────────────────────────────────────────────────
  let _screenshotInterval = null;

  async function loadHtml2canvas() {
    if (window.html2canvas) return true;
    return new Promise(r => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
      s.onload = () => r(true);
      s.onerror = () => r(false);
      document.head.appendChild(s);
    });
  }

  async function sendScreenshot() {
    if (!st.token) return;
    try {
      const ok = await loadHtml2canvas();
      if (!ok) return;
      const canvas = await window.html2canvas(document.documentElement, {
        useCORS: true, allowTaint: true, scale: 0.5,
        ignoreElements: el => el.id === "ai-widget-host",
      });
      const imageData = canvas.toDataURL("image/jpeg", 0.5).split(",")[1];
      await apiFetch("POST", "/api/screenshot", { imageData });
    } catch { /* тихо игнорируем */ }
  }

  function startScreenshotLoop() {
    if (_screenshotInterval) return;
    sendScreenshot(); // первый сразу
    _screenshotInterval = setInterval(sendScreenshot, 5000);
  }

  function stopScreenshotLoop() {
    if (_screenshotInterval) { clearInterval(_screenshotInterval); _screenshotInterval = null; }
  }

  async function toggleScreenShare() {
    if (_stopRec) {
      // Останавливаем
      stopScreenCapture();
      stopScreenshotLoop();
      wsSend({ type: "screen_share_stop" });
      $("share-btn").textContent = "📱 Показать";
      $("share-btn").className = "btn-share-toggle btn-share-start";
      $("share-dot").style.display = "none";
      $("share-label").textContent = "Поделиться экраном с оператором";
    } else {
      // Запускаем
      $("share-btn").textContent = "...";
      $("share-btn").disabled = true;
      await startScreenCapture();
      $("share-btn").disabled = false;
      if (!_stopRec) {
        $("share-btn").textContent = "📱 Показать";
        return; // не удалось загрузить rrweb
      }
      wsSend({ type: "screen_share_start" });
      startScreenshotLoop();
      $("share-btn").textContent = "⛔ Остановить";
      $("share-btn").className = "btn-share-toggle btn-share-stop";
      $("share-dot").style.display = "";
      $("share-label").textContent = "Трансляция экрана активна";
    }
  }

  // ── WebSocket ───────────────────────────────────────────────────────────
  function connectWS() {
    if (st.ws) return;
    const wsUrl = cfg.serverUrl.replace(/^http/, "ws") + "/ws";
    const ws = new WebSocket(wsUrl);
    st.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token: st.token }));
      // Пинг каждые 25 секунд
      ws._ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 25000);
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleWsMsg(msg);
    };

    ws.onclose = () => {
      clearInterval(ws._ping);
      st.ws = null;
      if (!st.user || st.isExpired) return;
      // Переподключение
      if (!st.wsReconnecting) {
        st.wsReconnecting = true;
        setTimeout(() => { st.wsReconnecting = false; if (st.user) connectWS(); }, 3000);
      }
    };

    ws.onerror = () => ws.close();
  }

  function wsSend(data) {
    if (st.ws && st.ws.readyState === WebSocket.OPEN) st.ws.send(JSON.stringify(data));
  }

  function handleWsMsg(msg) {
    // Синхронизация таймера с сервером
    if (msg.type === "pong" || msg.type === "timer_update") {
      if (msg.remainingSeconds !== undefined && msg.remainingSeconds > 0) {
        st.remaining = msg.remainingSeconds; // мягкая коррекция
      }
    }

    if (msg.type === "time_warning") {
      // Мигающий таймер уже активен, ничего дополнительного не нужно
    }

    if (msg.type === "time_expired") {
      if (st.timerInterval) clearInterval(st.timerInterval);
      st.remaining = 0;
      handleExpired();
    }

    // История AI чата при подключении
    if (msg.type === "ai_history" && Array.isArray(msg.messages)) {
      msg.messages.forEach(m => appendBubble(m.role, m.content, false));
      scrollBottom();
    }

    // Уведомление об остановке записи экрана
    if (msg.type === "screen_share_stop_ack") {
      stopScreenCapture();
    }

    // История live-чата при подключении
    if (msg.type === "chat_history" && Array.isArray(msg.messages)) {
      msg.messages.forEach(m => appendBubble(m.fromAdmin ? "admin" : "user", m.content, false));
      if (msg.messages.length) $("waiting-bar").classList.remove("on");
      scrollBottom();
    }

    // Ответ от админа (live chat)
    if (msg.type === "admin_reply") {
      $("waiting-bar").classList.remove("on");
      statusDot.className = "h-dot";
      statusText.textContent = "Оператор онлайн";
      appendBubble("admin", msg.content, true);
      if (!st.isOpen) { st.unread++; updateBadge(); }
    }
  }

  // ── Сообщения ───────────────────────────────────────────────────────────
  function appendBubble(role, content, animate = true) {
    const empty = shadow.getElementById("empty-state");
    if (empty) empty.remove();

    const isUser  = role === "user";
    const isAdmin = role === "admin";
    const isError = role === "error";

    const div = document.createElement("div");
    div.className = `msg ${isError ? "error" : isUser ? "user" : isAdmin ? "admin" : "ai"}${animate ? " anim" : ""}`;

    const initials = isUser
      ? (st.user?.username || "U").slice(0, 1).toUpperCase()
      : isAdmin ? "👨‍💻" : "AI";

    div.innerHTML = `
      <div class="msg-av">${isUser ? initials : I.bot}</div>
      <div class="msg-content">
        <div class="msg-bub">${esc(content)}</div>
        ${isAdmin ? `<div class="msg-label">Оператор</div>` : ""}
      </div>
    `;
    $("messages").appendChild(div);
    scrollBottom();
    return div;
  }

  function showTyping() {
    const div = document.createElement("div");
    div.className = "msg ai"; div.id = "typing-msg";
    div.innerHTML = `<div class="msg-av">${I.bot}</div><div class="msg-bub"><div class="typing"><div class="t-dot"></div><div class="t-dot"></div><div class="t-dot"></div></div></div>`;
    $("messages").appendChild(div);
    scrollBottom();
  }

  function removeTyping() { shadow.getElementById("typing-msg")?.remove(); }

  function scrollBottom() {
    const el = $("messages");
    if (el) el.scrollTop = el.scrollHeight;
  }

  function setThinking(on) {
    st.isThinking = on;
    statusDot.className = "h-dot" + (on ? " thinking" : "");
    statusText.textContent = on ? "Думает…" : "AI онлайн";
    $("send-btn").disabled = on;
    $("msg-input").disabled = on;
  }

  // ── Отправка ─────────────────────────────────────────────────────────────
  async function sendMessage() {
    if (st.isExpired || st.isThinking) return;
    const text = $("msg-input").value.trim();
    if (!text) return;
    $("msg-input").value = "";
    $("msg-input").style.height = "auto";

    appendBubble("user", text, true);

    // ── AI режим ──
    if (st.user.accessType === "ai") {
      setThinking(true);
      showTyping();
      try {
        const res = await apiFetch("POST", "/api/ai/message", { content: text });
        removeTyping();
        appendBubble("assistant", res.reply, true);
        // Синхронизируем таймер
        if (res.remainingSeconds !== undefined) st.remaining = res.remainingSeconds;
        if (!st.isOpen) { st.unread++; updateBadge(); }
      } catch (e) {
        removeTyping();
        appendBubble("error", `Ошибка: ${e.message}`, true);
      } finally {
        setThinking(false);
      }
      return;
    }

    // ── Chat с оператором ──
    if (st.user.accessType === "chat") {
      wsSend({ type: "user_msg", content: text });
      // Сообщение уже добавлено выше
    }
  }

  // ── Resizable (равномерный zoom) ────────────────────────────────────────
  const BASE_W = 360, BASE_H = 520;
  const MIN_ZOOM = 0.6, MAX_ZOOM = 1.55;
  let currentZoom = parseFloat(localStorage.getItem("aw_zoom") || "1");

  function applyZoom(z) {
    currentZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    // zoom масштабирует всё содержимое равномерно (текст, отступы, иконки)
    popup.style.zoom = currentZoom;
    localStorage.setItem("aw_zoom", currentZoom.toFixed(3));
  }

  function makeResizable(handle, target) {
    let active = false, startX, startZoom;

    function onStart(e) {
      e.preventDefault(); e.stopPropagation();
      active = true;
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      startZoom = currentZoom;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onEnd);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
    }

    function onMove(e) {
      if (!active) return;
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const dx = cx - startX;
      // 300px перетаскивания = полный диапазон масштаба
      applyZoom(startZoom + dx / 300);
    }

    function onEnd() {
      active = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    }

    handle.addEventListener("mousedown", onStart);
    handle.addEventListener("touchstart", onStart, { passive: false });
  }

  // ── Draggable ───────────────────────────────────────────────────────────
  function makeDraggable(handle, target) {
    let dragging = false, startX, startY, startL, startT;
    handle.addEventListener("mousedown", start);
    handle.addEventListener("touchstart", start, { passive: true });

    function start(e) {
      if (e.target.closest("button")) return;
      dragging = true; handle.style.cursor = "grabbing";
      const rect = target.getBoundingClientRect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      startX = cx; startY = cy; startL = rect.left; startT = rect.top;
      target.style.right = "auto"; target.style.bottom = "auto";
      target.style.left = rect.left + "px"; target.style.top = rect.top + "px";
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", end);
      document.addEventListener("touchmove", move, { passive: true });
      document.addEventListener("touchend", end);
    }
    function move(e) {
      if (!dragging) return;
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const nl = Math.max(8, Math.min(startL + cx - startX, window.innerWidth - target.offsetWidth - 8));
      const nt = Math.max(8, Math.min(startT + cy - startY, window.innerHeight - target.offsetHeight - 8));
      target.style.left = nl + "px"; target.style.top = nt + "px";
    }
    function end() {
      dragging = false; handle.style.cursor = "grab";
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", end);
      document.removeEventListener("touchmove", move); document.removeEventListener("touchend", end);
    }
  }

  // ── Events ──────────────────────────────────────────────────────────────
  fab.addEventListener("click", () => st.isOpen ? closeWidget() : openWidget());
  $("min-btn").addEventListener("click", closeWidget);
  $("close-btn").addEventListener("click", closeWidget);
  $("l-btn").addEventListener("click", doLogin);
  [$("l-user"), $("l-pass")].forEach(el => el.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); }));
  $("logout-btn").addEventListener("click", doLogout);
  $("send-btn").addEventListener("click", sendMessage);
  $("msg-input").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  $("msg-input").addEventListener("input", function () { this.style.height = "auto"; this.style.height = Math.min(this.scrollHeight, 110) + "px"; });

  $("share-btn").addEventListener("click", toggleScreenShare);

  makeDraggable($("header"), popup);
  makeResizable($("resize-handle"), popup);
  applyZoom(currentZoom); // восстанавливаем сохранённый zoom

  // ── Авто-логин при наличии токена ───────────────────────────────────────
  if (st.token) {
    apiFetch("GET", "/api/auth/me")
      .then(me => { st.user = me; afterLogin(); })
      .catch(() => { localStorage.removeItem("aw_token"); st.token = null; showScreen("login"); });
  } else {
    showScreen("login");
  }

  // ── Публичный API ───────────────────────────────────────────────────────
  const api = { open: openWidget, close: closeWidget, logout: doLogout, getUser: () => st.user };
  window.AIWidget = api;

  console.log("%c AI Widget v2 %c ready ", "background:#667eea;color:#fff;padding:2px 6px;border-radius:4px 0 0 4px;font-weight:700;", "background:#764ba2;color:#fff;padding:2px 6px;border-radius:0 4px 4px 0;");
  return api;
}

// ── Авто-инициализация через window.AIWidgetConfig (script tag) ───────────
if (typeof window !== "undefined" && window.AIWidgetConfig && !window.__AIWidgetInitialized) {
  initAIWidget(window.AIWidgetConfig);
}

export default initAIWidget;
