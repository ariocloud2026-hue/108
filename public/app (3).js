/* 108 — mijoz (Telegram Mini App) */
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor('#0a2a30'); tg.setBackgroundColor('#0a2a30'); } catch (_) {} }

const SYM = { qarga: '♠', gisht: '♦', chirva: '♥', xoch: '♣' };
const SUIT_NAME = { qarga: 'qarga', gisht: 'gisht', chirva: 'chirva', xoch: 'xoch' };
const isRed = s => s === 'gisht' || s === 'chirva';

const $ = id => document.getElementById(id);
const show = el => el && el.classList.remove('hidden');
const hide = el => el && el.classList.add('hidden');

/* ---------- Shaxsiy ma'lumot ---------- */
const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null;
let myId = tgUser ? String(tgUser.id) : (localStorage.getItem('g108_id') || ('g' + Math.random().toString(36).slice(2, 10)));
if (!tgUser) localStorage.setItem('g108_id', myId);
let myName = tgUser ? (tgUser.first_name || "O'yinchi") : (localStorage.getItem('g108_name') || '');

// Guruhdagi havoladan kelgan xona kodi:  t.me/bot/play?startapp=1234
const startParam = tg && tg.initDataUnsafe ? tg.initDataUnsafe.start_param : null;
let autoJoinCode = /^\d{4}$/.test(String(startParam || '')) ? String(startParam) : null;

let ws = null, S = null, roomCode = localStorage.getItem('g108_room') || null;
let watchCode = null; // mehmon rejimi uchun xona kodi
let pendingCardId = null;
let botInfo = { username: null, app: 'play' };

fetch('/api/info').then(r => r.json()).then(d => { if (d) botInfo = d; }).catch(() => {});

/* ---------- Ulanish (tez qayta ulanish + yurak urishi) ---------- */
let reconnectDelay = 400, pingTimer = null, pongTimer = null, connecting = false;

function socketDead() { return !ws || ws.readyState > 1; } // 2=closing, 3=closed

function connect() {
  if (connecting) return;
  if (ws && ws.readyState === 0) return; // allaqachon ulanmoqda
  connecting = true;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  try { ws = new WebSocket(`${proto}://${location.host}`); }
  catch (e) { connecting = false; scheduleReconnect(); return; }

  ws.onopen = () => {
    connecting = false;
    reconnectDelay = 400;
    hide($('offline'));
    if (watchCode) { send({ t: 'watch', tgId: myId, name: myName || 'Mehmon', code: watchCode }); }
    else if (autoJoinCode && myName) { send({ t: 'join', tgId: myId, name: myName, code: autoJoinCode }); autoJoinCode = null; }
    else send({ t: 'hello', tgId: myId, name: myName, roomCode });
    startHeartbeat();
  };
  ws.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch (_) {} };
  ws.onerror = () => {};
  ws.onclose = () => { connecting = false; stopHeartbeat(); show($('offline')); scheduleReconnect(); };
}

function scheduleReconnect() {
  setTimeout(() => { connect(); }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.6, 4000);
}

function startHeartbeat() {
  stopHeartbeat();
  pingTimer = setInterval(() => {
    if (socketDead()) { forceReconnect(); return; }
    send({ t: 'ping' });
    clearTimeout(pongTimer);
    pongTimer = setTimeout(() => { forceReconnect(); }, 7000); // javob yo'q → soket o'lik
  }, 18000);
}
function stopHeartbeat() { clearInterval(pingTimer); clearTimeout(pongTimer); pingTimer = pongTimer = null; }

function forceReconnect() {
  stopHeartbeat();
  try { if (ws) ws.close(); } catch (_) {}
  ws = null; connecting = false;
  reconnectDelay = 400;
  connect();
}

// Ilova fonga o'tib qaytganda darhol tekshiramiz (Telegramda eng ko'p shu yerda qotadi)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (socketDead()) forceReconnect();
    else send({ t: 'ping' });
  }
});
window.addEventListener('focus', () => { if (socketDead()) forceReconnect(); });
window.addEventListener('online', () => forceReconnect());
window.addEventListener('pageshow', () => { if (socketDead()) forceReconnect(); });

function send(o) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(o)); } catch (_) {} } }

function onMessage(m) {
  switch (m.t) {
    case 'ready':
      roomCode = null; localStorage.removeItem('g108_room');
      if (autoJoinCode && myName) { send({ t: 'join', tgId: myId, name: myName, code: autoJoinCode }); autoJoinCode = null; }
      else screenMenu();
      break;
    case 'lobby': S = m; roomCode = m.code; localStorage.setItem('g108_room', m.code); renderLobby(m); break;
    case 'state': S = m; roomCode = m.code; localStorage.setItem('g108_room', m.code); renderState(m); break;
    case 'chathist': loadChat(m.chat); break;
    case 'chat': addChat(m.msg); break;
    case 'call-peers': onCallPeers(m); break;
    case 'call-left': onPeerLeft(m.id); break;
    case 'rtc': onRtc(m); break;
    case 'pong': clearTimeout(pongTimer); hide($('offline')); break;
    case 'quit-ok': onQuitOk(m); break;
    case 'error': toast(m.msg); break;
  }
}

/* ---------- Ekranlar ---------- */
function screenMenu() {
  show($('menu')); hide($('lobby')); hide($('table'));
  hide($('resultModal')); hide($('voteModal')); hide($('suitModal')); hide($('fabs'));
  $('nameInput').value = myName;
}
function screenLobby() { hide($('menu')); show($('lobby')); hide($('table')); show($('fabs')); }
function screenTable() { hide($('menu')); hide($('lobby')); show($('table')); show($('fabs')); }

function renderLobby(m) {
  screenLobby();
  $('lobbyCode').textContent = m.code;
  const ul = $('lobbyPlayers'); ul.innerHTML = '';
  m.players.forEach(p => {
    const li = document.createElement('li');
    const lvl = p.isBot ? `<span class="lvltag">${({easy:'oson',hard:'qiyin',pro:'professor'})[p.level] || 'bot'}</span>` : '';
    li.innerHTML = `<span class="dot ${p.connected ? '' : 'off'}"></span><span>${esc(p.name)}</span>` + lvl +
      (p.isHost ? '<span class="tag">xona egasi</span>' : '');
    ul.appendChild(li);
  });
  $('botBox').classList.toggle('hidden', !m.isHost || m.players.length >= 6);
  const canStart = m.isHost && m.players.length >= 2;
  $('startBtn').classList.toggle('hidden', !m.isHost);
  $('startBtn').disabled = !canStart;
  $('lobbyHint').textContent = m.isHost
    ? (canStart ? "Hamma yig'ilgach boshlang." : "Kamida 2 o'yinchi kerak.")
    : 'Xona egasi boshlashini kuting.';
  renderCallState(m);
}

function renderState(m) {
  if (m.phase === 'lobby') { renderLobby(m); return; }
  screenTable();

  // Raqiblar
  const wrap = $('opponents'); wrap.innerHTML = '';
  m.players.filter(p => p.id !== m.youId).forEach(p => {
    const d = document.createElement('div');
    d.className = 'opp' + (p.isCurrent ? ' current' : '') + (p.folded ? ' folded' : '') + (p.eliminated ? ' elim' : '');
    const minis = Array.from({ length: Math.min(p.count, 7) }, () => '<span class="mini"></span>').join('');
    d.innerHTML =
      (p.isHost ? '<span class="hosttag">host</span>' : '') +
      (p.eliminated ? '<span class="obadge">chiqdi</span>' : p.folded ? '<span class="obadge">taslim</span>' : '') +
      `<div class="oname">${esc(p.name)}</div>
       <div class="ocards">${minis || '<span class="mini" style="opacity:.2"></span>'}</div>
       <div class="oscore">${p.cumulative} / ${m.limit}</div>`;
    wrap.appendChild(d);
  });

  // O'rtadagi kartalar
  $('drawCount').textContent = m.drawCount + ' karta';
  $('discardPile').innerHTML = m.top ? cardHTML(m.top) : '<div class="pile-back" style="opacity:.25"></div>';

  const badge = $('suitBadge');
  if (m.mustPlay) badge.textContent = 'Olgan kartangizni tashlang';
  else if (m.pendingDraw > 0) badge.textContent = `Jazo: ${m.pendingDraw} karta`;
  else badge.textContent = `Mast: ${SYM[m.currentSuit] || ''} ${SUIT_NAME[m.currentSuit] || ''}`;

  // Kartalar ketma-ketligi
  const h = $('history'); h.innerHTML = '';
  (m.history || []).forEach((c, i, arr) => {
    const el = document.createElement('div');
    el.className = 'hcard ' + (isRed(c.suit) ? 'red' : 'dark') + (i === arr.length - 1 ? ' last' : '');
    el.title = c.by;
    el.innerHTML = `${c.rank}<small>${SYM[c.suit]}</small>`;
    h.appendChild(el);
  });
  h.scrollLeft = h.scrollWidth;

  // Navbat
  const me = m.players.find(p => p.id === m.youId);
  const cur = m.players.find(p => p.isCurrent);
  const banner = $('turnBanner');
  if (m.youFolded) { banner.textContent = "Siz bu raundda taslim bo'ldingiz"; banner.className = 'turn-banner wait'; }
  else if (m.yourTurn && m.mustPlay) { banner.textContent = '⬇️ Olgan kartangiz mos keldi — uni tashlang'; banner.className = 'turn-banner'; }
  else if (m.yourTurn && m.mustMatch) { banner.textContent = '8 tashladingiz — mos karta chiqmaguncha oling'; banner.className = 'turn-banner'; }
  else if (m.yourTurn) { banner.textContent = 'Sizning navbatingiz'; banner.className = 'turn-banner'; }
  else { banner.textContent = cur ? `${cur.name}${cur.isBot ? ' 🤖 o\'ylayapti…' : " o'ynayapti…"}` : ''; banner.className = 'turn-banner wait'; }

  // Qo'lim
  const specCount = (m.spectators || []).length;
  $('myName').innerHTML = (me ? esc(me.name) : (m.spectator ? '👁 Mehmon' : '')) +
    (specCount ? `<span class="spec-badge">👁 ${specCount}</span>` : '');
  $('myScore').textContent = me ? `${me.cumulative} / ${m.limit}` : '';
  const hand = $('myHand'); hand.innerHTML = '';
  (m.you && m.you.hand ? m.you.hand : []).forEach(c => {
    const playable = m.yourTurn && m.legal.includes(c.id);
    const el = document.createElement('div');
    el.innerHTML = cardHTML(c, playable ? 'playable' : (m.yourTurn ? 'dim' : ''));
    const node = el.firstElementChild;
    if (playable) node.onclick = () => playCard(c);
    hand.appendChild(node);
  });

  // Tugmalar
  $('drawBtn').disabled = !m.yourTurn || !!m.mustPlay;
  $('drawBtn').textContent = m.yourTurn && m.pendingDraw > 0 ? `${m.pendingDraw} karta olish`
    : (m.yourTurn && m.mustMatch ? 'Mos karta chiqquncha olish' : 'Karta olish');
  $('foldBtn').disabled = m.youFolded || m.phase !== 'playing';
  $('restartBtn').disabled = !m.canRestart;
  $('endBtn').disabled = m.spectator;

  // Mehmon rejimi
  const spec = !!m.spectator;
  $('specNote').classList.toggle('hidden', !spec);
  $('myHand').classList.toggle('hidden', spec);
  $('drawBtn').classList.toggle('hidden', spec);
  $('foldBtn').classList.toggle('hidden', spec);
  $('restartBtn').classList.toggle('hidden', spec);
  if (spec) { $('endBtn').textContent = '🚪 Chiqish'; $('endBtn').onclick = () => { watchCode = null; send({ t: 'leave' }); screenMenu(); }; }

  $('log').innerHTML = (m.log || []).map(l => `<div>${esc(l)}</div>`).join('');
  $('log').scrollTop = 999;

  renderCallState(m);
  renderVote(m);
  renderResult(m);
}

function renderVote(m) {
  const v = m.pendingVote;
  if (!v) { hide($('voteModal')); return; }
  show($('voteModal'));
  $('voteText').textContent = v.kind === 'end'
    ? `${v.proposerName} o'yinni YAKUNLASHNI taklif qilyapti`
    : `${v.proposerName} o'yinni QAYTADAN BOSHLASHNI taklif qilyapti`;
  const others = m.players.filter(p => p.id !== v.proposerId);
  const lines = others.map(p => {
    const val = v.votes[p.id];
    return `${esc(p.name)}: ${val === 'yes' ? '✅ rozi' : val === 'no' ? "❌ yo'q" : '… kutilmoqda'}`;
  });
  const note = v.kind === 'end'
    ? "Hamma rozi bo'lsagina o'yin yakunlanadi (eng kam ochkoli g'olib)."
    : "Hamma rozi bo'lsagina o'yin noldan boshlanadi.";
  $('voteStatus').innerHTML = lines.join('<br>') + '<br><small>' + note + '</small>';
  $('voteButtons').classList.toggle('hidden', !v.youNeedToVote);
}

function renderResult(m) {
  if (m.phase !== 'roundover' && m.phase !== 'gameover') { hide($('resultModal')); return; }
  show($('resultModal'));
  const over = m.phase === 'gameover';
  $('resultTitle').textContent = over
    ? (m.endedEarly ? `🏁 O'yin yakunlandi — g'olib: ${m.champName}` : `🏆 G'olib: ${m.champName}`)
    : `${m.roundNumber}-raund tugadi — ${m.winnerName} yutdi`;
  const ul = $('scoreList'); ul.innerHTML = '';
  m.scores.slice().sort((a, b) => a.cumulative - b.cumulative).forEach(s => {
    const li = document.createElement('li');
    if (s.eliminated) li.className = 'elim';
    if (s.name === m.winnerName && !over) li.className = 'win';
    const d = s.roundDelta > 0 ? `+${s.roundDelta}` : (s.roundDelta < 0 ? `${s.roundDelta}` : '0');
    li.innerHTML = `<span class="sname">${esc(s.name)}</span>
      <span class="sdelta">${d}${s.eliminated ? ' · chiqdi' : ''}</span>
      <span class="stotal">${s.cumulative}</span>`;
    ul.appendChild(li);
  });
  $('nextRoundBtn').classList.toggle('hidden', over || !m.isHost);
  $('resultWait').classList.toggle('hidden', over || m.isHost);
  $('backMenuBtn').classList.toggle('hidden', !over);
}

/* ---------- Karta HTML ---------- */
function cardHTML(c, cls = '') {
  const color = isRed(c.suit) ? 'red' : 'dark';
  return `<div class="playcard ${color} ${cls}" data-id="${c.id}">
    <span class="r">${c.rank}</span><span class="c">${SYM[c.suit]}</span><span class="s">${SYM[c.suit]}</span>
  </div>`;
}

/* ---------- O'yin harakatlari ---------- */
function playCard(c) {
  haptic();
  if (c.rank === 'Q') { pendingCardId = c.id; show($('suitModal')); return; }
  send({ t: 'play', cardId: c.id });
}
$('startBtn').onclick = () => { haptic(); send({ t: 'start' }); };
document.querySelectorAll('.addbot').forEach(b => { b.onclick = () => { haptic(); send({ t: 'addbot', level: b.dataset.level }); }; });
$('rembotBtn').onclick = () => { haptic(); send({ t: 'rembot' }); };
$('drawBtn').onclick = () => { haptic(); send({ t: 'draw' }); };
$('drawPile').onclick = () => { if (S && S.yourTurn && !S.mustPlay) { haptic(); send({ t: 'draw' }); } };
$('foldBtn').onclick = () => { if (confirm("Rostdan taslim bo'lasizmi? Qo'lingizdagi kartalar ochko sifatida qo'shiladi.")) send({ t: 'fold' }); };
$('restartBtn').onclick = () => { if (confirm("O'yinni qaytadan boshlashni taklif qilasizmi? (bir marta)")) send({ t: 'propose', kind: 'restart' }); };
$('endBtn').onclick = () => show($('endModal'));
$('endCancel').onclick = () => hide($('endModal'));
$('endVoteBtn').onclick = () => { hide($('endModal')); send({ t: 'propose', kind: 'end' }); };
$('quitSelfBtn').onclick = () => {
  hide($('endModal'));
  if (confirm("O'yindan chiqasizmi? Qo'lingizdagi kartalar ochkoga qo'shiladi va o'yin siz uchun tugaydi. Qolganlar davom etadi.")) send({ t: 'quit' });
};

// Chiqqandan keyingi natija
function onQuitOk(m) {
  hide($('resultModal')); hide($('voteModal'));
  $('quitInfo').textContent = `Yakuniy ochkongiz: ${m.cumulative}. O'rningiz: ${m.place}.`;
  show($('quitModal'));
}
$('quitMenuBtn').onclick = () => {
  hide($('quitModal')); hangUp(); send({ t: 'leave' });
  roomCode = null; watchCode = null; localStorage.removeItem('g108_room'); screenMenu();
};
$('quitWatchBtn').onclick = () => {
  hide($('quitModal'));
  watchCode = roomCode;
  send({ t: 'watch', tgId: myId, name: myName, code: watchCode });
  toast('Endi mehmon sifatida kuzatyapsiz.');
};

// Mehmon sifatida kuzatish (bosh menyudan)
$('watchBtn').onclick = () => {
  const c = ($('codeInput').value || '').trim();
  if (!/^\d{4}$/.test(c)) return toast('Kuzatish uchun 4 xonali xona kodini kiriting.');
  const n = ($('nameInput').value || '').trim() || 'Mehmon';
  myName = n; localStorage.setItem('g108_name', n);
  watchCode = c;
  send({ t: 'watch', tgId: myId, name: n, code: c });
};
$('voteYes').onclick = () => send({ t: 'vote', yes: true });
$('voteNo').onclick = () => send({ t: 'vote', yes: false });
$('nextRoundBtn').onclick = () => send({ t: 'next' });
$('backMenuBtn').onclick = () => { hangUp(); send({ t: 'leave' }); roomCode = null; localStorage.removeItem('g108_room'); screenMenu(); };
$('leaveLobbyBtn').onclick = () => { hangUp(); send({ t: 'leave' }); roomCode = null; localStorage.removeItem('g108_room'); screenMenu(); };
$('suitCancel').onclick = () => { pendingCardId = null; hide($('suitModal')); };
document.querySelectorAll('.suit-choice').forEach(b => {
  b.onclick = () => { if (!pendingCardId) return; send({ t: 'play', cardId: pendingCardId, suit: b.dataset.suit }); pendingCardId = null; hide($('suitModal')); };
});

$('createBtn').onclick = () => {
  const n = ($('nameInput').value || '').trim();
  if (!n) return toast('Ismingizni kiriting.');
  myName = n; localStorage.setItem('g108_name', n);
  send({ t: 'create', tgId: myId, name: n });
};
$('joinBtn').onclick = () => {
  const n = ($('nameInput').value || '').trim();
  const c = ($('codeInput').value || '').trim();
  if (!n) return toast('Ismingizni kiriting.');
  if (!/^\d{4}$/.test(c)) return toast('4 xonali xona kodini kiriting.');
  myName = n; localStorage.setItem('g108_name', n);
  send({ t: 'join', tgId: myId, name: n, code: c });
};
$('copyCodeBtn').onclick = () => {
  const code = $('lobbyCode').textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(code);
  toast('Kod nusxalandi: ' + code);
};

/* ---------- Guruhga / do'stlarga yuborish ---------- */
$('shareBtn').onclick = () => {
  const code = $('lobbyCode').textContent;
  const text = `108 o'ynaymiz! Xona kodi: ${code}`;
  if (botInfo.username) {
    const link = `https://t.me/${botInfo.username}/${botInfo.app || 'play'}?startapp=${code}`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    if (tg && tg.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank');
  } else {
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    toast('Nusxalandi — do\'stlaringizga yuboring.');
  }
};

/* ---------- Qo'llanma ---------- */
[$('rulesBtn1'), $('rulesBtn2'), $('rulesBtn3')].forEach(b => { if (b) b.onclick = () => show($('rulesModal')); });
$('rulesClose').onclick = () => hide($('rulesModal'));

/* ================================================================= *
 *  AUDIO / VIDEO QO'NG'IROQ (WebRTC — to'g'ridan-to'g'ri, mesh)
 * ================================================================= */
const ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
] };
let localStream = null, callMode = null, peers = {}; // id -> RTCPeerConnection

$('callFab').onclick = () => show($('callPanel'));
$('callClose').onclick = () => hide($('callPanel'));
$('callAudioBtn').onclick = () => startCall('audio');
$('callVideoBtn').onclick = () => startCall('video');
$('callLeaveBtn').onclick = () => { hangUp(); hide($('callPanel')); };

async function startCall(mode) {
  if (localStream) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia(
      mode === 'video' ? { audio: true, video: { width: 320, height: 240 } } : { audio: true });
  } catch (e) { return toast('Mikrofon/kameraga ruxsat berilmadi.'); }
  callMode = mode;
  addTile('me', myName + ' (siz)', localStream, true);
  send({ t: 'call', action: 'join', mode });
  $('callJoin').classList.add('hidden');
  $('callActive').classList.remove('hidden');
  $('camBtn').classList.toggle('hidden', mode !== 'video');
  $('callFab').classList.add('live');
  show($('callStrip'));
  hide($('callPanel'));
  toast(mode === 'video' ? 'Video qo\'ng\'iroq boshlandi' : 'Audio qo\'ng\'iroq boshlandi');
}

function hangUp() {
  if (!localStream) return;
  send({ t: 'call', action: 'leave' });
  Object.values(peers).forEach(pc => { try { pc.close(); } catch (_) {} });
  peers = {};
  localStream.getTracks().forEach(t => t.stop());
  localStream = null; callMode = null;
  $('callStrip').innerHTML = '';
  hide($('callStrip'));
  $('callFab').classList.remove('live');
  $('callJoin').classList.remove('hidden');
  $('callActive').classList.add('hidden');
}

function makePeer(id, name) {
  if (peers[id]) return peers[id];
  const pc = new RTCPeerConnection(ICE);
  peers[id] = pc;
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = e => { if (e.candidate) send({ t: 'rtc', to: id, kind: 'ice', data: e.candidate }); };
  pc.ontrack = e => addTile(id, name || 'O\'yinchi', e.streams[0], false);
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) onPeerLeft(id);
  };
  return pc;
}

// Men qo'shildim → mavjud a'zolarga taklif yuboraman
async function onCallPeers(m) {
  for (const id of (m.peers || [])) {
    const pc = makePeer(id, null);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ t: 'rtc', to: id, kind: 'offer', data: offer });
  }
}

async function onRtc(m) {
  if (!localStream) return; // qo'ng'iroqda emasman
  const pc = makePeer(m.from, m.name);
  try {
    if (m.kind === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(m.data));
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      send({ t: 'rtc', to: m.from, kind: 'answer', data: ans });
    } else if (m.kind === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(m.data));
    } else if (m.kind === 'ice') {
      await pc.addIceCandidate(new RTCIceCandidate(m.data));
    }
  } catch (e) { console.error('rtc:', e.message); }
}

function onPeerLeft(id) {
  if (peers[id]) { try { peers[id].close(); } catch (_) {} delete peers[id]; }
  const tile = document.getElementById('tile_' + id);
  if (tile) tile.remove();
}

function addTile(id, name, stream, muted) {
  let tile = document.getElementById('tile_' + id);
  if (!tile) {
    tile = document.createElement('div');
    tile.id = 'tile_' + id;
    tile.className = 'call-tile';
    tile.innerHTML = `<div class="avatar">🎙</div><video autoplay playsinline${muted ? ' muted' : ''}></video><span class="cname">${esc(name)}</span>`;
    $('callStrip').appendChild(tile);
  }
  const v = tile.querySelector('video');
  v.srcObject = stream;
  const hasVideo = stream.getVideoTracks().length > 0;
  tile.querySelector('.avatar').style.display = hasVideo ? 'none' : 'grid';
  v.style.display = hasVideo ? 'block' : 'none';
}

$('muteBtn').onclick = () => {
  if (!localStream) return;
  const tr = localStream.getAudioTracks()[0]; if (!tr) return;
  tr.enabled = !tr.enabled;
  $('muteBtn').classList.toggle('off', !tr.enabled);
  $('muteBtn').textContent = tr.enabled ? '🎙 Mikrofon' : '🔇 O\'chiq';
};
$('camBtn').onclick = () => {
  if (!localStream) return;
  const tr = localStream.getVideoTracks()[0]; if (!tr) return;
  tr.enabled = !tr.enabled;
  $('camBtn').classList.toggle('off', !tr.enabled);
  $('camBtn').textContent = tr.enabled ? '📹 Kamera' : '📵 O\'chiq';
};

function renderCallState(m) {
  const c = m.call;
  const info = $('callInfo');
  if (c && c.members.length) {
    info.textContent = `Qo'ng'iroqda: ${c.members.map(x => x.name).join(', ')}`;
    $('callFab').classList.add('live');
  } else {
    info.textContent = "Birga gaplashib o'ynash uchun qo'shiling.";
    if (!localStream) $('callFab').classList.remove('live');
  }
}

/* ================================================================= *
 *  CHAT — matn, rasm, ovozli xabar
 * ================================================================= */
const seenChat = new Set();
function chatVisible() { return !$('chatPanel').classList.contains('hidden'); }
function openChat() { show($('chatPanel')); hide($('chatDot')); $('chatBody').scrollTop = $('chatBody').scrollHeight; }
function closeChat() { hide($('chatPanel')); }

$('chatFab').onclick = () => chatVisible() ? closeChat() : openChat();
$('chatClose').onclick = closeChat;

function loadChat(list) { if (Array.isArray(list)) list.forEach(msg => addChat(msg, true)); }

function addChat(msg, silent) {
  if (!msg || seenChat.has(msg.id)) return;
  seenChat.add(msg.id);
  const b = document.createElement('div');
  const mine = msg.from === myId;
  b.className = 'bubble' + (mine ? ' me' : '');
  let inner = mine ? '' : `<span class="who">${esc(msg.name)}</span>`;
  if (msg.kind === 'text') inner += esc(msg.data);
  else if (msg.kind === 'image') inner += `<img src="${msg.data}" alt="rasm" />`;
  else if (msg.kind === 'voice') inner += `<audio controls preload="metadata" src="${msg.data}"></audio>`;
  b.innerHTML = inner;
  const img = b.querySelector('img');
  if (img) img.onclick = () => { $('imgBig').src = msg.data; show($('imgModal')); };
  const body = $('chatBody');
  body.appendChild(b);
  body.scrollTop = body.scrollHeight;
  if (!silent && !chatVisible() && !mine) { show($('chatDot')); haptic(); }
}
$('imgModal').onclick = () => hide($('imgModal'));

function sendText() {
  const v = $('chatText').value.trim();
  if (!v) return;
  send({ t: 'chat', kind: 'text', data: v });
  $('chatText').value = '';
}
$('chatSend').onclick = sendText;
$('chatText').addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });

$('imgBtn').onclick = () => $('imgInput').click();
$('imgInput').onchange = e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f || !f.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const im = new Image();
    im.onload = () => {
      const MAX = 900;
      let w = im.width, h = im.height;
      if (w > MAX || h > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(im, 0, 0, w, h);
      const data = cv.toDataURL('image/jpeg', 0.72);
      if (data.length > 2.4 * 1024 * 1024) return toast('Rasm juda katta.');
      send({ t: 'chat', kind: 'image', data });
      if (!chatVisible()) openChat();
    };
    im.src = reader.result;
  };
  reader.readAsDataURL(f);
};

let rec = null, recChunks = [], recTimer = null, recStart = 0;
$('micBtn').onclick = async () => {
  if (rec) return;
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast("Qurilma ovoz yozishni qo'llamaydi.");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(m => MediaRecorder.isTypeSupported(m)) || '';
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recChunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(recTimer);
      hide($('recBar'));
      $('micBtn').classList.remove('rec');
      const cancelled = rec && rec._cancelled;
      const dur = Math.round((Date.now() - recStart) / 1000);
      rec = null;
      if (cancelled || !recChunks.length) return;
      const blob = new Blob(recChunks, { type: recChunks[0].type || 'audio/webm' });
      if (blob.size > 1.8 * 1024 * 1024) return toast('Ovoz juda uzun.');
      const fr = new FileReader();
      fr.onload = () => { send({ t: 'chat', kind: 'voice', data: fr.result, dur }); if (!chatVisible()) openChat(); };
      fr.readAsDataURL(blob);
    };
    rec.start();
    recStart = Date.now();
    $('micBtn').classList.add('rec');
    show($('recBar'));
    if (!chatVisible()) openChat();
    recTimer = setInterval(() => {
      const s = Math.round((Date.now() - recStart) / 1000);
      $('recTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      if (s >= 60) $('recStop').click();
    }, 250);
  } catch (err) { toast('Mikrofonga ruxsat berilmadi.'); }
};
$('recStop').onclick = () => { if (rec && rec.state !== 'inactive') { rec._cancelled = false; rec.stop(); } };
$('recCancel').onclick = () => { if (rec && rec.state !== 'inactive') { rec._cancelled = true; rec.stop(); } };

/* ---------- Yordamchi ---------- */
function toast(msg) {
  const t = $('toast'); t.textContent = msg; show(t);
  clearTimeout(t._h); t._h = setTimeout(() => hide(t), 2600);
}
function haptic() { try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred('light'); } catch (_) {} }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ---------- Ishga tushirish ---------- */
if (autoJoinCode && !myName) { myName = "O'yinchi"; }
screenMenu();
if (autoJoinCode) $('codeInput').value = autoJoinCode;
connect();
