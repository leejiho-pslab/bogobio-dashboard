#!/usr/bin/env python3
"""매월 1일·15일 재점검: 전전월 1일 ~ 어제를 전 채널 다시 수집해 원장을 바로잡고, 바뀐 내용을 텔레그램으로 보고.
  cron: 40 0 1,15 * *  (한국시간 09:40, 매일 수집·08시 보고가 끝난 뒤)
  python3 recheck.py            # 정기 실행
  python3 recheck.py 2026-09-01 2026-11-08   # 기간 지정"""
import json, os, subprocess, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
KST = timezone(timedelta(hours=9)); HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))

def sheet(action, timeout=330, **kw):
    body = json.dumps({"action": action, "key": CFG["key"], **kw}, ensure_ascii=False).encode()
    for i in range(3):
        try:
            r = urllib.request.urlopen(urllib.request.Request(CFG["api_url"], data=body, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST"), timeout=timeout)
            return json.loads(r.read().decode() or "{}")
        except Exception as e:
            if i == 2: return {"ok": False, "error": str(e)[:200]}
            time.sleep(10)

def snapshot(d1, d2):
    j = sheet("data"); S = {}
    for r in j.get("daily") or []:
        if d1 <= r["date"] <= d2:
            k = (r["ch"], r["date"][:7]); x = S.setdefault(k, [0, 0]); x[0] += r.get("net") or 0; x[1] += r.get("orders") or 0
    return S

def months(d1, d2):
    out, cur = [], datetime.strptime(d1[:7] + "-01", "%Y-%m-%d")
    while cur.strftime("%Y-%m-%d") <= d2:
        nxt = (cur + timedelta(days=32)).replace(day=1)
        out.append((max(d1, cur.strftime("%Y-%m-%d")), min(d2, (nxt - timedelta(days=1)).strftime("%Y-%m-%d")))); cur = nxt
    return out

def main(argv):
    now = datetime.now(KST); yday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    m = now.month - 2; y = now.year + (m - 1) // 12; m = (m - 1) % 12 + 1
    d1 = argv[0] if argv else f"{y}-{m:02d}-01"; d2 = argv[1] if len(argv) > 1 else yday
    print(now.strftime("%F %T"), "RECHECK", d1, "~", d2, flush=True)
    before = snapshot(d1, d2); fails = []
    jobs = [("스마트스토어", ["naver_collect.py", d1, d2]), ("쿠팡", ["coupang_collect.py", d1, d2]), ("11번가", ["elevenst_collect.py", d1, d2]),
            ("롯데ON", ["lotteon_collect.py", d1, d2]), ("SSG", ["ssg_collect.py", d1, d2])]
    if os.path.exists(os.path.join(HERE, "eternal_collect.py")) and CFG.get("ej_id"):
        jobs.append(("아난티", ["eternal_collect.py", d1, d2]))  # 로그인 끊겨 있으면 조용히 건너뜀
    for name, cmd in jobs:
        t0 = time.time()
        try:
            p = subprocess.run([sys.executable] + cmd, cwd=HERE, capture_output=True, text=True, timeout=3000)
            tail = (p.stdout + p.stderr).strip().splitlines()[-1:] or [""]
            print(f"[{name}] rc={p.returncode} {int(time.time()-t0)}s {tail[0][:160]}", flush=True)
            if p.returncode != 0: fails.append(f"{name}: {tail[0][:120]}")
        except Exception as e:
            fails.append(f"{name}: {e}"); print("ERROR", name, e, flush=True)
    for a, b in months(d1, d2):  # 자사몰·영문몰(카페24)은 시트가 한 달씩 다시 수집
        r = sheet("cafe24Range", start=a, end=b, timeout=400); print(f"[카페24] {a}~{b} {str(r)[:120]}", flush=True)
        if not r.get("ok"): fails.append(f"카페24 {a[:7]}: {str(r)[:120]}")
    after = snapshot(d1, d2)
    diffs = []
    for k in sorted(set(before) | set(after)):
        b0, a0 = before.get(k, [0, 0]), after.get(k, [0, 0])
        if round(a0[0]) != round(b0[0]) or a0[1] != b0[1]:
            diffs.append(f"· {k[0]} {int(k[1][5:])}월: {b0[0]/1e4:,.1f}만 → <b>{a0[0]/1e4:,.1f}만</b> ({(a0[0]-b0[0])/1e4:+,.1f}만, 주문 {b0[1]}→{a0[1]})")
    head = f"🔁 <b>정기 재점검</b> {d1} ~ {d2}\n"
    body = ("바뀐 숫자 없음 — 원장이 채널 원본과 일치합니다." if not diffs else "바로잡은 항목:\n" + "\n".join(diffs[:25]) + (f"\n…외 {len(diffs)-25}건" if len(diffs) > 25 else ""))
    if fails: body += "\n\n⚠️ 실패: " + " / ".join(fails)[:600]
    print(head + body, flush=True); sheet("alert", text=head + body)
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
