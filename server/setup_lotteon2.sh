#!/usr/bin/env bash
# 롯데ON: 2025-01-01부터 소급 + 매일 07:28(KST) 자동 실행 등록
cd ~/bogobio || exit 1
python3 lotteon_collect.py 2025-01-01 "$(date -d yesterday +%F)"
if ! crontab -l 2>/dev/null | grep -q lotteon_collect; then
  H=$(crontab -l | grep coupang_collect | head -1 | awk '{print $2}')
  (crontab -l; echo "28 $H * * * cd ~/bogobio && python3 lotteon_collect.py >> lotteon.log 2>&1") | crontab -
  echo "CRON ADDED"
fi
crontab -l
