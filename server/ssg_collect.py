#!/usr/bin/env python3
"""보고바이오 — SSG Open API 수집기 (서버 고정 IP 13.125.122.152, 11/3 파트너오피스에 직접입력 등록)

API: 정산 > 위수탁 기준 정산 조회 GET https://eapi.ssgadm.com/api/settle/v1/ven/sales/list.ssg?critnDt=YYYYMMDD
     헤더 Authorization: 인증키(config "ssg_key"), Accept: application/json
     보고바이오는 SSG 위수탁 판매라 주문검색에는 안 나오고 이 정산 목록에만 나온다(파트너오피스 「위수탁 정산」과 같은 자료).
집계: 날짜 = 기준일(critnDt), 매출 = 순판매액(netAmt), 수량 = salesQty. 음수(반품)는 반품으로.
사용법
  python3 ssg_collect.py                       # 최근 40일 다시 집계 (매일 cron)
  python3 ssg_collect.py 2026-02-01 2026-11-02 # 기간 지정
  python3 ssg_collect.py --test                # 응답 확인 (시트에 안 씀)
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
URL = "https://eapi.ssgadm.com/api/settle/v1/ven/sales/list.ssg"
HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
N = lambda v: float(re.sub(r"[^0-9.\-]", "", str(v if v is not None else 0)) or 0)


def get(day, page=1, fmt="%Y%m%d"):
    q = urllib.parse.urlencode({"critnDt": day.strftime(fmt), "page": page, "pageSize": 1000})
    req = urllib.request.Request(URL + "?" + q, headers={"Authorization": CFG["ssg_key"].strip(), "Accept": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                time.sleep(0.2)
                return json.loads(r.read().decode("utf-8", "replace") or "{}")
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:300]
            if e.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(3 * (attempt + 1)); continue
            raise RuntimeError(f"HTTP {e.code} {msg}")


def rows_of(j):
    res = j.get("result", j)
    code = str(res.get("resultCode", ""))
    if code not in ("00", "0", "SUCCESS"):
        raise RuntimeError(f"{code} {res.get('resultMessage')} {res.get('resultDesc')}"[:200])
    data = res.get("resultData") or []
    if isinstance(data, dict):  # XML→JSON 변환 형태 대비
        data = next((v for v in data.values() if isinstance(v, list)), [data])
    return data, int(res.get("totalCnt") or len(data))


def fetch(d1, d2):
    out, errors = {}, []
    cur = datetime.strptime(d1, "%Y-%m-%d"); end = datetime.strptime(d2, "%Y-%m-%d")
    while cur <= end:
        d = cur.strftime("%Y-%m-%d")
        try:
            rows, page = [], 1
            while True:
                data, tot = rows_of(get(cur, page)); rows += data
                if len(rows) >= tot or not data:
                    break
                page += 1
            out[d] = rows
        except Exception as ex:
            errors.append(f"{d}: {str(ex)[:160]}")
        cur += timedelta(days=1)
    return out, errors


def aggregate(by_day):
    days, prods = [], {}
    for d, rows in by_day.items():
        r = {"date": d, "ch": "SSG", "pay": 0, "orders": set(), "qty": 0, "cancel": 0, "cancelCnt": 0, "refund": 0, "refundCnt": 0, "note": "SSG API(서버)"}
        for o in rows:
            q = N(o.get("salesQty")); amt = N(o.get("netAmt"))
            if not q and not amt:
                continue
            code = "S" + str(o.get("itemId") or ""); name = o.get("itemNm") or code
            p = prods.setdefault(d + code, {"date": d, "code": code, "name": name, "qty": 0, "amt": 0, "cancelQty": 0, "cancelAmt": 0, "retQty": 0, "retAmt": 0, "exQty": 0})
            if q < 0 or amt < 0:
                r["refund"] += abs(amt); r["refundCnt"] += 1; p["retQty"] += abs(q); p["retAmt"] += abs(amt)
            else:
                r["pay"] += amt; r["qty"] += q; r["orders"].add(str(o.get("orordNo") or o.get("ordNo"))); p["qty"] += q; p["amt"] += amt
        days.append(dict(r, orders=len(r["orders"]), pay=round(r["pay"]), refund=round(r["refund"])))
    return days, list(prods.values())


def sheet(action, **kw):
    body = json.dumps({"action": action, "key": CFG["key"], **kw}, ensure_ascii=False).encode()
    req = urllib.request.Request(CFG["api_url"], data=body, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST")
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode() or "{}")


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    now = datetime.now(KST); yday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    if "--test" in argv:
        for d in ("2026-09-30", "2026-09-15", yday):
            try:
                j = get(datetime.strptime(d, "%Y-%m-%d")); rows, tot = rows_of(j)
                print(d, "rows", tot, "sum netAmt", sum(N(o.get("netAmt")) for o in rows))
                for o in rows[:2]:
                    print("  ", {k: o.get(k) for k in ("critnDt", "ordNo", "orordNo", "itemId", "itemNm", "salesQty", "totSellAmt", "netAmt", "settlAmt")})
            except Exception as ex:
                print(d, "ERROR", str(ex)[:300])
        # 9월 전체 합계(파트너오피스 9월 순판매액과 비교용)
        by, err = fetch("2026-09-01", "2026-09-30")
        print("SEP total netAmt", sum(N(o.get("netAmt")) for rs in by.values() for o in rs), "days with data", sum(1 for rs in by.values() if rs), "errors", err[:2] or "none")
        return 0
    d1 = args[0] if args else (now - timedelta(days=40)).strftime("%Y-%m-%d")
    d2 = args[1] if len(args) > 1 else yday
    by_day, errors = fetch(d1, d2)
    if errors and not by_day:
        print("ERRORS", errors[:3]); sheet("alert", text="⚠️ <b>SSG 자동 수집 오류</b>\n" + "\n".join(errors[:5])[:1200]); return 1
    days, prods = aggregate(by_day)
    r1 = sheet("submit", rows=days, method="SSG API(서버)", merge=True)
    r2 = sheet("products", ch="SSG", d1=d1, d2=d2, rows=prods, method="SSG API(서버)")
    print(d1, "~", d2, "days", len(days), "orders", sum(r["orders"] for r in days), "pay", sum(r["pay"] for r in days), "->", str(r1)[:100], str(r2)[:100], "errors", errors[:2])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
