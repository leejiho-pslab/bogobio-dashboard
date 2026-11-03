#!/usr/bin/env bash
# SSG: 2026-01-01부터 일별 소급(월말 1줄 기록을 일별로 교체) + 매일 07:30(KST) 자동 실행 등록
cd ~/bogobio || exit 1
python3 ssg_collect.py 2026-01-01 "$(date -d yesterday +%F)"
crontab -l 2>/dev/null | grep -v ssg_collect > /tmp/ct
echo "30 22 * * * cd ~/bogobio && python3 ssg_collect.py >> ssg.log 2>&1" >> /tmp/ct
crontab /tmp/ct && echo "CRON OK" && crontab -l | grep -c collect
