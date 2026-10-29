#!/usr/bin/env bash
# 쿠팡 로켓그로스 수집기 반영 + 2025-12 이후 소급 (서버 ~/bogobio 에서 한 번 실행)
set -e
cd ~/bogobio
pkill -f coupang_collect.py || true
curl -sSLO https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/main/server/coupang_collect.py
curl -sSLO https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/main/server/elevenst_collect.py
python3 coupang_collect.py --test
nohup python3 coupang_collect.py 2025-11-01 "$(date -d yesterday +%F)" > backfill_rg.log 2>&1 &
echo "STARTED — 진행: tail -f ~/bogobio/backfill_rg.log"
