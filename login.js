// node login.js <url> [auth/state.json] — opens a visible browser; log in by hand.
// Saves the session automatically once you leave the login page (or snapshots it if you close the window).
import { chromium } from 'playwright';
import fs from 'node:fs';

const [url, file = 'auth/state.json'] = process.argv.slice(2);
if (!url) throw new Error('usage: node login.js <url> [auth/state.json]');
fs.mkdirSync('auth', { recursive: true });
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
await page.goto(url);
console.log('Log in in the browser window…');
let closed = false;
browser.on('disconnected', () => (closed = true));
let left = 0;
while (!closed && left < 3) {
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const u = page.url();
    left = /login|two-factor|challenge/.test(u) || u === 'about:blank' ? 0 : left + 1;
    await ctx.storageState({ path: file });
  } catch { break; }
}
console.log('saved', file, '(gitignored)');
await browser.close().catch(() => {});
