#!/usr/bin/env python3
"""보고바이오 — 스마트스토어(네이버 커머스API) 일일 실적 수집 → 구글 시트 원장 기록

사용법
  python3 naver_collect.py                 # 어제(한국시간) 1일 수집
  python3 naver_collect.py 2026-10-16      # 특정 날짜
  python3 naver_collect.py 2026-10-16 2026-10-26   # 기간 소급 수집
  python3 naver_collect.py --test          # 어제 데이터를 시트에 쓰지 않고 화면에만 출력

설정: 같은 폴더의 config.json (install.sh가 만듦, 권한 600)
  {"naver_id": "...", "naver_secret": "$2a$04$...", "api_url": "https://script.google.com/.../exec", "key": "대시보드 비밀번호"}
"""
import base64, json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

import bcrypt

KST = timezone(timedelta(hours=9))
BASE = "https://api.commerce.naver.com/external"
HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
_token = {"v": None, "exp": 0}


def http(method, url, data=None, headers=None, form=False):
    headers = dict(headers or {})
    body = None
    if data is not None:
        if form:
            body = urllib.parse.urlencode(data).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            body = json.dumps(data, ensure_ascii=False).encode()
            headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{url.split('?')[0]} {e.code} {e.read().decode()[:300]}")


def token():
    if _token["v"] and time.time() < _token["exp"]:
        return _token["v"]
    ts = str(int(time.time() * 1000))
    sign = base64.b64encode(bcrypt.hashpw(f"{CFG['naver_id']}_{ts}".encode(), CFG["naver_secret"].encode())).decode()
    j = http("POST", BASE + "/v1/oauth2/token", {"client_id": CFG["naver_id"], "timestamp": ts, "client_secret_sign": sign,
                                                "grant_type": "client_credentials", "type": "SELF"}, form=True)
    if "access_token" not in j:
        raise RuntimeError("토큰 발급 실패: " + json.dumps(j, ensure_ascii=False)[:300])
    _token.update(v=j["access_token"], exp=time.time() + int(j.get("expires_in", 3600)) - 300)
    return _token["v"]


def nget(path):
    return http("GET", BASE + path, headers={"Authorization": "Bearer " + token()})


def npost(path, body):
    return http("POST", BASE + path, body, headers={"Authorization": "Bearer " + token()})


def kst_day(s):
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=KST)


def to_kst_date(iso):
    if not iso:
        return None
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(KST).strftime("%Y-%m-%d")


def daily(date):
    start = kst_day(date)
    frm, to = start.isoformat(timespec="milliseconds"), (start + timedelta(days=1)).isoformat(timespec="milliseconds")
    ids = set()
    for _ in range(100):
        q = urllib.parse.urlencode({"lastChangedFrom": frm, "lastChangedTo": to})
        d = (nget("/v1/pay-order/seller/product-orders/last-changed-statuses?" + q).get("data") or {})
        ids.update(s["productOrderId"] for s in d.get("lastChangeStatuses") or [])
        more = d.get("more") or {}
        if not more.get("moreFrom"):
            break
        frm = more["moreFrom"]
    pay = qty = cancel = refund = 0
    cancel_cnt = refund_cnt = 0
    orders = set()
    ids = list(ids)
    for i in range(0, len(ids), 300):
        for x in npost("/v1/pay-order/seller/product-orders/query", {"productOrderIds": ids[i:i + 300]}).get("data") or []:
            o, po = x.get("order") or {}, x.get("productOrder") or {}
            amt = float(po.get("totalPaymentAmount") or 0)
            if to_kst_date(o.get("paymentDate")) == date:
                pay += amt; qty += float(po.get("quantity") or 0); orders.add(o.get("orderId"))
            if to_kst_date((x.get("cancel") or {}).get("cancelCompletedDate")) == date:
                cancel += amt; cancel_cnt += 1
            if to_kst_date((x.get("return") or {}).get("returnCompletedDate")) == date:
                refund += amt; refund_cnt += 1
    inq, unans = "", ""
    try:  # 상품 문의 (실패해도 매출은 기록)
        q = urllib.parse.urlencode({"fromDate": start.isoformat(timespec="milliseconds"),
                                    "toDate": (start + timedelta(days=1, milliseconds=-1)).isoformat(timespec="milliseconds"),
                                    "page": 1, "size": 100})
        j = nget("/v1/contents/qnas?" + q)
        items = j.get("contents") or j.get("content") or j.get("data") or []
        inq = len(items); unans = sum(1 for it in items if not (it.get("answered") or it.get("answer")))
    except Exception as e:
        print("  (QnA lookup failed, ignored) " + str(e)[:150])
    return {"date": date, "ch": "스마트스토어", "pay": round(pay), "orders": len(orders), "qty": round(qty, 1),
            "cancel": round(cancel), "cancelCnt": cancel_cnt, "refund": round(refund), "refundCnt": refund_cnt,
            "inq": inq, "unans": unans, "note": "네이버API(서버)"}


def sheet(action, **kw):
    return http("POST", CFG["api_url"], {"action": action, "key": CFG["key"], **kw}, headers={"Content-Type": "text/plain;charset=utf-8"})


def main(argv):
    test = "--test" in argv
    args = [a for a in argv if not a.startswith("--")]
    yday = (datetime.now(KST) - timedelta(days=1)).strftime("%Y-%m-%d")
    d1 = args[0] if args else yday
    d2 = args[1] if len(args) > 1 else d1
    days, d = [], kst_day(d1)
    while d <= kst_day(d2):
        days.append(d.strftime("%Y-%m-%d")); d += timedelta(days=1)
    rows, errors = [], []
    for day in days:
        try:
            r = daily(day); rows.append(r)
            print(f"{day} SMARTSTORE paid {r['pay']:,} KRW | orders {r['orders']} | qty {r['qty']} | cancel {r['cancel']:,} ({r['cancelCnt']}) | return {r['refund']:,} ({r['refundCnt']}) | QnA {r['inq']}")
        except Exception as e:
            errors.append(f"{day}: {e}"); print("ERROR " + errors[-1])
    if test:
        print("(--test: not written to the sheet)"); return 1 if errors else 0
    if rows:
        print("Sheet result:", sheet("submit", rows=rows, method="API(서버)", merge=True))
    if errors:
        try:
            sheet("alert", text="⚠️ <b>스마트스토어 자동 수집 오류</b>\n" + "\n".join(errors)[:1500] +
                  "\n(IP 변경·시크릿 재발급·인증 기한 만료 여부 확인)")
        except Exception as e:
            print("alert failed:", e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
