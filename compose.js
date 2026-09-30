// node compose.js <name> [--vertical]  ->  out/<name>.mp4 (or out/<name>-vertical.mp4)
// raw.webm + timeline.json -> trim/speed-up/cards (pass 1) -> zoom/pan (pass 2) -> cursor/ripples/captions (pass 3)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { makeCamera } from './lib/camera.js';

const name = process.argv[2];
if (!name) throw new Error('usage: node compose.js <name> [--vertical]');
const dir = path.resolve('raw', name);
const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
const vertical = process.argv.includes('--vertical') || tl.vertical;
const FPS = 60, W = tl.W, H = tl.H;
const OUT = vertical ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };
const K = vertical ? OUT.h / H : 1; // source px -> output px at zoom 1
const tmp = path.resolve('out', '.tmp', name + (vertical ? '-vertical' : ''));
fs.mkdirSync(tmp, { recursive: true });
const outFile = path.resolve('out', name + (vertical ? '-vertical' : '') + '.mp4');
const events = [...tl.events].sort((a, b) => a.t0 - b.t0);

// ---------- 1. segment plan (trim dead time, speed up waits, insert cards) ----------
const firstGoto = events.find((e) => e.type === 'goto');
const S = firstGoto ? firstGoto.t1 - 0.25 : events[0].t0 - 0.3;
const E = Math.min(tl.rawDur, events.at(-1).t1 + 1.0);

let fast = [];
let reach = S;
for (const e of events) {
  if (e.type !== 'chapter' && e.t0 - reach > 1.5) fast.push([reach + 0.3, e.t0 - 0.1]);
  if (e.fast && e.t1 > e.t0) fast.push([e.t0, e.t1]);
  reach = Math.max(reach, e.t1);
}
fast = fast.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
const merged = [];
for (const f of fast) {
  const l = merged.at(-1);
  if (l && f[0] <= l[1]) l[1] = Math.max(l[1], f[1]); else merged.push([...f]);
}
const chapters = events.filter((e) => e.type === 'chapter' && e.t0 > S && e.t0 < E);
const cuts = [...new Set([S, E, ...merged.flat(), ...chapters.map((c) => c.t0)].filter((t) => t >= S && t <= E))].sort((a, b) => a - b);

const segs = [];
const CARD = 1.6;
if (tl.intro) segs.push({ kind: 'card', title: tl.intro.title, sub: tl.intro.subtitle, fd: tl.intro.dur ?? 2.4, hold: S });
chapters.forEach((c, i) => (c.no = i + 1));
for (let i = 0; i < cuts.length - 1; i++) {
  const [a, b] = [cuts[i], cuts[i + 1]];
  const chap = chapters.find((c) => c.t0 === a);
  if (chap) segs.push({ kind: 'card', chapter: chap.no, title: chap.title, sub: chap.sub, fd: CARD, hold: a });
  if (b - a < 0.02) continue;
  const isFast = merged.some(([x, y]) => (a + b) / 2 >= x && (a + b) / 2 <= y);
  const d = b - a;
  const fd = isFast ? Math.max(0.5, d / 4) : d;
  segs.push({ kind: 'src', s0: a, s1: b, speed: fd < d ? d / fd : 1, fd });
}
if (tl.outro) segs.push({ kind: 'card', title: tl.outro.title, sub: tl.outro.subtitle, fd: tl.outro.dur ?? 2.6, hold: E });
let acc = 0;
for (const s of segs) { s.f0 = acc; acc += s.fd; }
const TOTAL = acc;

const srcSegs = segs.filter((s) => s.kind === 'src');
const srcToFinal = (t) => {
  for (const s of srcSegs) if (t >= s.s0 && t < s.s1) return s.f0 + (t - s.s0) / s.speed;
  return t < srcSegs[0].s0 ? srcSegs[0].f0 : srcSegs.at(-1).f0 + srcSegs.at(-1).fd;
};
const segAt = (f) => segs.find((s) => f >= s.f0 && f < s.f0 + s.fd) ?? segs.at(-1);
const finalToSrc = (f) => {
  const s = segAt(f);
  return s.kind === 'src' ? s.s0 + (f - s.f0) * s.speed : s.hold;
};

// ---------- 2. camera keyframes (final-time domain) ----------
const clampC = (z, cx, cy) => {
  const ww = OUT.w / (K * z), hh = OUT.h / (K * z);
  return { cx: Math.min(W - ww / 2, Math.max(ww / 2, cx)), cy: Math.min(H - hh / 2, Math.max(hh / 2, cy)) };
};
const home = { z: 1, ...clampC(1, W / 2, H / 2) };
const raw = [];
let explicit = false;
const acts = events.filter((e) => e.type === 'click' || e.type === 'type');
for (const e of events) {
  if (e.t0 < S || e.t0 > E) continue;
  if (e.type === 'zoom') {
    if (e.reset) { explicit = false; raw.push({ f: srcToFinal(e.t0), d: 0.9, z: 1, cx: home.cx, cy: home.cy }); }
    else { explicit = true; raw.push({ f: srcToFinal(e.t0), d: 0.9, z: e.z, ...clampC(e.z, e.x, e.y) }); }
  } else if (e.type === 'goto' && !explicit) {
    raw.push({ f: srcToFinal(e.t0), d: 0.7, z: 1, cx: home.cx, cy: home.cy });
  } else if (e.type === 'chapter') {
    const c = segs.find((s) => s.kind === 'card' && s.chapter === e.no);
    if (c) raw.push({ f: c.f0, d: 0.001, z: 1, cx: home.cx, cy: home.cy });
  } else if ((e.type === 'click' || e.type === 'type') && !explicit) {
    let z = e.zoom ?? (vertical ? 1 : tl.zoom); // vertical is already 1.78x at zoom 1
    if (e.box.width > 1000) z = Math.min(z, 1.25);
    const f = srcToFinal(e.moveT0);
    raw.push({ f, d: 0.85, z, ...clampC(z, e.x, e.y) });
    const next = acts[acts.indexOf(e) + 1];
    if (!next || next.moveT0 - e.t1 > 2.5) raw.push({ f: srcToFinal(e.t1) + 0.5, d: 0.8, z: 1, cx: home.cx, cy: home.cy });
  }
}
raw.sort((a, b) => a.f - b.f);
const kfs = [];
for (const k of raw) {
  const l = kfs.at(-1);
  if (l && k.f <= l.f + 0.001) { Object.assign(l, k, { f: l.f }); continue; }
  if (l) l.d = Math.max(0.001, Math.min(l.d, k.f - l.f));
  kfs.push({ ...k });
}
const cam = makeCamera(kfs, home);

// ---------- pass 1: trim / speed / cards ----------
const fmt = (n) => n.toFixed(4);
const rawFile = path.join(dir, 'raw.webm');
const p1 = path.join(tmp, 'pass1.mp4');
const fc = [];
fc.push(`[0:v]split=${srcSegs.length}${srcSegs.map((_, i) => `[r${i}]`).join('')}`);
let si = 0;
segs.forEach((s, i) => {
  if (s.kind === 'src') {
    fc.push(`[r${si++}]trim=start=${fmt(s.s0)}:end=${fmt(s.s1)},setpts=(PTS-STARTPTS)/${fmt(s.speed)},fps=${FPS},scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[v${i}]`);
  } else fc.push(`color=c=0x0b0d17:s=1920x1080:r=${FPS}:d=${fmt(s.fd)},format=yuv420p,setsar=1[v${i}]`);
});
fc.push(`${segs.map((_, i) => `[v${i}]`).join('')}concat=n=${segs.length}:v=1:a=0[out]`);
fs.writeFileSync(path.join(tmp, 'p1.txt'), fc.join(';\n'));
const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
console.log(`pass 1: ${segs.length} segments, ${TOTAL.toFixed(1)}s final`);
ff(['-i', rawFile, '-/filter_complex', path.join(tmp, 'p1.txt'), '-map', '[out]', '-r', String(FPS), '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', p1]);

// ---------- pass 2: zoom / pan ----------
const Z = cam.expr('z'), CX = cam.expr('cx'), CY = cam.expr('cy');
const sw = `trunc(1920*${K.toFixed(5)}*(${Z})/2)*2`, sh = `trunc(1080*${K.toFixed(5)}*(${Z})/2)*2`;
const vf = `scale=w='${sw}':h='${sh}':eval=frame:flags=bicubic,` +
  `crop=w=${OUT.w}:h=${OUT.h}:x='clip((${CX})*${K.toFixed(5)}*(${Z})-${OUT.w / 2},0,${sw}-${OUT.w})':y='clip((${CY})*${K.toFixed(5)}*(${Z})-${OUT.h / 2},0,${sh}-${OUT.h})',setsar=1,format=yuv420p`;
fs.writeFileSync(path.join(tmp, 'p2.txt'), vf);
const p2 = path.join(tmp, 'pass2.mp4');
console.log(`pass 2: ${kfs.length} camera moves`);
ff(['-i', p1, '-/vf', path.join(tmp, 'p2.txt'), '-r', String(FPS), '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', p2]);

// ---------- pass 3: cursor, ripples, captions, cards (rendered in Chromium, piped to ffmpeg) ----------
const nFrames = Math.round(Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', p2]).toString()));
const moves = events.filter((e) => e.type === 'move');
const ease = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
const cursorAt = (t) => {
  let pos = tl.cursorStart;
  for (const m of moves) {
    if (t < m.t0) break;
    if (t >= m.t1) { pos = m.to; continue; }
    const p = ease((t - m.t0) / (m.t1 - m.t0));
    return {
      x: (1 - p) ** 2 * m.from.x + 2 * (1 - p) * p * m.c.x + p ** 2 * m.to.x,
      y: (1 - p) ** 2 * m.from.y + 2 * (1 - p) * p * m.c.y + p ** 2 * m.to.y,
    };
  }
  return pos;
};
const clicks = acts.filter((e) => e.t0 >= S && e.t0 <= E).map((e) => ({ f: srcToFinal(e.t0), x: e.x, y: e.y }));
const capEvents = events.filter((e) => (e.type === 'caption' || e.type === 'chapter') && e.t0 >= S && e.t0 <= E);
const caps = [];
capEvents.forEach((e, i) => {
  if (e.type !== 'caption' || !e.text) return;
  const nxt = capEvents[i + 1];
  const f0 = srcToFinal(e.t0);
  const f1 = nxt ? srcToFinal(nxt.t0) : TOTAL - (tl.outro ? tl.outro.dur ?? 2.6 : 0);
  caps.push({ f0, f1: Math.max(f1, f0 + 1.8), text: e.text });
});

const browser = await chromium.launch();
const pg = await browser.newPage({ viewport: { width: OUT.w, height: OUT.h } });
await pg.goto('file://' + path.resolve('lib/overlay.html'));
await pg.evaluate(([w, h]) => window.setup(w, h), [OUT.w, OUT.h]);

const enc = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', p2, '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
  '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto,format=yuv420p', '-r', String(FPS), '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-movflags', '+faststart', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((res, rej) => { enc.on('close', (c) => (c ? rej(new Error('ffmpeg ' + c)) : res())); enc.stdin.on('error', () => {}); });

const toScreen = (c, x, y) => ({ x: (x - c.cx) * K * c.z + OUT.w / 2, y: (y - c.cy) * K * c.z + OUT.h / 2 });
console.log(`pass 3: ${nFrames} frames`);
for (let i = 0; i < nFrames; i++) {
  const f = i / FPS;
  const seg = segAt(f);
  const c = cam.at(f);
  const st = { z: c.z, vertical };
  if (seg.kind === 'card') {
    const p = f - seg.f0;
    st.card = { title: seg.title, sub: seg.sub, chapter: seg.chapter, alpha: Math.min(1, p / 0.3, (seg.fd - p) / 0.3) };
  } else {
    const t = finalToSrc(f);
    const cp = cursorAt(t);
    st.cursor = toScreen(c, cp.x, cp.y);
    const last = clicks.filter((k) => k.f <= f).at(-1);
    st.press = last ? Math.max(0, 1 - (f - last.f) / 0.18) : 0;
    st.ripples = clicks.filter((k) => f >= k.f && f - k.f < 0.75).map((k) => ({ ...toScreen(c, k.x, k.y), age: (f - k.f) / 0.75 }));
    const cap = caps.find((k) => f >= k.f0 && f < k.f1);
    if (cap) st.caption = { text: cap.text, alpha: Math.min(1, (f - cap.f0) / 0.25, (cap.f1 - f) / 0.25) };
  }
  const png = await pg.evaluate((s) => window.draw(s), st).then(() => pg.screenshot({ omitBackground: true, type: 'png' }));
  if (!enc.stdin.write(png)) await new Promise((r) => enc.stdin.once('drain', r));
  if (i % 120 === 0) process.stdout.write(`\r${i}/${nFrames}`);
}
enc.stdin.end();
await done;
await browser.close();
console.log(`\nwrote ${outFile}`);
