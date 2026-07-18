# 108 — Telegram Mini App karta o'yini

Onlayn, 2–6 o'yinchi. Har kim o'z telefonidan, Telegram bot orqali kiradi.

---

## Fayllar

| Fayl | Vazifasi |
|---|---|
| `server.js` | O'yin serveri — butun o'yin mantig'i (kartalar, maxsus funksiyalar, sanoq, 108 qoidasi) |
| `bot.js` | Telegram bot — `/start` bosilganda Mini App tugmasini chiqaradi |
| `public/index.html` | Mini App interfeysi |
| `public/style.css` | Dizayn |
| `public/app.js` | Mijoz mantig'i (WebSocket + Telegram) |

---

## 1-qadam: Bot yaratish

1. Telegramda **@BotFather** ni oching → `/newbot`
2. Bot nomi va username bering → sizga **token** beradi (masalan `7712345678:AAE...`) — saqlang.

## 2-qadam: Serverni internetga joylash

Server **HTTPS** bo'lishi shart (Telegram talabi). Eng oson yo'l — **Render.com** (bepul):

1. Kodni GitHub'ga yuklang.
2. Render → **New → Web Service** → repozitoriyani tanlang.
3. Sozlamalar:
   - Build command: `npm install`
   - Start command: `npm start`
4. Deploy tugagach sizga manzil beradi, masalan: `https://108-game.onrender.com`

> Muqobil variantlar: Railway, Fly.io, yoki o'zingizning VPS (Nginx + SSL).

## 3-qadam: Botni ishga tushirish

Xuddi shu serverda (yoki alohida) ishga tushiring:

```bash
BOT_TOKEN=sizning_token APP_URL=https://108-game.onrender.com node bot.js
```

Bu `/start` da **"▶️ O'ynash"** tugmasini chiqaradi va pastdagi menyu tugmasini ham sozlab qo'yadi.

> Botni doim yoqiq tutish uchun Render'da yana bitta **Background Worker** yarating: start command `node bot.js`, environment'ga `BOT_TOKEN` va `APP_URL` qo'shing.

**Yoki botsiz, faqat BotFather orqali:** @BotFather → `/newapp` → botni tanlang → nom, rasm va **URL** (`https://108-game.onrender.com`) bering. Shunda ham Mini App ochiladi.

## 4-qadam: O'ynash

1. Botni oching → **/start** → **O'ynash**.
2. Bir kishi **"Yangi xona ochish"** → 4 xonali **kod** chiqadi.
3. Kodni do'stlarga yuboring → ular botga kirib **"Xonaga qo'shilish"** → kodni kiritadi.
4. Xona egasi **"O'yinni boshlash"** bosadi.

---

## O'yin qoidalari (dasturda shunday ishlaydi)

**Karta tashlash:** ustidagi kartaga **mast** yoki **raqam** mos bo'lishi kerak.

**Maxsus kartalar:**
- **6** — keyingi o'yinchi 2 karta oladi. Keyingi ham 6 tashlasa → undan keyingisi 4 ta, keyin 6 ta...
- **7** — keyingi 1 karta oladi, 7 bilan qaytariladi (1, 2, 3...)
- **8** — o'zi yana tashlaydi. Nechta 8 bo'lsa, ketma-ket davom ettiraveradi.
- **Q** — istalgan mast ustiga tashlanadi; keyin 4 mastdan birini o'zi tanlaydi.
- **A** — keyingi o'yinchi xodini yo'qotadi. **2 kishi o'ynasa** — xod o'ziga qaytadi (8 kabi).
- **K ♠ (qarga)** — keyingi o'yinchi **4 karta** oladi.

**Tala tugasa:** o'ynalgan kartalar aralashtirilib qayta yopiladi (ustidagisi qoladi).

**Raund sanog'i:** kim kartasini birinchi tugatsa — yutdi (0 ochko). Qolganlarning qo'lidagi kartalar sanaladi:

| Karta | Ochko |
|---|---|
| 6, 7, 8, 10 | o'z qiymati |
| **9** | **0** (sanalmaydi) |
| J | 2 |
| Q | 3 |
| K | 4 |
| A | 11 |

**Maxsus sanoq (faqat qo'lda bitta karta qolganda):**
- Yolg'iz **Q** → 20
- Yolg'iz **Q ♠** → 40
- Yolg'iz **K ♠** → 80

**G'olibning oxirgi kartasi jazo kartasi bo'lsa:** keyingi o'yinchi **avval kartalarni oladi**, keyin ochkolar sanaladi:
- oxirgi karta **6** → keyingi 2 karta oladi
- oxirgi karta **7** → keyingi 1 karta oladi
- oxirgi karta **K ♠** → keyingi 4 karta oladi

**G'olib bonusi:** raundni yutgan o'yinchining **oxirgi tashlagan kartasi K ♠** bo'lsa — ochkosidan **80 ayriladi** (minusga ham ketaveradi).

**Raund boshlanishi:**
- **1-raund:** o'rtaga karta ochiladi, **tasodifiy** o'yinchi boshlaydi.
- **2-raunddan:** o'rtaga karta ochilmaydi — **ochkosi eng baland** o'yinchi istalgan kartasidan boshlaydi.

**Maqsad:** ochko **108 dan oshsa** — o'yinchi chiqib ketadi. **Aynan 108** bo'lsa — ochko **0** ga qaytadi. Oxirida qolgan o'yinchi — **g'olib**.

**Qo'shimcha imkoniyatlar:**
- **Taslim (sdatsya)** — istalgan payt raunddan chiqasiz, qo'lingizdagi kartalar ochko sifatida qo'shiladi, qolganlar davom etadi.
- **Qayta boshlash taklifi** — har o'yinchi o'yin davomida **bir marta** taklif yuboradi. **Hamma rozi bo'lsagina** o'yin noldan boshlanadi.
- **Qayta ulanish** — internet uzilsa, ilovaga qaytganingizda xonaga avtomatik qaytasiz.

---

## Mahalliy sinov (kompyuterda)

```bash
npm install
npm start          # http://localhost:3000
```

Bir nechta brauzer oynasida ochib sinab ko'rsangiz bo'ladi (Telegramsiz ham ishlaydi — ism so'raydi).
