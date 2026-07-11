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
    case 'lobby': S = m; roomCode = m.code; localStorage.setItem('g108_room', m.code); renderLobby(m); break;
    case 'state': S = m; roomCode = m.code; localStorage.setItem('g108_room', m.code); renderState(m); break;
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
  $('proposeBtn').disabled = !m.canPropose;

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
  $('voteText').textContent = `${v.proposerName} o'yinni qaytadan boshlashni taklif qilyapti`;
  const others = m.players.filter(p => p.id !== v.proposerId);
  const lines = others.map(p => {
    const val = v.votes[p.id];
    return `${esc(p.name)}: ${val === 'yes' ? '✅ rozi' : val === 'no' ? '❌ yo\'q' : '… kutilmoqda'}`;
  });
  $('voteStatus').innerHTML = lines.join('<br>') + '<br><small>Hamma rozi bo\'lsagina qaytadan boshlanadi.</small>';
  $('voteButtons').classList.toggle('hidden', !v.youNeedToVote);
}

function renderResult(m) {
  if (m.phase !== 'roundover' && m.phase !== 'gameover') { hide($('resultModal')); return; }
  show($('resultModal'));
  const over = m.phase === 'gameover';
  $('resultTitle').textContent = over
    ? `🏆 G'olib: ${m.champName}`
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
$('drawBtn').onclick = () => { haptic(); send({ t: 'draw' }); };
$('foldBtn').onclick = () => { if (confirm('Rostdan taslim bo\'lasizmi? Qo\'lingizdagi kartalar ochko sifatida qo\'shiladi.')) send({ t: 'fold' }); };
$('proposeBtn').onclick = () => { if (confirm('O\'yinni qaytadan boshlashni taklif qilasizmi? (bir marta)')) send({ t: 'propose' }); };
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

/* ---------- Ishga tushirish ---------- */
screenMenu();
connect();
