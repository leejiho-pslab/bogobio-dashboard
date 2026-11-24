#!/usr/bin/env python3
"""G마켓/옥션 수집 알림 (매월 1일·15일 12:10 KST).
ESM PLUS는 서버 접속 시 그림 문자(자동입력 방지)를 요구해 서버 자동 로그인이 불가(11/24 확인).
→ 마지막 기록일을 알려주고, 담당자가 데스크톱 앱에서 로그인한 뒤 Claude에게 'G마켓 수집해줘'라고 요청하게 한다."""
import json, os, urllib.request
from datetime import datetime, timedelta, timezone
HERE = os.path.dirname(os.path.abspath(__file__)); CFG = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
def sheet(action, **kw):
    body = json.dumps({"action": action, "key": CFG["key"], **kw}, ensure_ascii=False).encode()
    r = urllib.request.urlopen(urllib.request.Request(CFG["api_url"], data=body, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST"), timeout=300)
    return json.loads(r.read().decode() or "{}")
d = sheet("data"); last = max([r["date"] for r in d.get("daily", []) if r.get("ch") == "G마켓/옥션"] or ["(없음)"])
yday = (datetime.now(timezone(timedelta(hours=9))) - timedelta(days=1)).strftime("%Y-%m-%d")
nxt = (datetime.strptime(last, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d") if last[0].isdigit() else "?"
print(sheet("alert", text=f"🛒 <b>G마켓/옥션 정기 수집 차례</b>\n마지막 기록: {last}\n빈 기간: {nxt} ~ {yday}\n\n1) 컴퓨터에서 Claude 앱 열기 → 브라우저 패널에서 ESM PLUS 로그인\n2) Claude에게 <b>'G마켓 수집해줘'</b>라고 요청"))
