/**
 * server.js — AI Widget Backend
 * Express + MongoDB + WebSocket
 *
 * Запуск: node server.js
 */

require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const cors = require("cors");

// ── Конфиг ───────────────────────────────────────────────────────────────
const PORT            = process.env.PORT            || 4500;
const MONGODB_URI     = process.env.MONGODB_URI     || "mongodb://localhost:27017/widget-ai";
const JWT_SECRET      = process.env.JWT_SECRET      || "dev_secret";
const GROQ_API_KEY    = process.env.GROQ_API_KEY    || "";
const GROQ_MODEL      = process.env.GROQ_MODEL      || "llama-3.1-8b-instant";
const ADMIN_USERNAME  = process.env.ADMIN_USERNAME  || "admin";
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD  || "admin123";
const TG_BOT_TOKEN    = process.env.TG_BOT_TOKEN    || "";
// Поддержка нескольких ID через запятую: "123456,789012"
const ADMIN_TG_IDS    = (process.env.ADMIN_TELEGRAM_ID || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// ── MongoDB ──────────────────────────────────────────────────────────────
let db;

async function connectDB() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db();

  // Индексы
  await db.collection("users").createIndex({ username: 1 }, { unique: true });
  await db.collection("ai_messages").createIndex({ userId: 1, createdAt: 1 });
  await db.collection("live_messages").createIndex({ userId: 1, createdAt: 1 });

  // Сбрасываем незакрытые сессии (если сервер упал)
  await db.collection("users").updateMany(
    { sessionStart: { $ne: null } },
    { $set: { sessionStart: null } }
  );

  // Создаём admin если не существует
  const adminExists = await db.collection("users").findOne({ role: "admin" });
  if (!adminExists) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await db.collection("users").insertOne({
      username:     ADMIN_USERNAME,
      passwordHash: hash,
      role:         "admin",
      accessType:   null,
      accessMinutes: null,
      usedSeconds:  0,
      sessionStart: null,
      createdAt:    new Date(),
    });
    console.log(`✓ Создан admin: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  }

  console.log("✓ MongoDB подключен:", MONGODB_URI);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function signToken(payload, expiresIn = "24h") {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/** Оставшееся время в секундах для пользователя */
function getRemainingSeconds(user) {
  if (!user.accessMinutes) return Infinity; // безлимит (admin)
  const totalSeconds = user.accessMinutes * 60;
  let used = user.usedSeconds || 0;
  if (user.sessionStart) {
    used += (Date.now() - new Date(user.sessionStart).getTime()) / 1000;
  }
  return Math.max(0, totalSeconds - used);
}

/** Форматировать секунды в "Xч Yм Zс" */
function fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}

// ── Express ──────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// Статические файлы (виджет, admin.html, index.html)
// Блокируем .env
app.use((req, res, next) => {
  if (req.path.includes(".env")) return res.status(403).send("Forbidden");
  next();
});
app.use(express.static(path.join(__dirname)));

// /admin → admin.html
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// ── Auth Middleware ───────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  try {
    const payload = verifyToken(token);
    const user = await db.collection("users").findOne({ _id: new ObjectId(payload.sub) });
    if (!user) return res.status(401).json({ error: "Пользователь не найден" });

    // Проверяем не истекло ли время (для обычных пользователей)
    if (user.role !== "admin" && user.accessMinutes !== null) {
      const remaining = getRemainingSeconds(user);
      if (remaining <= 0) {
        return res.status(403).json({ error: "time_expired", message: "Время доступа истекло" });
      }
    }

    req.user = user;
    req.userId = user._id.toString();
    next();
  } catch (e) {
    return res.status(401).json({ error: "Неверный токен" });
  }
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Нет доступа" });
    next();
  });
}

// ── AUTH ROUTES ──────────────────────────────────────────────────────────

// POST /api/auth/login — вход (юзер или админ)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });

    const user = await db.collection("users").findOne({ username });
    if (!user) return res.status(401).json({ error: "Пользователь не найден" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Неверный пароль" });

    // Для обычных пользователей проверяем доступ
    if (user.role !== "admin") {
      if (!user.accessType) return res.status(403).json({ error: "Доступ не назначен администратором" });

      const remaining = getRemainingSeconds(user);
      if (remaining <= 0) {
        return res.status(403).json({ error: "time_expired", message: "Время доступа истекло" });
      }

      // Запускаем таймер сессии при логине
      await db.collection("users").updateOne(
        { _id: user._id },
        { $set: { sessionStart: new Date() } }
      );
    }

    const token = signToken({ sub: user._id.toString(), username: user.username, role: user.role });
    const remaining = user.role === "admin" ? null : getRemainingSeconds({ ...user, sessionStart: new Date() });

    res.json({
      token,
      user: {
        id:           user._id.toString(),
        username:     user.username,
        role:         user.role,
        accessType:   user.accessType,
        accessMinutes: user.accessMinutes,
        remainingSeconds: remaining,
      },
    });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// POST /api/auth/logout — выход (сохраняем использованное время)
app.post("/api/auth/logout", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "admin" && req.user.sessionStart) {
      const elapsed = (Date.now() - new Date(req.user.sessionStart).getTime()) / 1000;
      await db.collection("users").updateOne(
        { _id: req.user._id },
        { $inc: { usedSeconds: elapsed }, $set: { sessionStart: null } }
      );
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// GET /api/auth/me — текущий пользователь + остаток времени
app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = req.user;
  const remaining = user.role === "admin" ? null : getRemainingSeconds(user);
  res.json({
    id:               user._id.toString(),
    username:         user.username,
    role:             user.role,
    accessType:       user.accessType,
    accessMinutes:    user.accessMinutes,
    remainingSeconds: remaining,
  });
});

// ── ADMIN ROUTES ─────────────────────────────────────────────────────────

// GET /api/admin/users — список пользователей
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const users = await db.collection("users")
    .find({ role: { $ne: "admin" } })
    .sort({ createdAt: -1 })
    .toArray();

  res.json(users.map(u => ({
    id:            u._id.toString(),
    username:      u.username,
    accessType:    u.accessType,
    accessMinutes: u.accessMinutes,
    usedSeconds:   u.usedSeconds || 0,
    remainingSeconds: getRemainingSeconds(u),
    isOnline:      !!u.sessionStart || userSockets.has(u._id.toString()),
    createdAt:     u.createdAt,
  })));
});

// POST /api/admin/users — создать пользователя
app.post("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const { username, password, accessType, accessMinutes } = req.body;
    if (!username || !password || !accessType || !accessMinutes) {
      return res.status(400).json({ error: "Заполните все поля" });
    }
    if (!["ai", "chat"].includes(accessType)) {
      return res.status(400).json({ error: "accessType: ai или chat" });
    }
    const mins = parseInt(accessMinutes);
    if (isNaN(mins) || mins <= 0) return res.status(400).json({ error: "Неверное время" });

    const hash = await bcrypt.hash(password, 10);
    const result = await db.collection("users").insertOne({
      username,
      passwordHash:  hash,
      role:          "user",
      accessType,
      accessMinutes: mins,
      usedSeconds:   0,
      sessionStart:  null,
      createdAt:     new Date(),
    });
    res.json({ id: result.insertedId.toString(), username, accessType, accessMinutes: mins });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "Имя пользователя занято" });
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// PATCH /api/admin/users/:id — изменить (сбросить время, изменить доступ)
app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const { accessType, accessMinutes, resetTime } = req.body;
    const update = {};
    if (accessType) update.accessType = accessType;
    if (accessMinutes) update.accessMinutes = parseInt(accessMinutes);
    if (resetTime) { update.usedSeconds = 0; update.sessionStart = null; }

    await db.collection("users").updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// DELETE /api/admin/users/:id
app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    await db.collection("users").deleteOne({ _id: new ObjectId(req.params.id) });
    await db.collection("ai_messages").deleteMany({ userId: req.params.id });
    await db.collection("live_messages").deleteMany({ userId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// GET /api/admin/chat/:userId — история live-чата
app.get("/api/admin/chat/:userId", requireAdmin, async (req, res) => {
  const messages = await db.collection("live_messages")
    .find({ userId: req.params.userId })
    .sort({ createdAt: 1 })
    .toArray();
  res.json(messages);
});

// ── AI ROUTES ────────────────────────────────────────────────────────────

// POST /api/ai/message — отправить сообщение AI
app.post("/api/ai/message", requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "Пустое сообщение" });
    if (req.user.accessType !== "ai") return res.status(403).json({ error: "Нет доступа к AI" });

    // Сохраняем сообщение пользователя
    const userId = req.userId;
    await db.collection("ai_messages").insertOne({
      userId, role: "user", content, createdAt: new Date()
    });

    // Загружаем историю (последние 20 сообщений)
    const history = await db.collection("ai_messages")
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
    history.reverse();

    // Вызов Groq API
    if (!GROQ_API_KEY) {
      return res.status(503).json({ error: "GROQ_API_KEY не настроен на сервере" });
    }

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: "You are a helpful and friendly AI assistant. Keep responses concise." },
          ...history.map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
        ],
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Groq HTTP ${groqRes.status}`);
    }

    const data = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "Нет ответа";

    // Сохраняем ответ AI
    await db.collection("ai_messages").insertOne({
      userId, role: "assistant", content: reply, createdAt: new Date()
    });

    // Обновляем оставшееся время
    const remaining = getRemainingSeconds(await db.collection("users").findOne({ _id: req.user._id }));

    res.json({ reply, remainingSeconds: remaining });
  } catch (e) {
    console.error("AI error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/screenshot — скриншот страницы пользователя → Telegram
app.post("/api/screenshot", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "user" || req.user.accessType !== "chat") {
      return res.status(403).json({ error: "Нет доступа" });
    }
    const { imageData } = req.body; // base64 jpeg без префикса data:
    if (!imageData) return res.status(400).json({ error: "Нет данных" });
    if (!TG_BOT_TOKEN || !ADMIN_TG_IDS.length) return res.json({ ok: true }); // TG не настроен

    // Конвертируем base64 → Buffer
    const buf = Buffer.from(imageData, "base64");
    const caption = `📱 ${req.user.username} | ${new Date().toLocaleTimeString("ru")}`;

    // Отправляем всем admin-ам
    await Promise.all(ADMIN_TG_IDS.map(adminId => {
      const boundary = "----WidgetBoundary" + Date.now() + adminId;
      const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${adminId}`,
        `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`,
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="screen.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ];
      const header = Buffer.from(parts.join("\r\n"));
      const footer = Buffer.from(`\r\n--${boundary}--`);
      const body = Buffer.concat([header, buf, footer]);
      return fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
        body,
      });
    }));

    res.json({ ok: true });
  } catch (e) {
    console.error("Screenshot error:", e.message);
    res.status(500).json({ error: "Ошибка" });
  }
});

// GET /api/ai/history — история AI чата
app.get("/api/ai/history", requireAuth, async (req, res) => {
  const messages = await db.collection("ai_messages")
    .find({ userId: req.userId })
    .sort({ createdAt: 1 })
    .toArray();
  res.json(messages);
});

// ── Telegram Bot ──────────────────────────────────────────────────────────

// tg message_id → userId (для reply-to tracking)
const tgMsgToUser = new Map();
let tgOffset = 0;

async function tgRequest(method, params = {}) {
  if (!TG_BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return res.json();
  } catch (e) {
    console.error("TG request error:", e.message);
    return null;
  }
}

async function tgSendToAdmin(text, options = {}) {
  if (!TG_BOT_TOKEN || !ADMIN_TG_IDS.length) return null;
  const results = await Promise.all(
    ADMIN_TG_IDS.map(id => tgRequest("sendMessage", {
      chat_id: id, text, parse_mode: "HTML", ...options,
    }))
  );
  return results[0]?.result; // возвращаем результат первого (для reply tracking)
}

async function sendAdminReplyToUser(targetUserId, content) {
  const message = {
    userId: targetUserId,
    fromAdmin: true,
    content,
    createdAt: new Date(),
  };
  await db.collection("live_messages").insertOne(message);

  // WebSocket если онлайн
  const targetWs = userSockets.get(targetUserId);
  if (targetWs) {
    wsSend(targetWs, { type: "admin_reply", content, createdAt: message.createdAt });
  }

  // Уведомить admin-панель
  wsSend(adminSocket, {
    type: "admin_msg_sent",
    to: targetUserId,
    content,
    createdAt: message.createdAt,
  });
}

async function processTgUpdates() {
  if (!TG_BOT_TOKEN) return;
  try {
    const data = await tgRequest("getUpdates", {
      offset: tgOffset,
      timeout: 25,
      allowed_updates: ["message"],
    });
    if (!data?.ok || !data.result?.length) return;

    for (const update of data.result) {
      tgOffset = update.update_id + 1;
      const msg = update.message;
      if (!msg) continue;

      // Только от admin-ов
      if (!ADMIN_TG_IDS.includes(msg.from?.id?.toString())) continue;

      const text = (msg.text || "").trim();

      // /create username password minutes ai|chat
      if (text.startsWith("/create ")) {
        const parts = text.slice(8).trim().split(/\s+/);
        if (parts.length < 4) {
          await tgSendToAdmin("❌ Использование:\n<code>/create username password minutes ai|chat</code>");
          continue;
        }
        const [username, password, minutes, accessType] = parts;
        if (!["ai", "chat"].includes(accessType)) {
          await tgSendToAdmin("❌ accessType должен быть <b>ai</b> или <b>chat</b>");
          continue;
        }
        const mins = parseInt(minutes);
        if (isNaN(mins) || mins <= 0) {
          await tgSendToAdmin("❌ Неверное время (минуты > 0)");
          continue;
        }
        try {
          const hash = await bcrypt.hash(password, 10);
          await db.collection("users").insertOne({
            username, passwordHash: hash, role: "user",
            accessType, accessMinutes: mins, usedSeconds: 0,
            sessionStart: null, createdAt: new Date(),
          });
          await tgSendToAdmin(
            `✅ Пользователь создан:\n👤 Логин: <code>${username}</code>\n🔑 Пароль: <code>${password}</code>\n🔰 Тип: <b>${accessType}</b>\n⏱ Время: <b>${mins} мин</b>`
          );
        } catch (e) {
          if (e.code === 11000) await tgSendToAdmin("❌ Имя пользователя уже занято");
          else await tgSendToAdmin("❌ Ошибка создания пользователя");
        }
        continue;
      }

      // /users — список пользователей
      if (text === "/users") {
        const users = await db.collection("users")
          .find({ role: { $ne: "admin" } })
          .sort({ createdAt: -1 })
          .toArray();
        if (!users.length) { await tgSendToAdmin("Нет пользователей"); continue; }
        const list = users.map(u => {
          const rem = getRemainingSeconds(u);
          const online = userSockets.has(u._id.toString()) ? "🟢" : "⚫";
          const remStr = rem === Infinity ? "∞" : Math.floor(rem / 60) + "м";
          return `${online} <b>${u.username}</b> [${u.accessType}] ${remStr}`;
        }).join("\n");
        await tgSendToAdmin(`👥 Пользователи:\n${list}`);
        continue;
      }

      // /help
      if (text === "/help" || text === "/start") {
        await tgSendToAdmin(
          `🤖 <b>AI Widget Bot</b>\n\nКоманды:\n` +
          `/create username password minutes ai|chat — создать пользователя\n` +
          `/users — список пользователей\n` +
          `/reply userId текст — ответить пользователю\n\n` +
          `💡 Или ответьте (reply) на любое сообщение от пользователя чтобы отправить ответ`
        );
        continue;
      }

      // /reply userId текст
      if (text.startsWith("/reply ")) {
        const rest = text.slice(7);
        const spaceIdx = rest.indexOf(" ");
        if (spaceIdx === -1) { await tgSendToAdmin("❌ /reply userId текст"); continue; }
        const targetUserId = rest.slice(0, spaceIdx);
        const content = rest.slice(spaceIdx + 1);
        await sendAdminReplyToUser(targetUserId, content);
        await tgSendToAdmin("✅ Сообщение отправлено");
        continue;
      }

      // Reply на forwarded сообщение → ответ пользователю
      if (msg.reply_to_message) {
        const targetUserId = tgMsgToUser.get(msg.reply_to_message.message_id);
        if (targetUserId && text) {
          await sendAdminReplyToUser(targetUserId, text);
          await tgSendToAdmin("✅ Сообщение отправлено");
          continue;
        }
      }
    }
  } catch (e) {
    console.error("TG polling error:", e.message);
  }
}

function startTgPolling() {
  if (!TG_BOT_TOKEN) return;
  console.log("✓ Telegram бот запущен");
  tgSendToAdmin("🟢 Сервер запущен. /help — список команд");
  // Используем рекурсивный setTimeout для long polling
  async function poll() {
    await processTgUpdates();
    setTimeout(poll, 1000);
  }
  poll();
}

// ── WebSocket ─────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

// Активные WS соединения
let adminSocket = null;                    // WS администратора
const userSockets = new Map();            // userId → WebSocket
const timerIntervals = new Map();         // userId → intervalId

function wsSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Уведомить admin-а
function notifyAdmin(data) {
  wsSend(adminSocket, data);
}

// Запустить таймер для пользователя
function startUserTimer(userId, user) {
  // Чистим предыдущий если был
  if (timerIntervals.has(userId)) {
    clearInterval(timerIntervals.get(userId));
  }

  const interval = setInterval(async () => {
    const ws = userSockets.get(userId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      clearInterval(interval);
      timerIntervals.delete(userId);
      return;
    }

    // Получаем актуального пользователя из БД
    const freshUser = await db.collection("users").findOne({ _id: new ObjectId(userId) });
    if (!freshUser) return;

    const remaining = getRemainingSeconds(freshUser);

    // Отправляем обновление таймера
    wsSend(ws, { type: "timer_update", remainingSeconds: Math.floor(remaining) });

    // Предупреждение за 5 минут
    if (remaining <= 300 && remaining > 0) {
      wsSend(ws, { type: "time_warning", remainingSeconds: Math.floor(remaining) });
    }

    // Время истекло
    if (remaining <= 0) {
      wsSend(ws, { type: "time_expired" });
      clearInterval(interval);
      timerIntervals.delete(userId);
      // Останавливаем сессию в БД
      await db.collection("users").updateOne(
        { _id: new ObjectId(userId) },
        { $set: { sessionStart: null } }
      );
      setTimeout(() => ws.close(), 1000);
    }
  }, 30000); // каждые 30 секунд

  timerIntervals.set(userId, interval);
}

// При отключении пользователя — сохраняем время
async function onUserDisconnect(userId) {
  userSockets.delete(userId);

  if (timerIntervals.has(userId)) {
    clearInterval(timerIntervals.get(userId));
    timerIntervals.delete(userId);
  }

  try {
    const user = await db.collection("users").findOne({ _id: new ObjectId(userId) });
    if (user && user.sessionStart) {
      const elapsed = (Date.now() - new Date(user.sessionStart).getTime()) / 1000;
      await db.collection("users").updateOne(
        { _id: new ObjectId(userId) },
        { $inc: { usedSeconds: elapsed }, $set: { sessionStart: null } }
      );
    }
  } catch (e) {
    console.error("onUserDisconnect error:", e.message);
  }

  // Уведомляем admin
  notifyAdmin({ type: "user_offline", userId });
}

// ── WS Connection handler ─────────────────────────────────────────────────
wss.on("connection", (ws) => {
  let authedUser = null;

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── Аутентификация ──
    if (msg.type === "auth") {
      try {
        const payload = verifyToken(msg.token);
        const user = await db.collection("users").findOne({ _id: new ObjectId(payload.sub) });
        if (!user) return wsSend(ws, { type: "auth_error", message: "Пользователь не найден" });

        authedUser = user;
        const userId = user._id.toString();

        // Администратор
        if (user.role === "admin") {
          adminSocket = ws;
          // Отправляем список онлайн пользователей
          const onlineUsers = [...userSockets.keys()];
          wsSend(ws, {
            type: "auth_ok",
            role: "admin",
            onlineUsers,
          });
          return;
        }

        // Обычный пользователь
        const remaining = getRemainingSeconds(user);
        if (remaining <= 0) {
          wsSend(ws, { type: "time_expired" });
          ws.close();
          return;
        }

        // Регистрируем сокет
        userSockets.set(userId, ws);

        // Обновляем sessionStart если не было
        if (!user.sessionStart) {
          await db.collection("users").updateOne(
            { _id: user._id },
            { $set: { sessionStart: new Date() } }
          );
        }

        wsSend(ws, {
          type: "auth_ok",
          user: { id: userId, username: user.username, accessType: user.accessType },
          remainingSeconds: Math.floor(remaining),
        });

        // Запускаем таймер
        startUserTimer(userId, user);

        // Для chat-пользователей — уведомляем admin и загружаем историю
        if (user.accessType === "chat") {
          notifyAdmin({
            type: "user_online",
            userId,
            username: user.username,
          });

          // Уведомление в Telegram
          if (TG_BOT_TOKEN && ADMIN_TG_IDS.length) {
            tgSendToAdmin(
              `🟢 <b>${user.username}</b> вошёл в чат\n` +
              `<i>Ответьте на его сообщение или используйте /reply ${userId} текст</i>`
            );
          }

          // Загружаем историю чата и отправляем пользователю
          const history = await db.collection("live_messages")
            .find({ userId })
            .sort({ createdAt: 1 })
            .toArray();
          wsSend(ws, { type: "chat_history", messages: history });
        }

        // Для AI — загружаем историю AI чата
        if (user.accessType === "ai") {
          const history = await db.collection("ai_messages")
            .find({ userId })
            .sort({ createdAt: 1 })
            .toArray();
          wsSend(ws, { type: "ai_history", messages: history });
        }

      } catch (e) {
        wsSend(ws, { type: "auth_error", message: "Неверный токен" });
      }
      return;
    }

    // Дальше только для аутентифицированных
    if (!authedUser) return;

    const userId = authedUser._id.toString();

    // ── Ping ──
    if (msg.type === "ping") {
      const freshUser = await db.collection("users").findOne({ _id: authedUser._id });
      const remaining = freshUser ? getRemainingSeconds(freshUser) : 0;
      wsSend(ws, { type: "pong", remainingSeconds: Math.floor(remaining) });
      return;
    }

    // ── Сообщение пользователя → admin ──
    if (msg.type === "user_msg" && authedUser.role !== "admin") {
      const message = {
        userId,
        fromAdmin: false,
        content:   msg.content,
        createdAt: new Date(),
      };
      await db.collection("live_messages").insertOne(message);

      // Пересылаем admin-у (WS)
      notifyAdmin({
        type:      "new_message",
        userId,
        username:  authedUser.username,
        content:   msg.content,
        messageId: message._id?.toString(),
        createdAt: message.createdAt,
      });

      // Пересылаем admin-у в Telegram
      if (TG_BOT_TOKEN && ADMIN_TG_IDS.length) {
        const sent = await tgSendToAdmin(
          `💬 <b>${authedUser.username}</b>:\n${msg.content}\n\n<i>ID: ${userId}</i>`,
          { reply_markup: { force_reply: true } }
        );
        if (sent?.message_id) {
          tgMsgToUser.set(sent.message_id, userId);
          // Чистим старые записи (держим последние 200)
          if (tgMsgToUser.size > 200) {
            const firstKey = tgMsgToUser.keys().next().value;
            tgMsgToUser.delete(firstKey);
          }
        }
      }

      // Подтверждение пользователю
      wsSend(ws, {
        type:      "msg_sent",
        content:   msg.content,
        createdAt: message.createdAt,
      });
      return;
    }

    // ── Пользователь начал трансляцию экрана ──
    if (msg.type === "screen_share_start" && authedUser.role !== "admin") {
      notifyAdmin({ type: "screen_share_start", userId, username: authedUser.username });
      tgSendToAdmin(
        `🖥 <b>${authedUser.username}</b> начал трансляцию экрана\n` +
        `<i>Скриншоты будут приходить сюда каждые 5 секунд.\nЖивой просмотр — откройте веб-панель.</i>`
      );
      return;
    }

    // ── Пользователь остановил трансляцию ──
    if (msg.type === "screen_share_stop" && authedUser.role !== "admin") {
      notifyAdmin({ type: "screen_share_stop", userId });
      tgSendToAdmin(`⏹ <b>${authedUser.username}</b> остановил трансляцию экрана`);
      return;
    }

    // ── События экрана → admin ──
    if (msg.type === "screen_events" && authedUser.role !== "admin") {
      if (adminSocket && adminSocket.readyState === WebSocket.OPEN) {
        adminSocket.send(JSON.stringify({ type: "screen_events", userId, events: msg.events }));
      }
      return;
    }

    // ── Ответ admin → пользователю ──
    if (msg.type === "admin_msg" && authedUser.role === "admin") {
      const { to: targetUserId, content } = msg;
      if (!targetUserId || !content) return;

      const message = {
        userId:    targetUserId,
        fromAdmin: true,
        content,
        createdAt: new Date(),
      };
      await db.collection("live_messages").insertOne(message);

      // Пересылаем пользователю
      const targetWs = userSockets.get(targetUserId);
      wsSend(targetWs, {
        type:      "admin_reply",
        content,
        createdAt: message.createdAt,
      });

      // Подтверждение admin-у
      wsSend(ws, {
        type:      "admin_msg_sent",
        to:        targetUserId,
        content,
        createdAt: message.createdAt,
      });
      return;
    }
  });

  ws.on("close", () => {
    if (!authedUser) return;
    if (authedUser.role === "admin") {
      if (adminSocket === ws) adminSocket = null;
    } else {
      onUserDisconnect(authedUser._id.toString());
    }
  });

  ws.on("error", (e) => console.error("WS error:", e.message));
});

// ── Старт ─────────────────────────────────────────────────────────────────
connectDB()
  .then(() => {
    startTgPolling();
    server.listen(PORT, () => {
      console.log(`
  ┌────────────────────────────────────────────────┐
  │  AI Widget Server v2.0                         │
  │  http://localhost:${PORT}                          │
  │  Admin panel: http://localhost:${PORT}/admin        │
  │                                                │
  │  MongoDB:  ${MONGODB_URI.slice(0, 35)}...     │
  │  Groq Key: ${GROQ_API_KEY ? GROQ_API_KEY.slice(0, 8) + "..." : "⚠️  не задан"}               │
  └────────────────────────────────────────────────┘
      `);
    });
  })
  .catch((err) => {
    console.error("❌ Не удалось запустить сервер:", err.message);
    process.exit(1);
  });
