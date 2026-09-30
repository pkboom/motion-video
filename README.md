# motion-video

How-to video studio. Records real app footage and composes how-to MP4s with zooms, click highlights and captions.

## Setup query

Paste this into [Claude Code](https://claude.com/claude-code):

```
Clone https://github.com/pkboom/motion-video.git into ~/code and set it up
```

## Set up

```
brew install node ffmpeg git
mkdir -p ~/code && cd ~/code
git clone https://github.com/pkboom/motion-video.git
cd motion-video
npm install
npx playwright install chromium
```
