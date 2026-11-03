---
name: "bogobio-sales-collect"
description: "보고바이오 전 채널 전날 매출을 확인·수집해 구글 시트 원장·제품원장에 기록하고 결과를 알릴 때 사용. 매일 아침 예약 실행, '매출 수집', '어제 매출 채워줘' 요청 시."
---

# 보고바이오 전 채널 매출 수집 (매일 아침)

목표: 어제(KST) 전 채널 매출이 원장에 빠짐없이 들어가 08:00 텔레그램·대시보드가 맞게 나가도록 한다.
매월 15일은 기간을 **전전월 1일 ~ 어제**로 넓힌다(늦게 바뀐 취소·반품 반영).

## 지켜야 할 것
- 로그인·인증·비밀번호·API 키 입력은 하지 않는다. 로그인 풀린 몰은 건너뛰고 마지막에 "다시 로그인 필요"로 알린다.
- 동의·약관·결제 버튼, 팝업의 '동의'는 누르지 않는다. 팝업이 작업을 막으면 사용자에게 알린다.
- 주문자 이름·연락처·주소는 저장·출력하지 않는다(상품명·수량·금액·날짜·주문번호만).
- 숫자를 추정해 채우지 않는다. 못 가져온 채널은 비워 두고 보고한다.
- 대시보드 비밀번호(API key)는 시트 '설정' 탭 `DASH_KEY` 값(또는 사용자에게 받은 값)을 대화 안에서만 쓴다. 보고·로그에 적지 않는다.

## 시트 API
`POST https://script.google.com/macros/s/AKfycbzGB6M89TvVtns8gHwIi9_tfFeANDRI2DFVAQyh9MjXvDaGTd1ujzIXlqgvY75YYuZN_w/exec` (Content-Type: text/plain)
- `{action:'data', key}` → `daily`(원장), `products`, `asof`
- `{action:'submit', key, rows:[{date,ch,pay,orders,qty,cancel,cancelCnt,refund,refundCnt,note}], method:'외부몰(웹)', merge:true}`
- `{action:'products', key, ch, d1, d2, rows:[{date,code,name,qty,amt,cancelQty,cancelAmt,retQty,retAmt,exQty}], method}` → 그 채널·기간 제품 행 통째로 교체(**수집한 기간만**)
- 순매출 = pay − cancel − refund (시트 계산). 클라우드 작업공간에서 script.google.com이 막히면 브라우저 탭 안에서 fetch로 호출.

## 0단계 — 날짜·키 준비 (11/2 실행에서 추가)
- **어제 날짜는 KST로 계산**: 클라우드 세션의 환경 날짜는 UTC라 하루 늦을 수 있다 → `TZ=Asia/Seoul date +%F` 로 오늘을 구해 하루 뺀다.
- **DASH_KEY**: 구글 시트 '설정' 탭(키·값·설명)에서 `DASH_KEY` 행의 '값'을 로그인된 시트 탭 안에서 읽는다(`…/gviz/tq?tqx=out:csv&sheet=설정` fetch). 값이 비어 있거나 안내 문구("대시보드 들어갈 때 치는 비밀번호…")면 **키 미설정** → 기록(submit/products)은 건너뛰고 보고에 적는다. 키 값은 탭 안 변수에만 두고 보고·로그에 절대 쓰지 않는다.
- **시트 API 호출 위치**: 클라우드 작업공간에서는 script.google.com이 막힘 → 시트 탭(docs.google.com) 안에서 `fetch(API,{method:'POST',headers:{'Content-Type':'text/plain'},body})` 로 호출(CORS 통과).
- **키가 없을 때의 대체 읽기**: 원장·제품원장·수기입력 탭을 같은 gviz CSV 방식으로 직접 읽어 1·4단계(확인·이상치·보고)는 수행한다. 기록만 불가.
- 각 몰 로그인 여부는 첫 화면을 열어 `input[type=password]` 유무 또는 로그인 URL(signin.esmplus.com, login.11st.co.kr, store.lotteon.com/cm/main/login_SO.wsp, biz.eternaljourney.co.kr/login/form)로 바로 판정한다.

## 1단계 — 자동 수집 채널 확인 (07:15~07:30에 이미 실행됨)
`data`로 어제 날짜 행 확인:
- 스마트스토어: 서버 07:15(네이버 API). 없으면 "서버 수집 실패" 보고(IP·시크릿·서버 상태).
- 쿠팡: 서버 07:20(쿠팡 API). 없으면 보고 + 키 만료(6개월, 채널톡 공용 키) 여부 안내.
- 자사몰: 시트 07:30(카페24 API). 없으면 시트 편집기에서 `collectDate('YYYY-MM-DD')` 실행 또는 보고(카페24 재연결 필요 가능). 3일 연속 0원이면 ⚠️(11/2 실행에서 10/30~11/01 연속 0원 관찰).
- 11번가: 서버 07:25(`elevenst_collect.py`) · 롯데ON: 서버 07:28(`lotteon_collect.py`) · SSG: 서버 07:30(`ssg_collect.py`, 11/3부터, 위수탁 정산 API) — 조회 성공 시 판매 0건이어도 0원 행이 생긴다. 행이 없으면 "서버 수집 실패"로 보고. **이 세 몰은 2단계 웹 수집을 하지 않는다**(서버가 정본).
- 수기 채널(국군복지몰·공동구매·오프라인): 시트 「수기입력」 탭(엑셀형 표, 11/2 개편)이 정본. 입력하면 바로 원장에 반영되고 07:30에 한 번 더 맞춘다. 옛 폼 응답 탭은 보지 않는다.
제품원장에 같은 날짜 행이 있는지도 확인.

## 2단계 — 외부몰 웹 수집 (Claude 브라우저, 로그인된 탭)
각 몰 관리자 탭 안에서 fetch로 조회. 1회 최대 1개월 → 길면 월 단위 반복. 금액 기준은 대시보드 하단 「채널별 집계 방식·기준 정의」와 동일.

**G마켓/옥션** (https://www.esmplus.com, 채널 `G마켓/옥션`)
- G마켓: `POST /Account/Sell/SellDetailSearch` form `srch_dt=D1&srch_kind=DT1&cust_no=145085235&sday=YYYY-MM-DD&eday=(끝날+1일)&srch_type=&srch_value=0&page=1&limit=500` → `InputDt`, `ContrNo`, `'G'+GdNo/GdNm`, `ContrAmt`, `TradeMoney`. 음수 행 = 취소.
- 옥션: `POST /Account/Sell/GetIacSellProgressOrder` form `sellStatusType=DT1&sellerId=bogobio&dateType=D1&fromDate&toDate&searchType=&searchValue=&page=1&limit=500` → `RecpDate, OrderNo, 'A'+GoodsNo/GoodsName, OrderQty, PayAmnt`, `RefundDate`.

**11번가 · 롯데ON · SSG** — 서버 API로 자동 수집(1단계). 서버 행이 없을 때만 원인 보고, 웹 수집으로 대신 채우지 않는다.

**아난티/무케렌시아** (이터널저니 https://biz.eternaljourney.co.kr/vmgr/ordr/list) — 서버 `eternal_collect.py`(월요일 문자인증) 설치 후에는 서버가 정본. 미설치·접속 끊김일 때만 로그인된 탭에서 아래 방식으로 수집.
- 첫 번째 검색 폼: 주문상태 전부 체크, `dateType=2`(결제일), `startDate/endDate`, `recordCountPerPage=500` → 폼 action으로 POST → '품목이름·결제일시' 표 파싱.
- 결제일시 앞 10자리, 주문번호('열기' 제거), `'J'+품목코드`, 수량, 금액=판매금액(회원 할인 후). '주문취소' → 같은 날 cancel.

**국군복지몰·공구·오프라인** — 시트 「수기입력」 탭 담당자 입력분만 사용. 어제 칸이 비어 있으면 "입력 필요(판매 없으면 무시)"로 보고.

## 3단계 — 기록
1. 몰별 날짜×채널 합계: pay, orders(주문번호 수), qty, cancel/cancelCnt, refund/refundCnt, note='외부몰 웹 수집'. 조회에 성공했는데 판매 0건이면 `pay:0, orders:0`으로 넣어 미입력과 구분.
2. `submit`(merge:true) → 채널별 `products`(d1·d2 = 이번 수집 기간).
3. 응답의 merged/written 수 확인.

## 4단계 — 확인·보고
- `data`를 다시 받아 어제 채널별 순매출 표(스마트스토어 → 쿠팡 → 자사몰 → 외부몰).
- 최근 7일 평균의 3배 이상, 평소 매출 있는 채널 0원, 취소+반품 > 결제금액이면 ⚠️.
- 보고: ✅ 기록 채널·금액 / ⚠️ 이상치 / 🔒 다시 로그인 필요한 몰 / 📝 폼 입력 필요한 채널. 짧게, 한국어.
- 예약 실행(사용자 부재)이면 푸시 알림으로 보내고, 로그인·입력이 필요한 것만 요청.
- 08:00 텔레그램·대시보드는 시트가 자동 처리하므로 별도 발송하지 않는다.