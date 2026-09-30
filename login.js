// node login.js <url> [auth/state.json]  — opens a visible browser; log in by hand, then press Enter here.
import { chromium } from 'playwright';
import fs from 'node:fs';
import readline from 'node:readline/promises';

const [url, file = 'auth/state.json'] = process.argv.slice(2);
if (!url) throw new Error('usage: node login.js <url> [auth/state.json]');
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
await page.goto(url);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question('Log in in the browser window, then press Enter here to save the session… ');
rl.close();
fs.mkdirSync('auth', { recursive: true });
await ctx.storageState({ path: file });
await browser.close();
console.log('saved', file, '(gitignored)');
