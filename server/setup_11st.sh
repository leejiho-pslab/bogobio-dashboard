#!/usr/bin/env bash
# 11번가 수집기 설치: 내려받기 → 2025-01-01부터 소급 → 매일 07:25(KST) 자동 실행 등록
cd ~/bogobio || exit 1
curl -sSLo elevenst_collect.py "https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/ebf23bbc853e8692ce9c24e1bd47f3924009dda3/server/elevenst_collect.py"
python3 elevenst_collect.py 2025-01-01 "$(date -d yesterday +%F)"
if ! crontab -l 2>/dev/null | grep -q elevenst_collect; then
  H=$(crontab -l | grep coupang_collect | head -1 | awk '{print $2}')
  (crontab -l; echo "25 $H * * * cd ~/bogobio && python3 elevenst_collect.py >> elevenst.log 2>&1") | crontab -
  echo "CRON ADDED"
fi
crontab -l
