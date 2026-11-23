#!/usr/bin/env python3
"""보고바이오 — G마켓/옥션(ESM PLUS) 수집기 (서버 브라우저 + 텔레그램 인증번호)

ESM PLUS는 판매자 API가 없어(셀링툴 업체 전용) 서버에서 화면 없는 브라우저로 로그인한다.
로그인에 2단계 인증이 나오면 텔레그램 단톡방에 "인증번호 답장" 요청 → 담당자가 6자리 답장 → 입력.
로그인 후 판매진행내역(입금확인일 기준) 자료를 받아 원장·제품원장에 기록한다.
  · G마켓: /Account/Sell/SellDetailSearch  → InputDt, ContrNo, GdNo/GdNm, ContrAmt(수량), TradeMoney(결제금액)
  · 옥션 : /Account/Sell/GetIacSellProgressOrder → RecpDate, OrderNo, GoodsNo/GoodsName, OrderQty, PayAmnt, RefundDate
실행 (가상환경 파이썬: ~/bogobio/gmvenv/bin/python)
  gmarket_collect.py                       # 정기(1일·15일 12:10): 전전월 1일(또는 마지막 성공일 다음날) ~ 어제
  gmarket_collect.py 2026-10-01 2026-11-22 # 기간 지정
  gmarket_collect.py --test 2026-10-01 2026-11-22   # 로그인·조회만, 시트에 안 씀
config.json: gm_id, gm_pw, tg_token, tg_chat(선택), api_url, key
"""
import json, os, re, sys, time, uuid, urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
HERE = os.path.dirname(os.path.abspath(__file__))
CFG_PATH = os.path.join(HERE, "config.json")
CFG = json.load(open(CFG_PATH, encoding="utf-8"))
PROFILE = os.path.join(HERE, "gm_profile")
SHOTS = os.path.join(HERE, "gm_shots"); os.makedirs(SHOTS, exist_ok=True)
CH = "G마켓/옥션"
ESM = "https://www.esmplus.com"
CUST_NO, SELLER = "145085235", "bogobio"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
N = lambda v: float(re.sub(r"[^0-9.\-]", "", str(v if v is not None else 0)) or 0)
LOG = lambda *a: print(datetime.now(KST).strftime("%T"), *a, flush=True)


# ---------- 텔레그램 ----------
def tg(method, **kw):
    url = f"https://api.telegram.org/bot{CFG['tg_token']}/{method}"
    r = urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(kw).encode(), headers={"Content-Type": "application/json"}), timeout=70)
    return json.loads(r.read().decode())


def chat():
    return CFG.get("tg_chat") or -5576980060


def tg_photo(path, caption):
    try:
        b = uuid.uuid4().hex; img = open(path, "rb").read()
        parts = [f'--{b}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n{chat()}\r\n',
                 f'--{b}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n{caption[:1000]}\r\n',
                 f'--{b}\r\nContent-Disposition: form-data; name="photo"; filename="s.png"\r\nContent-Type: image/png\r\n\r\n']
        body = "".join(parts).encode() + img + f"\r\n--{b}--\r\n".encode()
        urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{CFG['tg_token']}/sendPhoto", data=body,
                                                      headers={"Content-Type": f"multipart/form-data; boundary={b}"}), timeout=60)
    except Exception as e:
        LOG("photo send fail", e)


def ask_code(timeout_min=180):
    ups = tg("getUpdates", timeout=0).get("result", [])
    offset = (ups[-1]["update_id"] + 1) if ups else 0
    m = tg("sendMessage", chat_id=chat(), parse_mode="HTML",
           text="🔐 <b>G마켓(ESM PLUS) 매출 수집</b>\n방금 휴대폰으로 온 <b>G마켓 인증번호</b>를 이 메시지에 <b>답장</b>으로 보내주세요.\n(3시간 안에 / 숫자만)")
    mid = m.get("result", {}).get("message_id")
    end = time.time() + timeout_min * 60
    while time.time() < end:
        for u in tg("getUpdates", offset=offset, timeout=50).get("result", []):
            offset = u["update_id"] + 1
            msg = u.get("message") or {}
            if str(msg.get("chat", {}).get("id")) != str(chat()):
                continue
            hit = re.search(r"(?<!\d)(\d{4,8})(?!\d)", msg.get("text") or "")
            replied = (msg.get("reply_to_message") or {}).get("message_id") == mid
            if hit and (replied or len(hit.group(1)) == 6):
                tg("getUpdates", offset=offset, timeout=0)
                return hit.group(1)
    tg("sendMessage", chat_id=chat(), reply_to_message_id=mid, text="⏰ 3시간 안에 인증번호가 없어 이번 G마켓 수집은 건너뜁니다. 다음 1일·15일에 다시 요청합니다.")
    return None


# ---------- 브라우저 ----------
def shot(page, name):
    p = os.path.join(SHOTS, f"{datetime.now(KST):%m%d_%H%M%S}_{name}.png")
    try:
        page.screenshot(path=p)
    except Exception:
        return None
    return p


def visible_text(page):
    try:
        return re.sub(r"\s+", " ", page.inner_text("body"))[:600]
    except Exception:
        return ""


def click_text(page, pattern, scope="button, a, [role=button], label"):
    for el in page.query_selector_all(scope):
        try:
            t = (el.inner_text() or "").strip()
            if t and re.search(pattern, t) and el.is_visible():
                el.click(); return t
        except Exception:
            continue
    return None


def fail(page, why):
    p = shot(page, "fail") if page else None
    LOG("FAIL", why, "|", visible_text(page)[:300] if page else "")
    if p:
        tg_photo(p, f"❌ G마켓 로그인 중단: {why}")
    raise RuntimeError(why)


def logged_in(page):
    u = page.url
    return "esmplus.com" in u and "signin." not in u and "/login" not in u.lower() and "twoFactor" not in u


def two_factor(page):
    LOG("2FA page", page.url, visible_text(page)[:200])
    shot(page, "2fa_before")
    click_text(page, r"휴대폰|휴대전화|문자|SMS", "label, button, [role=tab], li, a")  # 수단 선택이 있으면 휴대폰
    time.sleep(1)
    sent = click_text(page, r"인증\s*번호.*(발송|요청|받기|전송)|(발송|요청|전송)하기|인증요청")
    LOG("send button:", sent)
    if not sent:
        fail(page, "인증번호 발송 버튼을 찾지 못함(화면 구조 확인 필요)")
    time.sleep(2)
    click_text(page, r"^확인$")  # '발송했습니다' 안내창
    code = ask_code()
    if not code:
        raise RuntimeError("인증번호 미수신(3시간)")
    box = None
    for el in page.query_selector_all("input"):
        try:
            if el.is_visible() and el.get_attribute("type") in (None, "text", "tel", "number", "password") and not el.get_attribute("readonly") and not (el.input_value() or "").strip():
                box = el; break
        except Exception:
            continue
    if not box:
        fail(page, "인증번호 입력칸을 찾지 못함")
    box.fill(code); time.sleep(0.5)
    click_text(page, r"^(확인|인증|인증하기|인증 완료|완료|로그인)$")
    for _ in range(30):
        time.sleep(1)
        click_text(page, r"^확인$")
        if logged_in(page):
            return True
    fail(page, "인증번호 입력 후에도 로그인되지 않음")


def login(page):
    page.goto(ESM + "/Home/Home", wait_until="domcontentloaded", timeout=60000); time.sleep(3)
    if logged_in(page):
        LOG("session alive"); return True
    if "signin." not in page.url:
        page.goto("https://signin.esmplus.com/login", wait_until="domcontentloaded", timeout=60000); time.sleep(3)
    LOG("login page", page.url)
    click_text(page, r"^ESM PLUS$", "button, [role=tab], li, a, label")
    page.fill("#typeMemberInputId01", CFG["gm_id"]); page.fill("#typeMemberInputPassword01", CFG["gm_pw"])
    page.click("form button:has-text('로그인')")
    for i in range(40):
        time.sleep(1)
        if logged_in(page):
            LOG("login ok"); return True
        txt = visible_text(page)
        if re.search(r"자동\s*입력\s*방지|보안\s*문자|captcha", txt, re.I) or page.query_selector("img[src*=aptcha]"):
            fail(page, "그림 문자(자동 접속 방지) 확인이 떠서 서버에서 진행 불가 — 직접 로그인 필요")
        if "twoFactor" in page.url:
            return two_factor(page)
        if re.search(r"2단계 인증을 진행", txt):
            click_text(page, r"^확인$"); continue
        if re.search(r"비밀번호.*(일치하지|틀|오류)|아이디.*(없|확인)", txt):
            fail(page, "아이디 또는 비밀번호가 맞지 않음")
        if re.search(r"비밀번호를 재설정|비밀번호 변경", txt) and i > 5:
            click_text(page, r"다음에|나중에|30일|닫기")
    fail(page, "로그인 결과를 알 수 없음(40초)")


# ---------- 조회 ----------
def rows_in(j):
    """응답 JSON에서 주문 목록(딕셔너리 리스트)을 찾는다"""
    best = []
    def walk(x):
        nonlocal best
        if isinstance(x, list) and x and isinstance(x[0], dict):
            if len(x) > len(best): best = x
            return
        if isinstance(x, dict):
            for v in x.values(): walk(v)
    walk(j); return best


def post(page, path, form):
    r = page.request.post(ESM + path, form=form, headers={"X-Requested-With": "XMLHttpRequest", "Referer": ESM + "/Account/Sell/SellProgressList"}, timeout=90000)
    t = r.text()
    if r.status != 200 or t.lstrip()[:1] not in "[{":
        raise RuntimeError(f"{path} 응답 이상 {r.status}: {t[:120]}")
    return json.loads(t)


def months(d1, d2):
    out, cur = [], datetime.strptime(d1, "%Y-%m-%d")
    end = datetime.strptime(d2, "%Y-%m-%d")
    while cur <= end:
        nxt = (cur.replace(day=1) + timedelta(days=32)).replace(day=1)
        out.append((cur, min(end, nxt - timedelta(days=1)))); cur = nxt
    return out


def day_of(v):
    s = str(v or "")
    m = re.search(r"/Date\((\d+)", s)
    if m:
        return datetime.fromtimestamp(int(m.group(1)) / 1000, KST).strftime("%Y-%m-%d")
    m = re.search(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})", s)
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None


def fetch(page, d1, d2):
    g, a = [], []
    for s, e in months(d1, d2):
        f = {"srch_dt": "D1", "srch_kind": "DT1", "cust_no": CUST_NO, "sday": s.strftime("%Y-%m-%d"), "eday": (e + timedelta(days=1)).strftime("%Y-%m-%d"),
             "srch_type": "", "srch_value": "0", "page": "1", "limit": "500"}
        rg = rows_in(post(page, "/Account/Sell/SellDetailSearch", f)); g += rg
        f = {"sellStatusType": "DT1", "sellerId": SELLER, "dateType": "D1", "fromDate": s.strftime("%Y-%m-%d"), "toDate": e.strftime("%Y-%m-%d"),
             "searchType": "", "searchValue": "", "page": "1", "limit": "500"}
        ra = rows_in(post(page, "/Account/Sell/GetIacSellProgressOrder", f)); a += ra
        LOG("fetch", s.date(), "~", e.date(), "G", len(rg), "A", len(ra))
    return g, a


def aggregate(g, a, d1, d2):
    days = {}; prods = {}; bad = 0
    cur = datetime.strptime(d1, "%Y-%m-%d")
    while cur <= datetime.strptime(d2, "%Y-%m-%d"):
        d = cur.strftime("%Y-%m-%d")
        days[d] = {"date": d, "ch": CH, "pay": 0, "orders": set(), "qty": 0, "cancel": 0, "cancelCnt": 0, "refund": 0, "refundCnt": 0, "note": "ESM PLUS(서버 브라우저)"}
        cur += timedelta(days=1)
    norm = [(day_of(o.get("InputDt")), "G", o.get("ContrNo"), o.get("GdNo"), o.get("GdNm"), N(o.get("ContrAmt")), N(o.get("TradeMoney")), "") for o in g] + \
           [(day_of(o.get("RecpDate")), "A", o.get("OrderNo"), o.get("GoodsNo"), o.get("GoodsName"), N(o.get("OrderQty")), N(o.get("PayAmnt")), day_of(o.get("RefundDate")) or "") for o in a]
    for d, mk, ordno, gno, gname, q, amt, refd in norm:
        if not d or not gno:
            bad += 1; continue
        if d not in days:
            continue
        r = days[d]; code = mk + str(gno)
        p = prods.setdefault(d + code, {"date": d, "code": code, "name": gname or code, "qty": 0, "amt": 0, "cancelQty": 0, "cancelAmt": 0, "retQty": 0, "retAmt": 0, "exQty": 0})
        if amt < 0 or q < 0:
            r["cancel"] += abs(amt); r["cancelCnt"] += 1; p["cancelQty"] += abs(q); p["cancelAmt"] += abs(amt)
        else:
            r["pay"] += amt; r["qty"] += q; r["orders"].add(mk + str(ordno)); p["qty"] += q; p["amt"] += amt
            if refd and refd in days:
                rr = days[refd]; rr["refund"] += amt; rr["refundCnt"] += 1
    out = [dict(r, orders=len(r["orders"]), pay=round(r["pay"]), cancel=round(r["cancel"]), refund=round(r["refund"])) for r in days.values()]
    return out, list(prods.values()), bad


def sheet(action, **kw):
    body = json.dumps({"action": action, "key": CFG["key"], **kw}, ensure_ascii=False).encode()
    r = urllib.request.urlopen(urllib.request.Request(CFG["api_url"], data=body, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST"), timeout=300)
    return json.loads(r.read().decode() or "{}")


def main(argv):
    from playwright.sync_api import sync_playwright
    args = [x for x in argv if not x.startswith("--")]
    test = "--test" in argv
    now = datetime.now(KST); yday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    m = now.month - 2; y = now.year + (m - 1) // 12; m = (m - 1) % 12 + 1
    d1 = args[0] if args else min(f"{y}-{m:02d}-01", CFG.get("gm_next", "9999"))
    d2 = args[1] if len(args) > 1 else yday
    LOG("GMARKET", "TEST" if test else "RUN", d1, "~", d2)
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            PROFILE, headless=True, user_agent=UA, locale="ko-KR", timezone_id="Asia/Seoul", viewport={"width": 1280, "height": 900},
            args=["--disable-dev-shm-usage", "--disable-gpu", "--no-zygote", "--renderer-process-limit=1", "--disable-extensions",
                  "--disable-features=site-per-process,Translate,BackForwardCache,MediaRouter", "--js-flags=--max-old-space-size=256"])
        ctx.route("**/*", lambda r: r.abort() if r.request.resource_type in ("media", "font") else r.continue_())
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            login(page)
            g, a = fetch(page, d1, d2)
        finally:
            ctx.close()
    days, prods, bad = aggregate(g, a, d1, d2)
    tot = sum(x["pay"] for x in days); cnt = sum(x["orders"] for x in days)
    LOG("rows G", len(g), "A", len(a), "unreadable", bad, "orders", cnt, "pay", tot)
    for x in days:
        if x["pay"] or x["cancel"] or x["refund"]:
            print(" ", x["date"], "pay", x["pay"], "orders", x["orders"], "qty", x["qty"], "cancel", x["cancel"], "refund", x["refund"])
    if g[:1]: print("  G keys:", ",".join(list(g[0].keys())[:40]))
    if a[:1]: print("  A keys:", ",".join(list(a[0].keys())[:40]))
    if test:
        tg("sendMessage", chat_id=chat(), text=f"🧪 G마켓 시험 조회 성공 ({d1}~{d2}: {cnt}건 · {tot:,.0f}원) — 시트에는 아직 안 씀")
        print("TEST OK"); return 0
    if bad:
        raise RuntimeError(f"주문 {bad}줄을 읽지 못함(화면 구조 변경 가능) — 시트에 쓰지 않음")
    r1 = sheet("submit", rows=days, method="ESM PLUS(서버)", merge=True)
    r2 = sheet("products", ch=CH, d1=d1, d2=d2, rows=prods, method="ESM PLUS(서버)")
    LOG("sheet", str(r1)[:100], str(r2)[:100])
    c = json.load(open(CFG_PATH, encoding="utf-8")); c["gm_next"] = now.strftime("%Y-%m-%d")
    json.dump(c, open(CFG_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    tg("sendMessage", chat_id=chat(), text=f"✅ G마켓/옥션 수집 완료 ({d1}~{d2}: {cnt}건 · {tot:,.0f}원)")
    print("DONE"); return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as ex:
        print("ERROR", ex)
        try:
            tg("sendMessage", chat_id=chat(), text="⚠️ G마켓/옥션 수집 실패: " + str(ex)[:400] + "\n→ 데스크톱 앱에서 G마켓 로그인 후 Claude에게 'G마켓 수집해줘'라고 요청하면 채울 수 있습니다.")
        except Exception:
            pass
        sys.exit(1)
