#!/usr/bin/env python3
"""텔레그램 데일리 예비 발송 (서버 cron 08:20 KST). 시트가 오늘 이미 보냈으면 아무것도 안 함.
  python3 push_once.py           # 예비 발송(pushOnce)
  python3 push_once.py --now     # 지금 바로 오늘 보고 발송(push)
  python3 push_once.py --check   # 예약 상태 확인(triggers)"""
import json, os, sys, urllib.request
CFG = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json"), encoding="utf-8"))
def call(action):
    body = json.dumps({"action": action, "key": CFG["key"]}).encode()
    req = urllib.request.Request(CFG["api_url"], data=body, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST")
    return urllib.request.urlopen(req, timeout=300).read().decode()[:800]
a = "push" if "--now" in sys.argv else "triggers" if "--check" in sys.argv else "pushOnce"
r = call(a); print(a, r)
if a == "pushOnce" and "unknown" in r:  # 시트 새 버전 배포 전: 예약 확인만 하고 넘어감
    print("pushOnce 미배포 - 건너뜀")
