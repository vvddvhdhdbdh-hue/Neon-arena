'use strict';
// Neon Arena server: node server.js  (no dependencies). Open http://<this-pc>:3000 on every device.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const PORT = +process.env.PORT || 3000, A = 70, PR = 3.2, PORTAL = { x: 0, z: -24 }, TICK = 0.05;
const rooms = new Map(); let nid = 1;
const num = (v, d = 0) => typeof v == 'number' && isFinite(v) ? v : d, cl = (v, a, b) => Math.max(a, Math.min(b, v)), r2 = v => Math.round(v * 100) / 100;
const spawnPt = id => { const a = id * 2.4; return { x: r2(Math.sin(a) * 18), z: r2(Math.cos(a) * 18) } };
const H = p => p.hp > 0 ? Math.max(1, Math.round(p.hp)) : 0;
// enemy table: hp, size, melee dmg, shot dmg, shot cooldown, range, keep-distance, speed mult
const TY = {
  g: { hp: 3, sc: 1, m: 6, sd: 4, rc: 3.5, r: 28 }, b: { hp: 6, sc: 1.4, m: 10, sd: 7, rc: 3, r: 30 }, r: { hp: 2, sc: .75, m: 5, sp: 2.2 },
  f: { hp: 3, sc: 1, sd: 5, rc: 2, r: 30, keep: 12 }, s: { hp: 3, sc: 1, sd: 9, rc: 3, r: 45, keep: 22 }, B: { hp: 40, sc: 2.2, m: 15, sd: 8, rc: 1.5, r: 45, boss: 1 }
};
function room(name) {
  let R = rooms.get(name);
  if (!R) {
    R = { name, players: new Map(), seq: 0, ev: [], th: 0, tv: 0 };
    if (name.startsWith('C-')) { R.co = { wave: 1, ph: 0, E: new Map(), id: 1, q: [], sp: [], st: 0, qt: 0, g1: 0, n: 0, hold: 0, pt: 0 }; startWave(R) }
    rooms.set(name, R);
  }
  return R;
}
const emit = (R, e) => { e.s = ++R.seq; R.ev.push(e); if (R.ev.length > 300) R.ev.splice(0, 100) };
function hurtP(R, p, n, from) {
  if (p.hp <= 0) return; p.hp -= n;
  if (p.hp <= 0) { p.hp = 0; p.d++; p.rt = Date.now() + (R.co ? 4000 : 3000); emit(R, { t: 'kill', k: from ? from.id : 0, v: p.id, kn: from ? from.name : 'ENEMY', vn: p.name }); if (from) from.k++ }
}
// ---- co-op waves: the server owns the enemies, every client just renders them ----
function addGroup(c, n) {
  const w = c.wave, ty = [['g', 1]]; if (w >= 2) ty.push(['b', .2], ['r', .2]); if (w >= 3) ty.push(['f', .2]); if (w >= 4) ty.push(['s', .12]);
  const tot = ty.reduce((a, b) => a + b[1], 0);
  for (let i = 0; i < n; i++) { let r = Math.random() * tot, t = 'g'; for (const [k, v] of ty) { r -= v; if (r <= 0) { t = k; break } } c.sp.push(t) }
}
function startWave(R) {
  const c = R.co, w = c.wave, tot = Math.min(48, Math.round((4 + w * 2.2) * (w % 5 == 0 ? .6 : 1))), fr = w < 3 ? [1] : w < 6 ? [.6, .4] : [.45, .3, .25];
  c.q = fr.map(f => Math.max(1, Math.round(tot * f))); c.g1 = c.q[0]; c.ph = 0; c.st = 0; c.qt = 0; c.sp = []; c.hold = 0; c.n = 0; addGroup(c, c.q.shift());
  if (w % 5 == 0) spawnE(R, 'B');
  for (const p of R.players.values()) if (p.hp > 0) p.hp = Math.min(100, p.hp + 30);
}
function spawnE(R, t) {
  const c = R.co, al = [...R.players.values()].filter(p => p.hp > 0), b = al.length ? al[Math.floor(Math.random() * al.length)] : { x: 0, z: 0 };
  const a = Math.random() * 6.283, d = 22 + Math.random() * 14, w = c.wave, hp = TY[t].hp * (t == 'B' ? 1 + w * .1 : 1 + Math.min(w, 20) * .06);
  const id = c.id++; c.E.set(id, { id, t, x: cl(b.x + Math.cos(a) * d, -A + 3, A - 3), z: cl(b.z + Math.sin(a) * d, -A + 3, A - 3), yaw: 0, hp, mhp: hp, mc: 0, cd: 1 + Math.random() * 2 });
}
function moveE(R, e, al, dt) {
  const T = TY[e.t], w = R.co.wave; let tg = null, d = 1e9;
  for (const p of al) { const q = Math.hypot(p.x - e.x, p.z - e.z); if (q < d) { d = q; tg = p } }
  if (!tg) return; d = d || 1;
  const dx = tg.x - e.x, dz = tg.z - e.z, spd = (2.6 + Math.min(w, 14) * .2) / T.sc * (T.sp || 1) * (T.boss ? .8 : 1);
  let mx = dx / d, mz = dz / d, go = d > T.sc * 1.2;
  if (T.keep) { go = true; if (d < T.keep - 3) { mx = -mx; mz = -mz } else if (d < T.keep + 3) { const s = e.id % 2 ? 1 : -1; mx = -dz / d * s; mz = dx / d * s } }
  if (go) { e.x = cl(e.x + mx * spd * dt, -A + 2, A - 2); e.z = cl(e.z + mz * spd * dt, -A + 2, A - 2) }
  e.yaw = Math.atan2(dx, dz) + Math.PI; e.mc -= dt; e.cd -= dt;
  const sc = 1 + Math.min(w, 20) * .04;
  if (T.m && d < 1.3 + T.sc * .6 && e.mc <= 0) { e.mc = .9; hurtP(R, tg, T.m * sc) }
  if (T.sd && e.cd <= 0 && d < T.r) {
    e.cd = T.rc * (.8 + Math.random() * .5); const hit = Math.random() < .6;
    emit(R, { t: 'shot', id: 0, o: [r2(e.x), 1.3, r2(e.z)], e: [r2(tg.x + (hit ? 0 : (Math.random() - .5) * 3)), 1.2, r2(tg.z)], w: 0, f: 1 });
    if (hit) hurtP(R, tg, T.sd * sc);
  }
}
function coTick(R, dt) {
  const c = R.co, al = [...R.players.values()].filter(p => p.hp > 0);
  if (!R.players.size) return;
  if (c.ph == 0) {
    c.st -= dt; if (c.sp.length && c.st <= 0) { spawnE(R, c.sp.shift()); c.st = .12 }
    if (c.q.length) { c.qt += dt; if (c.E.size + c.sp.length <= Math.max(2, c.g1 >> 2) || c.qt > 22) { c.qt = 0; addGroup(c, c.q.shift()) } }
    for (const e of c.E.values()) moveE(R, e, al, dt);
    if (!c.E.size && !c.sp.length && !c.q.length) c.ph = 1;
  } else if (c.ph == 1) {   // portal: next wave starts when ALL living players stand inside
    c.n = al.filter(p => Math.hypot(p.x - PORTAL.x, p.z - PORTAL.z) < PR).length;
    c.hold = al.length && c.n == al.length ? c.hold + dt : 0; if (c.hold > .4) { c.ph = 2; c.pt = 0 }
  } else { c.pt += dt; if (c.pt > .35) { c.wave++; startWave(R) } }
}
function coSnap(R) {
  const c = R.co, al = [...R.players.values()].filter(p => p.hp > 0).length;
  return { w: c.wave, ph: c.ph, px: PORTAL.x, pz: PORTAL.z, n: c.ph ? c.n : 0, t: al, en: [...c.E.values()].map(e => [e.id, e.t, r2(e.x), r2(e.z), r2(e.yaw), r2(e.hp), r2(e.mhp)]) };
}
// ---- http api ----
function join(b) {
  const nm = String(b.room || 'LOBBY').replace(/[^\w\- ]/g, '').slice(0, 12) || 'LOBBY', R = room(nm), id = nid++, sp = spawnPt(id), m = {};
  if (b.model && typeof b.model == 'object') for (const k of Object.keys(b.model).slice(0, 60)) { const v = b.model[k]; if (typeof v == 'number' && isFinite(v)) m[k] = v }
  const p = { id, name: String(b.name || '').replace(/[<>&"']/g, '').slice(0, 12) || 'Player' + id, model: m, x: sp.x, y: 0, z: sp.z, yaw: 0, pitch: 0, w: 0, a: 0, hp: 100, k: 0, d: 0, rs: 1, rt: 0, vote: -1, seen: Date.now() };
  R.players.set(id, p);
  return { id, room: nm, seq: R.seq, me: { rs: p.rs, x: p.x, z: p.z, hp: 100 }, th: R.th, tv: R.tv };
}
function sync(b) {
  const R = rooms.get(String(b.room)), p = R && R.players.get(num(b.id));
  if (!p) return { error: 'Session expired - rejoin' };
  p.seen = Date.now(); const s = b.s || {};
  p.x = cl(num(s.x, p.x), -A, A); p.y = cl(num(s.y), 0, 40); p.z = cl(num(s.z, p.z), -A, A); p.yaw = num(s.yaw); p.pitch = cl(num(s.pitch), -2, 2); p.w = cl(num(s.w) | 0, 0, 5); p.a = num(s.a) | 0;
  for (const sh of (Array.isArray(b.shots) ? b.shots : []).slice(0, 12)) if (Array.isArray(sh.o) && Array.isArray(sh.e)) emit(R, { t: 'shot', id: p.id, o: sh.o.slice(0, 3).map(v => num(v)), e: sh.e.slice(0, 3).map(v => num(v)), w: num(sh.w) | 0, f: sh.f ? 1 : 0 });
  if (p.hp > 0) {
    if (R.co) for (const h of (Array.isArray(b.eh) ? b.eh : []).slice(0, 32)) {   // damage dealt to shared enemies
      const e = R.co.E.get(num(h.i)); if (!e) continue; e.hp -= cl(num(h.d), 0, 25);
      if (e.hp <= 0) { R.co.E.delete(e.id); p.k++; if (TY[e.t].boss) { R.co.E.clear(); R.co.sp = []; R.co.q = [] } }
    } else for (const h of (Array.isArray(b.hits) ? b.hits : []).slice(0, 16)) {   // deathmatch / point of contact
      const t = R.players.get(num(h.t)); if (t && t !== p && t.hp > 0) hurtP(R, t, cl(num(h.dmg), 0, 120), p);
    }
  }
  if (num(b.tv, -1) === R.tv) p.vote = Number.isInteger(b.vote) && b.vote >= 0 && b.vote < 7 ? b.vote : -1;
  const votes = [0, 0, 0, 0, 0, 0, 0]; for (const q of R.players.values()) if (q.vote >= 0) votes[q.vote]++;
  const need = Math.floor(R.players.size / 2) + 1, wi = votes.findIndex(v => v >= need);
  if (wi >= 0) { R.th = wi; R.tv++; for (const q of R.players.values()) q.vote = -1; votes.fill(0) }
  const known = new Set(Array.isArray(b.known) ? b.known : []), since = num(b.since);
  const out = {
    seq: R.seq, me: { rs: p.rs, x: p.x, z: p.z, hp: H(p), k: p.k }, np: R.players.size, votes, tv: R.tv, th: R.th,
    players: [...R.players.values()].map(q => { const o = { id: q.id, name: q.name, x: r2(q.x), y: r2(q.y), z: r2(q.z), yaw: r2(q.yaw), pitch: r2(q.pitch), hp: H(q), w: q.w, a: q.a, k: q.k, d: q.d }; if (!known.has(q.id)) o.model = q.model; return o }),
    ev: R.ev.filter(e => e.s > since)
  };
  if (R.co) out.co = coSnap(R);
  return out;
}
function leave(b) { const R = rooms.get(String(b.room)); if (R) { R.players.delete(num(b.id)); if (!R.players.size) rooms.delete(R.name) } return {} }
setInterval(() => {
  const now = Date.now();
  for (const R of rooms.values()) {
    for (const p of R.players.values()) {
      if (now - p.seen > 10000) { R.players.delete(p.id); continue }
      if (p.hp <= 0 && now >= p.rt) { const sp = spawnPt(p.id + R.seq); p.hp = 100; p.rs++; p.x = sp.x; p.z = sp.z }
    }
    if (!R.players.size) { rooms.delete(R.name); continue }
    if (R.co) coTick(R, TICK);
  }
}, TICK * 1000);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };
http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
  if (req.method == 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  if (req.method == 'POST' && req.url.startsWith('/api/')) {
    let body = ''; req.on('data', c => { body += c; if (body.length > 2e5) req.destroy() });
    req.on('end', () => {
      let out; try { const b = JSON.parse(body || '{}'), ep = req.url.slice(5).split('?')[0]; out = ep == 'join' ? join(b) : ep == 'sync' ? sync(b) : ep == 'leave' ? leave(b) : { error: 'Unknown endpoint' } } catch (e) { out = { error: 'Bad request' } }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
    }); return;
  }
  let f = decodeURIComponent(req.url.split('?')[0]); if (f == '/') f = '/Neon_Arena2.html';
  const fp = path.join(__dirname, f);
  if (!fp.startsWith(__dirname) || fp.endsWith('server.js')) { res.writeHead(403, cors); return res.end('Forbidden') }
  fs.readFile(fp, (e, d) => { if (e) { res.writeHead(404, cors); return res.end('Not found') } res.writeHead(200, { ...cors, 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); res.end(d) });
}).listen(PORT, '0.0.0.0', () => {
  console.log('Neon Arena server on port ' + PORT);
  for (const l of Object.values(os.networkInterfaces())) for (const i of l) if (i.family == 'IPv4' && !i.internal) console.log('  open  http://' + i.address + ':' + PORT);
});
