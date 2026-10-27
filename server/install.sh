#!/usr/bin/env bash
# 보고바이오 스마트스토어 자동 수집 — Lightsail(Ubuntu) 설치 스크립트
# 실행:  bash <(curl -fsSL https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/main/server/install.sh)
set -euo pipefail
DIR="$HOME/bogobio"
RAW="https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/main/server"
mkdir -p "$DIR"; cd "$DIR"

echo "[1/4] Installing python3-bcrypt ..."
if ! python3 -c "import bcrypt" 2>/dev/null; then
  sudo apt-get update -qq && sudo apt-get install -y -qq python3-bcrypt >/dev/null
fi

echo "[2/4] Downloading collector ..."
curl -fsSL "$RAW/naver_collect.py" -o naver_collect.py
chmod 700 naver_collect.py

echo "[3/4] Settings (secret/password are hidden while typing)"
if [ -f config.json ]; then
  read -r -p "  Settings already exist. Re-enter? (y/N) " redo
else redo=y; fi
if [[ "${redo,,}" == "y" ]]; then
  read -r    -p "  NAVER Application ID     : " NID
  read -r -s -p "  NAVER Application Secret : " NSEC; echo "  (secret received: ${#NSEC} chars)"
  read -r -s -p "  Dashboard password       : " KEY; echo "  (password received: ${#KEY} chars)"
  API="https://script.google.com/macros/s/AKfycbzGB6M89TvVtns8gHwIi9_tfFeANDRI2DFVAQyh9MjXvDaGTd1ujzIXlqgvY75YYuZN_w/exec"
  umask 077
  NID="$NID" NSEC="$NSEC" KEY="$KEY" API="$API" python3 - <<'PY'
import json, os
json.dump({"naver_id": os.environ["NID"].strip(), "naver_secret": os.environ["NSEC"].strip(),
           "api_url": os.environ["API"], "key": os.environ["KEY"]}, open("config.json", "w"), ensure_ascii=False)
PY
  chmod 600 config.json
fi

echo "[4/4] Scheduling daily run at 07:15 KST ..."
OFF=$(date +%z); SIGN=${OFF:0:1}; HH=$((10#${OFF:1:2}))
[ "$SIGN" = "-" ] && HH=$((-HH))
H=$(( ( (7 - 9 + HH) % 24 + 24 ) % 24 ))
LINE="15 $H * * * cd $DIR && /usr/bin/python3 naver_collect.py >> $DIR/collect.log 2>&1"
CUR=$(crontab -l 2>/dev/null | grep -v 'naver_collect.py' || true)
printf '%s\n%s\n' "$CUR" "$LINE" | sed '/^$/d' | crontab -
echo "  OK: $LINE"

echo
echo "DONE. Test run for yesterday (NOT written to the sheet):"
python3 naver_collect.py --test || true
echo
echo "If numbers look right, backfill with:"
echo "  cd ~/bogobio && python3 naver_collect.py 2026-10-16 $(date -d 'yesterday' +%F)"
