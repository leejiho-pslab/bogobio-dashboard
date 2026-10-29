#!/usr/bin/env python3
"""보고바이오 — 쿠팡 OPEN API 원본 수집기 (서버 고정 IP 13.125.122.152 에서만 동작)

쿠팡은 등록된 IP에서만 API를 허용하므로, 이 서버는 '원본을 가져와 구글 시트로 넘기는 역할'만 한다.
숫자 계산(결제·취소·반품·제품별 집계)은 구글 Apps Script(coupangIngest_)가 하므로 계산 방식은 시트 쪽에서 고친다.
개인정보(주문자·수취인·연락처·주소 등)는 보내기 전에 지운다.

사용법
  python3 coupang_collect.py                       # 최근 7일 (매월 15일엔 전전월 1일 ~ 어제)
  python3 coupang_collect.py 2025-01-01 2026-10-27 # 기간 소급
  python3 coupang_collect.py --test                # 연결 확인만 (시트에 쓰지 않음)
설정: config.json 의 cp_vendor, cp_access, cp_secret (+ api_url, key)
"""
import hashlib, hmac, json, os, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
HOST = "https://api-gateway.coupang.com"
HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
V = CFG.get("cp_vendor", "")
STATUSES = ["ACCEPT", "INSTRUCT", "DEPARTURE", "DELIVERING", "FINAL_DELIVERY", "NONE_TRACKING"]
PII = re.compile(r"(orderer|receiver|requester|phone|addr|zip|email|safenumber|personal|customs|memo|parcelprintmessage|deliverycompany|invoice|realname|returndelivery)", re.I)


def scrub(o):
    if isinstance(o, dict):
        return {k: scrub(v) for k, v in o.items() if not PII.search(k)}
    if isinstance(o, list):
        return [scrub(x) for x in o]
    return o


def cp_get(path, params, keep_empty=()):
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None and (v != "" or k in keep_empty)})
    for attempt in range(6):
        dt = datetime.now(timezone.utc).strftime("%y%m%dT%H%M%SZ")
        sig = hmac.new(CFG["cp_secret"].encode(), (dt + "GET" + path + q).encode(), hashlib.sha256).hexdigest()
        req = urllib.request.Request(HOST + path + ("?" + q if q else ""), headers={
            "Authorization": f"CEA algorithm=HmacSHA256, access-key={CFG['cp_access']}, signed-date={dt}, signature={sig}",
            "X-Requested-By": V, "Content-Type": "application/json;charset=UTF-8"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                time.sleep(0.25)
                return json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(2 * (attempt + 1)); continue
            raise RuntimeError(f"{path.split('/')[-1]} {e.code} {msg}")
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 5:
                time.sleep(3 * (attempt + 1)); continue
            raise RuntimeError(f"{path.split('/')[-1]} network {e}")


def paged(path, params):
    out, token = [], ""
    for _ in range(300):
        j = cp_get(path, dict(params, nextToken=token))
        out += j.get("data") or []
        token = j.get("nextToken") or ""
        if not token:
            break
    return out


def paged_token(path, params):
    """매출내역(revenue-history)식 페이지: token='' 로 시작, hasNext/nextToken"""
    out, token = [], ""
    for _ in range(400):
        j = cp_get(path, dict(params, token=token), keep_empty=("token",))  # 첫 페이지는 token= (빈값) 필수
        out += j.get("data") or []
        if not j.get("hasNext") or not j.get("nextToken"):
            break
        token = j["nextToken"]
    return out


def fetch(a, b):
    """[a, b] 기간 원본: 발주서(상태별) + 취소·반품 요청 + 교환 요청 + 취소·반품 주문의 상세
    + 로켓그로스 주문(rg) + 매출내역(revenue: 로켓그로스 반품 파악용, 매출인식일 기준)"""
    base = f"/v2/providers/openapi/apis/api/v4/vendors/{V}"
    raw = {"d1": a, "d2": b, "sheets": [], "cancels": [], "returns": [], "exchanges": [], "details": [], "rg": [], "revenue": [], "errors": []}
    # 로켓그로스(쿠팡 창고 배송) 주문: 결제일 기준, 한 번에 30일 이내
    try:
        raw["rg"] = paged(f"/v2/providers/rg_open_api/apis/api/v1/vendors/{V}/rg/orders", {"paidDateFrom": a.replace("-", ""), "paidDateTo": b.replace("-", "")})
    except Exception as e:
        raw["errors"].append(f"rg orders: {e}")
    # 매출내역: 매출인식일(구매확정일) 기준, 어제까지만 조회 가능. REFUND 행으로 로켓그로스 반품을 잡는다
    yday = (datetime.now(KST) - timedelta(days=1)).strftime("%Y-%m-%d")
    if a <= yday:
        try:
            raw["revenue"] = paged_token("/v2/providers/openapi/apis/api/v1/revenue-history", {"vendorId": V, "recognitionDateFrom": a, "recognitionDateTo": min(b, yday), "maxPerPage": 50})
        except Exception as e:
            raw["errors"].append(f"revenue: {e}")
    for st in STATUSES:
        try:
            raw["sheets"] += paged(base + "/ordersheets", {"createdAtFrom": a, "createdAtTo": b, "status": st, "maxPerPage": 50})
        except Exception as e:
            raw["errors"].append(f"ordersheets {st}: {e}")
    # 취소·반품은 '요청일' 기준으로만 조회되므로 앞뒤로 넓게 가져온다:
    #  - 이 기간에 결제된 주문이 나중에 취소된 경우(결제금액 복원용) → 뒤로 +23일
    #  - 이전에 요청돼 이 기간에 완료된 반품 → 앞으로 -24일   (한 번 조회는 31일 이내)
    today = datetime.now(KST).strftime("%Y-%m-%d")
    day = lambda s, n: (datetime.strptime(s, "%Y-%m-%d") + timedelta(days=n)).strftime("%Y-%m-%d")
    wins = [(day(a, -24), day(a, -1)), (a, min(day(b, 23), today))]
    seen = set()
    def add(key, rows):
        for r in rows:
            rid = str(r.get("receiptId") or json.dumps(r, sort_keys=True)[:200])
            if rid not in seen:
                seen.add(rid); raw[key].append(r)
    for w1, w2 in wins:
        try:
            add("cancels", paged(base + "/returnRequests", {"createdAtFrom": w1, "createdAtTo": w2, "cancelType": "CANCEL"}))
        except Exception as e:
            raw["errors"].append(f"cancel {w1}: {e}")
        for st in ["RU", "UC", "CC", "PR"]:
            try:
                add("returns", paged(base + "/returnRequests", {"createdAtFrom": w1, "createdAtTo": w2, "cancelType": "RETURN", "status": st}))
            except Exception as e:
                raw["errors"].append(f"return {st} {w1}: {e}")
    try:
        raw["exchanges"] = paged(base + "/exchangeRequests", {"createdAtFrom": a + "T00:00:00", "createdAtTo": b + "T23:59:59", "maxPerPage": 50})  # 교환은 요청일 기준
    except Exception as e:
        raw["errors"].append(f"exchange: {e}")
    have = {str(s.get("orderId")) for s in raw["sheets"]} | {str(o.get("orderId")) for o in raw["rg"]}
    need = {str(r.get("orderId")) for r in raw["cancels"] + raw["returns"] if r.get("orderId")} - have
    for oid in sorted(need):
        try:
            d = cp_get(f"{base}/{oid}/ordersheets", {}).get("data")
            raw["details"] += d if isinstance(d, list) else ([d] if d else [])
        except Exception as e:
            raw["errors"].append(f"detail {oid}: {str(e)[:120]}")
    return scrub(raw)


def sheet(action, **kw):
    body = json.dumps({"action": action, "key": CFG["key"], **kw}, ensure_ascii=False).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(CFG["api_url"], data=body, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST")
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read().decode() or "{}")
        except Exception as e:
            if attempt == 3:
                return {"ok": False, "error": str(e)[:200]}
            time.sleep(5 * (attempt + 1))


def main(argv):
    test = "--test" in argv
    args = [a for a in argv if not a.startswith("--")]
    now = datetime.now(KST); yday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    # 매일 실행: 로켓그로스 주문은 '출고 후'에야 API에 나오므로 최근 7일을 매번 다시 수집한다
    d1 = args[0] if args else (now - timedelta(days=7)).strftime("%Y-%m-%d")
    d2 = args[1] if len(args) > 1 else (d1 if args else yday)
    if not args and now.day == 15:
        m = now.month - 2; y = now.year + (m - 1) // 12; m = (m - 1) % 12 + 1
        d1 = f"{y}-{m:02d}-01"
    if test:
        raw = fetch(yday, yday)
        print(f"COUPANG TEST {yday}: sheets {len(raw['sheets'])} rg {len(raw['rg'])} revenue {len(raw['revenue'])} cancels {len(raw['cancels'])} returns {len(raw['returns'])} exchanges {len(raw['exchanges'])}")
        if raw["rg"]:
            print("rg sample:", json.dumps(raw["rg"][0], ensure_ascii=False)[:400])
        if raw["revenue"]:
            print("revenue sample:", json.dumps(raw["revenue"][0], ensure_ascii=False)[:400])
        print("errors:", raw["errors"][:3] or "none")
        return 1 if raw["errors"] and not raw["sheets"] and not raw["rg"] else 0
    cur = datetime.strptime(d1, "%Y-%m-%d"); end = datetime.strptime(d2, "%Y-%m-%d"); fails = []
    while cur <= end:
        b = min(cur + timedelta(days=6), end)
        a_s, b_s = cur.strftime("%Y-%m-%d"), b.strftime("%Y-%m-%d")
        try:
            raw = fetch(a_s, b_s)
            res = sheet("coupang", raw=raw)
            print(f"{a_s}~{b_s}: sheets {len(raw['sheets'])} rg {len(raw['rg'])} rev {len(raw['revenue'])} cancel {len(raw['cancels'])} return {len(raw['returns'])} err {len(raw['errors'])} -> {str(res)[:160]}", flush=True)
            if not res.get("ok"):
                fails.append(f"{a_s}~{b_s}: {str(res)[:150]}")
        except Exception as e:
            fails.append(f"{a_s}~{b_s}: {e}"); print("ERROR", fails[-1], flush=True)
        cur = b + timedelta(days=1)
    if fails:
        sheet("alert", text="⚠️ <b>쿠팡 자동 수집 오류</b>\n" + "\n".join(fails)[:1500] + "\n(IP 등록·키 만료(6개월) 여부 확인)")
    print("DONE", d1, "~", d2, "fails", len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
