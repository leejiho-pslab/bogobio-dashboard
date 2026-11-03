#!/usr/bin/env bash
# SSG: 인증키 저장 → 응답 테스트 (시트에 쓰지 않음)
cd ~/bogobio || exit 1
read -p "SSG API 인증키(파트너오피스 API 계정정보의 긴 값): " K
K="$K" python3 -c "import json,os;c=json.load(open('config.json',encoding='utf-8'));c['ssg_key']=os.environ['K'].strip();json.dump(c,open('config.json','w',encoding='utf-8'),ensure_ascii=False,indent=1);print('저장 완료')"
python3 ssg_collect.py --test
