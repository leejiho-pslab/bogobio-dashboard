#!/usr/bin/env bash
# 아난티(이터널저니): 계정·텔레그램 토큰 저장 → 자동 실행 등록 → 첫 로그인(문자 인증) 실행
cd ~/bogobio || exit 1
read -p "이터널저니 아이디: " EJID; read -s -p "이터널저니 비밀번호(입력해도 화면에 안 보임): " EJPW; echo
read -p "텔레그램 봇 토큰(BotFather가 준 숫자:영문 긴 값): " TGT
EJID="$EJID" EJPW="$EJPW" TGT="$TGT" python3 - <<'PY'
import json, os
c = json.load(open("config.json", encoding="utf-8"))
c.update(ej_id=os.environ["EJID"].strip(), ej_pw=os.environ["EJPW"], tg_token=os.environ["TGT"].strip())
json.dump(c, open("config.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("저장 완료")
PY
crontab -l 2>/dev/null | grep -v eternal_collect > /tmp/ct
echo "26 22 * * * cd ~/bogobio && python3 eternal_collect.py >> eternal.log 2>&1" >> /tmp/ct
echo "0 0 * * 1 cd ~/bogobio && python3 eternal_collect.py --login >> eternal.log 2>&1" >> /tmp/ct
echo "*/10 * * * * cd ~/bogobio && python3 eternal_collect.py --ping >> eternal_ping.log 2>&1" >> /tmp/ct
crontab /tmp/ct && echo "CRON OK"
echo "지금 첫 로그인 시작 → 휴대폰 문자 6자리를 텔레그램 단톡방 메시지에 '답장'으로 보내주세요"
python3 eternal_collect.py --login 2025-01-01 "$(date -d yesterday +%F)"
python3 eternal_collect.py --test | head -5
