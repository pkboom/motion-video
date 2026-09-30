// node record.js howto/<name>.js  ->  raw/<name>/raw.webm + timeline.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const file = process.argv[2];
if (!file) throw new Error('usage: node record.js howto/<name>.js');
const script = (await import(pathToFileURL(path.resolve(file)))).default;
const name = script.name ?? path.basename(file, '.js');
const W = 1920, H = 1080;
const dir = path.resolve('raw', name);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

if (script.storageState && !fs.existsSync(script.storageState)) {
  throw new Error(`${script.storageState} missing. Run: npm run login -- <url> ${script.storageState}`);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  baseURL: script.baseURL,
  storageState: script.storageState,
  recordVideo: { dir, size: { width: W, height: H } },
});
const page = await ctx.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
// Sync marker: one red frame at a known time, found in the raw video to align timeline and video clocks.
await page.setContent('<body style="margin:0;background:#f00"></body>');
const tMark = now();
await page.waitForTimeout(500);
const events = [];
let cur = script.cursorStart ?? { x: W * 0.55, y: H * 0.6 };

const ease = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
const bez = (a, c, b, p) => ({
  x: (1 - p) ** 2 * a.x + 2 * (1 - p) * p * c.x + p ** 2 * b.x,
  y: (1 - p) ** 2 * a.y + 2 * (1 - p) * p * c.y + p ** 2 * b.y,
});

async function moveTo(to) {
  const from = { ...cur };
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist < 2) return;
  const dur = Math.min(0.9, Math.max(0.4, 0.3 + dist / 2500));
  const c = { x: (from.x + to.x) / 2 - (to.y - from.y) * 0.08, y: (from.y + to.y) / 2 + (to.x - from.x) * 0.08 };
  const ev = { type: 'move', t0: now(), t1: now() + dur, from, to, c };
  events.push(ev);
  const start = Date.now();
  while (true) {
    const p = Math.min(1, (Date.now() - start) / 1000 / dur);
    const q = bez(from, c, to, ease(p));
    await page.mouse.move(q.x, q.y);
    if (p >= 1) break;
  }
  cur = { ...to };
  ev.t1 = now();
  return ev;
}

async function target(step, sel) {
  const loc = page.locator(sel).first();
  await loc.waitFor({ state: 'visible', timeout: step.timeout ?? 15000 });
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  const [fx, fy] = step.at ?? [0.5, 0.5];
  return { loc, box, pt: { x: box.x + box.width * fx, y: box.y + box.height * fy } };
}

const sleep = (ms) => page.waitForTimeout(ms);

async function run(step) {
  if ('goto' in step) {
    const ev = { type: 'goto', t0: now(), fast: step.fast ?? true, url: step.goto };
    await page.goto(step.goto, { waitUntil: step.waitUntil ?? 'load' });
    await sleep(step.settle ?? 400);
    ev.t1 = now(); events.push(ev);
  } else if ('click' in step) {
    const { box, pt } = await target(step, step.click);
    const mv = await moveTo(pt);
    await sleep(step.pause ?? 150);
    const ev = { type: 'click', t0: now(), moveT0: mv?.t0 ?? now(), x: pt.x, y: pt.y, box, zoom: step.zoom };
    await page.mouse.click(pt.x, pt.y);
    await sleep(step.after ?? 450);
    ev.t1 = now(); events.push(ev);
  } else if ('type' in step) {
    const { box, pt } = await target(step, step.type);
    const mv = await moveTo(pt);
    await sleep(150);
    const ev = { type: 'type', t0: now(), moveT0: mv?.t0 ?? now(), x: pt.x, y: pt.y, box, zoom: step.zoom, keys: [], chars: step.text.length };
    await page.mouse.click(pt.x, pt.y);
    await sleep(200);
    for (const ch of step.text) {
      ev.keys.push({ t: now(), k: step.secret ? '*' : ch });
      await page.keyboard.type(ch);
      await sleep(step.delay ?? 70);
    }
    await sleep(step.after ?? 350);
    ev.t1 = now(); events.push(ev);
  } else if ('press' in step) {
    const ev = { type: 'press', t0: now(), key: step.press };
    await page.keyboard.press(step.press);
    await sleep(step.after ?? 400);
    ev.t1 = now(); events.push(ev);
  } else if ('scroll' in step) {
    const ev = { type: 'scroll', t0: now(), dy: step.scroll };
    await page.mouse.wheel(0, step.scroll);
    await sleep(step.after ?? 700);
    ev.t1 = now(); events.push(ev);
  } else if ('wait' in step || 'waitFor' in step) {
    const ev = { type: 'wait', t0: now(), fast: step.fast ?? ('waitFor' in step) };
    if ('waitFor' in step) {
      if (step.waitFor === 'networkidle') await page.waitForLoadState('networkidle');
      else await page.locator(step.waitFor).first().waitFor({ state: 'visible', timeout: step.timeout ?? 60000 });
    } else await sleep(step.wait);
    ev.t1 = now(); events.push(ev);
  } else if ('caption' in step) {
    const ev = { type: 'caption', t0: now(), text: step.caption };
    events.push(ev);
    await sleep(step.caption ? (step.hold ?? 1200) : 0);
    ev.t1 = now();
  } else if ('chapter' in step) {
    events.push({ type: 'chapter', t0: now(), t1: now(), title: step.chapter, sub: step.sub });
  } else if ('zoomTo' in step) {
    const ev = { type: 'zoom', t0: now(), t1: now(), z: step.z ?? 1.8 };
    if (step.zoomTo === null) ev.reset = true;
    else if (typeof step.zoomTo === 'string') {
      const { pt } = await target(step, step.zoomTo);
      ev.x = pt.x; ev.y = pt.y;
    } else { ev.x = step.zoomTo.x; ev.y = step.zoomTo.y; }
    events.push(ev);
    await sleep(step.hold ?? 900);
    ev.t1 = now();
  } else throw new Error('unknown step ' + JSON.stringify(step));
}

let failed;
try {
  for (const [i, s] of script.steps.entries()) {
    try { await run(s); } catch (e) { e.message = `step ${i} ${JSON.stringify(s)}: ${e.message}`; throw e; }
  }
  await sleep(900);
} catch (e) { failed = e; await page.screenshot({ path: path.join(dir, 'failure.png') }).catch(() => {}); }
const wall = now();
await ctx.close();
await browser.close();
if (failed) { console.error(failed.message); process.exit(1); }

const raw = path.join(dir, 'raw.webm');
fs.renameSync(fs.readdirSync(dir).filter((f) => f.endsWith('.webm')).map((f) => path.join(dir, f))[0], raw);
const rawDur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', raw]).toString());
const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', raw, '-vf', 'scale=1:1', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
const pts = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', raw]).toString().trim().split('\n').map(Number);
let mark = -1;
for (let i = 0; i < pts.length; i++) if (rgb[i * 3] > 200 && rgb[i * 3 + 1] < 80 && rgb[i * 3 + 2] < 80) { mark = i; break; }
if (mark < 0) throw new Error('sync marker not found in video');
const offset = pts[mark] - tMark; // video clock = timeline clock + offset
for (const e of events) {
  for (const k of ['t0', 't1', 'moveT0']) if (k in e) e[k] += offset;
  if (e.keys) e.keys.forEach((k) => (k.t += offset));
}
const meta = { name, W, H, rawDur, offset, cursorStart: script.cursorStart ?? { x: W * 0.55, y: H * 0.6 }, vertical: !!script.vertical, zoom: script.zoom ?? 1.6, intro: script.intro, outro: script.outro };
fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify({ ...meta, events }, null, 1));
console.log(`recorded ${raw} (${rawDur.toFixed(1)}s, ${events.length} events)`);
