#!/usr/bin/env bash
# 오늘 보고 즉시 발송 + 매일 08:20(KST) 예비 발송 등록
cd ~/bogobio || exit 1
python3 push_once.py --check
python3 push_once.py --now
crontab -l 2>/dev/null | grep -v push_once > /tmp/ct
echo "20 23 * * * cd ~/bogobio && python3 push_once.py >> push.log 2>&1" >> /tmp/ct
crontab /tmp/ct && echo "CRON OK"
