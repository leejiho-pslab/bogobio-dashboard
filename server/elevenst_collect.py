#!/usr/bin/env python3
"""보고바이오 — 11번가 셀러 Open API 수집기 (초안: API 키 발급 후 --test 로 응답 형식 확인 → 필드명 보정)

준비: 11번가 셀러오피스 맨 아래 'Open API' → 서비스 등록/확인 → Seller API 정보 등록(서버 IP 13.125.122.152) → 11ST OPEN API KEY 복사
      config.json 에 "st_key": "<키>" 추가 (api_url, key 는 기존 값 사용)
사용법
  python3 elevenst_collect.py            # 어제 (매월 15일엔 전전월 1일 ~ 어제)
  python3 elevenst_collect.py 2026-10-01 2026-10-28
  python3 elevenst_collect.py --test     # 어제 결제완료 주문 원본 앞부분 출력 (시트에 쓰지 않음)
집계 기준: 결제완료일(ordStlEndDttm) 기준 판매가(selPrc×수량 + 옵션가) — 대시보드 '11번가' 정의와 동일.
취소·반품: 취소/반품 API 경로가 문서(로그인 필요)로만 확인되므로 --test 로 확인 후 CLAIM_PATHS 를 채운다.
"""
import json, os, re, sys, time, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
BASE = "https://api.11st.co.kr/rest"
HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
# 결제완료 주문 조회: 시작/종료 시각(yyyyMMddHHmm). 형식이 다르면(yyyyMMddHH) 자동으로 한 번 더 시도
ORDER_PATH = "/ordservices/complete/{s}/{e}"
CLAIM_PATHS = {}  # 예: {"cancel": "/claimservice/...", "return": "/claimservice/..."} — 확인 후 채움
PII = re.compile(r"(ordNm|rcvr|memNo|buyer|addr|telNo|hpNo|email|Memo|zip|safeNo|clearance|pcc)", re.I)


def get(path):
    req = urllib.request.Request(BASE + path, headers={"openapikey": CFG["st_key"], "Content-Type": "text/xml;charset=utf-8"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                time.sleep(0.3)
                b = r.read()
                for enc in ("cp949", "utf-8"):
                    try:
                        return b.decode(enc)
                    except UnicodeDecodeError:
                        pass
                return b.decode("cp949", "replace")
        except urllib.error.HTTPError as e:
            body = e.read().decode("cp949", "replace")[:300]
            if e.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(3 * (attempt + 1)); continue
            raise RuntimeError(f"{path.split('/')[1]} {e.code} {body}")


def strip_ns(tag):
    return tag.split("}")[-1]


def to_dicts(xml_text):
    """<orders><order>...</order></orders> → [{필드: 값}] (네임스페이스 제거, 개인정보 필드 제거)"""
    xml_text = re.sub(r"^<\?xml[^>]*\?>", "", xml_text.strip())
    root = ET.fromstring(xml_text)
    if strip_ns(root.tag).lower() in ("error", "errormessage") or root.find(".//{*}message") is not None and len(root) <= 2:
        raise RuntimeError("API 오류: " + "".join(root.itertext())[:200])
    rows = []
    for el in root.iter():
        if strip_ns(el.tag) == "order":
            rows.append({strip_ns(c.tag): (c.text or "").strip() for c in el if not PII.search(strip_ns(c.tag))})
    return rows


def fetch_orders(d1, d2):
    """[d1, d2] 결제완료 주문 (하루씩 조회 — 조회 구간 제한 대비)"""
    out, errors = [], []
    cur = datetime.strptime(d1, "%Y-%m-%d"); end = datetime.strptime(d2, "%Y-%m-%d")
    while cur <= end:
        s, e = cur.strftime("%Y%m%d0000"), cur.strftime("%Y%m%d2359")
        try:
            try:
                out += to_dicts(get(ORDER_PATH.format(s=s, e=e)))
            except RuntimeError as ex:
                if "400" not in str(ex) and "형식" not in str(ex):
                    raise
                out += to_dicts(get(ORDER_PATH.format(s=s[:10], e=e[:10])))  # yyyyMMddHH 형식 재시도
        except Exception as ex:
            errors.append(f"{cur:%Y-%m-%d}: {ex}")
        cur += timedelta(days=1)
    return out, errors


N = lambda v: float(re.sub(r"[^0-9.\-]", "", str(v or 0)) or 0)


def aggregate(orders, d1, d2):
    days, prods, seen = {}, {}, set()
    cur = datetime.strptime(d1, "%Y-%m-%d"); end = datetime.strptime(d2, "%Y-%m-%d")
    while cur <= end:
        d = cur.strftime("%Y-%m-%d"); days[d] = {"date": d, "ch": "11번가", "pay": 0, "orders": set(), "qty": 0, "cancel": 0, "cancelCnt": 0, "refund": 0, "refundCnt": 0, "note": "11번가API(서버)"}
        cur += timedelta(days=1)
    for o in orders:
        key = o.get("ordNo", "") + "|" + o.get("ordPrdSeq", "")
        if key in seen:
            continue
        seen.add(key)
        dt = o.get("ordStlEndDttm") or o.get("ordDt") or ""
        d = re.sub(r"[^0-9]", "", dt)[:8]; d = f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) == 8 else None
        if d not in days:
            continue
        q = N(o.get("ordQty")); amt = (N(o.get("selPrc")) + N(o.get("optAmt") or o.get("optPrc"))) * q
        days[d]["pay"] += amt; days[d]["qty"] += q; days[d]["orders"].add(o.get("ordNo", ""))
        code = "E" + (o.get("prdNo") or ""); k = d + "|" + code
        p = prods.setdefault(k, {"date": d, "code": code, "name": o.get("prdNm") or code, "qty": 0, "amt": 0, "cancelQty": 0, "cancelAmt": 0, "retQty": 0, "retAmt": 0, "exQty": 0})
        p["qty"] += q; p["amt"] += amt
    rows = [dict(r, orders=len(r["orders"]), pay=round(r["pay"]), cancel=round(r["cancel"]), refund=round(r["refund"])) for r in days.values()]
    return rows, list(prods.values())


def sheet(action, **kw):
    body = json.dumps({"action": action, "key": CFG["key"], **kw}, ensure_ascii=False).encode()
    req = urllib.request.Request(CFG["api_url"], data=body, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST")
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode() or "{}")


def main(argv):
    test = "--test" in argv
    args = [a for a in argv if not a.startswith("--")]
    now = datetime.now(KST); yday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    d1 = args[0] if args else yday; d2 = args[1] if len(args) > 1 else (d1 if args else yday)
    if not args and now.day == 15:
        m = now.month - 2; y = now.year + (m - 1) // 12; m = (m - 1) % 12 + 1; d1 = f"{y}-{m:02d}-01"
    if test:
        # 조회 경로 후보를 7일 구간 3개로 시험: 결과코드·메시지·건수·필드
        cands = {"결제완료": "/ordservices/complete/{s}/{e}", "배송중": "/ordservices/shipping/{s}/{e}",
                 "배송완료": "/ordservices/completed/{s}/{e}", "정산내역": "/settlement/settlementList/{s}/{e}",
                 "정산(일자)": "/settlement/settlementList/{d1}/{d2}", "반품": "/claimservice/returnorders/{s}/{e}"}
        for a, b in ((datetime(2026, 10, 9), datetime(2026, 10, 15)), (datetime(2026, 9, 13), datetime(2026, 9, 19))):
            s_, e_ = a.strftime("%Y%m%d0000"), b.strftime("%Y%m%d2359")
            print(f"== {a:%m/%d}~{b:%m/%d}")
            for nm, pth in cands.items():
                try:
                    raw = get(pth.format(s=s_, e=e_, d1=a.strftime("%Y%m%d"), d2=b.strftime("%Y%m%d")))
                    code = re.search(r"result_code>([^<]*)<", raw); txt = re.search(r"result_text>([^<]*)<", raw)
                    rows = to_dicts(raw) if "order>" in raw else []
                    if not rows and "result_code" not in raw:
                        print(f"  {nm}: RAW {raw[:300]!r}")
                    print(f"  {nm}: code={code.group(1) if code else '-'} {txt.group(1)[:30] if txt else ''} 건수={len(rows)}" + (f" 필드={sorted(rows[0].keys())[:25]}" if rows else ""))
                except Exception as ex:
                    print(f"  {nm}: ERR {str(ex)[:90]}")
        return 0
    orders, errors = fetch_orders(d1, d2)
    rows, prods = aggregate(orders, d1, d2)
    r1 = sheet("submit", rows=rows, method="11번가API(서버)", merge=True)
    r2 = sheet("products", ch="11번가", d1=d1, d2=d2, rows=prods, method="11번가API(서버)")
    print(d1, "~", d2, "orders", len(orders), "days", len(rows), "products", len(prods), "->", str(r1)[:120], str(r2)[:120], "errors", errors[:3])
    if errors:
        sheet("alert", text="⚠️ <b>11번가 자동 수집 오류</b>\n" + "\n".join(errors)[:1200] + "\n(키 유효기간 180일 · IP 등록 확인)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
