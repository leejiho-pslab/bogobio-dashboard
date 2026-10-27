#!/usr/bin/env bash
# 보고바이오 스마트스토어 자동 수집 — Lightsail(Ubuntu) 설치 스크립트
# 실행:  bash <(curl -fsSL https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/main/server/install.sh)
set -euo pipefail
DIR="$HOME/bogobio"
RAW="https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/main/server"
mkdir -p "$DIR"; cd "$DIR"

echo "▶ 1/4 필요한 프로그램 설치 (python3-bcrypt)"
if ! python3 -c "import bcrypt" 2>/dev/null; then
  sudo apt-get update -qq && sudo apt-get install -y -qq python3-bcrypt >/dev/null
fi

echo "▶ 2/4 수집 프로그램 내려받기"
curl -fsSL "$RAW/naver_collect.py" -o naver_collect.py
chmod 700 naver_collect.py

echo "▶ 3/4 설정 입력 (입력한 글자는 화면에 보이지 않습니다)"
if [ -f config.json ]; then
  read -r -p "  기존 설정이 있습니다. 새로 입력할까요? (y/N) " redo
else redo=y; fi
if [[ "${redo,,}" == "y" ]]; then
  read -r    -p "  네이버 애플리케이션 ID: " NID
  read -r -s -p "  네이버 애플리케이션 시크릿: " NSEC; echo
  read -r -s -p "  대시보드 비밀번호: " KEY; echo
  API="https://script.google.com/macros/s/AKfycbzGB6M89TvVtns8gHwIi9_tfFeANDRI2DFVAQyh9MjXvDaGTd1ujzIXlqgvY75YYuZN_w/exec"
  umask 077
  NID="$NID" NSEC="$NSEC" KEY="$KEY" API="$API" python3 - <<'PY'
import json, os
json.dump({"naver_id": os.environ["NID"].strip(), "naver_secret": os.environ["NSEC"].strip(),
           "api_url": os.environ["API"], "key": os.environ["KEY"]}, open("config.json", "w"), ensure_ascii=False)
PY
  chmod 600 config.json
fi

echo "▶ 4/4 매일 07:15(한국시간) 자동 실행 등록"
OFF=$(date +%z); SIGN=${OFF:0:1}; HH=$((10#${OFF:1:2}))
[ "$SIGN" = "-" ] && HH=$((-HH))
H=$(( ( (7 - 9 + HH) % 24 + 24 ) % 24 ))
LINE="15 $H * * * cd $DIR && /usr/bin/python3 naver_collect.py >> $DIR/collect.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'naver_collect.py' ; echo "$LINE" ) | crontab -
echo "  등록됨: $LINE"

echo
echo "✅ 설치 완료. 지금 시험해 봅니다 (시트에는 쓰지 않음):"
python3 naver_collect.py --test || true
echo
echo "숫자가 맞으면 소급 수집:  cd ~/bogobio && python3 naver_collect.py 2026-10-16 $(date -d 'yesterday' +%F)"
