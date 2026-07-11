/* 108 — mijoz (Telegram Mini App) */
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor('#0a2a30'); tg.setBackgroundColor('#0a2a30'); } catch (_) {} }

const SYM = { qarga: '♠', gisht: '♦', chirva: '♥', xoch: '♣' };
const SUIT_NAME = { qarga: 'qarga', gisht: 'gisht', chirva: 'chirva', xoch: 'xoch' };
const isRed = s => s === 'gisht' || s === 'chirva';

const $ = id => document.getElementById(id);
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');

/* ---------- Shaxsiy ma'lumot ---------- */
const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null;
let myId = tgUser ? String(tgUser.id) : (localStorage.getItem('g108_id') || ('g' + Math.random().toString(36).slice(2, 10)));
if (!tgUser) localStorage.setItem('g108_id', myId);
let myName = tgUser ? (tgUser.first_name || 'O\'yinchi') : (localStorage.getItem('g108_name') || '');

let ws = null, S = null, roomCode = localStorage.getItem('g108_room') || null;
let pendingCardId = null; // Q uchun mast tanlanayotgan karta

/* ---------- Ulanish ---------- */
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => send({ t: 'hello', tgId: myId, name: myName, roomCode });
  ws.onmessage = e => onMessage(JSON.parse(e.data));
  ws.onclose = () => { toast('Aloqa uzildi — qayta ulanmoqda…'); setTimeout(connect, 1500); };
}
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

function onMessage(m) {
  switch (m.t) {
    case 'ready': roomCode = null; localStorage.removeItem('g108_room'); screenMenu(); break;
    case 'lobby': S = m; roomCode = m.code; localStorage.setItem('g108_room', m.code); loadChat(m.chat); renderLobby(m); break;
    case 'state': S = m; roomCode = m.code; localStorage.setItem('g108_room', m.code); loadChat(m.chat); renderState(m); break;
    case 'chat': addChat(m.msg); break;
    case 'error': toast(m.msg); break;
  }
}

/* ---------- Ekranlar ---------- */
function screenMenu() {
  show($('menu')); hide($('lobby')); hide($('table'));
  hide($('resultModal')); hide($('voteModal')); hide($('suitModal'));
  $('nameInput').value = myName;
}
function screenLobby() { hide($('menu')); show($('lobby')); hide($('table')); }
function screenTable() { hide($('menu')); hide($('lobby')); show($('table')); }

function renderLobby(m) {
  screenLobby();
  $('lobbyCode').textContent = m.code;
  const ul = $('lobbyPlayers'); ul.innerHTML = '';
  m.players.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot ${p.connected ? '' : 'off'}"></span><span>${esc(p.name)}</span>` +
      (p.isHost ? '<span class="tag">xona egasi</span>' : '');
    ul.appendChild(li);
  });
  const canStart = m.isHost && m.players.length >= 2;
  $('startBtn').classList.toggle('hidden', !m.isHost);
  $('startBtn').disabled = !canStart;
  $('lobbyHint').textContent = m.isHost
    ? (canStart ? 'Hamma yig\'ilgach boshlang.' : 'Kamida 2 o\'yinchi kerak.')
    : 'Xona egasi boshlashini kuting.';
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
  const dp = $('discardPile');
  dp.innerHTML = m.top ? cardHTML(m.top) : '<div class="pile-back" style="opacity:.25"></div>';

  const badge = $('suitBadge');
  if (m.awaitingLead) {
    badge.textContent = 'Istalgan kartadan boshlang';
  } else if (m.pendingDraw > 0) {
    badge.textContent = `Jazo: ${m.pendingDraw} karta`;
  } else {
    badge.textContent = `Mast: ${SYM[m.currentSuit] || ''} ${SUIT_NAME[m.currentSuit] || ''}`;
  }

  // Navbat
  const me = m.players.find(p => p.id === m.youId);
  const cur = m.players.find(p => p.isCurrent);
  const banner = $('turnBanner');
  if (m.youFolded) { banner.textContent = 'Siz bu raundda taslim bo\'ldingiz'; banner.className = 'turn-banner wait'; }
  else if (m.yourTurn) { banner.textContent = 'Sizning navbatingiz'; banner.className = 'turn-banner'; }
  else { banner.textContent = cur ? `${cur.name} o'ynayapti…` : ''; banner.className = 'turn-banner wait'; }

  // O'z qo'lim
  $('myName').textContent = me ? me.name : '';
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
  $('drawBtn').disabled = !m.yourTurn || m.awaitingLead;
  $('drawBtn').textContent = m.pendingDraw > 0 && m.yourTurn ? `${m.pendingDraw} karta olish` : 'Karta olish';
  $('foldBtn').disabled = m.youFolded || m.phase !== 'playing';
  $('restartBtn').disabled = !m.canRestart;
  $('endBtn').disabled = !m.canEnd;

  // Jurnal
  $('log').innerHTML = (m.log || []).map(l => `<div>${esc(l)}</div>`).join('');
  $('log').scrollTop = 999;

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
    return `${esc(p.name)}: ${val === 'yes' ? '✅ rozi' : val === 'no' ? '❌ yo\'q' : '… kutilmoqda'}`;
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

/* ---------- Harakatlar ---------- */
function playCard(c) {
  haptic();
  if (c.rank === 'Q') { pendingCardId = c.id; show($('suitModal')); return; }
  send({ t: 'play', cardId: c.id });
}
$('startBtn').onclick = () => { haptic(); send({ t: 'start' }); };
$('drawBtn').onclick = () => { haptic(); send({ t: 'draw' }); };
$('foldBtn').onclick = () => { if (confirm('Rostdan taslim bo\'lasizmi? Qo\'lingizdagi kartalar ochko sifatida qo\'shiladi.')) send({ t: 'fold' }); };
$('restartBtn').onclick = () => { if (confirm('O\'yinni qaytadan boshlashni taklif qilasizmi? Hamma rozi bo\'lsa ochkolar nolga qaytadi. (bir marta)')) send({ t: 'propose', kind: 'restart' }); };
$('endBtn').onclick = () => { if (confirm('O\'yinni yakunlashni taklif qilasizmi? Hamma rozi bo\'lsa o\'yin tugaydi, eng kam ochkoli g\'olib bo\'ladi. (bir marta)')) send({ t: 'propose', kind: 'end' }); };
$('voteYes').onclick = () => send({ t: 'vote', yes: true });
$('voteNo').onclick = () => send({ t: 'vote', yes: false });
$('nextRoundBtn').onclick = () => send({ t: 'next' });
$('backMenuBtn').onclick = () => { send({ t: 'leave' }); roomCode = null; localStorage.removeItem('g108_room'); screenMenu(); };
$('leaveLobbyBtn').onclick = () => { send({ t: 'leave' }); roomCode = null; localStorage.removeItem('g108_room'); screenMenu(); };
$('suitCancel').onclick = () => { pendingCardId = null; hide($('suitModal')); };
document.querySelectorAll('.suit-choice').forEach(b => {
  b.onclick = () => { if (!pendingCardId) return; send({ t: 'play', cardId: pendingCardId, suit: b.dataset.suit }); pendingCardId = null; hide($('suitModal')); };
});
$('drawPile').onclick = () => { if (S && S.yourTurn && !S.awaitingLead) { haptic(); send({ t: 'draw' }); } };

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
  navigator.clipboard && navigator.clipboard.writeText(code);
  toast('Kod nusxalandi: ' + code);
};

/* ---------- Yordamchi ---------- */
function toast(msg) {
  const t = $('toast'); t.textContent = msg; show(t);
  clearTimeout(t._h); t._h = setTimeout(() => hide(t), 2600);
}
function haptic() { try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred('light'); } catch (_) {} }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ---------------------------------------------------------------- *
 *  CHAT — matn, rasm, ovozli xabar
 * ---------------------------------------------------------------- */
const seenChat = new Set();
let chatOpen = false;

function chatVisible() { return !$('chatPanel').classList.contains('hidden'); }

function openChat() {
  show($('chatPanel')); hide($('chatDot')); chatOpen = true;
  $('chatBody').scrollTop = $('chatBody').scrollHeight;
}
function closeChat() { hide($('chatPanel')); chatOpen = false; }

$('chatFab').onclick = () => chatVisible() ? closeChat() : openChat();
$('chatClose').onclick = closeChat;
$('lobbyChatBtn').onclick = openChat;

function loadChat(list) {
  show($('chatFab'));
  if (!Array.isArray(list)) return;
  list.forEach(msg => addChat(msg, true));
}

function addChat(msg, silent) {
  if (!msg || seenChat.has(msg.id)) return;
  seenChat.add(msg.id);

  const b = document.createElement('div');
  const mine = msg.from === myId;
  b.className = 'bubble' + (mine ? ' me' : '');

  let inner = mine ? '' : `<span class="who">${esc(msg.name)}</span>`;
  if (msg.kind === 'text') {
    inner += esc(msg.data);
  } else if (msg.kind === 'image') {
    inner += `<img src="${msg.data}" alt="rasm" />`;
  } else if (msg.kind === 'voice') {
    inner += `<audio controls preload="metadata" src="${msg.data}"></audio>`;
  }
  b.innerHTML = inner;

  const img = b.querySelector('img');
  if (img) img.onclick = () => { $('imgBig').src = msg.data; show($('imgModal')); };

  const body = $('chatBody');
  body.appendChild(b);
  body.scrollTop = body.scrollHeight;

  if (!silent && !chatVisible() && !mine) { show($('chatDot')); haptic(); }
}

$('imgModal').onclick = () => hide($('imgModal'));

/* --- Matn yuborish --- */
function sendText() {
  const v = $('chatText').value.trim();
  if (!v) return;
  send({ t: 'chat', kind: 'text', data: v });
  $('chatText').value = '';
}
$('chatSend').onclick = sendText;
$('chatText').addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });

/* --- Rasm yuborish (kichraytirib) --- */
$('imgBtn').onclick = () => $('imgInput').click();
$('imgInput').onchange = e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (!f.type.startsWith('image/')) return toast('Bu rasm emas.');
  const reader = new FileReader();
  reader.onload = () => {
    const im = new Image();
    im.onload = () => {
      const MAX = 900;
      let { width: w, height: h } = im;
      if (w > MAX || h > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(im, 0, 0, w, h);
      const data = cv.toDataURL('image/jpeg', 0.72);
      if (data.length > 2.4 * 1024 * 1024) return toast('Rasm juda katta.');
      send({ t: 'chat', kind: 'image', data });
      if (!chatVisible()) openChat();
    };
    im.onerror = () => toast('Rasmni o\'qib bo\'lmadi.');
    im.src = reader.result;
  };
  reader.readAsDataURL(f);
};

/* --- Ovozli xabar --- */
let rec = null, recChunks = [], recTimer = null, recStart = 0;

$('micBtn').onclick = async () => {
  if (rec) return;
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast('Qurilma ovoz yozishni qo\'llamaydi.');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
      .find(m => MediaRecorder.isTypeSupported(m)) || '';
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
      if (s >= 60) $('recStop').click(); // maksimum 60 soniya
    }, 250);
  } catch (err) {
    toast('Mikrofonga ruxsat berilmadi.');
  }
};
$('recStop').onclick = () => { if (rec && rec.state !== 'inactive') { rec._cancelled = false; rec.stop(); } };
$('recCancel').onclick = () => { if (rec && rec.state !== 'inactive') { rec._cancelled = true; rec.stop(); } };

/* ---------- Ishga tushirish ---------- */
screenMenu();
connect();
