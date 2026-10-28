#!/usr/bin/env python3
"""보고바이오 — 스마트스토어(네이버 커머스API) 일일 실적 수집 → 구글 시트 원장 기록

사용법
  python3 naver_collect.py                 # 어제(한국시간) 1일 수집
  python3 naver_collect.py 2026-10-16      # 특정 날짜
  python3 naver_collect.py 2026-10-16 2026-10-26   # 기간 소급 수집
  python3 naver_collect.py --test          # 어제 데이터를 시트에 쓰지 않고 화면에만 출력
  매월 15일 자동 실행 때는 전전월 1일 ~ 어제를 다시 수집 (늦게 바뀐 취소·반품·교환 반영)
  제품별 판매(수량·금액·취소·반품·교환)도 함께 시트 '제품원장'에 기록

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
    for attempt in range(6):
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:  # 호출 한도·일시 오류 → 잠시 후 재시도
                time.sleep(2 * (attempt + 1)); continue
            raise RuntimeError(f"{url.split('?')[0]} {e.code} {msg}")
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 5:
                time.sleep(3 * (attempt + 1)); continue
            raise RuntimeError(f"{url.split('?')[0]} network {e}")


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


def changed_ids(start, end):
    """[start, end) 사이에 '마지막 상태 변경'이 일어난 상품주문 ID. API 한 번에 최대 24시간이라 하루씩 나눠 조회."""
    ids, cur, n = set(), start, 0
    total = max(1, int((end - start).total_seconds() // 86400) + 1)
    while cur < end:
        n += 1
        if total > 7 and (n % 30 == 0 or n == 1):
            print(f"  scanning changes {cur.strftime('%Y-%m-%d')} ... ({n}/{total} days, {len(ids)} items)", flush=True)
        frm, to = cur, min(cur + timedelta(hours=24), end)
        f = frm.isoformat(timespec="milliseconds")
        for _ in range(200):
            q = urllib.parse.urlencode({"lastChangedFrom": f, "lastChangedTo": to.isoformat(timespec="milliseconds")})
            d = (nget("/v1/pay-order/seller/product-orders/last-changed-statuses?" + q).get("data") or {})
            ids.update(s["productOrderId"] for s in d.get("lastChangeStatuses") or [])
            more = d.get("more") or {}
            if not more.get("moreFrom"):
                break
            f = more["moreFrom"]
        cur = to
    return ids


def qna(date):
    start = kst_day(date)
    try:  # 상품 문의 (실패해도 매출은 기록)
        q = urllib.parse.urlencode({"fromDate": start.isoformat(timespec="milliseconds"),
                                    "toDate": (start + timedelta(days=1, milliseconds=-1)).isoformat(timespec="milliseconds"),
                                    "page": 1, "size": 100})
        j = nget("/v1/contents/qnas?" + q)
        items = j.get("contents") or j.get("content") or j.get("data") or []
        return len(items), sum(1 for it in items if not (it.get("answered") or it.get("answer")))
    except Exception as e:
        print("  (QnA lookup failed, ignored) " + str(e)[:150])
        return "", ""


def collect(days, detail=False):
    """결제일 기준 집계. 결제 후 상태가 바뀐(배송중·구매확정 등) 주문도 빠지지 않도록
    첫날 00시부터 '지금'까지 변경된 상품주문을 모두 모은 뒤 결제일·취소일·반품일로 나눠 담는다."""
    start = kst_day(days[0]); now = datetime.now(KST)
    ids = list(changed_ids(start, now))
    print(f"  found {len(ids)} product orders, fetching details ...", flush=True)
    B = {d: {"pay": 0.0, "qty": 0.0, "orders": set(), "cancel": 0.0, "cancelCnt": 0, "refund": 0.0, "refundCnt": 0, "lines": []} for d in days}
    P = {}  # (날짜, 상품번호) → 제품별 집계

    def prod(d, po):
        code = str(po.get("productId") or po.get("originalProductId") or po.get("productName"))
        k = (d, code)
        if k not in P:
            P[k] = {"date": d, "code": code, "name": po.get("productName") or code, "qty": 0.0, "amt": 0.0,
                    "cancelQty": 0.0, "cancelAmt": 0.0, "retQty": 0.0, "retAmt": 0.0, "exQty": 0.0}
        return P[k]
    for i in range(0, len(ids), 300):
        for x in npost("/v1/pay-order/seller/product-orders/query", {"productOrderIds": ids[i:i + 300]}).get("data") or []:
            o, po = x.get("order") or {}, x.get("productOrder") or {}
            amt = float(po.get("totalPaymentAmount") or 0)
            q = float(po.get("quantity") or 0)
            pd = to_kst_date(o.get("paymentDate"))
            if pd in B:
                b = B[pd]; b["pay"] += amt; b["qty"] += q; b["orders"].add(o.get("orderId"))
                p = prod(pd, po); p["qty"] += q; p["amt"] += amt
                b["lines"].append(f"    {o.get('paymentDate','')[:19]}  {po.get('productOrderId')}  {int(amt):>9,}  x{po.get('quantity')}  {po.get('productOrderStatus','')}")
            cd = to_kst_date((x.get("cancel") or {}).get("cancelCompletedDate"))
            if cd in B:
                B[cd]["cancel"] += amt; B[cd]["cancelCnt"] += 1
                p = prod(cd, po); p["cancelQty"] += q; p["cancelAmt"] += amt
            rd = to_kst_date((x.get("return") or {}).get("returnCompletedDate"))
            if rd in B:
                B[rd]["refund"] += amt; B[rd]["refundCnt"] += 1
                p = prod(rd, po); p["retQty"] += q; p["retAmt"] += amt
            ex = x.get("exchange") or {}
            xd = to_kst_date(ex.get("claimRequestDate")) if ex and "REJECT" not in str(ex.get("claimStatus", "")) else None
            if xd in B:
                prod(xd, po)["exQty"] += q
    rows = []
    for d in days:
        b = B[d]; inq, unans = qna(d) if len(days) <= 31 else ("", "")  # 긴 소급 수집 때는 문의 조회 생략
        rows.append({"date": d, "ch": "스마트스토어", "pay": round(b["pay"]), "orders": len(b["orders"]), "qty": round(b["qty"], 1),
                     "cancel": round(b["cancel"]), "cancelCnt": b["cancelCnt"], "refund": round(b["refund"]), "refundCnt": b["refundCnt"],
                     "inq": inq, "unans": unans, "note": "네이버API(서버)", "_lines": b["lines"]})
    return rows, list(P.values())


def sheet(action, **kw):
    return http("POST", CFG["api_url"], {"action": action, "key": CFG["key"], **kw}, headers={"Content-Type": "text/plain;charset=utf-8"})


def main(argv):
    test = "--test" in argv
    args = [a for a in argv if not a.startswith("--")]
    yday = (datetime.now(KST) - timedelta(days=1)).strftime("%Y-%m-%d")
    d1 = args[0] if args else yday
    d2 = args[1] if len(args) > 1 else d1
    today = datetime.now(KST)
    if not args and today.day == 15:  # 매월 15일: 전전월 1일 ~ 어제 재수집
        m = today.month - 2; y = today.year + (m - 1) // 12; m = (m - 1) % 12 + 1
        d1 = f"{y}-{m:02d}-01"; d2 = yday
        print(f"15th re-collect: {d1} ~ {d2}")
    days, d = [], kst_day(d1)
    while d <= kst_day(d2):
        days.append(d.strftime("%Y-%m-%d")); d += timedelta(days=1)
    rows, prows, errors = [], [], []
    try:
        rows, prows = collect(days)
        for r in rows:
            if len(rows) > 40 and not r["pay"] and not r["cancel"] and "--detail" not in argv:
                continue
            print(f"{r['date']} SMARTSTORE paid {r['pay']:,} KRW | orders {r['orders']} | qty {r['qty']} | cancel {r['cancel']:,} ({r['cancelCnt']}) | return {r['refund']:,} ({r['refundCnt']}) | QnA {r['inq']}")
            if "--detail" in argv:
                print("\n".join(r["_lines"]) or "    (no paid orders)")
    except Exception as e:
        errors.append(f"{d1}~{d2}: {e}"); print("ERROR " + errors[-1])
    for r in rows:
        r.pop("_lines", None)
    if prows:
        top = {}
        for p in prows:
            t = top.setdefault(p["name"], [0, 0, 0, 0]); t[0] += p["qty"]; t[1] += p["amt"]; t[2] += p["retQty"]; t[3] += p["exQty"]
        print(f"PRODUCTS: {len(top)} items")
        for n, t in sorted(top.items(), key=lambda kv: -kv[1][1])[:10]:
            print(f"  {int(t[1]):>11,} KRW  qty {t[0]:g}  return {t[2]:g}  exchange {t[3]:g}  | {n[:40]}")
    if test:
        print("(--test: not written to the sheet)"); return 1 if errors else 0
    if rows:
        for i in range(0, len(rows), 60):  # 60일씩 나눠 전송
            print(f"Sheet result ({rows[i]['date']}~{rows[min(i + 59, len(rows) - 1)]['date']}):",
                  sheet("submit", rows=rows[i:i + 60], method="API(서버)", merge=True), flush=True)
    if not errors:
        for i in range(0, len(days), 60):  # 제품별도 60일씩, 그 기간을 통째로 교체
            a, b = days[i], days[min(i + 59, len(days) - 1)]
            part = [p for p in prows if a <= p["date"] <= b]
            print(f"Products ({a}~{b}):", sheet("products", ch="스마트스토어", d1=a, d2=b, rows=part, method="API(서버)"), flush=True)
    if errors:
        try:
            sheet("alert", text="⚠️ <b>스마트스토어 자동 수집 오류</b>\n" + "\n".join(errors)[:1500] +
                  "\n(IP 변경·시크릿 재발급·인증 기한 만료 여부 확인)")
        except Exception as e:
            print("alert failed:", e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
