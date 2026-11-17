// Signal Master: Crossing Keeper — an original crossing-operator game.
// You run one busy level crossing: two railway tracks cross one road.
// Lower the gates before each train arrives, work the two track signals
// (green = go, yellow = slow, red = stop) to buy time when a car is caught
// on the crossing, and reach 1,200 points before your 120-second shift ends.
// Static files only: no network, no libraries. Canvas + WebAudio.

const W = 960, H = 540;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const ROAD = { x0: 596, x1: 692, cx: 644 };
const TRACK_A = { railY: 246, top: 192, dir: 1, signalX: 548, name: 'A' };  // left -> right
const TRACK_B = { railY: 356, top: 302, dir: -1, signalX: 716, name: 'B' }; // right -> left
const ZONE = { y0: 176, y1: 392 }; // crossing zone on the road
const TARGET = 1200, SHIFT = 120;

const $ = (id) => document.getElementById(id);
const hud = { score: $('score'), time: $('time'), timebar: $('timebar'), lives: $('lives'), next: $('next'), status: $('status') };

// ---------- audio (all synthesized, no files) ----------
let AC = null, muted = false;
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { AC = null; } } if (AC && AC.state === 'suspended') AC.resume(); return AC; }
function tone(freq, dur, type = 'sine', vol = 0.12, when = 0, slide = 0) {
  if (muted) return; const ac = audio(); if (!ac) return;
  const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noiseBurst(dur = 0.35, vol = 0.25) {
  if (muted) return; const ac = audio(); if (!ac) return;
  const n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ac.createBufferSource(), g = ac.createGain(); src.buffer = buf;
  g.gain.value = vol; src.connect(g).connect(ac.destination); src.start();
}
const sfx = {
  click: () => tone(1250, 0.05, 'square', 0.06),
  bell: (hi) => tone(hi ? 950 : 720, 0.14, 'square', 0.05),
  horn: () => { tone(349, 0.42, 'sawtooth', 0.07); tone(440, 0.42, 'sawtooth', 0.06, 0.02); },
  chime: () => { tone(784, 0.12, 'sine', 0.12); tone(1175, 0.22, 'sine', 0.12, 0.1); },
  coin: () => tone(1568, 0.07, 'sine', 0.07),
  crash: () => { noiseBurst(); tone(140, 0.4, 'sawtooth', 0.16, 0, -90); },
  clear: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.13, i * 0.13)),
  over: () => [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'triangle', 0.12, i * 0.16)),
};

// ---------- game state ----------
let state = 'title'; // title | playing | paused | ended | shot
let score = 0, lives = 3, timeLeft = SHIFT, elapsed = 0;
let trains = [], cars = [], popups = [], puffs = [], confetti = [];
let gateAngle = 0, gateTarget = 0; // 0 = up (open), 90 = down (closed)
let sigA = 'G', sigB = 'G';
let spawnTrainT = 1.2, spawnCarT = 0.5, bellT = 0, shake = 0, flashT = 0, endInfo = null;
let rngSeed = 20261117;
function rnd() { rngSeed = (rngSeed * 1103515245 + 12345) & 0x7fffffff; return rngSeed / 0x7fffffff; }
function rr(a, b) { return a + rnd() * (b - a); }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

const CAR_COLORS = ['#e74c3c', '#3498db', '#f39c12', '#2ecc71', '#9b59b6', '#fd79a8', '#00b8a9', '#e67e22'];

function reset() {
  score = 0; lives = 3; timeLeft = SHIFT; elapsed = 0;
  trains = []; cars = []; popups = []; puffs = []; confetti = [];
  gateAngle = 0; gateTarget = 0; sigA = 'G'; sigB = 'G';
  spawnTrainT = 1.4; spawnCarT = 0.4; shake = 0; endInfo = null;
}
function startGame() {
  reset(); state = 'playing';
  $('title').classList.add('hidden'); $('ending').classList.add('hidden'); $('paused').classList.add('hidden');
  audio(); sfx.click();
}
function endGame(clear, reason) {
  state = 'ended';
  endInfo = { clear, reason, score };
  $('endTitle').textContent = clear ? '🎉 SHIFT CLEAR!' : '🛑 SHIFT OVER';
  $('endText').innerHTML = clear
    ? `Target reached! Final score <b>${score}</b> with ${Math.ceil(timeLeft)}s to spare.<br>Every train and car made it home safe. Great signalling!`
    : `${reason}<br>Final score <b>${score}</b> / ${TARGET}. Lower the gates earlier — and don't be afraid of the red signal!`;
  $('ending').classList.remove('hidden');
  if (clear) { sfx.clear(); for (let i = 0; i < 90; i++) confetti.push({ x: rr(0, W), y: rr(-H, 0), vx: rr(-25, 25), vy: rr(60, 170), s: rr(4, 9), c: pick(CAR_COLORS), r: rr(0, 6.3) }); }
  else sfx.over();
}

// ---------- entities ----------
function spawnTrain() {
  const track = rnd() < 0.5 ? TRACK_A : TRACK_B;
  if (trains.some(t => t.track === track && (track.dir > 0 ? t.x < 320 : t.x > W - 320))) return; // keep spacing
  const cruise = rr(150, 195) + Math.min(55, elapsed * 0.55);
  const len = 236;
  trains.push({
    track, len, cruise, speed: cruise * 0.6,
    x: track.dir > 0 ? -len - 10 : W + 10, // x = front of the train
    passed: false, scored: false, warned: false, stoppedT: 0, hue: track === TRACK_A ? '#0e9aa7' : '#e67e22',
    label: track === TRACK_A ? 'RAPID' : 'LOCAL',
  });
  sfx.horn();
}
function spawnCar() {
  const down = rnd() < 0.5;
  const laneX = down ? 622 : 666;
  const y = down ? -52 : H + 52;
  if (cars.some(c => c.down === down && Math.abs(c.y - y) < 74)) return;
  cars.push({ down, x: laneX, y, speed: 0, cruise: rr(66, 92), color: pick(CAR_COLORS), inZone: false, counted: false, dead: false, spin: 0 });
}
function trainFront(t) { return t.x; }
function trainBack(t) { return t.x - t.track.dir * t.len; }
function trainInRoad(t) { const a = Math.min(trainFront(t), trainBack(t)), b = Math.max(trainFront(t), trainBack(t)); return b > ROAD.x0 && a < ROAD.x1; }
function warningActive() { return trains.some(t => { const d = t.track.dir > 0 ? ROAD.x0 - trainFront(t) : trainFront(t) - ROAD.x1; return (d > -t.len && d < 330) || trainInRoad(t); }); }

function cycleSignal(which) {
  const next = (s) => (s === 'G' ? 'Y' : s === 'Y' ? 'R' : 'G');
  if (which === 'A') sigA = next(sigA); else sigB = next(sigB);
  sfx.click();
}
function toggleGate() { gateTarget = gateTarget > 45 ? 0 : 90; sfx.click(); }

// ---------- update ----------
function update(dt) {
  flashT += dt;
  // gate animation: 90 degrees in 0.85s
  const gStep = (90 / 0.85) * dt;
  gateAngle += Math.max(-gStep, Math.min(gStep, gateTarget - gateAngle));

  if (state !== 'playing') { updateFx(dt); return; }
  elapsed += dt; timeLeft = Math.max(0, SHIFT - elapsed);

  spawnTrainT -= dt; if (spawnTrainT <= 0) { spawnTrain(); spawnTrainT = rr(4.2, 7.6) - Math.min(2.2, elapsed * 0.02); }
  spawnCarT -= dt; if (spawnCarT <= 0) { spawnCar(); spawnCarT = rr(1.1, 2.3); }

  const warn = warningActive();
  if (warn) { bellT -= dt; if (bellT <= 0) { sfx.bell(Math.floor(flashT * 2) % 2 === 0); bellT = 0.55; } }

  // trains
  for (const t of trains) {
    const sig = t.track === TRACK_A ? sigA : sigB;
    const distToSignal = (t.track.signalX - trainFront(t)) * t.track.dir; // >0 before the signal
    let target = t.cruise;
    if (sig === 'Y') target = t.cruise * 0.42;
    if (sig === 'R' && distToSignal > -6) target = 0;
    // braking so a red signal stops the nose at the signal
    if (sig === 'R' && distToSignal > 0 && distToSignal < 190) target = Math.min(target, Math.max(0, distToSignal * 1.4));
    if (t.speed < target) t.speed = Math.min(target, t.speed + 130 * dt);
    else t.speed = Math.max(target, t.speed - 300 * dt);
    // hard stop at a red signal: never creep past it
    if (sig === 'R' && distToSignal > 0 && distToSignal < 14 && t.speed < 16) { t.speed = 0; t.x = t.track.signalX; }
    if (sig === 'R' && t.speed < 4 && distToSignal > 2 && distToSignal < 60) {
      t.stoppedT += dt;
      if (t.stoppedT > 2.5 && Math.floor(t.stoppedT * 2) !== Math.floor((t.stoppedT - dt) * 2)) { score = Math.max(0, score - 2); addPopup(t.track.signalX, t.track.top - 26, 'DELAY −2', '#ffdf6b'); }
    } else t.stoppedT = 0;
    t.x += t.track.dir * t.speed * dt;
    if (rnd() < dt * 2 && Math.abs(t.speed) > 40) puffs.push({ x: trainBack(t) + rr(-4, 4), y: t.track.top + 6, vx: -t.track.dir * 18, vy: -14, life: 0.9, s: rr(3, 6) });

    // crash check: train in the road area while a car is on its track band
    if (trainInRoad(t)) {
      const band = t.track === TRACK_A ? [196, 268] : [306, 378];
      for (const c of cars) {
        if (!c.dead && c.y > band[0] && c.y < band[1]) {
          c.dead = true; c.spin = rr(2, 4); lives--;
          sfx.crash(); shake = 0.55;
          addPopup(ROAD.cx, band[0] - 12, '💥 CRASH!', '#ff6b81');
          hud.status.textContent = 'Crash! One safety heart lost.';
          if (lives <= 0) { endGame(false, 'Three crashes — the safety inspector closed the crossing.'); }
        }
      }
      t.passed = true;
    }
    if (!t.scored && t.passed && !trainInRoad(t) && ((t.track.dir > 0 && trainBack(t) > ROAD.x1) || (t.track.dir < 0 && trainBack(t) < ROAD.x0))) {
      t.scored = true; score += 120; sfx.chime(); addPopup(ROAD.cx, t.track.top - 14, '+120 SAFE!', '#7be3c3');
    }
  }
  trains = trains.filter(t => t.track.dir > 0 ? trainBack(t) < W + 60 : trainBack(t) > -60);

  // cars
  const gateClosed = gateAngle > 25;
  for (const c of cars) {
    let stopY = null;
    if (c.down) { // moving down: stop before track A
      if (gateClosed && c.y < ZONE.y0 - 26) stopY = ZONE.y0 - 26;
    } else { // moving up: stop after track B
      if (gateClosed && c.y > ZONE.y1 + 26) stopY = ZONE.y1 + 26;
    }
    const ahead = cars.find(o => o !== c && !o.dead && o.down === c.down && (c.down ? (o.y > c.y && o.y - c.y < 58) : (o.y < c.y && c.y - o.y < 58)));
    let target = c.cruise;
    if (ahead) target = Math.min(target, Math.max(0, (Math.abs(ahead.y - c.y) - 46) * 3));
    if (stopY !== null) {
      const d = Math.abs(stopY - c.y);
      if (d < 60) target = Math.min(target, Math.max(0, d * 1.6));
      if (d <= 1.5) target = 0;
    }
    if (c.dead) { c.speed = 0; c.spin *= 0.94; c.y += (c.down ? -1 : 1) * 12 * dt; continue; }
    c.speed += Math.max(-260 * dt, Math.min(160 * dt, target - c.speed));
    c.y += (c.down ? 1 : -1) * c.speed * dt;
    const wasIn = c.inZone;
    c.inZone = c.y > ZONE.y0 && c.y < ZONE.y1;
    if (wasIn && !c.inZone && !c.counted) { c.counted = true; score += 40; sfx.coin(); addPopup(c.x + (c.down ? -6 : 6), c.y, '+40', '#ffd94d'); }
  }
  cars = cars.filter(c => !c.dead ? (c.down ? c.y < H + 70 : c.y > -70) : Math.abs(c.spin) > 0.15);
  // honking when the gate stays shut with no train near
  if (gateClosed && !warn && cars.some(c => Math.abs(c.speed) < 3)) {
    if (Math.random() < dt * 0.5) addPopup(ROAD.cx + rr(-30, 30), ZONE.y0 - 44, '📣 honk!', '#ffb37b');
  }

  if (score >= TARGET) { endGame(true); }
  else if (timeLeft <= 0) { endGame(false, 'Time up — the next keeper takes over.'); }
  updateFx(dt);
  updateHud();
}
function updateFx(dt) {
  for (const p of popups) { p.y -= 34 * dt; p.life -= dt; }
  popups = popups.filter(p => p.life > 0);
  for (const p of puffs) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.s += 7 * dt; }
  puffs = puffs.filter(p => p.life > 0);
  for (const c of confetti) { c.x += c.vx * dt; c.y += c.vy * dt; c.r += dt * 3; if (c.y > H + 12) { c.y = -12; c.x = rr(0, W); } }
  if (shake > 0) shake -= dt;
}
function addPopup(x, y, text, color) { popups.push({ x, y, text, color, life: 1.15 }); }

function updateHud() {
  hud.score.textContent = score;
  hud.time.textContent = Math.ceil(timeLeft);
  hud.timebar.style.width = `${(timeLeft / SHIFT) * 100}%`;
  hud.timebar.style.background = timeLeft < 20 ? '#ff6b81' : '#ffd94d';
  hud.lives.textContent = '♥'.repeat(lives) + '♡'.repeat(Math.max(0, 3 - lives));
  let best = null;
  for (const t of trains) {
    const d = t.track.dir > 0 ? ROAD.x0 - trainFront(t) : trainFront(t) - ROAD.x1;
    if (d > -t.len && (!best || d < best.d)) best = { d, t };
  }
  hud.next.textContent = best ? (best.d <= 0 ? `${best.t.track.name} IN CROSSING!` : `${best.t.track.name} · ${Math.max(1, Math.round(best.d / Math.max(30, best.t.speed)))}s`) : '—';
}

// ---------- drawing ----------
function R(x, y, w, h, r, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, 340);
  sky.addColorStop(0, '#6ec1ee'); sky.addColorStop(1, '#cfeeff');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, 340);
  // sun + clouds
  ctx.fillStyle = '#ffd94d'; ctx.beginPath(); ctx.arc(872, 62, 30, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,217,77,.35)'; ctx.beginPath(); ctx.arc(872, 62, 44, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  for (const [cx, cy, s] of [[140, 56, 1], [420, 38, 0.7], [690, 84, 0.85]]) {
    ctx.beginPath(); ctx.ellipse(cx, cy, 44 * s, 15 * s, 0, 0, 7); ctx.ellipse(cx + 30 * s, cy + 3 * s, 32 * s, 12 * s, 0, 0, 7); ctx.ellipse(cx - 32 * s, cy + 4 * s, 28 * s, 11 * s, 0, 0, 7); ctx.fill();
  }
  // mountains + fields
  ctx.fillStyle = '#8fce9b'; ctx.beginPath(); ctx.moveTo(0, 210); ctx.lineTo(120, 130); ctx.lineTo(250, 210); ctx.lineTo(390, 140); ctx.lineTo(520, 210); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#a5dba8'; ctx.beginPath(); ctx.moveTo(700, 210); ctx.lineTo(830, 148); ctx.lineTo(960, 210); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#79c47e'; ctx.fillRect(0, 208, W, 132);
  ctx.fillStyle = '#8fd194'; ctx.fillRect(0, 300, W, 40);
  // station building (left)
  R(28, 128, 128, 62, 4, '#fdf6e3'); R(20, 116, 144, 16, 4, '#c0392b');
  R(44, 152, 26, 38, 2, '#7a4a21'); R(84, 148, 52, 24, 2, '#bfe6f5');
  ctx.fillStyle = '#20303c'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('HIMAWARI STN', 92, 110);
  // houses (right)
  for (const [hx, hc] of [[792, '#f7e8c9'], [884, '#e8f4fc']]) {
    R(hx, 140, 62, 48, 3, hc); ctx.fillStyle = '#8e5b2f';
    ctx.beginPath(); ctx.moveTo(hx - 5, 142); ctx.lineTo(hx + 31, 118); ctx.lineTo(hx + 67, 142); ctx.closePath(); ctx.fill();
    R(hx + 22, 160, 16, 28, 2, '#7a4a21');
  }
  // trees
  for (const tx of [196, 300, 470, 760, 540]) {
    ctx.fillStyle = '#6d4c2f'; ctx.fillRect(tx - 3, 176, 6, 20);
    ctx.fillStyle = '#3f9e4d'; ctx.beginPath(); ctx.arc(tx, 162, 17, 0, 7); ctx.arc(tx - 13, 172, 12, 0, 7); ctx.arc(tx + 13, 172, 12, 0, 7); ctx.fill();
  }
  // ground below tracks
  ctx.fillStyle = '#9aa5a1'; ctx.fillRect(0, 392, W, H - 392);
  ctx.fillStyle = '#7ed491'; ctx.fillRect(0, 392, 596, 18); ctx.fillRect(692, 392, W - 692, 18);
  ctx.fillStyle = '#6bbf76'; ctx.fillRect(0, 500, W, 40);
}
function drawTrack(track) {
  const y = track.railY;
  ctx.fillStyle = '#8d8d94'; ctx.fillRect(0, y - 16, W, 34); // ballast
  ctx.fillStyle = '#6e5636';
  for (let x = 4; x < W; x += 26) ctx.fillRect(x, y - 13, 16, 28); // sleepers
  ctx.fillStyle = '#d7dde2'; ctx.fillRect(0, y - 8, W, 4); ctx.fillRect(0, y + 5, W, 4); // rails
  ctx.fillStyle = '#f4f8fa'; ctx.fillRect(0, y - 8, W, 1.6); ctx.fillRect(0, y + 5, W, 1.6);
}
function drawRoad() {
  ctx.fillStyle = '#3d444b'; ctx.fillRect(ROAD.x0, 0, ROAD.x1 - ROAD.x0, H);
  ctx.fillStyle = '#596068'; ctx.fillRect(ROAD.x0, 0, 5, H); ctx.fillRect(ROAD.x1 - 5, 0, 5, H);
  ctx.strokeStyle = '#f5d76e'; ctx.lineWidth = 3; ctx.setLineDash([16, 14]);
  ctx.beginPath(); ctx.moveTo(ROAD.cx, 4); ctx.lineTo(ROAD.cx, H); ctx.stroke(); ctx.setLineDash([]);
  // crossing panels + stop lines
  ctx.fillStyle = '#4a5058'; ctx.fillRect(ROAD.x0, ZONE.y0, ROAD.x1 - ROAD.x0, ZONE.y1 - ZONE.y0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(ROAD.x0 + 8, ZONE.y0 - 8, 40, 5); // stop line, down lane
  ctx.fillRect(ROAD.x1 - 48, ZONE.y1 + 3, 40, 5); // stop line, up lane
  ctx.save(); ctx.translate(ROAD.x0 + 14, ZONE.y0 - 18); ctx.rotate(Math.PI / 4); ctx.fillStyle = '#ffd94d'; ctx.fillRect(-7, -7, 14, 14); ctx.restore();
}
function drawSignal(track, state) {
  const x = track.signalX, baseY = track.railY + 16, topY = baseY - 108;
  const facing = track.dir; // lamps face the oncoming train
  ctx.fillStyle = '#2c353d'; ctx.fillRect(x - 3, topY + 40, 6, baseY - topY - 40);
  ctx.fillStyle = '#454f57'; ctx.fillRect(x - 14, baseY - 2, 28, 6);
  // head: tall oval, lamps top->bottom GREEN, YELLOW, RED (Japanese railway order)
  R(x - 13, topY, 26, 46, 12, '#161c21');
  ctx.strokeStyle = '#454f57'; ctx.lineWidth = 2; ctx.stroke();
  const lamps = [['G', '#2eff8f'], ['Y', '#ffd94d'], ['R', '#ff4757']];
  lamps.forEach(([key, color], i) => {
    const cy = topY + 9 + i * 14, on = state === key;
    ctx.fillStyle = on ? color : '#39424a';
    ctx.beginPath(); ctx.arc(x, cy, 5.4, 0, 7); ctx.fill();
    if (on) { ctx.fillStyle = color + '55'; ctx.beginPath(); ctx.arc(x, cy, 10.5, 0, 7); ctx.fill(); }
    // hood pointing toward the train
    ctx.strokeStyle = '#161c21'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(x - 6, cy - 6); ctx.lineTo(x + facing * -9, cy - 6); ctx.stroke();
  });
  // label plate
  R(x - 11, topY + 50, 22, 13, 2, '#f5f6fa');
  ctx.fillStyle = '#20303c'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('SIG ' + track.name, x, topY + 60);
}
function drawGateMachine(px, py, armDir, phase) {
  // post with crossbuck and twin red lamps (lamps face the road traffic)
  ctx.fillStyle = '#f4c20d'; ctx.fillRect(px - 4, py - 64, 8, 64);
  ctx.fillStyle = '#222'; ctx.fillRect(px - 4, py - 44, 8, 7); ctx.fillRect(px - 4, py - 24, 8, 7);
  // X crossbuck
  ctx.save(); ctx.translate(px, py - 76); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#f8f9fa'; ctx.fillRect(-13, -3.4, 26, 6.8); ctx.fillRect(-3.4, -13, 6.8, 26);
  ctx.strokeStyle = '#d63031'; ctx.lineWidth = 1.4; ctx.strokeRect(-13, -3.4, 26, 6.8); ctx.restore();
  // twin lamps, alternating while warning or gate moving/closed
  const active = warningActive() || gateAngle > 3;
  const on = active && Math.floor(flashT * 1.8 + phase) % 2 === 0;
  for (const s of [-1, 1]) {
    ctx.fillStyle = on === (s < 0) ? '#ff4757' : '#5a2326';
    ctx.beginPath(); ctx.arc(px + s * 9, py - 56, 4.6, 0, 7); ctx.fill();
    if (on === (s < 0)) { ctx.fillStyle = 'rgba(255,71,87,.3)'; ctx.beginPath(); ctx.arc(px + s * 9, py - 56, 9, 0, 7); ctx.fill(); }
  }
  // arm: angle 0 = pointing up (open), 90 = horizontal (closed)
  const a = (gateAngle * Math.PI / 180);
  const ax = px + armDir * Math.sin(a) * 100, ay = (py - 58) - Math.cos(a) * 100;
  ctx.strokeStyle = '#f4c20d'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(px, py - 58); ctx.lineTo(ax, ay); ctx.stroke();
  ctx.strokeStyle = '#22252a'; ctx.lineWidth = 7;
  for (let i = 1; i <= 3; i++) {
    const t0 = i / 3.6, t1 = t0 + 0.13;
    ctx.beginPath();
    ctx.moveTo(px + (ax - px) * t0, (py - 58) + (ay - (py - 58)) * t0);
    ctx.lineTo(px + (ax - px) * t1, (py - 58) + (ay - (py - 58)) * t1);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#ff4757'; ctx.beginPath(); ctx.arc(ax, ay, 4, 0, 7); ctx.fill();
}
function drawTrain(t) {
  const dir = t.track.dir, front = t.x, back = trainBack(t);
  const x0 = Math.min(front, back), y = t.track.top, len = t.len, carW = 74, gap = 4;
  // shadow + bogies
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x0 + 4, y + 56, len - 8, 7);
  for (let i = 0; i < 3; i++) {
    const cx = x0 + i * (carW + gap);
    // body
    R(cx, y, carW, 52, 7, '#eef2f5');
    R(cx, y, carW, 15, 7, t.hue);
    R(cx, y + 40, carW, 12, 5, '#39424a');
    // windows
    ctx.fillStyle = '#a8dcf0';
    for (let wx = 8; wx < carW - 12; wx += 15) R(cx + wx, y + 19, 11, 13, 2, '#a8dcf0');
    R(cx + carW - 13, y + 19, 8, 13, 2, '#8fcbe8');
    // wheels
    ctx.fillStyle = '#22252a';
    ctx.beginPath(); ctx.arc(cx + 14, y + 54, 6, 0, 7); ctx.arc(cx + carW - 14, y + 54, 6, 0, 7); ctx.fill();
  }
  // nose (front car, direction side)
  const noseX = dir > 0 ? x0 + len - 78 : x0;
  R(noseX, y, 78, 52, 10, '#eef2f5'); R(noseX, y, 78, 15, 8, t.hue); R(noseX, y + 40, 78, 12, 6, '#39424a');
  ctx.fillStyle = '#20303c';
  if (dir > 0) { R(noseX + 58, y + 18, 15, 16, 3, '#20303c'); } else { R(noseX + 5, y + 18, 15, 16, 3, '#20303c'); }
  // destination sign + headlights
  ctx.fillStyle = '#10181f'; const signX = dir > 0 ? noseX + 22 : noseX + 34;
  R(signX, y + 2.5, 34, 10, 2, '#10181f');
  ctx.fillStyle = '#ffd94d'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(t.label, signX + 17, y + 10.5);
  ctx.fillStyle = '#fff7ae';
  const hl = dir > 0 ? front - 2 : front + 2;
  ctx.beginPath(); ctx.arc(hl, y + 38, 3.4, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,247,174,.28)'; ctx.beginPath(); ctx.arc(hl, y + 38, 9, 0, 7); ctx.fill();
  // pantograph on the middle car
  const px = x0 + carW + gap + 36;
  ctx.strokeStyle = '#39424a'; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(px - 11, y); ctx.lineTo(px, y - 11); ctx.lineTo(px + 11, y); ctx.moveTo(px, y - 11); ctx.lineTo(px, y); ctx.stroke();
  ctx.fillRect(px - 13, y - 14, 26, 3);
}
function drawCar(c) {
  const { x, y } = c, w = 34, h = 50;
  ctx.save(); ctx.translate(x, y); if (c.dead) ctx.rotate(c.spin * 0.4);
  ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(2, 4, w / 2, h / 2, 0, 0, 7); ctx.fill();
  R(-w / 2, -h / 2, w, h, 9, c.color);
  R(-w / 2 + 4, -h / 2 + 12, w - 8, 13, 4, '#bfe6f5'); // windshield
  R(-w / 2 + 4, h / 2 - 22, w - 8, 10, 4, '#9fd0e8'); // rear window
  R(-w / 2 + 3, -2, w - 6, 12, 3, 'rgba(255,255,255,.28)'); // roof
  ctx.fillStyle = '#22252a';
  for (const [wx, wy] of [[-w / 2 - 1, -h / 2 + 8], [w / 2 - 3, -h / 2 + 8], [-w / 2 - 1, h / 2 - 14], [w / 2 - 3, h / 2 - 14]]) ctx.fillRect(wx, wy, 4, 7);
  // lights: headlights point in the travel direction, brake lights glow when stopped
  const f = c.down ? 1 : -1;
  ctx.fillStyle = '#fff7ae';
  ctx.beginPath(); ctx.arc(-w / 2 + 7, f * (h / 2 - 3), 2.6, 0, 7); ctx.arc(w / 2 - 7, f * (h / 2 - 3), 2.6, 0, 7); ctx.fill();
  ctx.fillStyle = Math.abs(c.speed) < 6 && state === 'playing' ? '#ff2d40' : '#8e2432';
  ctx.beginPath(); ctx.arc(-w / 2 + 7, -f * (h / 2 - 3), 2.6, 0, 7); ctx.arc(w / 2 - 7, -f * (h / 2 - 3), 2.6, 0, 7); ctx.fill();
  ctx.restore();
}
function draw() {
  ctx.save();
  if (shake > 0) ctx.translate(rr(-1, 1) * shake * 9, rr(-1, 1) * shake * 7);
  drawBackground();
  drawRoad();
  drawTrack(TRACK_A); drawTrack(TRACK_B);
  // signals stand beside their tracks, before the crossing
  drawSignal(TRACK_A, sigA); drawSignal(TRACK_B, sigB);
  // gate machines: near-side and far-side for both approaches
  drawGateMachine(ROAD.x1 + 10, ZONE.y0 + 4, -1, 0);
  drawGateMachine(ROAD.x0 - 10, ZONE.y0 + 4, 1, 1);
  drawGateMachine(ROAD.x0 - 10, ZONE.y1 - 4, 1, 1);
  drawGateMachine(ROAD.x1 + 10, ZONE.y1 - 4, -1, 0);
  for (const c of cars) drawCar(c);
  for (const t of trains) drawTrain(t);
  for (const p of puffs) { ctx.fillStyle = `rgba(255,255,255,${0.5 * p.life})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 7); ctx.fill(); }
  // next-train edge warnings
  if (state === 'playing' || state === 'shot') {
    for (const t of trains) {
      const offLeft = trainBack(t) < 0 && t.track.dir > 0, offRight = trainBack(t) > W && t.track.dir < 0;
      if ((offLeft || offRight) && Math.floor(flashT * 2.4) % 2 === 0) {
        const ax = offLeft ? 18 : W - 18, ay = t.track.top + 26;
        ctx.fillStyle = '#ff4757'; ctx.beginPath();
        if (offLeft) { ctx.moveTo(ax + 12, ay); ctx.lineTo(ax - 8, ay - 11); ctx.lineTo(ax - 8, ay + 11); }
        else { ctx.moveTo(ax - 12, ay); ctx.lineTo(ax + 8, ay - 11); ctx.lineTo(ax + 8, ay + 11); }
        ctx.closePath(); ctx.fill();
      }
    }
  }
  // gate status banner
  if (state === 'playing') {
    ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = gateAngle > 80 ? 'rgba(20,120,70,.9)' : gateAngle > 10 ? 'rgba(200,140,20,.9)' : 'rgba(190,40,50,.9)';
    const label = gateAngle > 80 ? '⛔ GATES CLOSED' : gateAngle > 10 ? '⚠ GATES MOVING' : '⚠ GATES OPEN';
    const tw = ctx.measureText(label).width + 26;
    R(ROAD.cx - tw / 2, 452, tw, 26, 13, ctx.fillStyle);
    ctx.fillStyle = '#fff'; ctx.fillText(label, ROAD.cx, 470);
  }
  for (const p of popups) { ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center'; ctx.globalAlpha = Math.min(1, p.life); ctx.fillStyle = p.color; ctx.strokeStyle = 'rgba(10,20,30,.65)'; ctx.lineWidth = 3; ctx.strokeText(p.text, p.x, p.y); ctx.fillText(p.text, p.x, p.y); ctx.globalAlpha = 1; }
  for (const c of confetti) { ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.r); ctx.fillStyle = c.c; ctx.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2); ctx.restore(); }
  ctx.restore();
}

// ---------- input ----------
$('btnStart').addEventListener('click', startGame);
$('btnRestart').addEventListener('click', startGame);
$('btnGate').addEventListener('click', () => { if (state === 'playing') toggleGate(); });
$('btnSigA').addEventListener('click', () => { if (state === 'playing') cycleSignal('A'); });
$('btnSigB').addEventListener('click', () => { if (state === 'playing') cycleSignal('B'); });
$('btnMute').addEventListener('click', (e) => { muted = !muted; e.target.textContent = muted ? '🔇' : '🔊'; });
$('btnPause').addEventListener('click', togglePause);
function togglePause() {
  if (state === 'playing') { state = 'paused'; $('paused').classList.remove('hidden'); }
  else if (state === 'paused') { state = 'playing'; $('paused').classList.add('hidden'); }
}
canvas.addEventListener('click', (ev) => {
  if (state !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) * (W / rect.width), y = (ev.clientY - rect.top) * (H / rect.height);
  if (Math.abs(x - TRACK_A.signalX) < 34 && y < TRACK_A.railY - 40) cycleSignal('A');
  else if (Math.abs(x - TRACK_B.signalX) < 34 && y > 250 && y < TRACK_B.railY - 20) cycleSignal('B');
  else if (x > ROAD.x0 - 40 && x < ROAD.x1 + 40 && y > ZONE.y0 - 90 && y < ZONE.y1 + 40) toggleGate();
});
window.addEventListener('keydown', (ev) => {
  if (ev.repeat) return;
  const k = ev.key.toLowerCase();
  if (k === ' ') { ev.preventDefault(); if (state === 'title') startGame(); else if (state === 'playing') toggleGate(); }
  else if (k === 'a' && state === 'playing') cycleSignal('A');
  else if (k === 'l' && state === 'playing') cycleSignal('B');
  else if (k === 'p') togglePause();
  else if (k === 'm') { muted = !muted; $('btnMute').textContent = muted ? '🔇' : '🔊'; }
  else if (k === 'r' && state === 'ended') startGame();
  else if (k === 'enter' && state === 'title') startGame();
});

// ---------- screenshot modes (?shot=start|play|end) for the entry's screenshots ----------
const shotMode = new URLSearchParams(location.search).get('shot');
function setupShot(mode) {
  reset(); state = 'shot';
  $('title').classList.add('hidden'); $('ending').classList.add('hidden');
  document.querySelector('.controls').style.visibility = 'hidden';
  if (mode === 'auto') { // headless smoke test: a real game, started and left running
    startGame();
    document.querySelector('.controls').style.visibility = 'hidden';
    return;
  }
  if (mode === 'play') {
    score = 640; timeLeft = 78; elapsed = 42; lives = 3;
    gateAngle = 90; gateTarget = 90; sigA = 'G'; sigB = 'R';
    const t = { track: TRACK_A, len: 236, cruise: 180, speed: 150, x: 470, passed: false, scored: false, warned: true, stoppedT: 0, hue: '#0e9aa7', label: 'RAPID' };
    trains.push(t);
    const t2 = { track: TRACK_B, len: 236, cruise: 170, speed: 0, x: 830, passed: false, scored: false, warned: false, stoppedT: 1, hue: '#e67e22', label: 'LOCAL' };
    trains.push(t2);
    cars.push({ down: true, x: 622, y: 128, speed: 0, cruise: 80, color: '#e74c3c', inZone: false, counted: false, dead: false, spin: 0 });
    cars.push({ down: true, x: 622, y: 66, speed: 0, cruise: 80, color: '#3498db', inZone: false, counted: false, dead: false, spin: 0 });
    cars.push({ down: false, x: 666, y: 452, speed: 0, cruise: 80, color: '#f39c12', inZone: false, counted: false, dead: false, spin: 0 });
    addPopup(ROAD.cx, 168, '+120 SAFE!', '#7be3c3');
    updateHud();
  } else if (mode === 'end') {
    score = 1340; timeLeft = 23; lives = 3;
    endGame(true);
    state = 'shot';
  } else {
    state = 'title';
    $('title').classList.remove('hidden');
    document.querySelector('.controls').style.visibility = '';
  }
  draw();
}
if (shotMode) setupShot(shotMode);

// Small debug/testing hook (used by the author's headless smoke tests).
window.__sm = () => ({ state, elapsed: Math.round(elapsed * 10) / 10, score, lives, trains: trains.length, cars: cars.length, gate: Math.round(gateAngle), sigA, sigB });
window.__act = { start: startGame, gate: toggleGate, sigA: () => cycleSignal('A'), sigB: () => cycleSignal('B') };

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (state === 'shot' && shotMode === 'play') { flashT += dt; updateFx(dt); draw(); }
  else if (state !== 'paused') { update(dt); draw(); }
  requestAnimationFrame(frame);
}
updateHud();
draw();
requestAnimationFrame(frame);
