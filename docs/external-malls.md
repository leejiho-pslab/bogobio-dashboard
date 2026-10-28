# 외부몰 수집 메모 (브라우저 로그인 세션 사용, 개인정보는 저장하지 않음)

## G마켓·옥션 (ESM+) — 확인 완료 2026-10-28
- 화면: ESM+ → 정산 관리 → G마켓/옥션 판매진행내역 (iframe `/Account/Sell/SellProgressList`, `/Account/Sell/IacSellProgressList`)
- 조회 한도: 1회 최대 1개월, 기준 `D1` = 입금확인일(결제 기준)
- G마켓 상세: `POST https://www.esmplus.com/Account/Sell/SellDetailSearch` (form)
  `srch_dt=D1&srch_kind=DT1&cust_no=145085235&sday=YYYY-MM-DD&eday=(끝날+1일)&srch_type=&srch_value=0&page=1&limit=500`
  → `InputDt`(입금확인일), `ContrNo`(주문), `GdNo`/`GdNm`(상품), `ContrAmt`(수량), `ContrPrice`(판매가 합계), `TradeMoney`(구매자 결제금액), `ReturnDt`
- 옥션 상세: `POST .../Account/Sell/GetIacSellProgressOrder` (form)
  `sellStatusType=DT1&sellerId=bogobio&dateType=D1&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&searchType=&searchValue=&page=1&limit=500`
  → `RecpDate`, `OrderNo`, `GoodsNo`/`GoodsName`, `OrderQty`, `SellPrice`(합계), `PayAmnt`(결제금액), `RefundDate`
- 결제금액은 `TradeMoney`/`PayAmnt` 사용(다른 채널과 같은 '구매자 결제 기준'). 엑셀은 판매가(`ContrPrice`/`SellPrice`)를 써서 할인만큼 차이 남
- 이 목록은 결제가 유지된 건만 나옴 → 취소는 별도(취소 관리) 미반영
- 2025-01 ~ 2026-10-27: 35건(G 33, 옥션 2), 2025-09부터 판매

## 11번가 — 진행 중
- 화면: 정산관리 → 판매/정산현황 (iframe `/remittance/SellerRemittanceAction.tmall?method=displaySellerOwnSelStatSoffice`)
- 상세 그리드: `/remittance/SellerRemittanceAction.tmall?method=getSelAllStatDtlsSoffice`, 기간 최대 1개월
- `searchDtType`: `STL_DT`=결제일, `SND_TRT_DT`, `DELI_END_DT`, `BUY_CNFRM_DT`
- 판매취소 현황 `/view/6207`, 취소관리 `/view/6209`

## 롯데ON / SSG / 이터널저니 / 국군복지몰 / 공구 / 오프라인 — 미착수
