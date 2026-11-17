#!/usr/bin/env bash
# 쿠팡 수집기 갱신(구간 경계 주문 누락 수정) 후 9/1~어제 쿠팡만 다시 수집
cd ~/bogobio || exit 1
curl -sfO https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/$1/server/coupang_collect.py || { echo "DOWNLOAD FAIL"; exit 1; }
python3 -c "import ast;ast.parse(open('coupang_collect.py').read());print('UPDATE OK')"
python3 coupang_collect.py 2026-09-01 "$(date -d yesterday +%F)" | tail -4
