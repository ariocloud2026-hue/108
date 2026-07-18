# 108 — Texnik topshiriq (TZ)

Onlayn, ko'p o'yinchili Telegram Mini App karta o'yini. 2–6 o'yinchi, kompyuter (bot) bilan yoki bo'lmasdan.

---

## 1. Umumiy

- **Talalar (mastlar):** qarga ♠, gisht ♦, chirva ♥, xoch ♣
- **Kartalar:** 6, 7, 8, 9, 10, J, Q, K, A × 4 mast = **36 karta**
- **O'yinchilar:** 2–6 (odam va/yoki bot)
- **Har o'yinchiga:** boshida **4 karta**
- **Maqsad:** umumiy ochkoni **108 dan oshirmaslik**

---

## 2. O'yin maqsadi va tugashi

- Har raund oxirida o'yinchilarga ochko qo'shilib boradi.
- Ochko **108 dan oshsa** → o'yinchi **o'yindan chiqadi**.
- Ochko **aynan 108** bo'lsa → **0 ga qaytadi** (chiqmaydi).
- **Oxirida qolgan bitta o'yinchi — g'olib.**

---

## 3. Karta tashlash

- Ustidagi kartaga **mast** yoki **raqam** mos bo'lishi kerak.
  - Masalan **8♣** ustiga: **8** (istalgan mast) yoki istalgan **♣**.
- **Mos karta bo'lmasa** — taladan **1 karta** olinadi:
  - olingan karta **mos kelsa** → uni **darhol tashlash shart** (xod o'tmaydi);
  - **mos kelmasa** → xod keyingi o'yinchiga o'tadi.
- Tala tugasa — o'ynalgan kartalar (ustidagisidan tashqari) aralashtirilib qayta yopiladi.

---

## 4. Maxsus kartalar

| Karta | Vazifasi |
|---|---|
| **6** | Keyingi o'yinchi **2 karta** oladi. Ustiga 6 tashlansa jazo o'sadi: 2 → 4 → 6 … Faqat 6 bilan qaytariladi. |
| **7** | Keyingi o'yinchi **1 karta** oladi. 7 bilan qaytariladi: 1 → 2 → 3 … |
| **8** | O'yinchi **yana o'ynaydi**. Mos karta bo'lmasa — **mos karta chiqmaguncha** taladan oladi va o'sha kartani tashlaydi. |
| **Q** | **Joker** — istalgan mast ustiga tashlanadi; keyin o'yinchi kerakli **mastni tanlaydi**. |
| **A** | Keyingi o'yinchi **xodini yo'qotadi** (sakraladi). 2 kishida — xod o'ynagan odamga qaytadi. |
| **K ♠ (qarga)** | Keyingi o'yinchi **4 karta** oladi. |

- **6 / 7** jazolarini faqat o'sha raqam qaytaradi (6→6, 7→7). K♠ jazosini hech narsa qaytarmaydi.
- 8 va A ketma-ket bo'lsa — o'yinchi navbatni ketma-ket o'zida saqlaydi.

---

## 5. Raund yakuni va sanoq

Kim kartasini **birinchi tugatsa** — raundni **yutadi** (0 ochko). Qolganlarning qo'lidagi kartalar sanaladi va ochkoga qo'shiladi.

**Karta qiymatlari:**

| Karta | Ochko |
|---|---|
| 6, 7, 8, 10 | o'z qiymati |
| **9** | **0** (sanalmaydi) |
| J | 2 |
| Q | 3 |
| K | 4 |
| A | 11 |

**Qo'lda faqat bitta karta qolsa:**
- yolg'iz **Q** → 20
- yolg'iz **Q ♠** → 40
- yolg'iz **K ♠** → 80

**G'olibning oxirgi kartasi jazo kartasi bo'lsa** — keyingi o'yinchi **avval jazoni oladi**, keyin ochko sanaladi:
- oxirgi **6** → keyingi 2 karta oladi
- oxirgi **7** → keyingi 1 karta oladi
- oxirgi **K ♠** → keyingi 4 karta oladi

**Bonus:** g'olibning oxirgi kartasi **K ♠** bo'lsa — ochkosidan **80 ayriladi** (minusga ham ketishi mumkin).

---

## 6. Raund boshlanishi

- Har raundda o'rtaga **bitta karta ochiladi** (maxsus karta bo'lsa boshqasi bilan almashtiriladi).
- **1-raundni** — tasodifiy o'yinchi boshlaydi.
- **2-raunddan** — **ochkosi eng baland** o'yinchi boshlaydi.

---

## 7. Qo'shimcha imkoniyatlar

- **Taslim (sdatsya):** istalgan payt raunddan chiqasiz — qo'lingizdagi kartalar ochko sifatida qo'shiladi, qolganlar davom etadi.
- **🔄 Qayta boshlash** / **🏁 Yakunlash:** taklif yuboriladi (har biri o'yin davomida **1 marta**). **Hamma rozi bo'lsagina** amalga oshadi. Yakunlashda **eng kam ochkoli** o'yinchi g'olib.
- **💬 Chat:** matn, rasm, ovozli xabar.
- **📞 Qo'ng'iroq:** birga gaplashib o'ynash — audio yoki video.
- **📤 Ulashish:** xona kodini yoki Telegram havolasini yuborish (havola orqali to'g'ridan-to'g'ri xonaga kiriladi).

---

## 8. Kompyuter (bot)

Xona egasi lobbida bot qo'sha oladi (jami 6 o'yinchigacha). **3 daraja:**

| Daraja | Xatti-harakati |
|---|---|
| **Oson** | Tasodifiy to'g'ri kartani tashlaydi. |
| **Qiyin** | Yuqori ochkoli kartalardan qutuladi, raqib kam kartali bo'lsa hujum kartalarini (6/7/A/K♠) ishlatadi. |
| **Professor** | Bularга qo'shimcha: yolg'iz Q/K♠ jazosidan qochadi, 8 ni ketma-ketlik uchun saqlaydi, mast tanlashda strategik yondashadi. |

Botlar taklif (qayta/yakunlash) kelganda avtomatik rozi bo'ladi.

---

## 9. Barqarorlik (qotib qolmaslik)

- **Odam o'yin o'rtasida uzilsa** — ~14 soniyadan so'ng uning navbati **avtomatik o'ynaladi**, o'yin qotmaydi. Qaytib ulanganda davom etadi.
- **Raund yakunida** host bosmasa yoki chiqib ketgan bo'lsa — ~12 soniyadan so'ng keyingi raund avtomatik boshlanadi.
- **Ovoz berish** javobsiz qolsa — ~18 soniyada bekor bo'ladi.
- Serverdagi bironta xato butun serverni **yiqitmaydi** (har bir xabar himoyalangan).

---

## 10. Arxitektura

- **Backend:** Node.js + Express (statik fayllar) + `ws` (WebSocket). Butun o'yin mantig'i serverda (server = hakam). Fayl: `server.js`.
- **Bot:** `bot.js` — Telegram `/start` da Mini App tugmasini chiqaradi, server ichida ishlaydi.
- **Frontend:** `public/index.html`, `public/style.css`, `public/app.js` — Telegram Mini App.
- **Ulanish:** xona 4 xonali kod bilan. Qayta ulanish `tgId` orqali.
