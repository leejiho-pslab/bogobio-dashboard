#!/usr/bin/env bash
# 재점검 보고에 채널별 결과 표시 + 쿠팡 매일 재수집 7→14일
cd ~/bogobio || exit 1
B=https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/$1/server
for f in recheck.py coupang_collect.py; do curl -sfO $B/$f || { echo "DOWNLOAD FAIL $f"; exit 1; }; done
python3 -c "import ast;[ast.parse(open(f).read()) for f in ['recheck.py','coupang_collect.py']];print('UPDATE OK')"
