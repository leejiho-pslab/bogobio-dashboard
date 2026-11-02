#!/usr/bin/env bash
# 롯데ON 수집기 설치. 사용: bash <(curl ...setup_lotteon.sh) 인증키
cd ~/bogobio || exit 1
curl -sSLo lotteon_collect.py "https://raw.githubusercontent.com/leejiho-pslab/bogobio-dashboard/main/server/lotteon_collect.py"
if [ -n "$1" ]; then python3 -c "import json,sys;c=json.load(open('config.json'));c['lo_key']=sys.argv[1];json.dump(c,open('config.json','w'),ensure_ascii=False,indent=1);print('key saved')" "$1"; fi
python3 lotteon_collect.py --test
