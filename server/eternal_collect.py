#!/usr/bin/env python3
"""보고바이오 — 아난티/무케렌시아(이터널저니 biz.eternaljourney.co.kr) 수집기

이 몰은 로그인할 때마다 휴대폰 문자 인증번호가 필요하다.
그래서: 매주 월요일 09:00 서버가 로그인 → 문자 발송 → 텔레그램 단톡방에 "인증번호 답장" 요청
        → 담당자가 그 메시지에 6자리로 답장 → 서버가 받아 로그인 → 최근 21일 수집.
        로그인 쿠키는 저장해 두고 10분마다 접속을 유지(--ping). 유지되는 동안은 매일 07:26 자동 수집.
config.json: ej_id, ej_pw (이터널저니 관리자 계정), tg_token (텔레그램 봇 토큰), tg_chat(선택, 기본 단톡방)
사용법
  python3 eternal_collect.py --login     # 인증 요청 → 답장 대기(최대 3시간) → 수집 (cron: 월 09:00)
  python3 eternal_collect.py             # 저장된 접속으로 최근 21일 수집 (cron: 매일 07:26, 끊겼으면 조용히 건너뜀)
  python3 eternal_collect.py --ping      # 접속 유지 (cron: 10분마다)
  python3 eternal_collect.py --test      # 표 머리글·첫 행 확인 (시트에 안 씀)
  python3 eternal_collect.py 2025-01-01 2026-11-02   # 기간 지정 수집
"""
import http.cookiejar, json, os, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

KST = timezone(timedelta(hours=9))
BASE = "https://biz.eternaljourney.co.kr"
HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
JAR_PATH = os.path.join(HERE, "ej_cookies.txt")
CH = "아난티/무케렌시아"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
N = lambda v: float(re.sub(r"[^0-9.\-]", "", str(v or 0)) or 0)

jar = http.cookiejar.MozillaCookieJar(JAR_PATH)
if os.path.exists(JAR_PATH):
    try:
        jar.load(ignore_discard=True, ignore_expires=True)
    except Exception:
        pass
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def req(path, data=None, ajax=False):
    body = urllib.parse.urlencode(data, doseq=True).encode() if data is not None else None
    h = {"User-Agent": UA, "Referer": BASE + "/login/form"}
    if body is not None:
        h["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
    if ajax:
        h["X-Requested-With"] = "XMLHttpRequest"; h["Accept"] = "application/json, text/javascript, */*"
    r = opener.open(urllib.request.Request(BASE + path, data=body, headers=h), timeout=60)
    txt = r.read().decode("utf-8", "replace")
    jar.save(ignore_discard=True, ignore_expires=True)
    return r.geturl(), txt


# ---------- 텔레그램 ----------
def tg(method, **kw):
    url = f"https://api.telegram.org/bot{CFG['tg_token']}/{method}"
    r = urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(kw).encode(), headers={"Content-Type": "application/json"}), timeout=70)
    return json.loads(r.read().decode())


def chat():
    return CFG.get("tg_chat") or -5576980060


def ask_code(timeout_min=180):
    """단톡방에 요청을 보내고 6자리 답장을 기다린다"""
    ups = tg("getUpdates", timeout=0).get("result", [])
    offset = (ups[-1]["update_id"] + 1) if ups else 0
    m = tg("sendMessage", chat_id=chat(), parse_mode="HTML",
           text="🔐 <b>아난티(이터널저니) 주간 수집</b>\n방금 휴대폰으로 온 <b>인증번호 6자리</b>를 이 메시지에 <b>답장</b>으로 보내주세요.\n(3시간 안에 / 예: 123456)")
    mid = m.get("result", {}).get("message_id")
    end = time.time() + timeout_min * 60
    while time.time() < end:
        res = tg("getUpdates", offset=offset, timeout=50).get("result", [])
        for u in res:
            offset = u["update_id"] + 1
            msg = u.get("message") or {}
            if str(msg.get("chat", {}).get("id")) != str(chat()):
                continue
            hit = re.search(r"(?<!\d)(\d{6})(?!\d)", msg.get("text") or "")
            if hit:
                tg("getUpdates", offset=offset, timeout=0)  # 읽음 처리
                return hit.group(1)
    tg("sendMessage", chat_id=chat(), reply_to_message_id=mid, text="⏰ 3시간 안에 인증번호가 없어 이번 주 아난티 수집은 건너뜁니다. 다음 월요일에 다시 요청합니다.")
    return None


# ---------- 로그인 ----------
def alive():
    url, txt = req("/vmgr/ordr/list")
    return "/login" not in url and 'name="mngrPw"' not in txt


def login():
    req("/login/form")
    f = {"mngrId": CFG["ej_id"], "mngrPw": CFG["ej_pw"], "celNo": "", "authNum": "", "dormantConfirmYn": "N"}
    for _ in range(3):
        _, t = req("/login/process", f, ajax=True); j = json.loads(t or "{}")
        sc = str(j.get("statusCode"))
        if j.get("error"):
            raise RuntimeError("로그인 오류: " + str(j.get("error"))[:200])
        if sc == "200":
            break
        if sc == "203":
            f["dormantConfirmYn"] = "Y"; continue
        if sc == "202":
            req("/login/form"); continue
        if sc == "201":
            f["celNo"] = j.get("celNo") or ""
            code = ask_code()
            if not code:
                return False
            f["authNum"] = code
            _, t = req("/login/process", f, ajax=True); j = json.loads(t or "{}")
            if str(j.get("statusCode")) != "200":
                tg("sendMessage", chat_id=chat(), text="❌ 인증 실패: " + str(j.get("error") or j.get("message") or j)[:200] + "\n다음 월요일에 다시 요청합니다. (바로 하려면 담당자에게 요청)")
                return False
            break
    if j.get("redirectUrl"):
        try:
            req(j["redirectUrl"] if j["redirectUrl"].startswith("/") else "/" + j["redirectUrl"].lstrip("/"))
        except Exception:
            pass
    return alive()


# ---------- 표 파싱 ----------
class Tables(HTMLParser):
    def __init__(self):
        super().__init__(); self.tables = []; self.cell = None; self.row = None; self.depth = 0

    def handle_starttag(self, tag, a):
        if tag == "table":
            self.tables.append([]); self.depth += 1
        elif tag == "tr" and self.tables:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.row.append(re.sub(r"\s+", " ", "".join(self.cell)).strip()); self.cell = None
        elif tag == "tr" and self.row is not None and self.tables:
            if self.row:
                self.tables[-1].append(self.row)
            self.row = None

    def handle_data(self, d):
        if self.cell is not None:
            self.cell.append(d)


def fetch(d1, d2):
    data = {"statCds": ["20", "30", "40", "50", "60", "99"], "dateType": "2", "startDate": d1, "endDate": d2,
            "searchCnd": "1", "searchWrd": "", "recordCountPerPage": "500", "pageIndex": "1"}
    url, html = req("/vmgr/ordr/list", data)
    if "/login" in url:
        raise PermissionError("로그인 끊김")
    p = Tables(); p.feed(html)
    for t in p.tables:
        for i, r in enumerate(t[:3]):
            if any("결제일" in c for c in r) and any("수량" in c for c in r):
                return r, [x for x in t[i + 1:] if len(x) >= len(r) - 1]
    return [], []


def col(head, *keys):
    for k in keys:
        for i, h in enumerate(head):
            if k in h:
                return i
    return None


def aggregate(head, rows, d1, d2):
    ci = {"no": col(head, "주문번호"), "st": col(head, "주문상태", "상태"), "code": col(head, "품목코드", "상품코드"),
          "name": col(head, "품목이름", "품목명", "상품명"), "qty": col(head, "수량"),
          "amt": col(head, "판매금액", "결제금액", "금액"), "dt": col(head, "결제일")}
    g = lambda r, k: (r[ci[k]] if ci[k] is not None and ci[k] < len(r) else "")
    days, prods = {}, {}
    cur = datetime.strptime(d1, "%Y-%m-%d")
    while cur <= datetime.strptime(d2, "%Y-%m-%d"):
        d = cur.strftime("%Y-%m-%d"); cur += timedelta(days=1)
        days[d] = {"date": d, "ch": CH, "pay": 0, "orders": set(), "qty": 0, "cancel": 0, "cancelCnt": 0, "refund": 0, "refundCnt": 0, "note": "이터널저니(서버)"}
    for r in rows:
        d = (re.search(r"\d{4}-\d{2}-\d{2}", g(r, "dt")) or [None])[0]
        if d not in days:
            continue
        no = g(r, "no").replace("열기", "").strip(); q = N(g(r, "qty")) or 1; amt = N(g(r, "amt"))
        code = "J" + re.sub(r"\D", "", g(r, "code")); name = g(r, "name") or code
        p = prods.setdefault(d + code, {"date": d, "code": code, "name": name, "qty": 0, "amt": 0, "cancelQty": 0, "cancelAmt": 0, "retQty": 0, "retAmt": 0, "exQty": 0})
        st = g(r, "st")
        if "취소" in st:
            days[d]["cancel"] += amt; days[d]["cancelCnt"] += 1; p["cancelQty"] += q; p["cancelAmt"] += amt
        elif "반품" in st:
            days[d]["refund"] += amt; days[d]["refundCnt"] += 1; p["retQty"] += q; p["retAmt"] += amt
        else:
            days[d]["pay"] += amt; days[d]["qty"] += q; days[d]["orders"].add(no); p["qty"] += q; p["amt"] += amt
    out = [dict(x, orders=len(x["orders"]), pay=round(x["pay"]), cancel=round(x["cancel"]), refund=round(x["refund"])) for x in days.values()]
    return out, list(prods.values()), ci


def sheet(action, **kw):
    body = json.dumps({"action": action, "key": CFG["key"], **kw}, ensure_ascii=False).encode()
    r = urllib.request.urlopen(urllib.request.Request(CFG["api_url"], data=body, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST"), timeout=300)
    return json.loads(r.read().decode() or "{}")


def collect(d1, d2):
    head, rows = fetch(d1, d2)
    if not head:
        raise RuntimeError("주문 표를 찾지 못함(화면 구조 변경 가능)")
    days, prods, ci = aggregate(head, rows, d1, d2)
    r1 = sheet("submit", rows=days, method="이터널저니(서버)", merge=True)
    r2 = sheet("products", ch=CH, d1=d1, d2=d2, rows=prods, method="이터널저니(서버)")
    tot = sum(x["pay"] for x in days); cnt = sum(x["orders"] for x in days)
    print(d1, "~", d2, "rows", len(rows), "orders", cnt, "pay", tot, "->", str(r1)[:80], str(r2)[:80])
    return cnt, tot


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    now = datetime.now(KST); yday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    d1 = args[0] if args else (now - timedelta(days=21)).strftime("%Y-%m-%d")
    d2 = args[1] if len(args) > 1 else yday
    if "--ping" in argv:
        print(now.strftime("%F %T"), "alive" if alive() else "dead"); return 0
    if "--login" in argv:
        if not alive() and not login():
            print("login failed / no code"); return 1
        if "--nocollect" in argv:
            tg("sendMessage", chat_id=chat(), text="✅ 아난티 로그인 완료 (수집 확인 중)"); print("LOGIN OK"); return 0
        cnt, tot = collect(d1, d2)
        tg("sendMessage", chat_id=chat(), text=f"✅ 아난티 로그인·수집 완료 ({d1}~{d2}: {cnt}건 · {tot:,.0f}원)\n접속이 유지되는 동안은 매일 자동 수집합니다.")
        return 0
    if not alive():
        print(now.strftime("%F %T"), "session dead - skip (다음 월요일 인증 대기)"); return 0
    if "--test" in argv:
        head, rows = fetch(d1, d2)
        print("HEAD", head); [print(r) for r in rows[:3]]; print("rows", len(rows)); return 0
    collect(d1, d2)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as ex:
        print("ERROR", ex)
        try:
            sheet("alert", text="⚠️ <b>아난티 수집 오류</b>\n" + str(ex)[:500])
        except Exception:
            pass
        sys.exit(1)
