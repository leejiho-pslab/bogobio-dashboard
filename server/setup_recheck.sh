#!/usr/bin/env bash
# 매월 1일·15일 09:40(KST) 전 채널 재점검 등록 (+ 수집기 3개 갱신: 각자 15일 재수집하던 부분 제거)
cd ~/bogobio || exit 1
B=https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/$1/server
for f in recheck.py naver_collect.py coupang_collect.py elevenst_collect.py; do curl -sfO $B/$f || { echo "DOWNLOAD FAIL $f"; exit 1; }; done
python3 -c "import ast;[ast.parse(open(f).read()) for f in ['recheck.py','naver_collect.py','coupang_collect.py','elevenst_collect.py']];print('SYNTAX OK')"
crontab -l 2>/dev/null | grep -v recheck.py > /tmp/ct
echo "40 0 1,15 * * cd ~/bogobio && python3 recheck.py >> recheck.log 2>&1" >> /tmp/ct
crontab /tmp/ct && echo "CRON OK" && crontab -l | grep recheck
