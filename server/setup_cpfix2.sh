#!/usr/bin/env bash
# 쿠팡 압축 응답(gzip) 대응 + 실패 시 0원 덮어쓰기 방지 → 연결 시험 → 11/1~어제 재수집
cd ~/bogobio || exit 1
curl -sfO https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/$1/server/coupang_collect.py || { echo "DOWNLOAD FAIL"; exit 1; }
python3 -c "import ast;ast.parse(open('coupang_collect.py').read());print('UPDATE OK')" || exit 1
python3 coupang_collect.py --test || { echo "TEST FAIL - send this screen"; exit 1; }
python3 coupang_collect.py 2026-11-01 "$(TZ=Asia/Seoul date -d yesterday +%F)" | tail -6
