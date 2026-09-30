#!/bin/bash
set -e

echo "==> Installing motion-video"

if ! command -v brew >/dev/null 2>&1; then
  echo "==> Installing Homebrew (you may be asked for your Mac password)"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi

echo "==> Installing node, ffmpeg, git"
brew install node ffmpeg git

mkdir -p ~/Downloads
cd ~/Downloads
if [ ! -d motion-video ]; then
  git clone https://github.com/pkboom/motion-video.git
fi
cd motion-video

echo "==> Installing dependencies"
npm install
npx playwright install chromium

echo ""
echo "Done! motion-video is installed in ~/Downloads/motion-video"
