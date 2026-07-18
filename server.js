/*  108 — Telegram Mini App karta o'yini
 *  Server: Express (statik fayllar) + WebSocket (real-time o'yin).
 *  Butun o'yin mantig'i shu yerda — mijoz (frontend) faqat ko'rsatadi va yuboradi.
 */
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const app = express();
// Keshni o'chiramiz — Telegram eski fayllarni saqlab qolmasligi uchun
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store, must-revalidate'),
}));
app.get('/health', (_req, res) => res.send('ok'));

// Mini App havolasini yasash uchun bot ma'lumoti
app.get('/api/info', (_req, res) => {
  let info = { username: null, app: 'play' };
  try { info = require('./bot.js').getInfo() || info; } catch (_) {}
  res.json(info);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 3 * 1024 * 1024 }); // 3MB — rasm/ovoz uchun

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('108 server ishga tushdi: port ' + PORT);
  // Telegram botni shu servisning o'zida ishga tushiramiz (BOT_TOKEN berilgan bo'lsa)
  try { require('./bot.js').startBot(); }
  catch (e) { console.error('Botni ishga tushirib bo\'lmadi:', e.message); }
});

/* ----------------------------------------------------------------------- *
 *  O'YIN KONSTANTALARI
 * ----------------------------------------------------------------------- */
const SUITS = ['qarga', 'gisht', 'chirva', 'xoch']; // ♠ ♦ ♥ ♣
const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const HAND_SIZE = 4;
const LOSE_LIMIT = 108;

// Sanoqdagi oddiy qiymat
const VALUE = { '6': 6, '7': 7, '8': 8, '9': 0, '10': 10, 'J': 2, 'Q': 3, 'K': 4, 'A': 11 }; // 9 = 0 ochko (sanalmaydi)

// Raund boshidagi ochiladigan karta maxsus bo'lmasligi kerak (1-raund)
function isSpecialStart(c) {
  return ['6', '7', '8', 'Q', 'A'].includes(c.rank) || (c.rank === 'K' && c.suit === 'qarga');
}

function buildDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s, id: r + '_' + s });
  return deck;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Qo'ldagi kartalar yig'indisi (raund oxirida qo'shiladigan ochko)
function handScore(hand) {
  if (hand.length === 1) {
    const c = hand[0];
    if (c.rank === 'Q' && c.suit === 'qarga') return 40; // yolg'iz Q qarga
    if (c.rank === 'Q') return 20;                        // yolg'iz Q
    if (c.rank === 'K' && c.suit === 'qarga') return 80;  // yolg'iz K qarga
    return VALUE[c.rank];
  }
  return hand.reduce((s, c) => s + VALUE[c.rank], 0);
}

/* ----------------------------------------------------------------------- *
 *  XONALAR
 * ----------------------------------------------------------------------- */
const rooms = new Map(); // code -> room

function makeCode() {
  let code;
  do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
  return code;
}

function createRoom(hostId) {
  const code = makeCode();
  const room = {
    code,
    hostId,
    phase: 'lobby',          // lobby | playing | roundover | gameover
    roundNumber: 0,
    players: [],             // {id,name,ws,connected,hand,cumulative,eliminated,foldedThisRound,usedProposal,roundDelta}
    st: null,                // o'yin holati
    lastWinnerId: null,
    pendingVote: null,       // {kind:'restart'|'end', proposerId, votes:{id:'yes'|'no'}}
    chat: [],                // oxirgi 60 ta xabar
    call: null,              // {mode:'audio'|'video', members:[id]}
    stallTicks: 0,           // uzilgan o'yinchi navbatida kutish
    roTicks: 0,              // raund yakunida avtomatik keyingiga o'tish
    voteTicks: 0,            // ovoz berish vaqti
    log: [],
  };
  rooms.set(code, room);
  return room;
}

function addLog(room, text) {
  room.log.push(text);
  if (room.log.length > 8) room.log.shift();
}

function findPlayer(room, id) { return room.players.find(p => p.id === id); }
function activePlayers(room) { return room.players.filter(p => !p.eliminated); }

/* ----------------------------------------------------------------------- *
 *  RAUNDNI BOSHLASH
 * ----------------------------------------------------------------------- */
function startRound(room) {
  room.roundNumber++;
  const parts = activePlayers(room);
  parts.forEach(p => { p.hand = []; p.foldedThisRound = false; p.roundDelta = 0; });

  const deck = shuffle(buildDeck());
  for (let i = 0; i < HAND_SIZE; i++) for (const p of parts) p.hand.push(deck.pop());

  const st = {
    drawPile: deck,
    discard: [],
    currentSuit: null,
    currentRank: null,
    pendingDraw: 0,
    pendingType: null,     // '6' | '7' | 'K'
    mustPlay: null,        // taladan olingan karta mos kelsa — shuni tashlash shart
    mustMatch: false,      // 8 dan keyin: mos karta chiqmaguncha olish shart
    history: [],           // o'ynalgan kartalar ketma-ketligi
    order: parts.map(p => p.id),
    pos: 0,
    awaitingLead: false, // ishlatilmaydi (har raundda karta ochiladi)
  };

  // HAR RAUNDDA o'rtaga bitta karta ochiladi (maxsus bo'lmagani tanlanadi)
  let start = deck.pop();
  const skipped = [];
  while (start && isSpecialStart(start) && deck.length) { skipped.push(start); start = deck.pop(); }
  deck.unshift(...skipped);
  st.discard.push(start);
  st.currentSuit = start.suit;
  st.currentRank = start.rank;

  if (room.roundNumber === 1) {
    // 1-raund: tasodifiy o'yinchi boshlaydi
    st.pos = Math.floor(Math.random() * st.order.length);
    addLog(room, `1-raund boshlandi. O'rtada: ${cardText(start)}. Boshlaydi: ${nameOf(room, st.order[st.pos])}`);
  } else {
    // 2+ raund: OCHKOSI ENG BALAND o'yinchi boshlaydi
    let starterId = parts[0].id, best = -Infinity;
    for (const p of parts) if (p.cumulative > best) { best = p.cumulative; starterId = p.id; }
    st.pos = st.order.indexOf(starterId);
    addLog(room, `${room.roundNumber}-raund. O'rtada: ${cardText(start)}. Ochkosi baland ${nameOf(room, starterId)} boshlaydi.`);
  }

  room.st = st;
  room.phase = 'playing';
}

/* ----------------------------------------------------------------------- *
 *  YORDAMCHI FUNKSIYALAR
 * ----------------------------------------------------------------------- */
function nameOf(room, id) { const p = findPlayer(room, id); return p ? p.name : '???'; }
function currentId(room) { return room.st.order[room.st.pos]; }
function advance(room, steps) {
  const st = room.st;
  const n = st.order.length;
  let pos = st.pos;
  let moved = 0;
  // faqat taslim bo'lmagan o'yinchilarga o'tamiz
  while (moved < steps) {
    pos = (pos + 1) % n;
    const p = findPlayer(room, st.order[pos]);
    if (p && !p.foldedThisRound) moved++;
    if (allFoldedButOne(room)) break;
  }
  st.pos = pos;
}
function inRoundPlayers(room) {
  return room.st.order.map(id => findPlayer(room, id)).filter(p => p && !p.foldedThisRound);
}
function allFoldedButOne(room) { return inRoundPlayers(room).length <= 1; }

// Karta ustidagi kartaga mos keladimi (majburiyatlarni hisobga olmay)?
function matches(st, card) {
  if (card.rank === 'Q') return true;
  if (card.suit === st.currentSuit) return true;
  if (card.rank === st.currentRank) return true;
  return false;
}

// Ushbu karta hozir tashlansa bo'ladimi?
function canPlay(st, card) {
  if (st.mustPlay) return card.id === st.mustPlay; // olingan karta mos kelgan — faqat shuni tashlaydi
  if (st.awaitingLead) return true; // boshlovchi istalganini tashlaydi
  if (st.pendingDraw > 0) {
    if (st.pendingType === '6') return card.rank === '6';
    if (st.pendingType === '7') return card.rank === '7';
    if (st.pendingType === 'K') return false; // K qargaga qarshi yo'q — 4 ta olish shart
  }
  if (card.rank === 'Q') return true;                 // joker
  if (card.suit === st.currentSuit) return true;      // mast mos
  if (card.rank === st.currentRank) return true;      // raqam mos
  return false;
}
function legalMoves(st, hand) { return hand.filter(c => canPlay(st, c)).map(c => c.id); }

function reshuffleIfNeeded(st) {
  if (st.drawPile.length === 0 && st.discard.length > 1) {
    const top = st.discard.pop();
    st.drawPile = shuffle(st.discard);
    st.discard = [top];
  }
}
function drawN(room, player, n) {
  const st = room.st;
  let got = 0;
  for (let i = 0; i < n; i++) {
    reshuffleIfNeeded(st);
    if (st.drawPile.length === 0) break;
    player.hand.push(st.drawPile.pop());
    got++;
  }
  return got;
}

function cardText(c) {
  const sym = { qarga: '♠', gisht: '♦', chirva: '♥', xoch: '♣' };
  return c.rank + sym[c.suit];
}

/* ----------------------------------------------------------------------- *
 *  KARTA TASHLASH / OLISH / TASLIM
 * ----------------------------------------------------------------------- */
function applyEffect(room, card, declaredSuit) {
  const st = room.st;
  st.mustMatch = false;
  st.currentRank = card.rank;
  if (card.rank === 'Q') {
    st.currentSuit = SUITS.includes(declaredSuit) ? declaredSuit : card.suit;
    addLog(room, `${nameOf(room, currentId(room))}: Q → mast "${st.currentSuit}"`);
  } else {
    st.currentSuit = card.suit;
  }
  switch (card.rank) {
    case '6': st.pendingDraw += 2; st.pendingType = '6'; advance(room, 1); break;
    case '7': st.pendingDraw += 1; st.pendingType = '7'; advance(room, 1); break;
    case '8': st.mustMatch = true; /* qo'shimcha xod: mos karta chiqmaguncha oladi */ break;
    case 'A': advance(room, 2); break; // keyingi sakraladi (2 kishida o'ziga qaytadi)
    case 'K':
      if (card.suit === 'qarga') { st.pendingDraw += 4; st.pendingType = 'K'; }
      advance(room, 1);
      break;
    case 'Q': advance(room, 1); break;
    default: advance(room, 1);
  }
}

function handlePlay(room, player, cardId, declaredSuit) {
  const st = room.st;
  if (room.phase !== 'playing') return err(player, 'O\'yin hozir faol emas.');
  if (room.pendingVote) return err(player, 'Ovoz berish tugashini kuting.');
  if (currentId(room) !== player.id) return err(player, 'Sizning navbatingiz emas.');
  if (player.foldedThisRound) return err(player, 'Siz bu raundda taslim bo\'lgansiz.');
  const idx = player.hand.findIndex(c => c.id === cardId);
  if (idx < 0) return err(player, 'Bunday karta qo\'lingizda yo\'q.');
  const card = player.hand[idx];
  if (!canPlay(st, card)) return err(player, 'Bu kartani hozir tashlab bo\'lmaydi.');
  if (card.rank === 'Q' && !SUITS.includes(declaredSuit)) return err(player, 'Q uchun mast tanlang.');

  player.hand.splice(idx, 1);
  st.discard.push(card);
  st.awaitingLead = false;
  st.mustPlay = null;
  st.mustMatch = false;
  st.history.push({ rank: card.rank, suit: card.suit, by: player.name });
  if (st.history.length > 20) st.history.shift();
  addLog(room, `${player.name}: ${cardText(card)}`);

  // Qo'l tugadi — raund yakuni (g'olib)
  if (player.hand.length === 0) {
    // Oxirgi karta 6 / 7 / K qarga bo'lsa — keyingi o'yinchi AVVAL jazo kartalarini oladi,
    // shundan keyin ochkolar sanaladi.
    let add = 0;
    if (card.rank === '6') add = 2;
    else if (card.rank === '7') add = 1;
    else if (card.rank === 'K' && card.suit === 'qarga') add = 4;

    if (add > 0) {
      st.pendingDraw += add;                    // to'planib kelgan jazo ham qo'shiladi
      const total = st.pendingDraw;
      advance(room, 1);                         // keyingi o'yinchi
      const victim = findPlayer(room, currentId(room));
      if (victim && !victim.foldedThisRound) {
        const got = drawN(room, victim, total);
        addLog(room, `${victim.name} ${got} karta oldi (oxirgi ${cardText(card)} jazosi).`);
      }
      st.pendingDraw = 0;
      st.pendingType = null;
    }
    endRound(room, player.id, card);
    return;
  }
  applyEffect(room, card, declaredSuit);
  broadcastState(room);
}

function handleDraw(room, player) {
  const st = room.st;
  if (room.phase !== 'playing') return err(player, 'O\'yin hozir faol emas.');
  if (room.pendingVote) return err(player, 'Ovoz berish tugashini kuting.');
  if (currentId(room) !== player.id) return err(player, 'Sizning navbatingiz emas.');
  if (player.foldedThisRound) return err(player, 'Siz bu raundda taslim bo\'lgansiz.');
  if (st.awaitingLead) return err(player, 'Boshlash uchun karta tashlashingiz kerak.');

  if (st.pendingDraw > 0) {
    const n = st.pendingDraw;
    const got = drawN(room, player, n);
    addLog(room, `${player.name} ${got} karta oldi (jazo).`);
    st.pendingDraw = 0; st.pendingType = null;
    advance(room, 1);
  } else if (st.mustMatch) {
    // 8 dan keyin: MOS KARTA CHIQMAGUNCHA olish shart
    let taken = 0, found = null;
    while (taken < 40) {
      const got = drawN(room, player, 1);
      if (!got) break;                       // tala butunlay tugadi
      taken++;
      const c = player.hand[player.hand.length - 1];
      if (matches(st, c)) { found = c; break; }
    }
    if (found) {
      st.mustPlay = found.id;
      st.mustMatch = false;
      addLog(room, `${player.name} ${taken} karta oldi — mos karta chiqdi, tashlashi kerak.`);
    } else {
      st.mustMatch = false;
      addLog(room, `${player.name} ${taken} karta oldi, mos karta chiqmadi.`);
      advance(room, 1);
    }
  } else {
    const got = drawN(room, player, 1);
    const card = got ? player.hand[player.hand.length - 1] : null;

    if (card && matches(st, card)) {
      // Olingan karta mos keldi — o'yinchi shuni tashlashi SHART, xod o'tmaydi
      st.mustPlay = card.id;
      addLog(room, `${player.name} 1 karta oldi — mos keldi, tashlashi kerak.`);
    } else {
      addLog(room, got ? `${player.name} 1 karta oldi (mos kelmadi).` : `${player.name}: talada karta yo'q.`);
      advance(room, 1);
    }
  }
  broadcastState(room);
}

function handleFold(room, player) {
  if (room.phase !== 'playing') return err(player, 'Hozir taslim bo\'lib bo\'lmaydi.');
  if (room.pendingVote) return err(player, 'Ovoz berish tugashini kuting.');
  if (player.foldedThisRound) return err(player, 'Siz allaqachon taslim bo\'lgansiz.');
  player.foldedThisRound = true;
  if (room.st) room.st.mustPlay = null;
  addLog(room, `${player.name} taslim bo'ldi (sdatsya).`);

  // Faqat bitta o'yinchi qolsa — u g'olib
  const left = inRoundPlayers(room);
  if (left.length === 1) {
    endRound(room, left[0].id, null);
    return;
  }
  // Agar taslim bo'lgan o'yinchi navbatda edi — navbatni suramiz
  if (currentId(room) === player.id) advance(room, 1);
  broadcastState(room);
}

/* ----------------------------------------------------------------------- *
 *  RAUND YAKUNI VA OCHKO
 * ----------------------------------------------------------------------- */
function endRound(room, winnerId, lastCard) {
  const parts = activePlayers(room);
  for (const p of parts) {
    if (p.id === winnerId) {
      const delta = (lastCard && lastCard.rank === 'K' && lastCard.suit === 'qarga') ? -80 : 0;
      p.cumulative += delta;
      p.roundDelta = delta;
    } else {
      const s = handScore(p.hand);
      p.cumulative += s;
      p.roundDelta = s;
    }
  }
  // 108 ga teng bo'lsa 0 ga qaytadi; 108 dan oshsa chiqib ketadi
  for (const p of parts) {
    if (p.cumulative === LOSE_LIMIT) p.cumulative = 0;
    else if (p.cumulative > LOSE_LIMIT) p.eliminated = true;
  }
  room.lastWinnerId = winnerId;
  addLog(room, `Raund yakuni. G'olib: ${nameOf(room, winnerId)}.`);

  const remaining = activePlayers(room);
  if (remaining.length <= 1) {
    room.phase = 'gameover';
    let champ = remaining[0];
    if (!champ) champ = parts.slice().sort((a, b) => a.cumulative - b.cumulative)[0]; // hammasi chiqsa: eng kam ochkoli
    room.champId = champ ? champ.id : null;
    broadcastRoundOrOver(room);
  } else {
    room.phase = 'roundover';
    broadcastRoundOrOver(room);
  }
}

/* ----------------------------------------------------------------------- *
 *  QAYTA BOSHLASH TAKLIFI (OVOZ BERISH)
 * ----------------------------------------------------------------------- */
function handlePropose(room, player, kind) {
  if (kind !== 'restart' && kind !== 'end') return;
  if (room.pendingVote) return err(player, 'Allaqachon ovoz berish bormoqda.');
  if (kind === 'restart' && player.usedRestart) return err(player, 'Qayta boshlash taklifini faqat bir marta yuborasiz.');
  if (kind === 'end' && player.usedEnd) return err(player, 'Yakunlash taklifini faqat bir marta yuborasiz.');
  const voters = room.players.filter(p => p.connected && p.id !== player.id);
  if (voters.length === 0) return err(player, 'Ovoz beruvchi yo\'q.');

  if (kind === 'restart') player.usedRestart = true; else player.usedEnd = true;
  room.pendingVote = { kind, proposerId: player.id, votes: {} };
  addLog(room, kind === 'restart'
    ? `${player.name} o'yinni qaytadan boshlashni taklif qildi.`
    : `${player.name} o'yinni yakunlashni taklif qildi.`);
  broadcastState(room);
  autoBotVotes(room);
}

// Botlar taklifga avtomatik rozi bo'ladi (aks holda ovoz qotib qoladi)
function autoBotVotes(room) {
  if (!room.pendingVote) return;
  const bots = room.players.filter(p => p.isBot && p.id !== room.pendingVote.proposerId);
  for (const b of bots) { if (room.pendingVote) handleVote(room, b, true); }
}

function handleVote(room, player, yes) {
  const v = room.pendingVote;
  if (!v) return;
  if (player.id === v.proposerId) return; // taklif qiluvchi avtomatik "ha"
  v.votes[player.id] = yes ? 'yes' : 'no';

  const voters = room.players.filter(p => p.connected && p.id !== v.proposerId);
  const allVoted = voters.every(p => v.votes[p.id]);
  if (!allVoted) { broadcastState(room); return; }

  const allYes = voters.every(p => v.votes[p.id] === 'yes');
  const kind = v.kind;
  room.pendingVote = null;

  if (!allYes) {
    addLog(room, 'Taklif rad etildi. O\'yin davom etadi.');
    broadcastState(room);
    return;
  }
  if (kind === 'restart') {
    addLog(room, 'Hamma rozi — o\'yin qaytadan boshlanmoqda!');
    restartGame(room);
  } else {
    addLog(room, 'Hamma rozi — o\'yin yakunlandi.');
    finishGame(room);
  }
}

// O'yinni muddatidan oldin yakunlash: eng kam ochkoli o'yinchi g'olib
function finishGame(room) {
  const alive = room.players.filter(p => !p.eliminated);
  const pool = alive.length ? alive : room.players;
  const champ = pool.slice().sort((a, b) => a.cumulative - b.cumulative)[0];
  room.champId = champ ? champ.id : null;
  room.lastWinnerId = room.champId;
  room.players.forEach(p => { p.roundDelta = 0; });
  room.endedEarly = true;
  room.phase = 'gameover';
  broadcastState(room);
}

/* ----------------------------------------------------------------------- *
 *  CHAT (matn / rasm / ovoz)
 * ----------------------------------------------------------------------- */
const CHAT_LIMIT = { text: 400, media: 2.6 * 1024 * 1024 };

function handleChat(room, player, m) {
  const kind = m.kind === 'image' ? 'image' : m.kind === 'voice' ? 'voice' : 'text';
  let payload = String(m.data || '');
  if (!payload) return;

  if (kind === 'text') {
    payload = payload.slice(0, CHAT_LIMIT.text);
  } else {
    if (payload.length > CHAT_LIMIT.media) return err(player, 'Fayl juda katta.');
    const okPrefix = kind === 'image' ? payload.startsWith('data:image/') : payload.startsWith('data:audio/');
    if (!okPrefix) return err(player, 'Fayl turi noto\'g\'ri.');
  }

  const msg = {
    id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6),
    from: player.id,
    name: player.name,
    kind,
    data: payload,
    dur: kind === 'voice' ? Math.min(Number(m.dur) || 0, 120) : 0,
    ts: Date.now(),
  };
  room.chat.push(msg);
  if (room.chat.length > 60) room.chat.shift();
  // Tarixda ko'pi bilan 12 ta media qolsin (rasm/ovoz og'ir bo'ladi)
  const media = room.chat.filter(x => x.kind !== 'text');
  if (media.length > 12) {
    const drop = new Set(media.slice(0, media.length - 12).map(x => x.id));
    room.chat = room.chat.filter(x => !drop.has(x.id));
  }
  for (const p of room.players) send(p, { t: 'chat', msg });
}

/* ----------------------------------------------------------------------- *
 *  AUDIO / VIDEO QO'NG'IROQ — WebRTC signalizatsiya
 *  Server faqat "pochtachi": taklif/javob/ICE ni o'yinchilar orasida uzatadi.
 * ----------------------------------------------------------------------- */
function handleCall(room, player, m) {
  if (m.action === 'join') {
    const mode = m.mode === 'video' ? 'video' : 'audio';
    if (!room.call) room.call = { mode, members: [] };
    if (mode === 'video') room.call.mode = 'video';
    if (!room.call.members.includes(player.id)) room.call.members.push(player.id);
    addLog(room, `${player.name} qo'ng'iroqqa qo'shildi (${room.call.mode === 'video' ? 'video' : 'audio'}).`);
    // Yangi kelganga mavjud a'zolar ro'yxatini beramiz — u ularga taklif yuboradi
    send(player, { t: 'call-peers', peers: room.call.members.filter(id => id !== player.id), mode: room.call.mode });
    broadcastState(room);
    return;
  }
  if (m.action === 'leave') {
    if (!room.call) return;
    room.call.members = room.call.members.filter(id => id !== player.id);
    for (const p of room.players) send(p, { t: 'call-left', id: player.id });
    if (room.call.members.length === 0) room.call = null;
    broadcastState(room);
    return;
  }
}

// WebRTC xabarlarini kerakli o'yinchiga uzatish (offer / answer / ice)
function handleRtc(room, player, m) {
  const target = findPlayer(room, String(m.to || ''));
  if (!target) return;
  send(target, { t: 'rtc', from: player.id, name: player.name, kind: m.kind, data: m.data });
}

function leaveCall(room, player) {
  if (!room.call) return;
  if (!room.call.members.includes(player.id)) return;
  room.call.members = room.call.members.filter(id => id !== player.id);
  for (const p of room.players) send(p, { t: 'call-left', id: player.id });
  if (room.call.members.length === 0) room.call = null;
}

function restartGame(room) {
  room.roundNumber = 0;
  room.lastWinnerId = null;
  room.champId = null;
  room.players.forEach(p => {
    p.cumulative = 0; p.eliminated = false; p.foldedThisRound = false;
    p.usedRestart = false; p.usedEnd = false; p.roundDelta = 0; p.hand = [];
  });
  startRound(room);
  broadcastState(room);
}

/* ----------------------------------------------------------------------- *
 *  HOLATNI YUBORISH (har o'yinchiga moslashtirilgan)
 * ----------------------------------------------------------------------- */
function publicPlayer(room, p) {
  return {
    id: p.id,
    name: p.name,
    count: p.hand ? p.hand.length : 0,
    cumulative: p.cumulative,
    eliminated: p.eliminated,
    folded: p.foldedThisRound,
    connected: p.connected,
    isHost: p.id === room.hostId,
    isBot: !!p.isBot,
    level: p.level || null,
    isCurrent: room.phase === 'playing' && room.st && currentId(room) === p.id,
  };
}

function stateFor(room, me) {
  const st = room.st;
  const base = {
    t: 'state',
    code: room.code,
    phase: room.phase,
    roundNumber: room.roundNumber,
    youId: me.id,
    isHost: me.id === room.hostId,
    players: room.players.map(p => publicPlayer(room, p)),
    log: room.log.slice(),
    limit: LOSE_LIMIT,
    call: room.call ? { mode: room.call.mode, members: room.call.members.map(id => ({ id, name: nameOf(room, id) })) } : null,
    canRestart: !me.usedRestart && !room.pendingVote,
    canEnd: !me.usedEnd && !room.pendingVote,
    pendingVote: room.pendingVote ? {
      kind: room.pendingVote.kind,
      proposerId: room.pendingVote.proposerId,
      proposerName: nameOf(room, room.pendingVote.proposerId),
      youNeedToVote: room.pendingVote.proposerId !== me.id && !room.pendingVote.votes[me.id] && me.connected,
      votes: room.pendingVote.votes,
    } : null,
  };
  if (room.phase === 'playing' && st) {
    base.top = st.discard[st.discard.length - 1] || null;
    base.currentSuit = st.currentSuit;
    base.currentRank = st.currentRank;
    base.pendingDraw = st.pendingDraw;
    base.pendingType = st.pendingType;
    base.drawCount = st.drawPile.length;
    base.awaitingLead = st.awaitingLead;
    base.mustPlay = st.mustPlay;
    base.mustMatch = st.mustMatch;
    base.history = st.history.slice(-12);
    base.currentPlayerId = currentId(room);
    base.yourTurn = currentId(room) === me.id && !me.foldedThisRound;
    base.you = { hand: me.hand || [] };
    base.youFolded = me.foldedThisRound;
    base.legal = base.yourTurn ? legalMoves(st, me.hand) : [];
  }
  if (room.phase === 'roundover' || room.phase === 'gameover') {
    base.endedEarly = room.phase === 'gameover' && room.endedEarly === true;
    base.scores = room.players.map(p => ({
      id: p.id, name: p.name, cumulative: p.cumulative,
      roundDelta: p.roundDelta, eliminated: p.eliminated,
    }));
    base.winnerName = nameOf(room, room.lastWinnerId);
  }
  if (room.phase === 'gameover') base.champName = room.champId ? nameOf(room, room.champId) : '—';
  return base;
}

// Chat tarixi faqat ulanganda bir marta yuboriladi (har xodda emas!)
function sendChatHistory(p, room) { send(p, { t: 'chathist', chat: room.chat.slice() }); }

function send(p, obj) { try { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); } catch (_) {} }
function err(p, msg) { send(p, { t: 'error', msg }); }
function broadcastState(room) { for (const p of room.players) send(p, stateFor(room, p)); }
function broadcastRoundOrOver(room) { broadcastState(room); }
function broadcastLobby(room) {
  for (const p of room.players) {
    send(p, {
      t: 'lobby', code: room.code, youId: p.id, isHost: p.id === room.hostId,
      players: room.players.map(x => ({ id: x.id, name: x.name, isHost: x.id === room.hostId, connected: x.connected, isBot: !!x.isBot, level: x.level || null })),
    });
  }
}

/* ----------------------------------------------------------------------- *
 *  WEBSOCKET ULANISH
 * ----------------------------------------------------------------------- */
wss.on('connection', (ws) => {
  ws.meta = { roomCode: null, playerId: null };

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    try { handleMessage(ws, m); }
    catch (e) { console.error('xabar xatosi:', e.message); try { ws.send(JSON.stringify({ t: 'error', msg: 'Server xatosi — qayta urinib ko\'ring.' })); } catch (_) {} }
  });
  ws.on('error', () => {});

  ws.on('close', () => {
    const { roomCode, playerId } = ws.meta;
    const room = rooms.get(roomCode);
    if (!room) return;
    const p = findPlayer(room, playerId);
    if (p) { p.connected = false; p.ws = null; leaveCall(room, p); }
    // Faqat botlar qolsa (biror odam ulanmagan bo'lsa) — biroz kutib xonani tozalaymiz
    const noHuman = r => !r.players.some(x => !x.isBot && x.connected);
    if (noHuman(room)) {
      setTimeout(() => { const r = rooms.get(roomCode); if (r && noHuman(r)) rooms.delete(roomCode); }, 1000 * 60 * 10);
    } else if (room.phase === 'lobby') {
      broadcastLobby(room);
    } else {
      broadcastState(room);
    }
  });
});

function handleMessage(ws, m) {
  switch (m.t) {
    case 'hello': return onHello(ws, m);
    case 'create': return onCreate(ws, m);
    case 'join': return onJoin(ws, m);
    case 'start': return onStart(ws);
    case 'addbot': return onAddBot(ws, m);
    case 'rembot': return onRemoveBot(ws, m);
    case 'next': return onNext(ws);
    case 'play': return withRoom(ws, (room, p) => handlePlay(room, p, m.cardId, m.suit));
    case 'draw': return withRoom(ws, (room, p) => handleDraw(room, p));
    case 'fold': return withRoom(ws, (room, p) => handleFold(room, p));
    case 'propose': return withRoom(ws, (room, p) => handlePropose(room, p, m.kind));
    case 'chat': return withRoom(ws, (room, p) => handleChat(room, p, m));
    case 'call': return withRoom(ws, (room, p) => handleCall(room, p, m));
    case 'rtc': return withRoom(ws, (room, p) => handleRtc(room, p, m));
    case 'vote': return withRoom(ws, (room, p) => handleVote(room, p, !!m.yes));
    case 'leave': return onLeave(ws);
  }
}

function withRoom(ws, fn) {
  const room = rooms.get(ws.meta.roomCode);
  if (!room) return;
  const p = findPlayer(room, ws.meta.playerId);
  if (!p) return;
  fn(room, p);
}

// Qayta ulanish: tgId bo'yicha o'yinchini topib, ws'ni yangilaymiz
function onHello(ws, m) {
  const id = String(m.tgId || '');
  const code = m.roomCode ? String(m.roomCode) : null;
  if (code && rooms.has(code)) {
    const room = rooms.get(code);
    const p = findPlayer(room, id);
    if (p) {
      p.ws = ws; p.connected = true; if (m.name) p.name = m.name;
      ws.meta = { roomCode: code, playerId: id };
      sendChatHistory(p, room);
      if (room.phase === 'lobby') broadcastLobby(room); else broadcastState(room);
      return;
    }
  }
  send({ ws }, { t: 'ready' }); // yangi o'yinchi — menyuni ko'rsatadi (mijoz o'zi hal qiladi)
  try { ws.send(JSON.stringify({ t: 'ready' })); } catch (_) {}
}

function onCreate(ws, m) {
  const id = String(m.tgId || rndId());
  const name = (m.name || 'O\'yinchi').slice(0, 16);
  const room = createRoom(id);
  const player = newPlayer(id, name, ws);
  room.players.push(player);
  ws.meta = { roomCode: room.code, playerId: id };
  sendChatHistory(player, room);
  broadcastLobby(room);
}

function onJoin(ws, m) {
  const code = String(m.code || '');
  const room = rooms.get(code);
  if (!room) { try { ws.send(JSON.stringify({ t: 'error', msg: 'Bunday xona topilmadi.' })); } catch (_) {} return; }
  if (room.phase !== 'lobby') { try { ws.send(JSON.stringify({ t: 'error', msg: 'O\'yin allaqachon boshlangan.' })); } catch (_) {} return; }
  if (room.players.length >= 6) { try { ws.send(JSON.stringify({ t: 'error', msg: 'Xona to\'la (6 o\'yinchi).' })); } catch (_) {} return; }
  const id = String(m.tgId || rndId());
  const name = (m.name || 'O\'yinchi').slice(0, 16);
  let p = findPlayer(room, id);
  if (p) { p.ws = ws; p.connected = true; p.name = name; }
  else { p = newPlayer(id, name, ws); room.players.push(p); }
  ws.meta = { roomCode: room.code, playerId: id };
  sendChatHistory(p, room);
  broadcastLobby(room);
}

function onAddBot(ws, m) {
  const room = rooms.get(ws.meta.roomCode);
  if (!room) return;
  const host = findPlayer(room, ws.meta.playerId);
  if (ws.meta.playerId !== room.hostId) return err(host, "Faqat xona egasi bot qo'sha oladi.");
  if (room.phase !== 'lobby') return err(host, "Bot faqat o'yin boshlanishidan oldin qo'shiladi.");
  if (room.players.length >= 6) return err(host, "Xona to'la (6 o'yinchi).");
  const bot = newBot(m.level);
  room.players.push(bot);
  addLog(room, `${bot.name} (${LEVEL_LABEL[bot.level]}) qo'shildi.`);
  broadcastLobby(room);
}

function onRemoveBot(ws, m) {
  const room = rooms.get(ws.meta.roomCode);
  if (!room) return;
  const host = findPlayer(room, ws.meta.playerId);
  if (ws.meta.playerId !== room.hostId) return err(host, "Faqat xona egasi botni olib tashlaydi.");
  if (room.phase !== 'lobby') return;
  let idx;
  if (m.id) idx = room.players.findIndex(p => p.id === m.id && p.isBot);
  else { for (let i = room.players.length - 1; i >= 0; i--) if (room.players[i].isBot) { idx = i; break; } }
  if (idx >= 0) { const b = room.players.splice(idx, 1)[0]; addLog(room, `${b.name} olib tashlandi.`); broadcastLobby(room); }
}

function onStart(ws) {
  const room = rooms.get(ws.meta.roomCode);
  if (!room) return;
  if (ws.meta.playerId !== room.hostId) return err(findPlayer(room, ws.meta.playerId), 'Faqat xona egasi boshlaydi.');
  if (room.players.length < 2) return err(findPlayer(room, ws.meta.playerId), 'Kamida 2 o\'yinchi kerak.');
  startRound(room);
  broadcastState(room);
}

function onNext(ws) {
  const room = rooms.get(ws.meta.roomCode);
  if (!room || room.phase !== 'roundover') return;
  if (ws.meta.playerId !== room.hostId) return err(findPlayer(room, ws.meta.playerId), 'Keyingi raundni xona egasi boshlaydi.');
  startRound(room);
  broadcastState(room);
}

function onLeave(ws) {
  const room = rooms.get(ws.meta.roomCode);
  if (!room) return;
  const p = findPlayer(room, ws.meta.playerId);
  if (p) { p.connected = false; p.ws = null; }
  ws.meta = { roomCode: null, playerId: null };
  if (room.phase === 'lobby') broadcastLobby(room); else broadcastState(room);
}

function newPlayer(id, name, ws) {
  return {
    id, name, ws, connected: true,
    hand: [], cumulative: 0, eliminated: false,
    foldedThisRound: false, usedRestart: false, usedEnd: false, roundDelta: 0,
  };
}
function rndId() { return 'g' + Math.random().toString(36).slice(2, 10); }


/* ======================================================================= *
 *  KOMPYUTER (BOT) — 3 daraja: oson / qiyin / professor
 * ======================================================================= */
const BOT_BASE = ['Robot', 'Aqlbek', 'Chaqqon', 'Olim', 'Sardor', 'Doston', 'Kamron', 'Bekzod', 'Temur', 'Jasur'];
const LEVEL_LABEL = { easy: 'oson', hard: 'qiyin', pro: 'professor' };

function newBot(level) {
  const lv = ['easy', 'hard', 'pro'].includes(level) ? level : 'easy';
  const id = 'bot_' + Math.random().toString(36).slice(2, 9);
  const base = BOT_BASE[Math.floor(Math.random() * BOT_BASE.length)];
  return {
    id, name: `${base} 🤖`, ws: null, connected: true,
    hand: [], cumulative: 0, eliminated: false,
    foldedThisRound: false, usedRestart: false, usedEnd: false, roundDelta: 0,
    isBot: true, level: lv,
  };
}

function nextInRoundCount(room) {
  const st = room.st;
  const n = st.order.length;
  let pos = st.pos;
  for (let k = 0; k < n; k++) {
    pos = (pos + 1) % n;
    const p = findPlayer(room, st.order[pos]);
    if (p && !p.foldedThisRound) return p.hand.length;
  }
  return 99;
}

// Q uchun eng ko'p mavjud mastni tanlash
function chooseSuit(bot) {
  const cnt = { qarga: 0, gisht: 0, chirva: 0, xoch: 0 };
  for (const c of bot.hand) if (c.rank !== 'Q') cnt[c.suit]++;
  let best = 'gisht', bv = -1;
  for (const su of SUITS) if (cnt[su] > bv) { bv = cnt[su]; best = su; }
  return best;
}

// Qiyin/professor uchun karta tanlash
function smartPick(room, bot, legal, level) {
  const nextCount = nextInRoundCount(room);
  const handLen = bot.hand.length;
  const hasOther = id => legal.some(c => c.id !== id);
  let best = legal[0], bestScore = -1e9;
  for (const c of legal) {
    let s = VALUE[c.rank] * 1.2; // yuqori ochkoli kartadan qutulish afzal
    const isAttack = c.rank === '6' || c.rank === '7' || c.rank === 'A' || (c.rank === 'K' && c.suit === 'qarga');
    if (nextCount <= 2 && isAttack) s += 18;
    if (nextCount <= 1 && isAttack) s += 12;
    if (c.rank === 'K' && c.suit === 'qarga') s += 10; // K♠ jazosidan qutul
    if (c.rank === 'Q') s += (handLen <= 2 ? 14 : -6);  // Q ni saqla, lekin qo'l kichik bo'lsa tashla
    if (c.rank === '8') s += hasOther(c.id) ? 14 : (level === 'pro' ? -6 : 2);
    if (c.rank === '6' || c.rank === '7') s += 4;
    if (level === 'pro' && handLen <= 2 && (c.rank === 'Q' || (c.rank === 'K' && c.suit === 'qarga'))) s += 20;
    s += Math.random() * 3;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best;
}

function aiChooseCard(room, bot) {
  const st = room.st;
  if (st.mustPlay) return bot.hand.find(x => x.id === st.mustPlay) || null;
  const legal = bot.hand.filter(c => canPlay(st, c));
  if (!legal.length) return null;
  if ((bot.level || 'easy') === 'easy') return legal[Math.floor(Math.random() * legal.length)];
  return smartPick(room, bot, legal, bot.level);
}

// Botning (yoki uzilgan odamning) navbatini bajarish
function autoAct(room, player) {
  if (!room.st || room.phase !== 'playing') return;
  if (currentId(room) !== player.id) return;
  if (player.foldedThisRound) { advance(room, 1); broadcastState(room); return; }
  const card = aiChooseCard(room, player);
  if (card) {
    const suit = card.rank === 'Q' ? chooseSuit(player) : undefined;
    handlePlay(room, player, card.id, suit);
  } else {
    handleDraw(room, player);
  }
}

/* ======================================================================= *
 *  TAKTOMER (TICK) — botlar o'ynaydi, uzilganlar o'rniga o'ynaladi,
 *  raund/ovoz qotib qolmaydi. Butun server uchun bitta interval.
 * ======================================================================= */
const TICK_MS = 1200;
const DISCONNECT_GRACE = 12; // ~14s: uzilgan odam navbatida shuncha kutamiz
const ROUNDOVER_AUTO = 10;   // ~12s: raund yakunida host bosmasa avtomatik
const VOTE_TIMEOUT = 15;     // ~18s: ovoz berish javobsiz qolsa bekor

function hasConnectedHuman(room) {
  return room.players.some(p => !p.isBot && p.connected);
}

function tickRoom(room) {
  // Ovoz berish vaqti
  if (room.pendingVote) {
    room.voteTicks++;
    if (room.voteTicks >= VOTE_TIMEOUT) {
      room.pendingVote = null; room.voteTicks = 0;
      addLog(room, "Ovoz berish javobsiz qoldi — bekor qilindi.");
      broadcastState(room);
    }
    return;
  }
  room.voteTicks = 0;

  // Faqat botlar qolgan bo'lsa — harakat qilmaymiz (xona baribir tozalanadi)
  if (!hasConnectedHuman(room)) return;

  // Raund yakuni — host bot/uzilgan bo'lsa yoki vaqt o'tsa avtomatik davom
  if (room.phase === 'roundover') {
    room.roTicks++;
    const host = findPlayer(room, room.hostId);
    const hostActive = host && host.connected && !host.isBot && !host.eliminated;
    if (!hostActive || room.roTicks >= ROUNDOVER_AUTO) {
      room.roTicks = 0;
      startRound(room);
      broadcastState(room);
    }
    return;
  }
  room.roTicks = 0;

  if (room.phase !== 'playing' || !room.st) return;

  const cur = findPlayer(room, currentId(room));
  if (!cur) return;

  if (cur.isBot) {
    room.stallTicks = 0;
    autoAct(room, cur);
    return;
  }
  // Uzilgan odam navbatida — biroz kutib, avtomatik o'ynaymiz (o'yin qotmasin)
  if (!cur.connected) {
    room.stallTicks++;
    if (room.stallTicks >= DISCONNECT_GRACE) {
      room.stallTicks = 0;
      autoAct(room, cur);
    }
  } else {
    room.stallTicks = 0;
  }
}

setInterval(() => {
  for (const room of rooms.values()) {
    try { tickRoom(room); }
    catch (e) { console.error('tick xatosi [' + room.code + ']:', e.message); }
  }
}, TICK_MS);

// Butun serverni yiqitmaslik uchun — kutilmagan xatolarni ushlaymiz
process.on('uncaughtException', (e) => console.error('uncaughtException:', e && e.message));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e && (e.message || e)));
