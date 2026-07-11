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

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('108 server ishga tushdi: port ' + PORT));

/* ----------------------------------------------------------------------- *
 *  O'YIN KONSTANTALARI
 * ----------------------------------------------------------------------- */
const SUITS = ['qarga', 'gisht', 'chirva', 'xoch']; // ♠ ♦ ♥ ♣
const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const HAND_SIZE = 4;
const LOSE_LIMIT = 108;

// Sanoqdagi oddiy qiymat
const VALUE = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 2, 'Q': 3, 'K': 4, 'A': 11 };

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
    pendingVote: null,       // {proposerId, votes:{id:'yes'|'no'}}
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
    order: parts.map(p => p.id),
    pos: 0,
    awaitingLead: false,
  };

  if (room.roundNumber === 1) {
    // 1-raund: o'rtaga karta ochiladi (maxsus bo'lmaganini tanlaymiz), random o'yinchi boshlaydi
    let start = deck.pop();
    const skipped = [];
    while (start && isSpecialStart(start) && deck.length) { skipped.push(start); start = deck.pop(); }
    deck.unshift(...skipped);
    st.discard.push(start);
    st.currentSuit = start.suit;
    st.currentRank = start.rank;
    st.pos = Math.floor(Math.random() * st.order.length);
    addLog(room, `1-raund boshlandi. O'rtada: ${cardText(start)}. Boshlaydi: ${nameOf(room, st.order[st.pos])}`);
  } else {
    // 2+ raund: o'rtaga karta ochilmaydi. Ochkosi eng baland o'yinchi xohlagan kartasidan boshlaydi
    let starterId = parts[0].id, best = -Infinity;
    for (const p of parts) if (p.cumulative > best) { best = p.cumulative; starterId = p.id; }
    st.pos = st.order.indexOf(starterId);
    st.awaitingLead = true; // boshlovchi istalgan kartani tashlaydi
    addLog(room, `${room.roundNumber}-raund. Ochkosi baland ${nameOf(room, starterId)} istalgan karta bilan boshlaydi.`);
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

// Ushbu karta hozir tashlansa bo'ladimi?
function canPlay(st, card) {
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
    case '8': /* qo'shimcha xod: navbat o'zida qoladi */ break;
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
  addLog(room, `${player.name}: ${cardText(card)}`);

  // Qo'l tugadi — raund yakuni (g'olib)
  if (player.hand.length === 0) {
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
  } else {
    const got = drawN(room, player, 1);
    addLog(room, got ? `${player.name} 1 karta oldi.` : `${player.name}: talada karta yo'q.`);
    advance(room, 1);
  }
  broadcastState(room);
}

function handleFold(room, player) {
  if (room.phase !== 'playing') return err(player, 'Hozir taslim bo\'lib bo\'lmaydi.');
  if (room.pendingVote) return err(player, 'Ovoz berish tugashini kuting.');
  if (player.foldedThisRound) return err(player, 'Siz allaqachon taslim bo\'lgansiz.');
  player.foldedThisRound = true;
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
function handlePropose(room, player) {
  if (room.pendingVote) return err(player, 'Allaqachon ovoz berish bormoqda.');
  if (player.usedProposal) return err(player, 'Taklifni faqat bir marta yuborasiz.');
  const voters = room.players.filter(p => p.connected && p.id !== player.id);
  if (voters.length === 0) return err(player, 'Ovoz beruvchi yo\'q.');
  player.usedProposal = true;
  room.pendingVote = { proposerId: player.id, votes: {} };
  addLog(room, `${player.name} o'yinni qaytadan boshlashni taklif qildi.`);
  broadcastState(room);
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
  room.pendingVote = null;
  if (allYes) {
    addLog(room, 'Hamma rozi — o\'yin qaytadan boshlanmoqda!');
    restartGame(room);
  } else {
    addLog(room, 'Taklif rad etildi. O\'yin davom etadi.');
    broadcastState(room);
  }
}

function restartGame(room) {
  room.roundNumber = 0;
  room.lastWinnerId = null;
  room.champId = null;
  room.players.forEach(p => {
    p.cumulative = 0; p.eliminated = false; p.foldedThisRound = false;
    p.usedProposal = false; p.roundDelta = 0; p.hand = [];
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
    canPropose: !me.usedProposal && !room.pendingVote,
    pendingVote: room.pendingVote ? {
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
    base.currentPlayerId = currentId(room);
    base.yourTurn = currentId(room) === me.id && !me.foldedThisRound;
    base.you = { hand: me.hand || [] };
    base.youFolded = me.foldedThisRound;
    base.legal = base.yourTurn ? legalMoves(st, me.hand) : [];
  }
  if (room.phase === 'roundover' || room.phase === 'gameover') {
    base.scores = room.players.map(p => ({
      id: p.id, name: p.name, cumulative: p.cumulative,
      roundDelta: p.roundDelta, eliminated: p.eliminated,
    }));
    base.winnerName = nameOf(room, room.lastWinnerId);
  }
  if (room.phase === 'gameover') base.champName = room.champId ? nameOf(room, room.champId) : '—';
  return base;
}

function send(p, obj) { try { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); } catch (_) {} }
function err(p, msg) { send(p, { t: 'error', msg }); }
function broadcastState(room) { for (const p of room.players) send(p, stateFor(room, p)); }
function broadcastRoundOrOver(room) { broadcastState(room); }
function broadcastLobby(room) {
  for (const p of room.players) {
    send(p, {
      t: 'lobby', code: room.code, youId: p.id, isHost: p.id === room.hostId,
      players: room.players.map(x => ({ id: x.id, name: x.name, isHost: x.id === room.hostId, connected: x.connected })),
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
    handleMessage(ws, m);
  });

  ws.on('close', () => {
    const { roomCode, playerId } = ws.meta;
    const room = rooms.get(roomCode);
    if (!room) return;
    const p = findPlayer(room, playerId);
    if (p) { p.connected = false; p.ws = null; }
    // agar hech kim ulanmagan bo'lsa — biroz kutib xonani tozalaymiz
    if (room.players.every(x => !x.connected)) {
      setTimeout(() => {
        const r = rooms.get(roomCode);
        if (r && r.players.every(x => !x.connected)) rooms.delete(roomCode);
      }, 1000 * 60 * 10);
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
    case 'next': return onNext(ws);
    case 'play': return withRoom(ws, (room, p) => handlePlay(room, p, m.cardId, m.suit));
    case 'draw': return withRoom(ws, (room, p) => handleDraw(room, p));
    case 'fold': return withRoom(ws, (room, p) => handleFold(room, p));
    case 'propose': return withRoom(ws, (room, p) => handlePropose(room, p));
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
  broadcastLobby(room);
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
    foldedThisRound: false, usedProposal: false, roundDelta: 0,
  };
}
function rndId() { return 'g' + Math.random().toString(36).slice(2, 10); }
