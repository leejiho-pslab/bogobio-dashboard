#!/usr/bin/env bash
# 아난티 계정·토큰 다시 입력 (영문 안내, 입력값이 화면에 보임 → 확인 후 엔터)
cd ~/bogobio || exit 1
ask() { local v=""; while [ -z "$v" ]; do read -r -p "$1: " v; [ -z "$v" ] && echo "  (empty - type or paste again)"; done; printf '%s' "$v"; }
EJID=$(ask "ETERNAL ID"); echo
EJPW=$(ask "ETERNAL PASSWORD (visible)"); echo
TGT=$(ask "TELEGRAM BOT TOKEN (123456789:AA...)"); echo
EJID="$EJID" EJPW="$EJPW" TGT="$TGT" python3 -c "import json,os;c=json.load(open('config.json',encoding='utf-8'));c.update(ej_id=os.environ['EJID'].strip(),ej_pw=os.environ['EJPW'],tg_token=os.environ['TGT'].strip());json.dump(c,open('config.json','w',encoding='utf-8'),ensure_ascii=False,indent=1);print('SAVED id=%s pw_len=%d token_ok=%s'%(c['ej_id'],len(c['ej_pw']),':' in c['tg_token']))"
clear
echo "LOGIN START -> reply the 6-digit SMS code to the bot message in Telegram"
python3 eternal_collect.py --login --nocollect && python3 eternal_collect.py --test 2026-09-01 "$(date -d yesterday +%F)"
