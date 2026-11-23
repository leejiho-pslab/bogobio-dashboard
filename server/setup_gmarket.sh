#!/usr/bin/env bash
# G마켓/옥션 서버 수집 설치: 예비 메모리 2GB + 브라우저 + 계정 입력 + 1일·15일 12:10 예약 + 시험 조회
# 실행: bash <(curl -fsSL https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/<SHA>/server/setup_gmarket.sh) <SHA>
cd ~/bogobio || exit 1
B=https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/$1/server
echo "[1/5] swap"
if [ "$(free -m | awk '/Swap/{print $2}')" -lt 1800 ] && [ ! -f /swapfile_bogo ]; then
  sudo fallocate -l 2G /swapfile_bogo && sudo chmod 600 /swapfile_bogo && sudo mkswap /swapfile_bogo >/dev/null && sudo swapon /swapfile_bogo \
  && echo '/swapfile_bogo none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
free -m | awk '/Swap/{print "  swap MB:",$2}'
echo "[2/5] browser (3~6 min)"
sudo apt-get update -qq >/dev/null; sudo apt-get install -y -qq python3-venv >/dev/null || { echo "APT FAIL"; exit 1; }
[ -x gmvenv/bin/python ] || python3 -m venv gmvenv
gmvenv/bin/pip install -q playwright==1.49.1 || { echo "PIP FAIL"; exit 1; }
sudo gmvenv/bin/playwright install-deps chromium >/dev/null 2>&1 || { echo "DEPS FAIL"; exit 1; }
gmvenv/bin/playwright install chromium >/dev/null 2>&1 || { echo "BROWSER FAIL"; exit 1; }
echo "  browser OK"
echo "[3/5] download"
for f in gmarket_collect.py recheck.py; do curl -sfO $B/$f || { echo "DOWNLOAD FAIL $f"; exit 1; }; done
gmvenv/bin/python -c "import ast;[ast.parse(open(f).read()) for f in ['gmarket_collect.py','recheck.py']];print('  code OK')" || exit 1
echo "[4/5] G-market account (ESM PLUS master ID)"
ask() { local v=""; while [ -z "$v" ]; do read -r -p "$1: " v; [ -z "$v" ] && echo "  (empty - type or paste again)"; done; printf '%s' "$v"; }
GMID=$(ask "ESM PLUS ID"); echo
GMPW=$(ask "ESM PLUS PASSWORD (visible)"); echo
GMID="$GMID" GMPW="$GMPW" python3 -c "import json,os;c=json.load(open('config.json',encoding='utf-8'));c.update(gm_id=os.environ['GMID'].strip(),gm_pw=os.environ['GMPW']);json.dump(c,open('config.json','w',encoding='utf-8'),ensure_ascii=False,indent=1);print('  SAVED id=%s pw_len=%d tg=%s'%(c['gm_id'],len(c['gm_pw']),bool(c.get('tg_token'))))"
(crontab -l 2>/dev/null | grep -v gmarket_collect; echo "10 3 1,15 * * cd $HOME/bogobio && gmvenv/bin/python gmarket_collect.py >> gmarket.log 2>&1") | crontab -
echo "  schedule: 1st/15th 12:10 KST"
clear
echo "[5/5] TEST LOGIN -> if Telegram asks, reply the G-market SMS code"
gmvenv/bin/python gmarket_collect.py --test 2026-10-01 "$(date -d yesterday +%F)" 2>&1 | tail -25
free -m | head -2
