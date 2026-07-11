/*  108 — Telegram bot
 *  /start bosilganda "O'ynash" tugmasi chiqadi va Mini App ochiladi.
 *  Ishga tushirish:  BOT_TOKEN=xxx APP_URL=https://sizning-domen node bot.js
 *  (Qo'shimcha kutubxona kerak emas — Node 18+ dagi fetch ishlatiladi.)
 */
const TOKEN = process.env.BOT_TOKEN;
// Render manzilni o'zi beradi (RENDER_EXTERNAL_URL). Qo'lda ham berish mumkin: APP_URL
const APP_URL = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
const API = `https://api.telegram.org/bot${TOKEN}`;

async function call(method, body) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

// Pastdagi "menyu" tugmasini ham Mini App qilib qo'yamiz
async function setup() {
  await call('setChatMenuButton', {
    menu_button: { type: 'web_app', text: "108 o'ynash", web_app: { url: APP_URL } },
  });
  await call('setMyCommands', {
    commands: [
      { command: 'start', description: "O'yinni ochish" },
      { command: 'qoida', description: "O'yin qoidalari" },
    ],
  });
  console.log("Bot sozlandi. Mini App: " + APP_URL);
}

const RULES = [
  "🎴 *108 — qoidalar*",
  "",
  "36 karta (6,7,8,9,10,J,Q,K,A × 4 mast). Har kimga 4 tadan tarqatiladi.",
  "Karta *mast* yoki *raqam* bo'yicha tashlanadi.",
  "",
  "*Maxsus kartalar*",
  "• *6* — keyingi o'yinchi 2 karta oladi (6 ustiga 6 tashlansa 4, 6 ...)",
  "• *7* — keyingi 1 karta oladi (7 bilan qaytariladi)",
  "• *8* — o'zi yana tashlaydi",
  "• *Q* — istalgan mast ustiga; keyin mastni o'zi tanlaydi",
  "• *A* — keyingi o'yinchi xodini yo'qotadi (2 kishida xod o'ziga qaytadi)",
  "• *K ♠ (qarga)* — keyingi o'yinchi 4 karta oladi",
  "",
  "*Sanoq* (raund oxirida qo'ldagi kartalar)",
  "6–10 = o'zi, J=2, Q=3, K=4, A=11",
  "Yolg'iz qolgan Q = 20, Q♠ = 40, K♠ = 80",
  "Yutgan o'yinchining oxirgi kartasi K♠ bo'lsa — *ochkosidan 80 ayriladi*",
  "",
  "*Maqsad:* ochko 108 dan *oshsa* — chiqib ketasiz. *Aynan 108* bo'lsa — 0 ga qaytadi.",
  "Oxirida qolgan o'yinchi — g'olib.",
].join('\n');

let offset = 0;
async function poll() {
  try {
    const res = await call('getUpdates', { offset, timeout: 30 });
    for (const u of (res.result || [])) {
      offset = u.update_id + 1;
      const msg = u.message;
      if (!msg || !msg.text) continue;
      const chatId = msg.chat.id;
      const text = msg.text.trim().toLowerCase();

      if (text.startsWith('/start')) {
        await call('sendMessage', {
          chat_id: chatId,
          text: `Salom, ${msg.from.first_name || ''}! 🎴\n\n*108* — 2–6 kishilik onlayn karta o'yini.\nXona oching yoki do'stingiz bergan 4 xonali kod bilan qo'shiling.`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: "▶️ O'ynash", web_app: { url: APP_URL } }]],
          },
        });
      } else if (text.startsWith('/qoida')) {
        await call('sendMessage', { chat_id: chatId, text: RULES, parse_mode: 'Markdown' });
      }
    }
  } catch (e) {
    console.error('poll xatosi:', e.message);
    await new Promise(r => setTimeout(r, 3000));
  }
  poll();
}

/* Botni ishga tushirish. server.js shu funksiyani chaqiradi. */
function startBot() {
  if (!TOKEN) { console.log("BOT_TOKEN yo'q — bot ishga tushmadi (o'yin baribir ishlaydi)."); return; }
  if (!APP_URL) { console.log("APP_URL/RENDER_EXTERNAL_URL yo'q — bot ishga tushmadi."); return; }
  setup().then(poll).catch(e => console.error('bot xatosi:', e.message));
}

module.exports = { startBot };

// Alohida ishga tushirilsa (node bot.js) — o'zi boshlaydi
if (require.main === module) startBot();
