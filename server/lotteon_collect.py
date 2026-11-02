#!/usr/bin/env python3
"""보고바이오 — 롯데ON Open API 수집기 (서버 고정 IP 13.125.122.152)

준비: 롯데ON 판매자센터 → 판매자정보 → OpenAPI관리 → 직접입력 IP 등록(완료) · 인증키 → config.json "lo_key"
API: 정산 > 상품별 주문내역 POST https://openapi.lotteon.com/v1/openapi/settle/v1/se/SettleProduct {startDate, endDate}(yyyymmdd)
     조회 기준 = 정산기준일(중개 판매는 구매확정일). 그래서 주문일 뒤 45일까지 훑어 결제일(pyDttm)로 다시 집계한다.
집계: 매출 = 판매단가(slUprc) × 수량(slQty) (대시보드 롯데ON 정의: 롯데ON 할인 전 판매가), 날짜 = 결제일.
      주문유형 40(반품) → 반품금액(반품완료일), 20(취소) → 취소금액.
사용법
  python3 lotteon_collect.py                 # 최근 40일 다시 집계 (매일 cron)
  python3 lotteon_collect.py 2025-01-01 2026-11-01
  python3 lotteon_collect.py --test          # 정산기준일 최근 70일 응답 확인 (시트에 쓰지 않음)
"""
import json, os, re, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
URL = "https://openapi.lotteon.com/v1/openapi/settle/v1/se/SettleProduct"
HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
N = lambda v: float(re.sub(r"[^0-9.\-]", "", str(v or 0)) or 0)


def post(d1, d2):
    body = json.dumps({"startDate": d1, "endDate": d2}).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers={
        "Authorization": "Bearer " + CFG["lo_key"], "Content-Type": "application/json", "Accept": "application/json",
        "Accept-Language": "ko", "X-Timezone": "GMT+09:00"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                time.sleep(0.3)
                return json.loads(r.read().decode("utf-8", "replace") or "{}")
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:300]
            if e.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(3 * (attempt + 1)); continue
            raise RuntimeError(f"HTTP {e.code} {msg}")


def fetch(d1, d2):
    """정산기준일 [d1, d2+45일](오늘 이전)을 7일씩 조회"""
    out, errors = [], []
    yday = (datetime.now(KST) - timedelta(days=1)).replace(tzinfo=None)
    cur = datetime.strptime(d1, "%Y-%m-%d"); end = min(datetime.strptime(d2, "%Y-%m-%d") + timedelta(days=45), yday)
    while cur <= end:
        b = min(cur + timedelta(days=6), end)
        try:
            j = post(cur.strftime("%Y%m%d"), b.strftime("%Y%m%d"))
            if str(j.get("returnCode")) not in ("0000", "SUCCESS", "200"):
                raise RuntimeError(f"{j.get('returnCode')} {j.get('message')} {j.get('subMessages')}"[:200])
            out += j.get("data") or []
        except Exception as ex:
            errors.append(f"{cur:%Y-%m-%d}: {str(ex)[:160]}")
        cur = b + timedelta(days=1)
    return out, errors


def ymd(v):
    d = re.sub(r"[^0-9]", "", str(v or ""))[:8]
    return f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) == 8 else None


def aggregate(rows, d1, d2):
    days, prods, seen = {}, {}, set()
    cur = datetime.strptime(d1, "%Y-%m-%d"); end = datetime.strptime(d2, "%Y-%m-%d")
    while cur <= end:
        d = cur.strftime("%Y-%m-%d"); days[d] = {"date": d, "ch": "롯데온", "pay": 0, "orders": set(), "qty": 0, "cancel": 0, "cancelCnt": 0, "refund": 0, "refundCnt": 0, "note": "롯데ON API(서버)"}
        cur += timedelta(days=1)
    for o in rows:
        key = f"{o.get('odNo')}|{o.get('odSeq')}|{o.get('procSeq')}|{o.get('odTypCd')}"
        if key in seen:
            continue
        seen.add(key)
        typ = str(o.get("odTypCd") or "10")
        q = abs(N(o.get("slQty"))) or 1; amt = abs(N(o.get("slUprc"))) * q or abs(N(o.get("slAmt")))
        code = "L" + str(o.get("spdNo") or ""); name = o.get("spdNm") or code
        if typ in ("10", "01"):
            d = ymd(o.get("pyDttm")) or ymd(o.get("seStdDt"))
            if d not in days:
                continue
            days[d]["pay"] += amt; days[d]["qty"] += q; days[d]["orders"].add(str(o.get("odNo")))
            p = prods.setdefault(d + code, {"date": d, "code": code, "name": name, "qty": 0, "amt": 0, "cancelQty": 0, "cancelAmt": 0, "retQty": 0, "retAmt": 0, "exQty": 0})
            p["qty"] += q; p["amt"] += amt
        elif typ in ("20", "40"):
            d = ymd(o.get("rtngCmptDttm")) or ymd(o.get("seStdDt"))
            if d not in days:
                continue
            p = prods.setdefault(d + code, {"date": d, "code": code, "name": name, "qty": 0, "amt": 0, "cancelQty": 0, "cancelAmt": 0, "retQty": 0, "retAmt": 0, "exQty": 0})
            if typ == "20":
                days[d]["cancel"] += amt; days[d]["cancelCnt"] += 1; p["cancelQty"] += q; p["cancelAmt"] += amt
            else:
                days[d]["refund"] += amt; days[d]["refundCnt"] += 1; p["retQty"] += q; p["retAmt"] += amt
    out = [dict(r, orders=len(r["orders"]), pay=round(r["pay"]), cancel=round(r["cancel"]), refund=round(r["refund"])) for r in days.values()]
    return out, list(prods.values())


def sheet(action, **kw):
    body = json.dumps({"action": action, "key": CFG["key"], **kw}, ensure_ascii=False).encode()
    req = urllib.request.Request(CFG["api_url"], data=body, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST")
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode() or "{}")


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    now = datetime.now(KST); yday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    if "--test" in argv:
        rows, errors = fetch((now - timedelta(days=70)).strftime("%Y-%m-%d"), (now - timedelta(days=46)).strftime("%Y-%m-%d"))
        print("LOTTEON TEST rows", len(rows), "errors", errors[:2] or "none")
        for o in rows[:5]:
            print({k: o.get(k) for k in ("odNo", "odSeq", "odTypCd", "pyDttm", "seStdDt", "slQty", "slUprc", "slAmt", "spdNo")})
        return 1 if errors and not rows else 0
    d1 = args[0] if args else (now - timedelta(days=40)).strftime("%Y-%m-%d")
    d2 = args[1] if len(args) > 1 else yday
    rows, errors = fetch(d1, d2)
    if errors and not rows:
        print("ERRORS", errors[:3]); sheet("alert", text="⚠️ <b>롯데ON 자동 수집 오류</b>\n" + "\n".join(errors[:5])[:1200]); return 1
    days, prods = aggregate(rows, d1, d2)
    r1 = sheet("submit", rows=days, method="롯데ON API(서버)", merge=True)
    r2 = sheet("products", ch="롯데온", d1=d1, d2=d2, rows=prods, method="롯데ON API(서버)")
    print(d1, "~", d2, "rows", len(rows), "orders", sum(r["orders"] for r in days), "->", str(r1)[:100], str(r2)[:100], "errors", errors[:2])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
