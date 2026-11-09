#!/usr/bin/env python3
"""쿠팡 대조용(시트에 쓰지 않음): 기간의 일별 로켓그로스·판매자배송 결제, 매출내역 환불 행을 출력
  python3 coupang_diag.py 2026-10-01 2026-11-08"""
import sys, json
from datetime import datetime, timedelta, timezone
import coupang_collect as C
KST = timezone(timedelta(hours=9))
a, b = sys.argv[1], sys.argv[2]
day = lambda s, n: (datetime.strptime(s, "%Y-%m-%d") + timedelta(days=n)).strftime("%Y-%m-%d")
D = {}; refunds = []; errs = []
s = a
while s <= b:
    e = min(day(s, 6), b)
    raw = C.fetch(s, e); errs += raw["errors"]
    for o in raw["rg"]:
        pa = o.get("paidAt"); d = datetime.fromtimestamp(pa / 1000, KST).strftime("%Y-%m-%d") if isinstance(pa, (int, float)) else str(pa)[:10]
        for it in o.get("orderItems") or []:
            q = float(it.get("salesQuantity") or 0); amt = float(it.get("unitSalesPrice") or 0) * q
            x = D.setdefault(d, [0, 0, set()]); x[0] += amt; x[1] += q; x[2].add(str(o.get("orderId")))
    for o in raw["sheets"]:
        d = str(o.get("paidAt") or o.get("orderedAt"))[:10]
        for it in o.get("orderItems") or []:
            x = D.setdefault(d, [0, 0, set()]); x[0] += float(it.get("orderPrice") or 0); x[1] += float(it.get("shippingCount") or 0); x[2].add("S" + str(o.get("orderId")))
    for r in raw["revenue"]:
        if str(r.get("saleType")).upper() == "REFUND":
            refunds.append((r.get("recognitionDate"), r.get("saleDate"), r.get("orderId"), [(i.get("vendorItemName", "")[:20], i.get("quantity"), i.get("saleAmount")) for i in r.get("items") or []]))
    s = day(e, 1)
tot = [0, 0, 0]
for d in sorted(D):
    if a <= d <= b:
        x = D[d]; tot[0] += x[0]; tot[1] += x[1]; tot[2] += len(x[2]); print(d, f"{int(x[0]):>10,}", "qty", int(x[1]), "orders", len(x[2]))
print("TOTAL", f"{int(tot[0]):,}", "qty", int(tot[1]), "orders", tot[2])
print("REFUND rows (recognitionDate, saleDate, orderId, items):")
for r in sorted(set(json.dumps(x, ensure_ascii=False) for x in refunds)):
    print(" ", r)
print("ERRORS", errs[:5])
