#!/usr/bin/env bash
# G마켓 서버 자동 로그인 중단 → 1일·15일 12:10 텔레그램 알림으로 교체, 저장한 G마켓 비밀번호 삭제
cd ~/bogobio || exit 1
curl -sfO https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/$1/server/gm_remind.py || { echo "DOWNLOAD FAIL"; exit 1; }
(crontab -l 2>/dev/null | grep -v gmarket_collect | grep -v gm_remind; echo "10 3 1,15 * * cd $HOME/bogobio && python3 gm_remind.py >> gmarket.log 2>&1") | crontab -
python3 -c "import json;c=json.load(open('config.json'));c.pop('gm_pw',None);json.dump(c,open('config.json','w'),ensure_ascii=False,indent=1);print('PW REMOVED')"
crontab -l | grep -c gm_remind && python3 gm_remind.py
