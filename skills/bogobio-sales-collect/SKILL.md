---
name: bogobio-sales-collect
description: 보고바이오 전 채널(스마트스토어·자사몰·쿠팡·G마켓/옥션·11번가·롯데ON·아난티·SSG·폼 입력 채널) 전날 매출을 확인·수집해 구글 시트 원장과 제품원장에 기록하고 결과를 알릴 때 사용. 매일 아침 예약 실행, '매출 수집', '어제 매출 채워줘' 요청 시.
---

# 보고바이오 전 채널 매출 수집 (매일 아침)

목표: 어제(KST) 전 채널 매출이 원장에 빠짐없이 들어가 08:00 텔레그램·대시보드가 맞게 나가도록 한다.
매월 15일은 기간을 **전전월 1일 ~ 어제**로 넓힌다(늦게 바뀐 취소·반품 반영).

## 지켜야 할 것
- 로그인·인증·비밀번호·API 키 입력은 하지 않는다. 로그인 풀린 몰은 건너뛰고 마지막에 "다시 로그인 필요"로 알린다.
- 동의·약관·결제 버튼, 팝업의 '동의'는 누르지 않는다. 팝업이 작업을 막으면 사용자에게 알린다.
- 주문자 이름·연락처·주소는 읽어 와도 저장·출력하지 않는다(상품명·수량·금액·날짜·주문번호만).
- 숫자를 추정해 채우지 않는다. 못 가져온 채널은 비워 두고 보고한다.
- 대시보드 비밀번호(API key)는 사용자에게 받은 값을 대화 안에서만 쓴다.

## 시트 API
`POST https://script.google.com/macros/s/AKfycbzGB6M89TvVtns8gHwIi9_tfFeANDRI2DFVAQyh9MjXvDaGTd1ujzIXlqgvY75YYuZN_w/exec` (Content-Type: text/plain)
- `{action:'data', key}` → `daily`(원장), `products`, `asof`
- `{action:'submit', key, rows:[{date,ch,pay,orders,qty,cancel,cancelCnt,refund,refundCnt,note}], method:'외부몰(웹)', merge:true}` → 같은 날짜+채널은 빈칸 아닌 값만 덮어씀
- `{action:'products', key, ch, d1, d2, rows:[{date,code,name,qty,amt,cancelQty,cancelAmt,retQty,retAmt,exQty}], method}` → 그 채널·기간 제품 행 통째로 교체(**수집한 기간만** d1~d2로)
- 순매출 = pay − cancel − refund (시트가 계산)
- 클라우드 작업공간에서 script.google.com이 막혀 있으면 브라우저 탭 안에서 fetch로 호출한다.

## 1단계 — 자동 수집 채널 확인 (API, 07:15~07:30에 이미 돌아감)
`data`를 받아 어제 날짜에 아래 행이 있는지 본다.
| 채널 | 자동 수집 | 없을 때 |
|---|---|---|
| 스마트스토어 | 서버 07:15 (네이버 API) | "서버 수집 실패" 보고 — IP·시크릿·서버 상태 확인 필요 |
| 쿠팡 | 서버 07:20 (쿠팡 API) | 같은 방식 보고. 키 만료(6개월, 채널톡과 공용 키) 여부 함께 안내 |
| 자사몰 | 시트 07:30 (카페24 API) | 시트 편집기에서 `collectDate('YYYY-MM-DD')` 실행 또는 보고(카페24 재연결 필요할 수 있음) |
제품원장에 같은 날짜 행이 있는지도 함께 확인한다.

## 2단계 — 외부몰 웹 수집 (Claude 브라우저, 로그인된 탭 사용)
각 몰 관리자 페이지 탭 안에서 fetch로 조회한다. 1회 조회는 최대 1개월 → 기간이 길면 월 단위로 반복.
금액 기준은 대시보드 하단 「채널별 집계 방식·기준 정의」와 같게 맞춘다.

**G마켓/옥션 (ESM+ https://www.esmplus.com, 채널명 `G마켓/옥션`)**
- G마켓: `POST /Account/Sell/SellDetailSearch` form `srch_dt=D1&srch_kind=DT1&cust_no=145085235&sday=YYYY-MM-DD&eday=(끝날+1일)&srch_type=&srch_value=0&page=1&limit=500`
  날짜 `InputDt`, 주문 `ContrNo`, 상품 `G`+`GdNo`/`GdNm`, 수량 `ContrAmt`, 금액 `TradeMoney`(구매자 결제액). 수량·금액이 음수인 행 = 취소(같은 날 cancel).
- 옥션: `POST /Account/Sell/GetIacSellProgressOrder` form `sellStatusType=DT1&sellerId=bogobio&dateType=D1&fromDate&toDate&searchType=&searchValue=&page=1&limit=500`
  `RecpDate, OrderNo, 'A'+GoodsNo/GoodsName, OrderQty, PayAmnt`, 환불 `RefundDate`.

**11번가 (https://soffice.11st.co.kr, `11번가`)**
- `POST /remittance/SellerRemittanceAction.tmall?method=getSelAllStatDtlsSoffice` form
  `start=0&limit=500&dtlSearchStlmntType=Y`(그리고 `N` 한 번 더)`&cnsgnDlvYn=N&quickStlYn=N&searchType=ALL&stDate=YYYYMMDD&edDate=YYYYMMDD&ordPrdStat=&searchDtType=STL_DT&dtlSearchType=&dtlSearchVal=&intervalDay=0&isPaging=Y`
- 날짜 `ordStlEndDt`(결제일), 중복키 `ordNo|ordPrdSeq`, 상품 `'E'+prdNo/prdNm`, 수량 `ordQty`, 금액 `selPrcAmt+optAmt`(판매가). 취소는 판매취소 현황(/view/6207)에서 확인.

**롯데ON (https://store.lotteon.com, `롯데온`)**
- 주문/배송관리 → 통합주문조회 화면을 열고, XMLHttpRequest를 가로채 둔 뒤 조회 버튼(id 끝이 `_btn_search`)을 한 번 누른다 → `soapi.lotteon.com/soapi/v1/order/orderInquiry/getOrderList` 요청 본문·헤더 확보.
- 같은 헤더로 `prdStrtDt/prdEndDt`(YYYYMMDD), `rowsPerPage:'500'`만 바꿔 재요청.
- 날짜 `odCmptDttm`, 주문 `odNo`, 상품 `'L'+spdNo/spdNm`, 수량 `odQty`, 금액 `slPrc×odQty`(판매단가×수량). 주문유형이 취소면 cancel.
- 「개인정보 제3자 제공 동의」 팝업이 뜨면 누르지 말고 사용자에게 알린다.

**아난티/무케렌시아 (이터널저니 https://biz.eternaljourney.co.kr/vmgr/ordr/list, `아난티/무케렌시아`)**
- `POST /vmgr/ordr/list` 본문: `statCds`=20,30,40,50,60,99(주문상태만 — clmsTpCds·exchYn·cfmYn 체크박스는 넣지 말 것, 넣으면 클레임만 걸러져 0건), `dateType=2`(결제일), `startDate/endDate`, `searchCnd=1`, `recordCountPerPage=500` → 응답 HTML의 '품목이름·결제일시' 표 파싱.
- 결제일시 앞 10자리, 주문번호(뒤 '열기' 제거), `'J'+품목코드`, 품목이름, 수량, 금액=`판매금액`(회원 할인 후). 상태 '주문취소' → 같은 날 cancel.

**SSG (https://po.ssgadm.com, `SSG`) — 사용자 크롬(Claude in Chrome)에서**
- 정산 관리 → 정산조회 → **위수탁 정산** → 업체별 상세내역(주문별: 정산일자·주문ID·상품코드·상품명·수량·판매단가·상품대총판매가·순판매액).
- 「주문검색」 화면은 보고바이오 위수탁 주문이 나오지 않으니 쓰지 않는다.
- 금액 = 순판매액(할인부담 반영), 날짜 = 정산일자. 위수탁 정산은 월 마감이라 **전월분이 다음 달 초에 확정** → 일별 수집 대신 매월 15일 재수집 때 전월분을 채운다.
- 확정(10/30): 위수탁업체 마감리스트 화면(/se/vendor/listCommissionClose.ssg)에서 조회 한 번 → XHR `GET /se/vendor/getCommissionCloseListGridData.ssg` 주소를 잡아 `searchSettlYear=YYYYMM`만 바꿔 fetch(JSON gridRows). 셀[13]=순판매액 → 그 달 말일 날짜로 SSG 1행 기록. '상세조회' 버튼은 확인창을 띄워 탭이 멈추므로 누르지 않는다.

**국군복지몰·공구·오프라인** — 관리자 사이트 없음: 구글폼(시트 '설정' 탭 FORM_URL) 담당자 입력분만 사용. 어제 입력이 없으면 "입력 필요"로 보고.

## 3단계 — 기록
1. 몰별로 날짜×채널 합계 행을 만든다: pay(결제 합), orders(주문번호 수), qty, cancel/cancelCnt, refund/refundCnt, note='외부몰 웹 수집'.
   판매 0건인 날은 `pay:0, orders:0`으로 넣어 "미입력"과 구분한다(로그인 성공·조회 성공한 몰만).
2. `submit`(merge:true) → 채널별 `products`(d1·d2 = 이번 수집 기간).
3. 응답의 merged/written 수를 확인한다.

## 4단계 — 확인·보고
- `data`를 다시 받아 어제 날짜 채널별 순매출을 표로 만든다(채널 순서: 스마트스토어 → 쿠팡 → 자사몰 → 외부몰).
- 확인 규칙: 최근 7일 평균의 3배 이상, 평소 매출 있는 채널 0원, 취소+반품 > 결제금액이면 ⚠️ 표시.
- 보고 형식(짧게, 한국어):
  - ✅ 기록된 채널과 금액
  - ⚠️ 이상치
  - 🔒 로그인 다시 필요한 몰 / 📝 폼 입력 필요한 채널
- 예약 실행(사용자 부재)일 때는 알림(푸시)으로 보내고, 로그인·입력이 필요한 항목만 사용자에게 요청한다.
- 08:00 텔레그램·대시보드는 시트가 자동 처리하므로 별도 발송하지 않는다.
