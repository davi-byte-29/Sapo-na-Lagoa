'use strict';
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r || 0, w / 2, h / 2); this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
  };
}
/* ============================================================
   SAPO NA LAGOA — HTML + CSS + JS puros
   Controle: ARRASTAR E SOLTAR (estilingue). Puxe para trás e solte:
   o sapo pula para o lado oposto; quanto mais puxar, mais longe vai.
   Online: salas via WebRTC (PeerJS). O anfitrião roda o jogo.
   ============================================================ */

// ---------- Constantes ----------
const W = 362, H = 784;                         // tamanho do campo (mundo)
const COLORS = [
  { n: 'Azul',     c: '#19e3ff' },
  { n: 'Verde',    c: '#7dff3a' },
  { n: 'Amarelo',  c: '#ffd23a' },
  { n: 'Vermelho', c: '#ff4d6d' }
];
const ORDER = [0, 3, 1, 2];                     // 2 jogadores ficam em cantos opostos
const PADS = [[53, 238], [309, 238], [181, 392], [53, 545], [309, 545], [53, 392], [309, 392], [181, 112], [181, 672]];
const START = [0, 1, 3, 4];                     // vitória-régia inicial de cada cor
const MIN_D = 70, MAX_D = 250, JUMP_TIME = 0.42, PAD_R = 42, SINK_TIME = 1.6;
const PULL_MIN = 12, PULL_MAX = 122;            // arrasto (unidades do campo)
const rnd = (a, b) => a + Math.random() * (b - a);
const $ = id => document.getElementById(id);

// ---------- Rede: servidores ICE (STUN/TURN) para jogar entre redes diferentes ----------
const OR = { username: 'openrelayproject', credential: 'openrelayproject' };
const PEER_OPTS = { debug: 0, config: { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }, { urls: 'stun:openrelay.metered.ca:80' },
  { urls: 'turn:openrelay.metered.ca:80', ...OR }, { urls: 'turn:openrelay.metered.ca:443', ...OR },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', ...OR }
] } };

// ---------- Simulação (roda no modo local e no anfitrião) ----------
class Sim {
  constructor(slots, goal) {
    this.slots = slots.slice(); this.goal = goal;
    this.sc = [0, 0, 0, 0]; this.over = -1; this.cd = 3; this.ev = [];
    this.flies = []; this.fid = 1; this.spawnT = 1; this.dragT = rnd(7, 10); this.time = 0;
    this.frogs = [null, null, null, null];
    slots.forEach(s => {
      const p = PADS[START[s]];
      this.frogs[s] = { slot: s, x: p[0], y: p[1], ang: Math.atan2(H / 2 - p[1], W / 2 - p[0]),
        st: 0, t: 0, z: 0, pad: START[s], home: START[s], sx: 0, sy: 0, tx: 0, ty: 0 };
    });
  }
  occupied(i, me) { return this.frogs.some(f => f && f !== me && f.pad === i); }
  aim(slot, ang) {
    const f = this.frogs[slot];
    if (f && f.st === 0 && Number.isFinite(ang)) f.ang = ang;
  }
  input(slot, ang, pw) {
    const f = this.frogs[slot];
    if (!f || f.st !== 0 || this.cd > 0 || this.over >= 0) return;
    if (!Number.isFinite(ang) || !Number.isFinite(pw)) return;
    const dist = MIN_D + Math.min(1, Math.max(0, pw)) * (MAX_D - MIN_D);
    f.ang = ang; f.st = 1; f.t = 0; f.pad = -1; f.sx = f.x; f.sy = f.y;
    f.tx = f.x + Math.cos(ang) * dist; f.ty = f.y + Math.sin(ang) * dist;
    this.ev.push(['jump', slot]);
  }
  removeSlot(s) {
    this.frogs[s] = null; this.slots = this.slots.filter(x => x !== s);
    if (this.slots.length < 2 && this.over < 0) { this.over = this.slots.length ? this.slots[0] : 0; this.ev.push(['win', this.over]); }
  }
  land(f) {
    let best = -1, bd = 52;
    PADS.forEach((p, i) => {
      const d = Math.hypot(p[0] - f.x, p[1] - f.y);
      if (d < bd && !this.occupied(i, f)) { bd = d; best = i; }
    });
    f.z = 0;
    if (best >= 0) { f.x = PADS[best][0]; f.y = PADS[best][1]; f.pad = best; f.st = 0; this.ev.push(['land', f.slot]); }
    else { f.st = 2; f.t = 0; f.pad = -1; this.ev.push(['splash', f.x, f.y]); }
  }
  respawn(f) {
    const free = PADS.map((_, i) => i).filter(i => !this.occupied(i, f));
    if (!free.length) return;
    const i = free.includes(f.home) ? f.home : free[Math.floor(Math.random() * free.length)];
    f.x = PADS[i][0]; f.y = PADS[i][1]; f.pad = i; f.st = 0; f.z = 0;
    f.ang = Math.atan2(H / 2 - f.y, W / 2 - f.x);
    this.ev.push(['splash', f.x, f.y]);
  }
  catchAt(f) {
    for (let i = this.flies.length - 1; i >= 0; i--) {
      const a = this.flies[i]; if (a.mark) continue;
      if (Math.hypot(a.x - f.x, a.y - f.y) < (a.kind ? 42 : 34)) {
        const pts = a.kind ? 3 : 1;
        this.sc[f.slot] += pts; this.flies.splice(i, 1);
        this.ev.push(['catch', a.x, a.y, pts, f.slot]);
        if (this.sc[f.slot] >= this.goal) { this.over = f.slot; this.ev.push(['win', f.slot]); return; }
      }
    }
  }
  update(dt) {
    if (this.over >= 0) return;
    if (this.cd > 0) { this.cd = Math.max(0, this.cd - dt); if (!this.cd) this.ev.push(['go']); return; }
    this.time += dt;
    for (const f of this.frogs) {
      if (!f) continue;
      if (f.st === 1) {
        f.t += dt; const p = Math.min(1, f.t / JUMP_TIME);
        f.x = f.sx + (f.tx - f.sx) * p; f.y = f.sy + (f.ty - f.sy) * p; f.z = Math.sin(Math.PI * p);
        this.catchAt(f); if (this.over >= 0) return;
        if (p >= 1) this.land(f);
      } else if (f.st === 2) { f.t += dt; if (f.t >= SINK_TIME) this.respawn(f); }
    }
    // moscas
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.flies.filter(a => !a.kind).length < 5) {
      this.spawnT = rnd(0.8, 1.5);
      this.flies.push({ id: this.fid++, x: rnd(40, W - 40), y: rnd(90, H - 90), kind: 0, mark: true, t: 0.7, life: 0, va: rnd(0, 6.28) });
    }
    this.dragT -= dt;
    if (this.dragT <= 0) {
      this.dragT = rnd(9, 14);
      const left = Math.random() < 0.5, y = rnd(130, H - 130);
      this.flies.push({ id: this.fid++, x: left ? -35 : W + 35, y, y0: y, kind: left ? 1 : 2, mark: false, vx: left ? 150 : -150, ph: rnd(0, 6) });
    }
    for (let i = this.flies.length - 1; i >= 0; i--) {
      const a = this.flies[i];
      if (a.mark) { a.t -= dt; if (a.t <= 0) { a.mark = false; a.life = rnd(6, 9); } }
      else if (a.kind === 0) {
        a.va += (Math.random() - 0.5) * 7 * dt;
        a.x += Math.cos(a.va) * 22 * dt; a.y += Math.sin(a.va) * 22 * dt;
        if (a.x < 28 || a.x > W - 28 || a.y < 80 || a.y > H - 80) {
          a.va += Math.PI; a.x = Math.min(W - 28, Math.max(28, a.x)); a.y = Math.min(H - 80, Math.max(80, a.y));
        }
        a.life -= dt; if (a.life <= 0) this.flies.splice(i, 1);
      } else {
        a.x += a.vx * dt; a.ph += dt * 3; a.y = a.y0 + Math.sin(a.ph) * 20;
        if (a.x < -60 || a.x > W + 60) this.flies.splice(i, 1);
      }
    }
  }
  snap() {
    const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
    return {
      f: this.frogs.map(f => f && [r1(f.x), r1(f.y), r2(f.ang), f.st, r2(f.z)]),
      fl: this.flies.map(a => [a.id, r1(a.x), r1(a.y), a.kind, a.mark ? 1 : 0]),
      sc: this.sc, cd: Math.round(this.cd * 100) / 100, over: this.over
    };
  }
}

// ---------- Estado global ----------
let state = 'menu';            // menu | lobby | play
let mode = null;               // local | host | client
let sim = null, lastSnap = null;
let gameSlots = [], gameNames = ['', '', '', ''], goalCfg = 10, localN = 2, mySlot = 0, overShown = false;
let rings = [], pops = [], goT = 0, clock = 0;
const view = { f: [null, null, null, null], fl: new Map(), sc: [0, 0, 0, 0], cd: 0, over: -1 };
const net = { peer: null, conns: {}, players: [null, null, null, null], goal: 10, code: '', hostConn: null, pend: [], acc: 0, overSent: false };

// ---------- Som ----------
let ac;
function beep(f, d, type = 'sine', v = 0.07) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(v, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d);
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
  } catch (e) { /* sem áudio */ }
}
function handleEvents(list) {
  for (const e of list || []) {
    if (e[0] === 'jump') beep(300, 0.1, 'triangle');
    else if (e[0] === 'splash') { rings.push({ x: e[1], y: e[2], t: 0 }); beep(110, 0.25, 'sawtooth', 0.05); }
    else if (e[0] === 'catch') { pops.push({ x: e[1], y: e[2], t: 0, txt: '+' + e[3], c: COLORS[e[4]].c }); beep(e[3] > 1 ? 900 : 650, 0.14); }
    else if (e[0] === 'go') { goT = 0.8; beep(520, 0.2, 'square', 0.05); }
    else if (e[0] === 'win') { beep(500, 0.15); setTimeout(() => beep(750, 0.25), 150); }
  }
}

// ---------- Telas ----------
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); }
function setStage(on) { $('stage').hidden = !on; document.body.classList.toggle('playing', on); keepAwake(on); resize(true); }
function toast(t) { $('toast').textContent = t || ''; }
function onMsg(t) { $('onMsg').textContent = t || ''; }
let wl = null;
async function keepAwake(on) {
  try {
    if (on && navigator.wakeLock && !wl) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); }
    else if (!on && wl) { await wl.release(); wl = null; }
  } catch (e) { /* sem suporte */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state === 'play') keepAwake(true); });

function seg(el, cb) {
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    setSeg(el, b.dataset.v); cb(+b.dataset.v);
  });
}
function setSeg(el, v) { el.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.v === String(v))); }

document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { onMsg(''); show(b.dataset.back); }));
$('btnLocal').onclick = () => { toast(''); show('local'); };
$('btnOnline').onclick = () => { toast(''); onMsg(''); show('online'); };
seg($('segN'), v => localN = v);
seg($('segGoal'), v => goalCfg = v);
seg($('segLobbyGoal'), v => { if (mode === 'host') { net.goal = v; broadcastLobby(); } });
$('inCode').addEventListener('input', e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''));
$('inName').value = localStorage.getItem('sapo-nome') || '';
$('btnLocalStart').onclick = () => beginGame(ORDER.slice(0, localN), goalCfg, COLORS.map(c => c.n), 'local');

// ---------- Início / fim de partida ----------
function beginGame(slots, goal, names, m) {
  mode = m; gameSlots = slots; gameNames = names; goalCfg = goal;
  sim = m === 'client' ? null : new Sim(slots, goal);
  view.f = [null, null, null, null]; view.fl.clear(); view.over = -1; view.cd = 3; view.sc = [0, 0, 0, 0];
  rings = []; pops = []; goT = 0; lastSnap = null; overShown = false; net.overSent = false; net.pend = []; net.acc = 0;
  drags.clear(); state = 'play'; show(null); setStage(true);
}
function showOver(w) {
  overShown = true; drags.clear();
  $('overTitle').textContent = COLORS[w].n + ' venceu!';
  $('overTitle').style.color = COLORS[w].c;
  $('overSub').textContent = (gameNames[w] && mode !== 'local' ? gameNames[w] + ' · ' : '') + view.sc[w] + ' pontos';
  const again = $('btnAgain'); again.disabled = false;
  if (mode === 'local') again.textContent = 'Jogar de novo';
  else if (mode === 'host') again.textContent = 'Voltar à sala';
  else { again.textContent = 'Aguardando o anfitrião…'; again.disabled = true; }
  show('over');
}
$('btnAgain').onclick = () => {
  if (mode === 'local') beginGame(gameSlots, goalCfg, gameNames, 'local');
  else if (mode === 'host') { sim = null; state = 'lobby'; setStage(false); broadcastLobby(); }
};
$('btnOverExit').onclick = $('quit').onclick = () => leaveToMenu();
function leaveToMenu(msg) { cleanup(); setStage(false); show('menu'); toast(msg || ''); }
function cleanup() {
  try { if (net.peer) net.peer.destroy(); } catch (e) { /* ok */ }
  net.peer = null; net.conns = {}; net.hostConn = null; net.players = [null, null, null, null]; net.pend = [];
  sim = null; lastSnap = null; mode = null; state = 'menu'; overShown = false; drags.clear();
}

// ---------- Online: criar / entrar ----------
const genCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
const myName = () => {
  const n = $('inName').value.trim().slice(0, 12) || 'Jogador';
  localStorage.setItem('sapo-nome', $('inName').value.trim()); return n;
};
$('btnCreate').onclick = () => {
  if (!window.Peer) return onMsg('Não foi possível carregar o modo online. Verifique sua internet.');
  onMsg('Criando sala…'); tryRoom(myName(), 0);
};
function tryRoom(name, n) {
  if (n > 6) return onMsg('Não foi possível criar a sala. Tente de novo.');
  const code = genCode(), peer = new Peer('sapolagoa-' + code, PEER_OPTS);
  peer.on('open', () => {
    net.peer = peer; net.code = code; net.goal = 10; mode = 'host'; mySlot = 0;
    net.players = [{ name }, null, null, null]; net.conns = {};
    state = 'lobby'; renderLobby(); show('lobby');
  });
  peer.on('connection', onGuest);
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ok */ } });
  peer.on('error', e => {
    if (e.type === 'unavailable-id') { peer.destroy(); tryRoom(name, n + 1); }
    else if (state === 'menu' || !mode) onMsg('Erro de conexão (' + e.type + ').');
  });
}
function onGuest(conn) {
  conn.on('data', m => hostGot(conn, m));
  conn.on('close', () => guestLeft(conn));
}
function hostGot(conn, m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'join') {
    const slot = ORDER.find(s => !net.players[s]);
    if (state !== 'lobby') return refuse(conn, 'Partida em andamento.');
    if (slot === undefined) return refuse(conn, 'Sala cheia.');
    net.players[slot] = { name: String(m.name || 'Jogador').slice(0, 12) };
    conn.slot = slot; net.conns[slot] = conn;
    conn.send({ t: 'welcome', slot }); broadcastLobby();
  } else if (m.t === 'jump' && sim && conn.slot != null) sim.input(conn.slot, +m.a, +m.p);
  else if (m.t === 'aim' && sim && conn.slot != null) sim.aim(conn.slot, +m.a);
}
function refuse(conn, why) { conn.send({ t: 'full', why }); setTimeout(() => conn.close(), 400); }
function guestLeft(conn) {
  const s = conn.slot; if (s == null) return;
  delete net.conns[s]; net.players[s] = null;
  if (sim && state === 'play') sim.removeSlot(s);
  else if (state === 'lobby') broadcastLobby();
}
function sendAll(m) { Object.values(net.conns).forEach(c => { try { c.send(m); } catch (e) { /* ok */ } }); }
function broadcastLobby() {
  sendAll({ t: 'lobby', players: net.players, goal: net.goal, code: net.code });
  state = 'lobby'; renderLobby(); show('lobby');
}
$('btnJoin').onclick = () => {
  if (!window.Peer) return onMsg('Não foi possível carregar o modo online. Verifique sua internet.');
  const code = $('inCode').value.trim();
  if (code.length !== 4) return onMsg('Digite o código de 4 letras.');
  const name = myName(); onMsg('Entrando…');
  const peer = new Peer(undefined, PEER_OPTS); net.peer = peer; let opened = false;
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ok */ } });
  peer.on('open', () => {
    const c = peer.connect('sapolagoa-' + code, { reliable: true }); net.hostConn = c;
    c.on('open', () => { opened = true; c.send({ t: 'join', name }); });
    c.on('data', clientGot);
    c.on('close', () => { if (mode === 'client' || opened) leaveToMenu('A sala foi encerrada.'); });
    setTimeout(() => { if (!opened) { onMsg('Não foi possível conectar à sala. Confira o código e a internet.'); cleanup(); } }, 12000);
  });
  peer.on('error', e => {
    if (!opened) { onMsg(e.type === 'peer-unavailable' ? 'Sala não encontrada.' : 'Erro de conexão (' + e.type + ').'); cleanup(); }
  });
};
function clientGot(m) {
  if (m.t === 'welcome') { mode = 'client'; mySlot = m.slot; }
  else if (m.t === 'full') { onMsg(m.why); cleanup(); }
  else if (m.t === 'lobby') {
    net.players = m.players; net.goal = m.goal; net.code = m.code;
    const wasPlay = state === 'play'; state = 'lobby';
    if (wasPlay) { setStage(false); sim = null; }
    renderLobby(); show('lobby');
  } else if (m.t === 'start') beginGame(m.slots, m.goal, m.names, 'client');
  else if (m.t === 's') { lastSnap = m.s; handleEvents(m.ev); }
}
function renderLobby() {
  $('roomCode').textContent = net.code;
  const ul = $('plist'); ul.innerHTML = '';
  ORDER.forEach(s => {
    const p = net.players[s], li = document.createElement('li'), dot = document.createElement('i'), sp = document.createElement('span');
    dot.style.background = COLORS[s].c; dot.style.color = COLORS[s].c;
    sp.textContent = p ? p.name + (s === 0 ? ' 👑' : '') + (s === mySlot ? ' (você)' : '') : 'Aguardando jogador…';
    if (!p) li.className = 'empty';
    li.append(dot, sp); ul.append(li);
  });
  const host = mode === 'host', count = net.players.filter(Boolean).length;
  setSeg($('segLobbyGoal'), net.goal);
  $('segLobbyGoal').classList.toggle('ro', !host);
  $('btnStart').hidden = !host; $('btnStart').disabled = count < 2;
  $('lobbyHint').textContent = host
    ? (count < 2 ? 'Compartilhe o código — são necessários pelo menos 2 jogadores.' : 'Tudo pronto! Inicie quando quiser.')
    : 'Aguardando o anfitrião iniciar o jogo…';
}
$('btnStart').onclick = () => {
  const slots = ORDER.filter(s => net.players[s]); if (slots.length < 2) return;
  const names = net.players.map(p => p ? p.name : '');
  sendAll({ t: 'start', slots, goal: net.goal, names });
  beginGame(slots, net.goal, names, 'host');
};
$('btnLeave').onclick = () => leaveToMenu();

// ---------- Layout responsivo (campo se ajusta à tela; deitado = campo girado) ----------
const canvas = $('game'), mainCtx = canvas.getContext('2d', { alpha: false });
let ctx = mainCtx;                                  // troca temporariamente ao desenhar nos caches
let dprCap = Math.min(2, devicePixelRatio || 1);     // cai sozinho se o aparelho estiver lento
let L = { cw: 360, ch: 640, dpr: 1, rot: false, s: 1, ox: 0, oy: 0, hud: 44, st: 0, sl: 0, sr: 0 };
let lastSize = '', bgC = null, hudC = null, hudKey = '', sprites = {};
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
function resize(force) {
  const dpr = Math.min(dprCap, devicePixelRatio || 1);
  const cw = canvas.clientWidth || innerWidth, ch = canvas.clientHeight || innerHeight;
  const key = cw + 'x' + ch + '@' + dpr;
  if (!force && key === lastSize) return;
  lastSize = key;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  const cs = getComputedStyle($('safe'));
  const st = parseFloat(cs.paddingTop) || 0, sr = parseFloat(cs.paddingRight) || 0, sb = parseFloat(cs.paddingBottom) || 0, sl = parseFloat(cs.paddingLeft) || 0;
  const hud = Math.max(40, Math.min(54, Math.round(ch * 0.065)));
  const rot = cw > ch, vw = rot ? H : W, vh = rot ? W : H;
  const ax = sl + 6, ay = st + hud, aw = Math.max(50, cw - sl - sr - 12), ah = Math.max(50, ch - st - sb - hud - 6);
  const s = Math.min(aw / vw, ah / vh);
  L = { cw, ch, dpr, rot, s, hud, st, sl, sr, ox: ax + (aw - vw * s) / 2, oy: ay + (ah - vh * s) / 2, ax, ay, aw, ah };
  document.documentElement.style.setProperty('--hud', hud + 'px');
  document.documentElement.style.setProperty('--top', st + 'px');
  buildCaches();
}
let rzT = 0;
const softResize = () => { clearTimeout(rzT); rzT = setTimeout(() => resize(), 90); };
addEventListener('resize', softResize);
addEventListener('orientationchange', () => setTimeout(() => resize(), 250));
if (window.visualViewport) visualViewport.addEventListener('resize', softResize);

// Caches: campo + vitórias-régias, sapos e placar são desenhados uma vez e só copiados a cada quadro
function buildCaches() {
  const q = L.s * L.dpr;
  bgC = L.rot ? mk(H * q, W * q) : mk(W * q, H * q);
  const g = bgC.getContext('2d');
  if (L.rot) g.setTransform(0, bgC.width / H, -bgC.height / W * 1, 0, bgC.width, 0);
  else g.scale(bgC.width / W, bgC.height / H);
  ctx = g; drawFieldStatic();
  sprites = {};
  const sq = q * 1.4;
  COLORS.forEach((col, i) => [0, 1].forEach(j => {
    const c = mk(120 * sq, 120 * sq), sg = c.getContext('2d');
    sg.scale(c.width / 120, c.height / 120); sg.translate(60, 60);
    ctx = sg; drawFrogShape(col, !!j); sprites[i + '_' + j] = c;
  }));
  ctx = mainCtx; hudKey = '';
}
function ensureHud() {
  const key = [L.cw, L.hud, L.st, L.dpr, mode, mySlot, goalCfg, gameSlots.join(), gameNames.join(), view.sc.join()].join('|');
  if (key === hudKey && hudC) return;
  hudKey = key;
  hudC = hudC || document.createElement('canvas');
  hudC.width = Math.round(L.cw * L.dpr); hudC.height = Math.round((L.st + L.hud) * L.dpr);
  const g = hudC.getContext('2d'); g.scale(L.dpr, L.dpr);
  ctx = g; drawHud(); ctx = mainCtx;
}
const toWorld = (px, py) => L.rot ? [(py - L.oy) / L.s, H - (px - L.ox) / L.s] : [(px - L.ox) / L.s, (py - L.oy) / L.s];
const toScreen = (x, y) => L.rot ? [L.ox + (H - y) * L.s, L.oy + x * L.s] : [L.ox + x * L.s, L.oy + y * L.s];

// ---------- Controle: arrastar e soltar ----------
const drags = new Map();       // pointerId -> { slot, x0, y0, x, y }
let lastAimSent = 0;
function dragAim(d) {
  const vx = d.x0 - d.x, vy = d.y0 - d.y, len = Math.hypot(vx, vy);
  if (len < PULL_MIN) return null;
  return { ang: Math.atan2(vy, vx), pw: Math.min(1, (len - PULL_MIN) / (PULL_MAX - PULL_MIN)) };
}
function sendAim(slot, ang) {
  if (mode === 'local' || mode === 'host') sim && sim.aim(slot, ang);
  else if (mode === 'client' && net.hostConn && net.hostConn.open) {
    const t = performance.now(); if (t - lastAimSent < 60) return; lastAimSent = t;
    net.hostConn.send({ t: 'aim', a: ang });
  }
}
function doJump(slot, ang, pw) {
  if (mode === 'local' || mode === 'host') sim && sim.input(slot, ang, pw);
  else if (mode === 'client' && net.hostConn && net.hostConn.open) net.hostConn.send({ t: 'jump', a: ang, p: pw });
}
const wpos = e => toWorld(e.clientX, e.clientY);      // a tela do jogo ocupa a janela inteira
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  e.preventDefault(); if (state !== 'play' || overShown) return;
  const [x, y] = wpos(e), busy = s => [...drags.values()].some(d => d.slot === s);
  let slot = -1;
  if (mode !== 'local') slot = busy(mySlot) ? -1 : mySlot;           // online: puxe em qualquer lugar da tela
  else { let bd = 85; gameSlots.forEach(s => {                         // local: toque no seu sapo
    const f = view.f[s]; if (!f || f.st !== 0 || busy(s)) return;
    const d = Math.hypot(f.x - x, f.y - y); if (d < bd) { bd = d; slot = s; } }); }
  const f = slot >= 0 && view.f[slot]; if (!f || f.st !== 0) return;
  drags.set(e.pointerId, { slot, x0: x, y0: y, x, y });
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
});
canvas.addEventListener('pointermove', e => {
  const d = drags.get(e.pointerId); if (!d) return;
  e.preventDefault(); [d.x, d.y] = wpos(e);
  const a = dragAim(d); if (a) sendAim(d.slot, a.ang);
});
function endDrag(e, fire) {
  const d = drags.get(e.pointerId); if (!d) return;
  drags.delete(e.pointerId);
  if (fire) { const a = dragAim(d); if (a) doJump(d.slot, a.ang, a.pw); }
}
canvas.addEventListener('pointerup', e => endDrag(e, true));
canvas.addEventListener('pointercancel', e => endDrag(e, false));
addEventListener('keydown', e => { if (e.code === 'Escape' && state === 'play') leaveToMenu(); });

// ---------- Suavização do estado (clientes) ----------
function applySnap(s, k) {
  for (let i = 0; i < 4; i++) {
    const a = s.f[i]; if (!a) { view.f[i] = null; continue; }
    const v = view.f[i] || (view.f[i] = { x: a[0], y: a[1], ang: a[2] });
    v.x += (a[0] - v.x) * k; v.y += (a[1] - v.y) * k;
    let da = a[2] - v.ang; da = Math.atan2(Math.sin(da), Math.cos(da)); v.ang += da * k;
    v.st = a[3]; v.z = a[4];
  }
  const seen = new Set();
  for (const a of s.fl) {
    seen.add(a[0]);
    const v = view.fl.get(a[0]) || { x: a[1], y: a[2], id: a[0] };
    v.x += (a[1] - v.x) * k; v.y += (a[2] - v.y) * k; v.kind = a[3]; v.mark = a[4];
    view.fl.set(a[0], v);
  }
  for (const id of [...view.fl.keys()]) if (!seen.has(id)) view.fl.delete(id);
  view.sc = s.sc; view.cd = s.cd; view.over = s.over;
}

// ---------- Desenho (visual neon / tecnológico) ----------
const INK = '#04122b';
const FONT = '"Orbitron","Segoe UI",system-ui,sans-serif';
const glow = (c, b) => { if (ctx !== mainCtx) { ctx.shadowColor = c; ctx.shadowBlur = b; } };   // brilho só nos caches (barato)
const noGlow = () => { ctx.shadowBlur = 0; };
function outline(fill, lw = 4, stroke = INK) {
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
}
function drawPad(x, y, ang) {
  ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, PAD_R, ang + 0.28, ang + Math.PI * 2 - 0.28); ctx.closePath();
  glow('#39ffb0', 16); ctx.fillStyle = 'rgba(8,76,70,.9)'; ctx.fill(); noGlow();
  ctx.lineWidth = 3; ctx.strokeStyle = '#39ffb0'; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, PAD_R - 11, ang + 0.55, ang + Math.PI * 2 - 0.55);
  ctx.strokeStyle = 'rgba(57,255,176,.35)'; ctx.lineWidth = 2; ctx.stroke();
}
function drawFrogShape(col, j) {
  const legs = j ? [[-4, -9, -26, -12], [-4, 9, -26, 12], [8, -9, 25, -15], [8, 9, 25, 15]]
                 : [[-4, -10, -16, -22], [-4, 10, -16, 22], [8, -10, 17, -21], [8, 10, 17, 21]];
  for (const l of legs) {
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); ctx.lineWidth = 10; ctx.strokeStyle = INK; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); ctx.lineWidth = 5; ctx.strokeStyle = col.c; ctx.stroke();
    ctx.beginPath(); ctx.arc(l[2], l[3], 5, 0, 7); outline(col.c, 3);
  }
  glow(col.c, 16); ctx.beginPath(); ctx.ellipse(0, 0, 19, 15, 0, 0, 7); outline(col.c, 3); noGlow();
  ctx.beginPath(); ctx.ellipse(-3, 0, 9, 7, 0, 0, 7); ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fill();
  for (const sd of [-1, 1]) {
    ctx.beginPath(); ctx.arc(11, 8 * sd, 6, 0, 7); outline('#fff', 2.5);
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(13, 8 * sd, 2.8, 0, 7); ctx.fill();
  }
}
function drawFrog(f, i) {
  if (f.st === 2) return;
  const j = f.st === 1, z = f.z || 0, sc = 1 + 0.5 * z;
  if (j) { ctx.fillStyle = 'rgba(0,10,30,.4)'; ctx.beginPath(); ctx.ellipse(f.x + 8 + 10 * z, f.y + 10 + 14 * z, 20, 15, 0, 0, 7); ctx.fill(); }
  ctx.save(); ctx.translate(f.x, f.y - 14 * z); ctx.rotate(f.ang); ctx.scale(sc, sc);
  ctx.drawImage(sprites[i + '_' + (j ? 1 : 0)], -60, -60, 120, 120);
  ctx.restore();
}
function drawDrags() {
  for (const d of drags.values()) {
    const c = COLORS[d.slot].c, f = view.f[d.slot], a = dragAim(d);
    ctx.save(); ctx.lineCap = 'round';
    // elástico do estilingue
    ctx.globalAlpha = 0.55; ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.setLineDash([2, 7]);
    ctx.beginPath(); ctx.moveTo(d.x0, d.y0); ctx.lineTo(d.x, d.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 0.9; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(d.x0, d.y0, 11, 0, 7); ctx.stroke();
    glow(c, 12); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(d.x, d.y, 7, 0, 7); ctx.fill(); noGlow();
    if (a && f) {                                   // trajetória prevista
      const dist = MIN_D + a.pw * (MAX_D - MIN_D);
      ctx.globalAlpha = 0.85; ctx.fillStyle = c;
      for (let r = 40; r < dist - 10; r += 22) { ctx.beginPath(); ctx.arc(f.x + Math.cos(a.ang) * r, f.y + Math.sin(a.ang) * r, 3, 0, 7); ctx.fill(); }
      glow(c, 10); ctx.lineWidth = 2.5; ctx.strokeStyle = c;
      ctx.beginPath(); ctx.arc(f.x + Math.cos(a.ang) * dist, f.y + Math.sin(a.ang) * dist, 10, 0, 7); ctx.stroke(); noGlow();
    }
    ctx.restore();
  }
}
function drawFly(a) {
  if (a.mark) {
    const p = 1 + 0.14 * Math.sin(clock * 9);
    glow('#19e3ff', 12); ctx.beginPath(); ctx.arc(a.x, a.y, 15 * p, 0, 7);
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#19e3ff'; ctx.stroke(); noGlow();
    ctx.strokeStyle = '#e8f6ff'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(a.x - 5, a.y - 5); ctx.lineTo(a.x + 5, a.y + 5); ctx.moveTo(a.x + 5, a.y - 5); ctx.lineTo(a.x - 5, a.y + 5); ctx.stroke();
  } else if (a.kind === 0) {
    const w = 7.5 + Math.sin(clock * 45 + a.id) * 2;
    ctx.fillStyle = 'rgba(210,246,255,.85)';
    ctx.beginPath(); ctx.arc(a.x - 3, a.y - 8, w, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(a.x - 3, a.y + 8, w, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,227,90,.22)'; ctx.beginPath(); ctx.arc(a.x + 4, a.y, 17, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffe35a'; ctx.beginPath(); ctx.arc(a.x + 4, a.y, 9, 0, 7); ctx.fill();
  } else {
    ctx.save(); ctx.translate(a.x, a.y); ctx.scale(a.kind === 1 ? 1 : -1, 1);
    const flap = 0.75 + 0.25 * Math.sin(clock * 40);
    for (const [wx, wy] of [[2, -1], [-10, -1], [2, 1], [-10, 1]]) {
      ctx.beginPath(); ctx.ellipse(wx, wy * 13 * flap, 17, 6, wy * 0.3, 0, 7);
      ctx.fillStyle = 'rgba(220,240,255,.32)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(220,240,255,.9)'; ctx.stroke();
    }
    glow('#b46bff', 14); ctx.strokeStyle = '#b46bff'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(20, 0); ctx.stroke();
    ctx.fillStyle = '#b46bff'; ctx.beginPath(); ctx.arc(24, 0, 7.5, 0, 7); ctx.fill(); noGlow();
    ctx.restore();
  }
}
function drawFieldStatic() {
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, 18);
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#06163a'); g.addColorStop(0.5, '#0a2f6a'); g.addColorStop(1, '#06163a');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.strokeStyle = 'rgba(25,227,255,.09)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x <= W; x += 32) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
  for (let y = 0; y <= H; y += 32) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
  ctx.stroke(); ctx.restore();
  PADS.forEach((p, i) => drawPad(p[0], p[1], i * 2.1 + 0.6));
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, 18); ctx.lineWidth = 2.5; glow('#19e3ff', 14); ctx.strokeStyle = 'rgba(25,227,255,.8)'; ctx.stroke(); noGlow();
}
function drawHud() {
  const n = gameSlots.length, gap = 6, areaW = L.cw - L.sl - L.sr - 16 - 76;
  const cwid = Math.min(150, (areaW - (n - 1) * gap) / n), chh = Math.min(36, L.hud - 10), y = L.st + (L.hud - chh) / 2;
  ctx.textBaseline = 'middle';
  gameSlots.forEach((s, i) => {
    const x = L.sl + 8 + i * (cwid + gap), c = COLORS[s].c, mine = mode !== 'local' && s === mySlot;
    ctx.beginPath(); ctx.roundRect(x, y, cwid, chh, 10); ctx.fillStyle = 'rgba(6,20,50,.92)'; ctx.fill();
    glow(c, mine ? 12 : 6); ctx.lineWidth = mine ? 3 : 1.5; ctx.strokeStyle = c; ctx.stroke(); noGlow();
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + 13, y + chh / 2, 5, 0, 7); ctx.fill();
    ctx.textAlign = 'right';
    ctx.font = '700 10px ' + FONT; ctx.fillStyle = 'rgba(232,246,255,.55)';
    const gtxt = '/' + goalCfg; ctx.fillText(gtxt, x + cwid - 7, y + chh / 2 + 2);
    const gw = ctx.measureText(gtxt).width;
    ctx.font = '900 ' + Math.round(chh * 0.55) + 'px ' + FONT; glow(c, 8); ctx.fillStyle = c;
    ctx.fillText(String(view.sc[s]), x + cwid - 7 - gw - 2, y + chh / 2 + 1); noGlow();
    if (cwid >= 100) {
      ctx.textAlign = 'left'; ctx.font = '700 11px ' + FONT; ctx.fillStyle = '#e8f6ff';
      const nm = (mode === 'local' ? COLORS[s].n : (gameNames[s] || COLORS[s].n)).slice(0, 8);
      ctx.fillText(nm, x + 24, y + chh / 2 + 1);
    }
  });
}
function draw(dt) {
  clock += dt;
  const d = L.dpr;
  ctx.setTransform(d, 0, 0, d, 0, 0); ctx.fillStyle = '#040d22'; ctx.fillRect(0, 0, L.cw, L.ch);
  ctx.drawImage(bgC, L.ox, L.oy, (L.rot ? H : W) * L.s, (L.rot ? W : H) * L.s);   // fundo já na orientação da tela
  // campo (mundo): em tela deitada ele é girado para aproveitar o espaço
  if (L.rot) ctx.setTransform(0, L.s * d, -L.s * d, 0, (L.ox + H * L.s) * d, L.oy * d);
  else ctx.setTransform(L.s * d, 0, 0, L.s * d, L.ox * d, L.oy * d);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.t += dt; if (r.t >= 0.7) { rings.splice(i, 1); continue; }
    ctx.strokeStyle = 'rgba(25,227,255,' + (0.9 * (1 - r.t / 0.7)) + ')'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(r.x, r.y, 10 + r.t * 55, 0, 7); ctx.stroke();
  }
  drawDrags();
  view.f.forEach((f, i) => f && drawFrog(f, i));
  view.fl.forEach(drawFly);
  ctx.restore();
  // textos sempre em pé (espaço da tela)
  ctx.setTransform(d, 0, 0, d, 0, 0); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const me = mode !== 'local' && view.f[mySlot];
  if (me && me.st !== 2) {
    const [sx, sy] = toScreen(me.x, me.y);
    ctx.font = '700 ' + Math.max(9, Math.round(9 * L.s)) + 'px ' + FONT; ctx.fillStyle = COLORS[mySlot].c;
    ctx.fillText('VOCÊ ▼', sx, sy - (40 + (me.z || 0) * 14) * L.s);
  }
  ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.font = '900 ' + Math.max(16, Math.round(24 * L.s)) + 'px ' + FONT;
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]; p.t += dt; if (p.t >= 0.9) { pops.splice(i, 1); continue; }
    const [sx, sy] = toScreen(p.x, p.y); ctx.globalAlpha = 1 - p.t / 0.9;
    ctx.strokeStyle = INK; ctx.strokeText(p.txt, sx, sy - p.t * 40 * L.s);
    ctx.fillStyle = p.c; ctx.fillText(p.txt, sx, sy - p.t * 40 * L.s); ctx.globalAlpha = 1;
  }
  const [cx, cy] = toScreen(W / 2, H / 2);
  const txt = view.cd > 0 ? String(Math.ceil(view.cd)) : (goT > 0 ? 'JÁ!' : '');
  if (txt) {
    goT = Math.max(0, goT - dt);
    ctx.font = '900 ' + Math.round(100 * L.s) + 'px ' + FONT; ctx.lineWidth = Math.max(6, 12 * L.s);
    ctx.strokeStyle = '#0a5a8a'; ctx.strokeText(txt, cx, cy); ctx.fillStyle = '#fff'; ctx.fillText(txt, cx, cy);
    if (view.cd > 0) {
      ctx.font = '700 ' + Math.max(11, Math.round(13 * L.s)) + 'px ' + FONT; ctx.fillStyle = '#e8f6ff';
      ctx.fillText('ARRASTE PARA TRÁS E SOLTE', cx, cy + 80 * L.s);
    }
  }
  ensureHud(); ctx.drawImage(hudC, 0, 0, L.cw, L.st + L.hud);
}

// ---------- Laço principal ----------
let last = 0, slowN = 0, slowSum = 0;
function syncFromSim() {                       // local/anfitrião: copia direto da simulação (sem alocar)
  for (let i = 0; i < 4; i++) {
    const f = sim.frogs[i]; if (!f) { view.f[i] = null; continue; }
    const v = view.f[i] || (view.f[i] = {});
    v.x = f.x; v.y = f.y; v.ang = f.ang; v.st = f.st; v.z = f.z;
  }
  for (const a of sim.flies) {
    let v = view.fl.get(a.id); if (!v) { v = { id: a.id }; view.fl.set(a.id, v); }
    v.x = a.x; v.y = a.y; v.kind = a.kind; v.mark = a.mark ? 1 : 0;
  }
  if (view.fl.size !== sim.flies.length) { const ids = new Set(sim.flies.map(a => a.id)); for (const id of [...view.fl.keys()]) if (!ids.has(id)) view.fl.delete(id); }
  view.sc = sim.sc; view.cd = sim.cd; view.over = sim.over;
}
function sendSnap(m) {
  for (const c of Object.values(net.conns)) {
    try { const dc = c.dataChannel; if (dc && dc.bufferedAmount > 32768) continue; c.send(m); } catch (e) { /* ok */ }
  }
}
function loop(t) {
  const dt = Math.min(0.1, (t - last) / 1000 || 0); last = t;
  if (state === 'play') {
    if (sim) {
      for (let rem = dt; rem > 0; rem -= 1 / 30) sim.update(Math.min(rem, 1 / 30));
      const ev = sim.ev.splice(0); handleEvents(ev);
      if (mode === 'host') {
        net.pend.push(...ev); net.acc += dt;
        if (net.acc >= 1 / 20 || (sim.over >= 0 && !net.overSent)) {
          net.acc = 0; net.overSent = sim.over >= 0;
          sendSnap({ t: 's', s: sim.snap(), ev: net.pend.splice(0) });
        }
      }
      syncFromSim();
    } else if (lastSnap) applySnap(lastSnap, 1 - Math.exp(-dt * 18));
    draw(dt);
    if (view.over >= 0 && !overShown) showOver(view.over);
    // qualidade adaptativa: se estiver lento, reduz a resolução do desenho
    slowSum += dt; if (++slowN >= 45) { if (slowSum / slowN > 0.03 && dprCap > 1) { dprCap = Math.max(1, dprCap - 0.5); resize(true); } slowN = 0; slowSum = 0; }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- Convite por link ----------
const inviteUrl = () => location.href.split(/[?#]/)[0] + '?sala=' + net.code;
$('btnLink').onclick = async () => {
  const b = $('btnLink'), url = inviteUrl(), old = b.textContent;
  try { await navigator.clipboard.writeText(url); b.textContent = '✅ Link copiado!'; setTimeout(() => b.textContent = old, 1800); }
  catch (e) { prompt('Copie o link de convite:', url); }
};
const linkCode = (new URLSearchParams(location.search).get('sala') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
if (linkCode) { $('inCode').value = linkCode; show('online'); onMsg('Digite seu apelido e toque em "Entrar na sala".'); }
