#!/usr/bin/env bash
# 보고바이오 — 쿠팡 수집 설치 + 스마트스토어·쿠팡 2025-01-01 소급 수집 (Lightsail)
# 실행: bash <(curl -fsSL https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/<커밋>/server/setup_coupang.sh) <커밋>
set -uo pipefail
REF="${1:-main}"
DIR="$HOME/bogobio"; RAW="https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/$REF/server"
cd "$DIR" || { echo "~/bogobio not found. Run install.sh first."; exit 1; }

echo "[1/5] Downloading collectors ($REF) ..."
curl -fsSL "$RAW/naver_collect.py" -o naver_collect.py && curl -fsSL "$RAW/coupang_collect.py" -o coupang_collect.py && chmod 700 *.py || { echo "download failed"; exit 1; }

echo "[2/5] Coupang keys"
if python3 -c "import json,sys; c=json.load(open('config.json')); sys.exit(0 if c.get('cp_secret') else 1)"; then
  echo "  already saved (skip)"
else
  read -r -p "  Coupang vendor code (A0...) : " CPV
  read -r -p "  Coupang Access Key          : " CPA
  read -r -p "  Coupang Secret Key          : " CPS; echo "  (secret received: ${#CPS} chars)"
  CPV="$CPV" CPA="$CPA" CPS="$CPS" python3 - <<'PY'
import json, os
c = json.load(open("config.json"))
c.update(cp_vendor=os.environ["CPV"].strip(), cp_access=os.environ["CPA"].strip(), cp_secret=os.environ["CPS"].strip())
json.dump(c, open("config.json", "w"), ensure_ascii=False)
PY
  chmod 600 config.json
fi

echo "[3/5] Connection test (not written to the sheet)"
python3 coupang_collect.py --test
if [ $? -ne 0 ]; then
  echo
  echo "!! Coupang test failed. If you see 'ip address ... is not allowed':"
  echo "   Wing > 판매자정보 > 추가판매정보 > OPEN API 연동정보 > 수정 > IP 13.125.122.152"
  exit 1
fi

echo "[4/5] Scheduling daily Coupang run at 07:20 KST ..."
OFF=$(date +%z); SIGN=${OFF:0:1}; HH=$((10#${OFF:1:2})); [ "$SIGN" = "-" ] && HH=$((-HH))
H=$(( ( (7 - 9 + HH) % 24 + 24 ) % 24 ))
LINE="20 $H * * * cd $DIR && /usr/bin/python3 coupang_collect.py >> $DIR/coupang.log 2>&1"
CUR=$(crontab -l 2>/dev/null | grep -v 'coupang_collect.py' || true)
printf '%s\n%s\n' "$CUR" "$LINE" | sed '/^$/d' | crontab -
echo "  OK: $LINE"

YDAY=$(TZ=Asia/Seoul date -d 'yesterday' +%F)
echo "[5/5] Backfill 2025-01-01 ~ $YDAY in background (smartstore, then coupang)"
nohup sh -c "python3 naver_collect.py 2025-01-01 $YDAY; python3 coupang_collect.py 2025-01-01 $YDAY; echo ALL-DONE" > backfill.log 2>&1 &
echo
echo "STARTED. You can close this window. Progress:  tail -f ~/bogobio/backfill.log"
