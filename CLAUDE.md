# motion-video — how-to video studio

Shows real video of how to do things: Playwright-driven screen recordings of real apps, composed into how-to MP4s with zooms, click ripples, captions and chapter cards. Separate from `/Users/keunbae/code/motion-graphic`.

## Rules

- 1920×1080, 60fps. `--vertical` makes 1080×1920 for social.
- New version = new script file in `howto/`. Leave old ones alone.
- Never put credentials in the repo. Login uses Playwright `storageState` in `auth/` (gitignored): `npm run login -- <url> auth/<app>.json`, log in by hand, press Enter.
- If you can't log in or the brief is unclear, ask the user. Don't invent UI steps: check the real page first.
- When done: show 2–4 key frames and give the MP4 path.

## Pipeline

1. **Script** `howto/<name>.js` default-exports `{ name, baseURL, storageState, intro?, outro?, vertical?, zoom?, steps }`. Steps: `{goto}`, `{click: sel}`, `{type: sel, text, secret?}`, `{press}`, `{scroll: dy}`, `{wait: ms}`, `{waitFor: sel|'networkidle'}`, `{caption: text, hold?}` (`null` clears), `{chapter: title}`, `{zoomTo: sel|{x,y}|null, z}`. Clicks and typing auto-zoom; `zoomTo` overrides until `zoomTo: null`.
2. **Record** `node record.js howto/<name>.js` → `raw/<name>/raw.webm` + `timeline.json` (every move, click, keystroke, caption with timestamps). Headless 1920×1080. The real cursor is not in the video; a red sync frame aligns the clocks.
3. **Compose** `node compose.js <name> [--vertical]` → `out/<name>.mp4`. Trims dead time, speeds up waits and loads, inserts chapter cards, zooms and pans toward click targets, then draws the smooth cursor, ripples and captions at 60fps. Takes ~2.5 min per 20s of video.

`howto/_demo.js` + `demo/app.html` is a local smoke test for the pipeline.
