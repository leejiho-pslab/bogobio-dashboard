/**
 * 보고바이오 입점채널 현황 — 구글 시트 자동화 (Apps Script)
 * 역할: ① 입력용 구글폼 생성  ② 폼 응답 → 원장 누적  ③ 대시보드용 데이터 API(비밀번호 확인)
 *       ④ 텔레그램 데일리(08:00)/주간(월요일)/월간(1일) 푸시  ⑤ Cowork 스킬용 제출 API
 *
 * 최초 1회:  setup() 실행 → 시트·폼 생성, 과거 데이터 적재, 트리거 등록
 *            setSecrets('대시보드비밀번호','텔레그램봇토큰','채팅ID') 실행 (실행 후 인수는 지워도 됨)
 *            배포 → 새 배포 → 웹 앱 (실행: 나, 액세스: 모든 사용자) → URL을 대시보드 CONFIG.apiUrl에 입력
 */

const TZ = 'Asia/Seoul';
const CH_GROUPS = ['스마트스토어', '쿠팡', '자사몰', '외부몰'];
const CHANNELS = [
  ['NSS', '스마트스토어', '스마트스토어'], ['CPG', '쿠팡', '쿠팡'], ['OWN', '자사몰', '자사몰'],
  ['GMA', 'G마켓/옥션', '외부몰'], ['SSG', 'SSG', '외부몰'], ['11ST', '11번가', '외부몰'], ['LOT', '롯데온', '외부몰'],
  ['ANT', '아난티/무케렌시아', '외부몰'], ['MIL', '국군복지몰', '외부몰'], ['GRP', '공구', '외부몰'], ['OFF', '오프라인', '외부몰'],
];
const GROUP_OF = Object.fromEntries(CHANNELS.map(c => [c[1], c[2]]));
const LEDGER_HEAD = ['날짜', '채널', '결제금액', '결제건수', '판매수량', '취소금액', '취소건수', '환불금액', '환불건수', '순매출', '방문자', '신규문의', '미답변문의', '신규리뷰', '비고', '입력방식', '입력시각'];
const PROD_HEAD = ['날짜', '채널', '상품코드', '상품명', '판매수량', '판매금액', '취소수량', '취소금액', '반품수량', '반품금액', '교환수량', '입력방식', '입력시각'];
const PMASTER_HEAD = ['채널', '상품코드', '상품명(채널 원본)', '표준제품명', '최초등록'];
const FORM_FIELDS = [ // [제목, 도움말, 필수]
  ['결제금액(원)', '해당 날짜에 결제 완료된 금액 합계. 숫자만', true],
  ['결제건수', '주문 건수', true],
  ['판매수량', '판매된 개수', false],
  ['취소금액(원)', '취소된 금액 합계 (없으면 0)', false],
  ['취소건수', '', false],
  ['환불금액(원)', '반품·환불 금액 합계 (없으면 0)', false],
  ['환불건수', '', false],
  ['방문자', '관리자 화면의 일 방문자(유입) 수. 제공 안 되는 채널은 비워두기', false],
  ['신규문의', '오늘 새로 들어온 고객 문의 건수', false],
  ['미답변문의', '현재 답변 안 된 문의 건수(누적)', false],
  ['신규리뷰', '오늘 새로 등록된 리뷰 수', false],
  ['비고', '특이사항(프로모션, 품절, 시스템 오류 등)', false],
];


/** 시트 열기: 시트에 연결된 스크립트면 그 시트, 아니면 저장된 ID, 그것도 없으면 새로 만듦 */
function getSS_() {
  let ss = null; try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (ss) return ss;
  const p = PropertiesService.getScriptProperties(); const id = p.getProperty('SS_ID');
  if (id) return SpreadsheetApp.openById(id);
  ss = SpreadsheetApp.create('보고바이오_채널현황_원장'); p.setProperty('SS_ID', ss.getId());
  console.log('새 구글 시트를 만들었습니다: ' + ss.getUrl());
  return ss;
}

/* ============ 1. 최초 설정 ============ */
function setup() {
  const ss = getSS_(); const t0 = Date.now(); const log = m => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
  log('1/6 시트 생성'); ensureSheet_(ss, '원장', LEDGER_HEAD);
  const cm = ensureSheet_(ss, '채널마스터', ['채널코드', '채널명', '그룹']);
  if (cm.getLastRow() < 2) cm.getRange(2, 1, CHANNELS.length, 3).setValues(CHANNELS);
  const tg = ensureSheet_(ss, '월목표', ['연월', '스마트스토어', '쿠팡', '자사몰', '외부몰', '합계']);
  if (tg.getLastRow() < 2) {
    const rows = []; for (let m = 10; m <= 12; m++) rows.push([`2026-${pad_(m)}`, '', '', '', '', `=SUM(B${rows.length + 2}:E${rows.length + 2})`]);
    for (let m = 1; m <= 12; m++) rows.push([`2027-${pad_(m)}`, '', '', '', '', `=SUM(B${rows.length + 2}:E${rows.length + 2})`]);
    tg.getRange(2, 1, rows.length, 6).setValues(rows);
  }
  const cfgSh = ensureSheet_(ss, '설정', ['키', '값', '설명']); if (cfgSh.getLastRow() < 2) cfgSh.getRange(2, 1, 3, 3).setValues([
    ['REPORT_HOUR', 8, '데일리 푸시 시각(0~23, 한국시간)'],
    ['DASHBOARD_URL', 'https://leejiho-pslab.github.io/bogobio-dashboard/', '텔레그램 메시지에 붙는 대시보드 링크'],
    ['ALERT_DROP_PCT', -30, '전일/전주 대비 이 % 이하로 떨어지면 특이사항으로 표시'],
  ]);
  log('2/6 과거 데이터 적재'); loadHistory_(ss);
  log('3/6 구글폼 생성'); createForm_(ss);
  log('4/6 트리거 등록'); installTriggers_();
  log('5/6 완료. 폼 주소: ' + getSetting_('FORM_URL')); log('6/6 원장 시트 주소: ' + ss.getUrl());
  try { SpreadsheetApp.getUi().alert('설정 완료.\n1) setSecrets(비밀번호, 봇토큰, 채팅ID) 실행\n2) 배포 → 웹 앱 → URL을 대시보드에 입력\n폼 주소는 "설정" 시트 FORM_URL 참조'); } catch (e) {}
}

/** 텔레그램 연결(편집기에서 1회 실행): setTelegram('봇토큰') — 봇을 넣은 방에서 아무 메시지나 보낸 뒤 실행하면 방 번호를 자동으로 찾아 저장하고 시험 메시지를 보냄 */
function setTelegram(token, chatId) {
  if (!token) throw new Error("봇 토큰을 넣어 주세요: setTelegram('123456:ABC...')");
  const p = PropertiesService.getScriptProperties(); p.setProperty('TG_TOKEN', String(token).trim());
  if (!chatId) {
    const j = JSON.parse(UrlFetchApp.fetch(`https://api.telegram.org/bot${String(token).trim()}/getUpdates`, { muteHttpExceptions: true }).getContentText());
    if (!j.ok) throw new Error('토큰이 틀렸습니다: ' + (j.description || ''));
    const chats = (j.result || []).map(u => (u.message || u.my_chat_member || u.channel_post || {}).chat).filter(Boolean);
    if (!chats.length) throw new Error('방을 못 찾았습니다. 봇을 넣은 방(또는 봇과의 1:1 대화)에서 아무 메시지나 하나 보낸 뒤 다시 실행하세요.');
    const c = chats.reverse().find(x => x.type !== 'private') || chats[0];
    chatId = c.id; console.log('찾은 방: ' + (c.title || c.username || c.first_name) + ' (' + c.id + ')');
  }
  p.setProperty('TG_CHAT', String(chatId));
  const r = tg_('✅ <b>보고바이오 채널 현황 봇 연결 완료</b>\n매일 08:00 어제 실적, 월요일 주간, 1일 월간 보고가 이 방으로 옵니다.');
  console.log('시험 메시지 결과: ' + r + (r === 200 ? ' (성공)' : ' (실패 — 봇이 방에 있는지 확인)'));
}
function setSecrets(dashboardPassword, telegramBotToken, telegramChatId) {
  if (!dashboardPassword) throw new Error('비밀번호를 넣어주세요');
  const p = PropertiesService.getScriptProperties();
  p.setProperty('PW_HASH', sha256_(dashboardPassword));
  if (telegramBotToken) p.setProperty('TG_TOKEN', telegramBotToken);
  if (telegramChatId) p.setProperty('TG_CHAT', String(telegramChatId));
  return '저장됨';
}

function createForm_(ss) {
  const cfg = ss.getSheetByName('설정');
  if (getSetting_('FORM_URL')) return;
  const form = FormApp.create('보고바이오 일일 채널 실적 입력');
  form.setDescription('채널 1개당 1번 제출. 결제 기준(결제완료일). 숫자만 입력, 콤마 없이.');
  form.addDateItem().setTitle('날짜').setRequired(true).setHelpText('실적 날짜(어제)');
  form.addListItem().setTitle('채널').setRequired(true).setChoiceValues(CHANNELS.map(c => c[1]));
  FORM_FIELDS.forEach(([t, h, req]) => {
    const it = (t === '비고') ? form.addParagraphTextItem() : form.addTextItem();
    it.setTitle(t).setRequired(req); if (h) it.setHelpText(h);
  });
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  setSetting_('FORM_URL', form.getPublishedUrl(), '담당자 입력용 폼 주소(공유)');
  setSetting_('FORM_EDIT_URL', form.getEditUrl(), '폼 편집 주소');
  setSetting_('FORM_ID', form.getId(), '');
}

function installTriggers_() { restoreTriggers(); }
/** 자동 실행 예약 전체 점검·복구 (이미 있는 건 그대로, 없는 것만 추가). 편집기에서 언제 실행해도 안전 */
function restoreTriggers() {
  const ss = getSS_(); const have = h => ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === h);
  if (!have('onFormSubmit_')) ScriptApp.newTrigger('onFormSubmit_').forSpreadsheet(ss).onFormSubmit().create();
  // 08:00 보고: 예전 방식(06시에 08:00 일회용 예약을 거는 armDailyPush_)은 일회용 예약이 사라지는 일이 있어(11/3) 매일 반복 예약으로 교체
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'armDailyPush_').forEach(t => ScriptApp.deleteTrigger(t));
  // 일회용 예약(옛 방식)이 '있음'으로 잡혀 매일 예약이 안 만들어지는 일이 있었음(11/4) → 항상 지우고 매일 예약 2개(08시 + 09시 예비)를 새로 만든다. 하루 1회 중복 방지가 있어 두 번 가지 않음
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyPush_').forEach(t => ScriptApp.deleteTrigger(t));
  const H = Number(getSetting_('REPORT_HOUR') || 8);
  ScriptApp.newTrigger('dailyPush_').timeBased().everyDays(1).atHour(H).nearMinute(0).create();
  ScriptApp.newTrigger('dailyPush_').timeBased().everyDays(1).atHour(H + 1).nearMinute(0).create();
  if (!have('collectYesterday')) ScriptApp.newTrigger('collectYesterday').timeBased().everyDays(1).atHour(7).nearMinute(30).create();
  if (!have('monthly15_')) ScriptApp.newTrigger('monthly15_').timeBased().onMonthDay(15).atHour(5).create();
  if (!have('onManualEdit_')) ScriptApp.newTrigger('onManualEdit_').forSpreadsheet(ss).onEdit().create();
  const list = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()); console.log('예약 ' + list.length + '개: ' + list.join(', ')); return list;
}

/* ============ 2-0. 수기 매출 입력 (국군복지몰 · 공동구매 · 오프라인) ============ */
const MANUAL_CH = { '국군복지몰': '국군복지몰', '공동구매': '공구', '공구': '공구', '오프라인': '오프라인' };
const MANUAL_HEAD = ['타임스탬프', '날짜', '채널', '매출(원)', '주문건수', '판매개수', '비고'];
/** 편집기에서 1회 실행: 수기 입력 전용 구글폼 생성 + 응답 탭 「수기입력」 연결 */
function setupManualForm() {
  const ss = getSS_();
  if (getSetting_('MANUAL_FORM_URL')) { console.log('이미 있음: ' + getSetting_('MANUAL_FORM_URL')); return; }
  const before = ss.getSheets().map(s => s.getSheetId());
  const form = FormApp.create('보고바이오 수기 매출 입력 (국군복지몰 · 공동구매 · 오프라인)');
  form.setDescription('판매 1건(또는 하루치)마다 제출하세요. 같은 날짜·채널로 여러 번 내면 합산됩니다.\n잘못 낸 건은 시트 「수기입력」 탭에서 직접 고치거나 지우면 됩니다(매일 아침 다시 합산). 숫자만, 콤마 없이.');
  form.addDateItem().setTitle('날짜').setRequired(true).setHelpText('판매(결제)한 날짜');
  form.addMultipleChoiceItem().setTitle('채널').setRequired(true).setChoiceValues(['국군복지몰', '공동구매', '오프라인']);
  form.addTextItem().setTitle('매출(원)').setRequired(true).setHelpText('판매금액 합계. 취소·환불은 마이너스(-)로 입력');
  form.addTextItem().setTitle('주문건수').setRequired(true).setHelpText('결제(주문) 건수. 1건에 여러 개 사도 1');
  form.addTextItem().setTitle('판매개수').setRequired(true).setHelpText('실제 나간 제품 개수(박스 기준). 3박스 1건이면 3');
  form.addParagraphTextItem().setTitle('비고').setHelpText('거래처·공구명·특이사항');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush(); Utilities.sleep(2000);
  const sh = getSS_().getSheets().find(s => !before.includes(s.getSheetId()));
  if (sh) sh.setName('수기입력');
  setSetting_('MANUAL_FORM_URL', form.getPublishedUrl(), '수기 매출 입력 폼(국군복지몰·공동구매·오프라인)');
  setSetting_('MANUAL_FORM_EDIT_URL', form.getEditUrl(), '수기 폼 편집 주소');
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'onFormSubmit_'))
    ScriptApp.newTrigger('onFormSubmit_').forSpreadsheet(ss).onFormSubmit().create();
  console.log('폼 주소: ' + form.getPublishedUrl());
}
/* ---- 엑셀형 입력표 「수기입력」: 날짜 1줄 × (국군복지몰·공동구매·오프라인) × (매출·주문건수·판매개수) ---- */
const GRID_TAB = '수기입력';
const GRID_CH = [['국군복지몰', '국군복지몰'], ['공동구매', '공구'], ['오프라인', '오프라인']]; // [표 제목, 원장 채널]
const GRID_FIRST = 4; // 날짜 시작 행
/** 편집기에서 1회 실행: 입력표 생성 + 기존 폼 응답(10월분 등) 옮기기 + 칸 고치면 바로 반영되는 트리거 */
function setupManualGrid() {
  const ss = getSS_();
  const old = ss.getSheetByName(GRID_TAB);
  let prev = {};
  if (old && old.getRange(1, 1).getValue() !== '수기 매출 입력표') { // 예전 폼 응답 탭 → 값 읽고 이름 변경
    prev = readFormTab_(old); old.setName('수기입력_폼응답(사용안함)');
  }
  let sh = ss.getSheetByName(GRID_TAB);
  if (!sh) sh = ss.insertSheet(GRID_TAB, 1);
  sh.clear(); sh.setFrozenRows(3); sh.setFrozenColumns(1);
  sh.getRange('A1').setValue('수기 매출 입력표').setFontWeight('bold').setFontSize(13);
  sh.getRange('C1').setValue('숫자만 입력(콤마 없이). 칸을 고치면 바로 대시보드에 반영됩니다. 취소·환불은 마이너스(-). 비어 있으면 판매 없음.').setFontColor('#666666');
  sh.getRange(2, 1, 2, 1).merge().setValue('날짜');
  GRID_CH.forEach(([t], k) => { sh.getRange(2, 2 + k * 3, 1, 3).merge().setValue(t); sh.getRange(3, 2 + k * 3, 1, 3).setValues([['매출', '주문건수', '판매개수']]); });
  sh.getRange(2, 11, 2, 1).merge().setValue('비고');
  const head = sh.getRange(2, 1, 2, 11); head.setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setBackground('#eef2f7');
  [['#fff4e5', 2], ['#eaf6ec', 5], ['#eaf0fb', 8]].forEach(([c, col]) => sh.getRange(2, col, 2, 3).setBackground(c));
  extendGrid_(sh, '2026-10-01');
  // 옮기기(예전 폼 응답)
  const dates = sh.getRange(GRID_FIRST, 1, sh.getLastRow() - GRID_FIRST + 1, 1).getValues().map(r => normDate_(r[0]));
  Object.values(prev).forEach(a => { const r = dates.indexOf(a.date); const k = GRID_CH.findIndex(c => c[1] === a.ch); if (r < 0 || k < 0) return;
    sh.getRange(GRID_FIRST + r, 2 + k * 3, 1, 3).setValues([[a.pay, a.orders, a.qty]]); });
  sh.setColumnWidth(1, 96); for (let c = 2; c <= 10; c++) sh.setColumnWidth(c, 82); sh.setColumnWidth(11, 260);
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'onManualEdit_'))
    ScriptApp.newTrigger('onManualEdit_').forSpreadsheet(ss).onEdit().create();
  const r = syncManual_(); console.log('입력표 준비 완료. 반영 ' + r.synced + '건');
}
/** 날짜 줄을 다음 달 말일까지 늘림 (월이 바뀌면 굵은 선으로 구분) */
function extendGrid_(sh, from) {
  const last = sh.getLastRow(); let start = from;
  if (last >= GRID_FIRST) start = ymd_(addDays_(new Date(normDate_(sh.getRange(last, 1).getValue()) + 'T12:00:00+09:00'), 1));
  const n = new Date(); const end = ymd_(new Date(n.getFullYear(), n.getMonth() + 2, 0));
  const add = []; for (let d = start; d <= end; d = ymd_(addDays_(new Date(d + 'T12:00:00+09:00'), 1))) add.push([d]);
  if (!add.length) return;
  const r0 = Math.max(last + 1, GRID_FIRST); const rg = sh.getRange(r0, 1, add.length, 1);
  rg.setNumberFormat('@').setValues(add);
  sh.getRange(r0, 2, add.length, 9).setNumberFormat('#,##0;-#,##0;');
  const wd = add.map(([d]) => new Date(d + 'T12:00:00+09:00').getDay());
  add.forEach(([d], i) => { if (wd[i] === 0 || wd[i] === 6) sh.getRange(r0 + i, 1).setFontColor(wd[i] === 0 ? '#c0392b' : '#2e6fd1');
    if (d.slice(8) === '01') sh.getRange(r0 + i, 1, 1, 11).setBorder(true, null, null, null, null, null, '#555555', SpreadsheetApp.BorderStyle.SOLID_MEDIUM); });
}
function readFormTab_(sh) {
  const v = sh.getDataRange().getValues(); const h = v[0].map(x => String(x).trim()); const ix = k => h.indexOf(k);
  const n = x => Number(String(x == null ? '' : x).replace(/[^0-9.\-]/g, '')) || 0; const agg = {};
  if (ix('날짜') < 0) return agg;
  v.slice(1).forEach(r => { const d = normDate_(r[ix('날짜')]); const ch = MANUAL_CH[String(r[ix('채널')]).trim()]; if (!d || !ch) return;
    const k = d + '|' + ch; const a = agg[k] || (agg[k] = { date: d, ch, pay: 0, orders: 0, qty: 0 });
    a.pay += n(r[ix('매출(원)')]); a.orders += n(r[ix('주문건수')]); a.qty += n(r[ix('판매개수')]); });
  return agg;
}
function onManualEdit_(e) { try { if (e && e.range && e.range.getSheet().getName() === GRID_TAB && e.range.getRow() >= GRID_FIRST) syncManual_(); } catch (x) { console.log('수기 반영 오류: ' + x.message); } }
/** 입력표 → 원장 (빈 칸으로 바뀐 날짜·채널은 0으로) */
function syncManual_() {
  const ss = getSS_(); const sh = ss.getSheetByName(GRID_TAB);
  if (!sh || sh.getRange(1, 1).getValue() !== '수기 매출 입력표') return { synced: 0, note: '입력표 없음 — setupManualGrid 실행 필요' };
  extendGrid_(sh);
  const last = sh.getLastRow(); if (last < GRID_FIRST) return { synced: 0 };
  const v = sh.getRange(GRID_FIRST, 1, last - GRID_FIRST + 1, 11).getValues();
  const n = x => (x === '' || x == null) ? null : (Number(String(x).replace(/[^0-9.\-]/g, '')) || 0);
  const agg = {};
  v.forEach(r => { const d = normDate_(r[0]); if (!d) return;
    GRID_CH.forEach(([, ch], k) => { const pay = n(r[1 + k * 3]), od = n(r[2 + k * 3]), q = n(r[3 + k * 3]);
      if (pay == null && od == null && q == null) return;
      agg[d + '|' + ch] = { date: d, ch, pay: pay || 0, orders: od || 0, qty: q || 0, note: String(r[10] || '').slice(0, 200) }; }); });
  const led = ss.getSheetByName('원장'); const lv = led.getLastRow() > 1 ? led.getRange(2, 1, led.getLastRow() - 1, LEDGER_HEAD.length).getValues() : [];
  const had = {}; lv.forEach(r => { if (/^수기/.test(String(r[15])) && Object.values(MANUAL_CH).includes(r[1])) had[normDate_(r[0]) + '|' + r[1]] = r; });
  Object.keys(had).forEach(k => { if (!agg[k]) { const [d, ch] = k.split('|'); agg[k] = { date: d, ch, pay: 0, orders: 0, qty: 0, note: '' }; } });
  // 바뀐 것만 기록
  const rows = Object.entries(agg).filter(([k, a]) => { const o = had[k]; return !o || +o[2] !== a.pay || +o[3] !== a.orders || +o[4] !== a.qty || String(o[14] || '') !== a.note; })
    .map(([, a]) => buildRow_({ date: a.date, ch: a.ch, pay: a.pay, orders: a.orders, qty: a.qty, cancel: 0, refund: 0, note: a.note }, '수기(표)'));
  if (rows.length) upsertLedger_(rows);
  return { synced: rows.length };
}
/* ============ 2. 폼 응답 → 원장 ============ */
function onFormSubmit_(e) {
  const nv = e.namedValues || {};
  if (nv['매출(원)']) return; // (사용 안 함) 예전 수기 폼 — 지금은 「수기입력」 입력표 사용
  const g = k => (nv[k] && nv[k][0] != null ? String(nv[k][0]).trim() : '');
  const date = normDate_(g('날짜')); const ch = g('채널');
  if (!date || !ch) return;
  const row = buildRow_({ date, ch, pay: g('결제금액(원)'), orders: g('결제건수'), qty: g('판매수량'), cancel: g('취소금액(원)'), cancelCnt: g('취소건수'),
    refund: g('환불금액(원)'), refundCnt: g('환불건수'), visitors: g('방문자'), inq: g('신규문의'), unans: g('미답변문의'), reviews: g('신규리뷰'), note: g('비고') }, '구글폼');
  upsertLedger_([row]);
}

function buildRow_(o, method) {
  const n = v => (v === '' || v == null) ? '' : Number(String(v).replace(/[^0-9.\-]/g, '')) || 0;
  const pay = n(o.pay), cancel = n(o.cancel), refund = n(o.refund);
  const net = (o.net !== undefined && o.net !== '') ? n(o.net) : (pay === '' ? '' : pay - (cancel || 0) - (refund || 0));
  return [o.date, o.ch, pay, n(o.orders), n(o.qty), cancel, n(o.cancelCnt), refund, n(o.refundCnt), net, n(o.visitors), n(o.inq), n(o.unans), n(o.reviews), o.note || '', method, Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm')];
}

/** 같은 날짜+채널이 있으면 덮어쓰고(정정), 없으면 추가 */
/** 원장 쓰기는 한 번에 하나씩(서버 수집 5개 + 시트 수집이 07:15~07:30에 겹쳐도 서로 덮어쓰지 않게) */
function withLedgerLock_(fn) { const lk = LockService.getScriptLock(); lk.waitLock(180000); try { return fn(); } finally { lk.releaseLock(); } }
function upsertLedger_(rows) { return withLedgerLock_(() => upsertLedgerBody_(rows)); }
function upsertLedgerBody_(rows) {
  LEDGER_CACHE_ = null; MONTH_MAP_ = null;
  const sh = getSS_().getSheetByName('원장');
  const last = sh.getLastRow();
  const keys = last > 1 ? sh.getRange(2, 1, last - 1, 2).getValues().map(r => normDate_(r[0]) + '|' + r[1]) : [];
  const out = { updated: 0, added: 0 }; const toAdd = [];
  rows.forEach(r => {
    const i = keys.indexOf(r[0] + '|' + r[1]);
    if (i >= 0) { sh.getRange(i + 2, 1, 1, r.length).setValues([r]); out.updated++; }
    else { toAdd.push(r); keys.push(r[0] + '|' + r[1]); out.added++; }
  });
  if (toAdd.length) sh.getRange(sh.getLastRow() + 1, 1, toAdd.length, LEDGER_HEAD.length).setValues(toAdd); // 한 번에 기록
  SpreadsheetApp.flush();
  return out;
}

/* ============ 3. 웹 API (대시보드 · 스킬) ============ */
function doGet(e) {
  const p = e.parameter || {};
  if (String(p.state || '').indexOf('cafe24_') === 0 || ((p.code || p.error) && !p.action)) {
    const msg = (typeof cafe24Callback_ === 'function') ? cafe24Callback_(p) : 'Apis.gs가 없습니다';
    return HtmlService.createHtmlOutput('<meta charset="utf-8"><div style="font:16px sans-serif;padding:40px">' + msg + '</div>');
  }
  return handle_(p);
}
function doPost(e) {
  let body = {}; try { body = JSON.parse(e.postData.contents || '{}'); } catch (x) {}
  return handle_(Object.assign({}, e.parameter || {}, body));
}
function handle_(p) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (p.action === 'ping') return out({ ok: true, time: new Date() });
  if (!p.key || sha256_(String(p.key)) !== PropertiesService.getScriptProperties().getProperty('PW_HASH')) return out({ ok: false, error: 'unauthorized' });
  try {
    switch (p.action) {
      case 'data': return out(Object.assign({ ok: true }, buildData_()));
      case 'submit': { // rows: [{date, ch, pay, orders, qty, cancel, cancelCnt, refund, refundCnt, visitors, inq, unans, reviews, note}]
        const rows = (p.rows || []).map(r => buildRow_(Object.assign({}, r, { date: normDate_(r.date) }), p.method || 'Cowork 스킬'));
        if (p.merge && typeof mergeLedger_ === 'function') { mergeLedger_(rows); return out({ ok: true, merged: rows.length }); }
        return out(Object.assign({ ok: true }, upsertLedger_(rows)));
      }
      case 'products': { // {ch, d1, d2, rows:[{date, code, name, qty, amt, cancelQty, cancelAmt, retQty, retAmt, exQty}]} → 그 채널·기간 제품 행을 통째로 교체
        return out(Object.assign({ ok: true }, replaceProducts_(p.ch, normDate_(p.d1), normDate_(p.d2), p.rows || [], p.method || 'API')));
      }
      case 'coupang': return out(Object.assign({ ok: true }, coupangIngest_(p.raw || {}))); // 서버가 보낸 쿠팡 원본 → 저장·집계
      case 'manualSync': return out(Object.assign({ ok: true }, syncManual_()));
      case 'master': return out({ ok: true, rows: sheetObjects_(getSS_().getSheetByName('제품마스터')) }); // 제품마스터 전체
      case 'masterSet': return out(Object.assign({ ok: true }, setMaster_(p.rows || []))); // rows:[{ch, code, std}] → 표준제품명 갱신
      case 'alert': { return out({ ok: true, sent: tg_(String(p.text || '').slice(0, 3500)) });
      }
      case 'push': { const sent = sendDaily_(p.date); if (sent === 200 && !p.date) PropertiesService.getScriptProperties().setProperty('LAST_PUSH', ymd_(new Date())); return out({ ok: true, sent }); } // 수동 발송도 '오늘 보냄'으로 기록(예비 발송 중복 방지)
      case 'markPushed': PropertiesService.getScriptProperties().setProperty('LAST_PUSH', ymd_(new Date())); return out({ ok: true });
      case 'pushOnce': return out({ ok: true, sent: dailyPush_() }); // 서버 08:05 예비 발송: 오늘 아직 안 보냈을 때만 보냄
      case 'weekly': return out({ ok: true, sent: sendWeekly_() });
      case 'monthly': return out({ ok: true, sent: sendMonthly_() });
      case 'triggers': return out({ ok: true, list: restoreTriggers() });
      case 'preview': return out({ ok: true, text: dailyText_(p.date) });
      case 'previewWeekly': return out({ ok: true, text: weeklyText_() });
      case 'previewMonthly': return out({ ok: true, text: monthlyText_() });
      case 'missing': return out({ ok: true, missing: missingChannels_(p.date) });
      default: return out({ ok: false, error: 'unknown action' });
    }
  } catch (err) { return out({ ok: false, error: String(err) }); }
}

/** 대시보드가 쓰는 데이터 묶음 */
function buildData_() {
  const ss = getSS_();
  const led = readLedger_();
  const daily = led.map(r => ({ date: r.date, ch: r.ch, pay: nz_(r.pay), orders: nz_(r.orders), qty: nz_(r.qty), cancel: nz_(r.cancel), cancelCnt: nz_(r.cancelCnt), refund: nz_(r.refund), refundCnt: nz_(r.refundCnt), net: nz_(r.net), visitors: nz_(r.visitors), inq: nz_(r.inq), unans: nz_(r.unans), reviews: nz_(r.reviews), note: r.note, method: r.method }));
  // 월별: 채널 그룹마다 원장에 그 달 데이터가 있으면 원장 집계, 없으면 과거 월별 표 (그룹 단위로 교체)
  const monthly = mergedMonthly_(daily, sheetObjects_(ss.getSheetByName('월별실적_과거')));
  const targets = sheetObjects_(ss.getSheetByName('월목표')).filter(t => t.연월).map(t => ({ ym: t.연월, 스마트스토어: num_(t.스마트스토어), 쿠팡: num_(t.쿠팡), 자사몰: num_(t.자사몰), 외부몰: num_(t.외부몰), total: num_(t.합계) }));
  const mis = ss.getSheetByName('불일치기록'); const mismatch = mis && mis.getLastRow() > 1 ? mis.getRange(2, 1, mis.getLastRow() - 1, 7).getValues() : [];
  const asof = daily.length ? daily.map(d => d.date).sort().pop() : null;
  let products = null; try { products = buildProducts_(asof); } catch (e) { products = { error: String(e) }; }
  return { asof, generated: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), monthly, daily, targets, mismatch, products, channels: CHANNELS.map(c => ({ code: c[0], name: c[1], group: c[2] })) };
}


/** 과거 월별 표 + 원장 집계를 채널 그룹 단위로 합침. 2025년 '합계' 행은 교체된 그룹만큼 보정 */
function mergedMonthly_(daily, hist) {
  const agg = {}; // ym|group -> sums
  daily.forEach(d => { const g = GROUP_OF[d.ch]; if (!g) return; const k = d.date.slice(0, 7) + '|' + g;
    const a = agg[k] || (agg[k] = { sales: 0, orders: 0, qty: 0, visitors: null });
    a.sales += d.net || 0; a.orders += d.orders || 0; a.qty += d.qty || 0; if (d.visitors != null) a.visitors = (a.visitors || 0) + d.visitors; });
  const out = []; const histKeys = new Set();
  const byYm = {};
  hist.forEach(h => { const ym = `${h.연}-${pad_(h.월)}`; (byYm[ym] = byYm[ym] || []).push(h); });
  Object.keys(byYm).forEach(ym => {
    const [y, m] = ym.split('-').map(Number); let delta = 0; let sumRow = null;
    byYm[ym].forEach(h => {
      if (h.채널명 === '합계') { sumRow = h; return; }
      let a = agg[ym + '|' + h.채널명]; histKeys.add(ym + '|' + h.채널명);
      // 수집이 일부만 된 채널(외부몰 몰별 미수집, 쿠팡 로켓그로스 미연동 등)은 원장 합계가 엑셀의 80% 미만이면 엑셀 값을 유지
      if (a && (num_(h.매출) || 0) > 0 && a.sales < (num_(h.매출) || 0) * 0.8) a = null;
      if (a) { delta += a.sales - (num_(h.매출) || 0); out.push({ y, m, ch: h.채널명, sales: a.sales, orders: a.orders, qty: a.qty, visitors: a.visitors != null ? a.visitors : num_(h.방문자) }); }
      else out.push({ y, m, ch: h.채널명, sales: num_(h.매출), orders: num_(h.주문건수), qty: num_(h.판매개수), visitors: num_(h.방문자) });
    });
    if (sumRow) {
      CH_GROUPS.forEach(g => { const a = agg[ym + '|' + g]; if (a && !histKeys.has(ym + '|' + g)) delta += a.sales; });
      out.push({ y, m, ch: '합계', sales: num_(sumRow.매출) == null ? null : num_(sumRow.매출) + delta, orders: null, qty: null, visitors: num_(sumRow.방문자) });
    }
  });
  Object.keys(agg).forEach(k => { if (histKeys.has(k)) return; const [ym, g] = k.split('|'); const [y, m] = ym.split('-').map(Number); const a = agg[k];
    out.push({ y, m, ch: g, sales: a.sales, orders: a.orders, qty: a.qty, visitors: a.visitors }); });
  return out;
}

/* ============ 3-1. 제품별 판매 ============ */
/** 채널명 원본에서 표준제품명 1차 추정: [..] (..) 괄호·브랜드명 제거. 시트 '제품마스터'에서 사람이 고치면 그 값이 우선 */
function normProd_(name) {
  const s = String(name || '').replace(/\[[^\]]*\]|【[^】]*】/g, ' ').replace(/보고바이오|BOGOBIO/gi, ' ').replace(/\s+/g, ' ').trim();
  // 산삼비책 진/원: 600ml = 30포 1박스, 1000ml = 50포 1박스 → 대시보드 제품군 규칙과 같은 표준명
  const line = /산삼비책\s*진|블랙/.test(s) ? '산삼비책진 더 블랙' : /산삼비책\s*원|레드/.test(s) ? '산삼비책원 더 레드' : null;
  let m;
  if (line && !/세트|진\s*\+\s*원/.test(s)) {
    const bx = (m = s.match(/(\d+)\s*박스/)) ? +m[1] : 1;
    if (/1000\s*ml|1\s*kg|50\s*포/i.test(s)) return bx === 1 ? line + ' 50포(1kg)' : line + ' 50포 ' + bx + '박스';
    if (/600\s*ml|30\s*포/i.test(s)) return bx === 1 ? line + ' 1박스(30포)' : line + ' ' + bx + '박스';
  }
  if ((m = s.match(/^김삼미 김스낵 (오리지널\+와사비|오리지널|와사비), 12g, (\d+)개/))) return '김삼미 김스낵 ' + m[1] + ' ' + m[2] + '개';
  return s || String(name || '').trim();
}
/** 채널 ch의 [d1, d2] 기간 제품 행을 새 값으로 교체 (재수집해도 중복되지 않음) */
function replaceProducts_(ch, d1, d2, rows, method) {
  if (!ch || !d1 || !d2) throw new Error('products: ch, d1, d2 필요');
  const lock = LockService.getScriptLock(); lock.waitLock(120000);
  try {
    const ss = getSS_(); const sh = ensureSheet_(ss, '제품원장', PROD_HEAD);
    sh.getRange('A:C').setNumberFormat('@');
    const last = sh.getLastRow(); const W = PROD_HEAD.length;
    const old = last > 1 ? sh.getRange(2, 1, last - 1, W).getValues() : [];
    const keep = old.filter(r => r[0] && !(r[1] === ch && normDate_(r[0]) >= d1 && normDate_(r[0]) <= d2)).map(r => { r[0] = normDate_(r[0]); return r; });
    const n = v => Number(v) || 0; const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    const add = rows.map(r => Object.assign({}, r, { date: normDate_(r.date) })).filter(r => r.date >= d1 && r.date <= d2 && (n(r.qty) || n(r.cancelQty) || n(r.retQty) || n(r.exQty)))
      .map(r => [r.date, ch, String(r.code), String(r.name || ''), n(r.qty), Math.round(n(r.amt)), n(r.cancelQty), Math.round(n(r.cancelAmt)), n(r.retQty), Math.round(n(r.retAmt)), n(r.exQty), method || 'API', now]);
    const all = keep.concat(add).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    if (all.length) sh.getRange(2, 1, all.length, W).setValues(all); // 먼저 덮어쓰고
    if (last - 1 > all.length) sh.getRange(2 + all.length, 1, last - 1 - all.length, W).clearContent(); // 남는 줄만 지움 (읽는 쪽이 빈 표를 보는 순간이 없도록)
    const newProducts = updateProductMaster_(ss, ch, add);
    SpreadsheetApp.flush();
    return { replaced: old.length - keep.length, written: add.length, newProducts };
  } finally { lock.releaseLock(); }
}
function updateProductMaster_(ss, ch, add) {
  const sh = ensureSheet_(ss, '제품마스터', PMASTER_HEAD); sh.getRange('A:B').setNumberFormat('@');
  const have = new Set(sheetObjects_(sh).map(m => m.채널 + '|' + m.상품코드));
  const seen = new Set(); const today = ymd_(new Date());
  const rows = add.filter(r => { const k = ch + '|' + r[2]; if (have.has(k) || seen.has(k)) return false; seen.add(k); return true; }).map(r => [ch, r[2], r[3], normProd_(r[3]), today]);
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, PMASTER_HEAD.length).setValues(rows);
  return rows.length;
}
/** 제품마스터 표준제품명 일괄 갱신: rows [{ch, code, std}] (채널+상품코드가 같은 행의 D열만 바꿈) */
function setMaster_(rows) {
  const sh = getSS_().getSheetByName('제품마스터'); if (!sh || sh.getLastRow() < 2) return { updated: 0 };
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, PMASTER_HEAD.length).getValues();
  const want = {}; rows.forEach(r => { if (r && r.ch && r.code != null && r.std) want[r.ch + '|' + String(r.code).trim()] = String(r.std).trim(); });
  let updated = 0; const col = v.map(r => { const k = r[0] + '|' + String(r[1]).trim(); if (want[k] && want[k] !== r[3]) { updated++; return [want[k]]; } return [r[3]]; });
  if (updated) { sh.getRange(2, 4, col.length, 1).setValues(col); SpreadsheetApp.flush(); }
  return { updated, total: v.length };
}
/** 대시보드용: 월별 + 일별(전체 기간), 표준제품명 기준. 배열로 압축 */
function buildProducts_(asof) {
  const ss = getSS_(); const sh = ss.getSheetByName('제품원장'); if (!sh || sh.getLastRow() < 2) return { cols: [], m: [], d: [] };
  const std = {}; sheetObjects_(ss.getSheetByName('제품마스터')).forEach(m => { std[m.채널 + '|' + m.상품코드] = String(m.표준제품명 || m['상품명(채널 원본)'] || m.상품코드).trim(); });
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues();
  const M = {}, Dd = {};
  const addTo = (map, k, head, r) => { const a = map[k] || (map[k] = head.concat([0, 0, 0, 0, 0, 0, 0])); for (let i = 0; i < 7; i++) a[head.length + i] += Number(r[4 + i]) || 0; };
  v.forEach(r => { if (!r[0]) return; const d = normDate_(r[0]); const ch = r[1]; const name = std[ch + '|' + r[2]] || normProd_(r[3]);
    addTo(M, d.slice(0, 7) + '|' + ch + '|' + name, [d.slice(0, 7), ch, name], r);
    addTo(Dd, d + '|' + ch + '|' + name, [d, ch, name], r); });
  const round = a => a.map((x, i) => i < 3 ? x : Math.round(x * 10) / 10);
  return { cols: ['기간', '채널', '제품', '판매수량', '판매금액', '취소수량', '취소금액', '반품수량', '반품금액', '교환수량'], m: Object.values(M).map(round), d: Object.values(Dd).map(round) };
}

/* ============ 4. 텔레그램 ============ */
/** (폐기) 예전 08:00 일회용 예약 방식. 옛 배포본이 이 예약을 되살려도, 실행되면 자기 자신만 지우고 매일 예약을 보장한다(11/3) */
function armDailyPush_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'armDailyPush_').forEach(t => ScriptApp.deleteTrigger(t));
  restoreTriggers();
}
function dailyPush_() { // 08시·09시 예약 + 서버 08:20 예비 호출이 겹쳐도 한 번만 보내도록 잠금
  const lk = LockService.getScriptLock(); if (!lk.tryLock(240000)) return 'busy';
  try { return dailyPushBody_(); } finally { lk.releaseLock(); }
}
function dailyPushBody_() {
  const today = new Date(); const key = 'LAST_PUSH', dk = ymd_(today), pp = PropertiesService.getScriptProperties();
  if (pp.getProperty(key) === dk) { console.log('오늘 이미 발송함'); return 'already'; }
  const code = sendDaily_(); if (code !== 200) { console.log('발송 실패 ' + code); return code; } // 실패하면 표시하지 않아 예비 발송이 다시 시도
  pp.setProperty(key, dk);
  if (today.getDay() === 1) sendWeekly_();
  if (today.getDate() === 1) sendMonthly_();
  return 200;
}
function tg_(text) {
  const p = PropertiesService.getScriptProperties(); const token = p.getProperty('TG_TOKEN'), chat = p.getProperty('TG_CHAT');
  if (!token || !chat) return 'telegram-not-configured';
  const res = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
  return res.getResponseCode();
}
function sendDaily_(date) { return tg_(dailyText_(date)); }

/* ---- 모바일용 보고 (한 줄 짧게 · 숫자 앞 아이콘 · 채널은 매출 있는 곳만) ---- */
const WD_ = ['일', '월', '화', '수', '목', '금', '토'];
const CH_ICON_ = { '스마트스토어': '🟢', '쿠팡': '🟠', '자사몰': '🔵', '외부몰': '🟣' };
const md_ = d => `${+d.slice(5, 7)}/${+d.slice(8)}(${WD_[new Date(d + 'T12:00:00+09:00').getDay()]})`;
const arr_ = (a, b) => { if (!b) return ''; const p = (a - b) / Math.abs(b) * 100; return (p >= 0 ? ' ▲' : ' ▼') + Math.abs(p).toFixed(0) + '%'; };
const S_ = (rows, k) => rows.reduce((a, r) => a + (nz_(r[k]) || 0), 0);
/** 표준제품명 → [제품군, 구성수량] (대시보드 제품군 규칙과 동일) */
function pFam_(name) {
  const n = String(name || '').replace(/\s*※.*$/, '').trim(); let m;
  if ((m = n.match(/^(.*?진\s*\+\s*원.*?세트)\s*\((\d+)\s*세트\)/))) return [m[1].replace(/\s+/g, ' '), +m[2]];
  if ((m = n.match(/^(.+?) 50포 (\d+)박스/))) return [m[1] + ' 50포', +m[2]];
  if ((m = n.match(/^(.+?) 50포/))) return [m[1] + ' 50포', 1];
  if ((m = n.match(/^(.+?) 데일리팩 (\d+)박스/))) return [m[1] + ' 데일리팩', +m[2]];
  if ((m = n.match(/^(.+?) 10포/))) return [m[1] + ' 10포', 1];
  if ((m = n.match(/^(.+?) 1박스\(30포\)/))) return [m[1] + ' 30포', 1];
  if ((m = n.match(/^(산삼비책.+?) (\d+)박스$/))) return [m[1] + ' 30포', +m[2]];
  if ((m = n.match(/^(.+?) 기프트팩/))) return [m[1] + ' 기프트팩', 1];
  if ((m = n.match(/^(김삼미 김스낵 .+?) (\d+)개$/))) return [m[1], +m[2]];
  return [n || String(name), 1];
}
/** 날짜 [a, b] 제품군별 판매량·금액 */
function famTop_(a, b) {
  const ss = getSS_(); const std = {};
  sheetObjects_(ss.getSheetByName('제품마스터')).forEach(m => { std[m.채널 + '|' + m.상품코드] = String(m.표준제품명 || m['상품명(채널 원본)'] || m.상품코드).trim(); });
  const sh = ss.getSheetByName('제품원장'); if (!sh || sh.getLastRow() < 2) return [];
  const f = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(r => { const d = normDate_(r[0]); if (d < a || d > b) return;
    const nm = std[r[1] + '|' + String(r[2])] || String(r[3]); const [fam, mult] = pFam_(nm); const x = f[fam] || (f[fam] = { fam, units: 0, amt: 0 });
    x.units += (Number(r[4]) || 0) * mult; x.amt += Number(r[5]) || 0; });
  return Object.values(f).filter(x => x.amt > 0 && !/^(부자재|개인결제)/.test(x.fam)).sort((x, y) => y.amt - x.amt); // 부자재·개인결제는 순위에서 제외
}
function chanLines_(rows, prevRows, d) {
  const L = []; const cpLag = (new Date() - new Date(d + 'T12:00:00+09:00')) / 864e5 < 4;
  CH_GROUPS.forEach(g => { const rs = rows.filter(r => GROUP_OF[r.ch] === g), v = S_(rs, 'net'), pv = S_(prevRows.filter(r => GROUP_OF[r.ch] === g), 'net');
    if (g === '외부몰') { const sub = {}; rs.forEach(r => { if (nz_(r.net)) sub[r.ch] = (sub[r.ch] || 0) + nz_(r.net); });
      if (!v && !Object.keys(sub).length) return;
      L.push(`${CH_ICON_[g]} 외부몰 <b>${won_(v)}</b>`); Object.entries(sub).sort((a, b) => b[1] - a[1]).forEach(([c, x]) => L.push(`   · ${c} ${won_(x)}`)); return; }
    const od = S_(rs, 'orders');
    L.push(`${CH_ICON_[g]} ${g} <b>${won_(v)}</b>${arr_(v, pv)}${od ? ` · ${od}건` : ''}${g === '쿠팡' && cpLag && !v ? ' <i>(출고 후 반영)</i>' : ''}`); });
  return L;
}
function dailyText_(dateStr) {
  const d = dateStr ? normDate_(dateStr) : ymd_(addDays_(new Date(), -1));
  const led = readLedger_(); const day = x => led.filter(r => r.date === x);
  const pdD = ymd_(addDays_(new Date(d + 'T12:00:00+09:00'), -1)), lwD = ymd_(addDays_(new Date(d + 'T12:00:00+09:00'), -7));
  const T = day(d), P = day(pdD), W = day(lwD);
  const net = S_(T, 'net'), pay = S_(T, 'pay'), od = S_(T, 'orders'), qty = S_(T, 'qty'), cr = S_(T, 'cancel') + S_(T, 'refund');
  const ym = d.slice(0, 7), dn = +d.slice(8), dim = new Date(+d.slice(0, 4), +d.slice(5, 7), 0).getDate();
  const mtd = S_(led.filter(r => r.date.slice(0, 7) === ym && r.date <= d), 'net');
  const pm = new Date(+d.slice(0, 4), +d.slice(5, 7) - 2, 1), pmYm = ymd_(pm).slice(0, 7), pmDim = new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate();
  const pmSame = S_(led.filter(r => r.date.slice(0, 7) === pmYm && +r.date.slice(8) <= Math.min(dn, pmDim)), 'net');
  const target = targetFor_(ym), pace = mtd / dn * dim;
  const L = [];
  L.push(`📊 <b>보고바이오 데일리</b> · ${md_(d)}`, '');
  L.push(`💰 순매출 <b>${won_(net)}</b>`);
  L.push(`    전일${arr_(net, S_(P, 'net')) || ' –'} · 전주 같은 요일${arr_(net, S_(W, 'net')) || ' –'}`);
  L.push(`🧾 주문 ${od}건 · 판매 ${Math.round(qty)}개`);
  L.push(`💳 객단가 ${od ? won_(net / od) : '–'}${cr ? ` · 취소·반품 ${won_(cr)}` : ''}`);
  L.push('', `📈 <b>${+d.slice(5, 7)}월 누적</b> (${dn}/${dim}일)`);
  L.push(`    <b>${won_(mtd)}</b> · 전월 같은 기간${arr_(mtd, pmSame) || ' –'}`);
  L.push(`    월말 예상 ${won_(pace)}` + (target ? ` · 목표 ${(mtd / target * 100).toFixed(0)}%` : ''));
  L.push('', '<b>채널별</b> (순매출 · 전일비)'); chanLines_(T, P, d).forEach(x => L.push(x));
  try { const top = famTop_(d, d).slice(0, 3); if (top.length) { L.push('', '<b>🏆 TOP 제품</b>'); top.forEach((x, i) => L.push(`${i + 1}. ${x.fam}\n    ${Math.round(x.units)}개 · 판매 ${won_(x.amt)}`)); } } catch (e) { console.log('TOP 제품 생략: ' + e.message); }
  const flags = [];
  if (pay > 0 && cr / pay >= 0.15) flags.push(`취소·반품이 결제의 ${(cr / pay * 100).toFixed(0)}%`);
  const dropPct = Number(getSetting_('ALERT_DROP_PCT') || -30); const pn = S_(P, 'net'); if (pn > 0 && (net - pn) / pn * 100 <= dropPct) flags.push(`매출 전일 대비 ${Math.round((net - pn) / pn * 100)}%`);
  ['스마트스토어', '자사몰'].forEach(g => { const last3 = [0, 1, 2].map(i => S_(day(ymd_(addDays_(new Date(d + 'T12:00:00+09:00'), -i))).filter(r => GROUP_OF[r.ch] === g), 'pay')); if (last3.every(v => v <= 0)) flags.push(`${g} 3일 연속 결제 0`); });
  if (target && dn >= 7 && pace < target * 0.85) flags.push(`목표 대비 페이스 ${(pace / target * 100).toFixed(0)}%`);
  const miss = ['스마트스토어', '자사몰', '쿠팡', '11번가', '롯데온', 'SSG'].filter(c => !T.some(r => r.ch === c)); if (miss.length) flags.push(`자동 수집 누락: ${miss.join(', ')}`);
  // API 키 만료 3주 전부터 알림 (재발급 후 날짜를 아래 KEY_EXPIRY_에서 고칠 것)
  KEY_EXPIRY_.forEach(([nm, exp]) => { const left = Math.round((new Date(exp + 'T00:00:00+09:00') - new Date(d + 'T00:00:00+09:00')) / 864e5); if (left <= 21) flags.push(`${nm} ${left < 0 ? '만료됨' : '만료 ' + left + '일 전'} (${exp}) — 재발급 필요`); });
  if (flags.length) { L.push('', '<b>⚠️ 체크</b>'); flags.forEach(f => L.push('· ' + f)); }
  L.push('', `<a href="${getSetting_('DASHBOARD_URL')}">📱 대시보드 열기</a>`);
  return L.join('\n');
}

function weeklyText_() {
  const led = readLedger_(); const now = new Date(); const end = ymd_(addDays_(now, -1)), start = ymd_(addDays_(now, -7)), pStart = ymd_(addDays_(now, -14)), pEnd = ymd_(addDays_(now, -8));
  const rng = (a, b) => led.filter(r => r.date >= a && r.date <= b); const cur = rng(start, end), prev = rng(pStart, pEnd);
  const net = S_(cur, 'net'), od = S_(cur, 'orders');
  const L = [`📅 <b>주간 보고</b> · ${md_(start)}~${md_(end)}`, '', `💰 순매출 <b>${won_(net)}</b>${arr_(net, S_(prev, 'net'))} 전주`, `🧾 주문 ${od}건 · 판매 ${Math.round(S_(cur, 'qty'))}개`, `💳 객단가 ${od ? won_(net / od) : '–'} · 취소·반품 ${won_(S_(cur, 'cancel') + S_(cur, 'refund'))}`, '', '<b>채널별</b> (점유율 · 전주비)'];
  CH_GROUPS.forEach(g => { const c = S_(cur.filter(r => GROUP_OF[r.ch] === g), 'net'), p = S_(prev.filter(r => GROUP_OF[r.ch] === g), 'net'); if (!c && !p) return; L.push(`${CH_ICON_[g]} ${g} <b>${won_(c)}</b> · ${net ? (c / net * 100).toFixed(0) : 0}%${arr_(c, p)}`); });
  const byDay = {}; cur.forEach(r => byDay[r.date] = (byDay[r.date] || 0) + (nz_(r.net) || 0)); const top = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  if (top) L.push('', `⭐ 최고 매출일 ${md_(top[0])} ${won_(top[1])}`);
  try { const t = famTop_(start, end).slice(0, 3); if (t.length) { L.push('', '<b>🏆 주간 TOP 제품</b>'); t.forEach((x, i) => L.push(`${i + 1}. ${x.fam}\n    ${Math.round(x.units)}개 · 판매 ${won_(x.amt)}`)); } } catch (e) {}
  L.push('', `<a href="${getSetting_('DASHBOARD_URL')}">📱 대시보드 열기</a>`);
  return L.join('\n');
}
function sendWeekly_() { return tg_(weeklyText_()); }
function monthlyText_() {
  const now = new Date(); const ym = ymd_(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7), prevYm = ymd_(new Date(now.getFullYear(), now.getMonth() - 2, 1)).slice(0, 7), lyYm = (+ym.slice(0, 4) - 1) + ym.slice(4);
  const all = readLedger_(); const led = all.filter(r => r.date.slice(0, 7) === ym);
  const M = monthMap_(); const g = (k, grp) => (M[k] && M[k][grp || '합계'] != null) ? M[k][grp || '합계'] : null;
  const net = S_(led, 'net'), od = S_(led, 'orders'), prev = g(prevYm), ly = g(lyYm), target = targetFor_(ym);
  const L = [`🗓 <b>월간 보고</b> · ${+ym.slice(5)}월`, '', `💰 순매출 <b>${won_(net)}</b>`, `    전월${arr_(net, prev) || ' –'} · 전년 동월${arr_(net, ly) || ' –'}`];
  if (target) L.push(`🎯 목표 ${won_(target)} · 달성 ${(net / target * 100).toFixed(0)}%`);
  L.push(`🧾 주문 ${od}건 · 판매 ${Math.round(S_(led, 'qty'))}개`, `💳 객단가 ${od ? won_(net / od) : '–'} · 취소·반품 ${won_(S_(led, 'cancel') + S_(led, 'refund'))}`, '', '<b>채널별</b> (점유율 · 전월비)');
  CH_GROUPS.forEach(c => { const v = S_(led.filter(r => GROUP_OF[r.ch] === c), 'net'), p = g(prevYm, c); if (!v && !p) return; L.push(`${CH_ICON_[c]} ${c} <b>${won_(v)}</b> · ${net ? (v / net * 100).toFixed(0) : 0}%${arr_(v, p)}`); });
  try { const t = famTop_(ym + '-01', ym + '-31').slice(0, 5); if (t.length) { L.push('', '<b>🏆 월간 TOP 제품</b>'); t.forEach((x, i) => L.push(`${i + 1}. ${x.fam}\n    ${Math.round(x.units)}개 · 판매 ${won_(x.amt)}`)); } } catch (e) {}
  L.push('', `<a href="${getSetting_('DASHBOARD_URL')}">📱 대시보드 열기</a>`);
  return L.join('\n');
}
function sendMonthly_() { return tg_(monthlyText_()); }
/** 월별 합계 표(한 번만 계산): { 'YYYY-MM': { 합계, 스마트스토어, ... } } */
let MONTH_MAP_ = null;
function monthMap_() {
  if (MONTH_MAP_) return MONTH_MAP_;
  const rows = mergedMonthly_(readLedger_().map(r => ({ date: r.date, ch: r.ch, net: nz_(r.net), orders: nz_(r.orders), qty: nz_(r.qty), visitors: nz_(r.visitors) })), sheetObjects_(getSS_().getSheetByName('월별실적_과거')));
  const m = {}; rows.forEach(r => { const k = `${r.y}-${pad_(r.m)}`; (m[k] = m[k] || {})[r.ch] = r.sales; });
  Object.values(m).forEach(o => { if (o['합계'] == null) o['합계'] = CH_GROUPS.reduce((a, c) => a + (o[c] || 0), 0) || null; });
  return MONTH_MAP_ = m;
}

/* ============ 5. 보조 ============ */
const KEY_EXPIRY_ = [['쿠팡 API 키', '2026-12-27'], ['11번가 API 키', '2027-04-28'], ['SSG 인증키', '2027-03-31'], ['롯데ON 인증키', '2027-09-27']];
function missingChannels_(dateStr) {
  const d = dateStr ? normDate_(dateStr) : ymd_(addDays_(new Date(), -1));
  const have = new Set(readLedger_().filter(r => r.date === d).map(r => r.ch));
  return CHANNELS.map(c => c[1]).filter(n => !have.has(n));
}
function monthTotal_(ym, group) { const o = monthMap_()[ym]; if (!o) return null; return o[group || '합계'] != null ? o[group || '합계'] : null; }
function targetFor_(ym) { const t = sheetObjects_(getSS_().getSheetByName('월목표')).find(x => x.연월 === ym); return t && num_(t.합계) ? num_(t.합계) : null; }
let LEDGER_CACHE_ = null;
function readLedger_() {
  if (LEDGER_CACHE_) return LEDGER_CACHE_;
  const sh = getSS_().getSheetByName('원장'); if (sh.getLastRow() < 2) return [];
  const keys = ['date', 'ch', 'pay', 'orders', 'qty', 'cancel', 'cancelCnt', 'refund', 'refundCnt', 'net', 'visitors', 'inq', 'unans', 'reviews', 'note', 'method', 'at'];
  return LEDGER_CACHE_ = sh.getRange(2, 1, sh.getLastRow() - 1, LEDGER_HEAD.length).getValues().filter(r => r[0] && r[1]).map(r => { const o = {}; keys.forEach((k, i) => o[k] = r[i]); o.date = normDate_(o.date); return o; });
}
function loadHistory_(ss) {
  const h = ensureSheet_(ss, '월별실적_과거', ['연', '월', '채널명', '매출', '주문건수', '판매개수', '방문자', '출처']);
  if (h.getLastRow() < 2 && HISTORY.monthly.length) h.getRange(2, 1, HISTORY.monthly.length, 8).setValues(HISTORY.monthly.map(r => [r.y, r.m, r.ch, r.sales, r.orders, r.qty, r.visitors, '기존 엑셀']));
  const mis = ensureSheet_(ss, '불일치기록', ['연', '월', '채널명', '월별집계(정본)', '데이터정리참고', '차이', '처리']);
  if (mis.getLastRow() < 2 && HISTORY.mismatch.length) mis.getRange(2, 1, HISTORY.mismatch.length, 7).setValues(HISTORY.mismatch);
  if (ss.getSheetByName('원장').getLastRow() < 2 && HISTORY.daily.length) upsertLedger_(HISTORY.daily.map(d => buildRow_({ date: d.date, ch: d.ch, pay: '', orders: d.orders, qty: d.qty, net: d.net, note: '과거이관(순액, 결제/취소 분리 불가)' }, '과거이관')));
}
function ensureSheet_(ss, name, head) {
  let sh = ss.getSheetByName(name); if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(head); sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#1F3A5F').setFontColor('#FFFFFF'); sh.setFrozenRows(1); }
  return sh;
}
function sheetObjects_(sh) { if (!sh || sh.getLastRow() < 2) return []; const v = sh.getDataRange().getValues(); const head = v[0]; return v.slice(1).map(r => { const o = {}; head.forEach((h, i) => o[h] = r[i]); return o; }); }
function getSetting_(k) { const r = sheetObjects_(getSS_().getSheetByName('설정')).find(x => x.키 === k); return r ? r.값 : null; }
function setSetting_(k, v, desc) { const sh = getSS_().getSheetByName('설정'); const vals = sh.getDataRange().getValues(); const i = vals.findIndex(r => r[0] === k); if (i > 0) sh.getRange(i + 1, 2).setValue(v); else sh.appendRow([k, v, desc || '']); }
function normDate_(v) { if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd'); const s = String(v || '').trim(); const m = s.match(/(\d{4})[.\-\/년 ]+(\d{1,2})[.\-\/월 ]+(\d{1,2})/); return m ? `${m[1]}-${pad_(m[2])}-${pad_(m[3])}` : ''; }
function ymd_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function addDays_(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function pad_(n) { return String(n).padStart(2, '0'); }
function nz_(v) { return (v === '' || v == null) ? null : Number(v); }
function num_(v) { return (v === '' || v == null) ? null : Number(v); }
function won_(n) { if (n == null || isNaN(n)) return '–'; if (!n) return '0원'; return Math.abs(n) >= 1e8 ? (n / 1e8).toFixed(2) + '억' : Math.abs(n) < 1e4 ? Math.round(n).toLocaleString() + '원' : Math.round(n / 1e4).toLocaleString() + '만'; }
function pct_(a, b) { if (!b) return '–'; const p = (a - b) / Math.abs(b) * 100; return (p > 0 ? '+' : '') + p.toFixed(1) + '%'; }
function sha256_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join(''); }

/* ============ 과거 데이터 (기존 엑셀에서 추출) ============ */
const HISTORY = {"monthly": [{"y": 2025, "m": 1, "ch": "자사몰", "sales": 595000, "orders": null, "qty": null, "visitors": 507}, {"y": 2025, "m": 1, "ch": "스마트스토어", "sales": 1386000, "orders": null, "qty": null, "visitors": 530}, {"y": 2025, "m": 1, "ch": "쿠팡", "sales": 396000, "orders": null, "qty": null, "visitors": 44}, {"y": 2025, "m": 1, "ch": "합계", "sales": 2975000, "orders": null, "qty": null, "visitors": 1081}, {"y": 2025, "m": 2, "ch": "자사몰", "sales": 792000, "orders": null, "qty": null, "visitors": 258}, {"y": 2025, "m": 2, "ch": "스마트스토어", "sales": 990000, "orders": null, "qty": null, "visitors": 231}, {"y": 2025, "m": 2, "ch": "쿠팡", "sales": 0, "orders": null, "qty": null, "visitors": 60}, {"y": 2025, "m": 2, "ch": "합계", "sales": 2081000, "orders": null, "qty": null, "visitors": 549}, {"y": 2025, "m": 3, "ch": "자사몰", "sales": 198000, "orders": null, "qty": null, "visitors": 177}, {"y": 2025, "m": 3, "ch": "스마트스토어", "sales": 1678000, "orders": null, "qty": null, "visitors": 276}, {"y": 2025, "m": 3, "ch": "쿠팡", "sales": 198000, "orders": null, "qty": null, "visitors": 67}, {"y": 2025, "m": 3, "ch": "합계", "sales": 2074000, "orders": null, "qty": null, "visitors": 520}, {"y": 2025, "m": 4, "ch": "자사몰", "sales": 396000, "orders": null, "qty": null, "visitors": 4515}, {"y": 2025, "m": 4, "ch": "스마트스토어", "sales": 4238000, "orders": null, "qty": null, "visitors": 1950}, {"y": 2025, "m": 4, "ch": "쿠팡", "sales": 7764000, "orders": null, "qty": null, "visitors": 418}, {"y": 2025, "m": 4, "ch": "합계", "sales": 12398000, "orders": null, "qty": null, "visitors": 6883}, {"y": 2025, "m": 5, "ch": "자사몰", "sales": 1579000, "orders": null, "qty": null, "visitors": 12942}, {"y": 2025, "m": 5, "ch": "스마트스토어", "sales": 8907600, "orders": null, "qty": null, "visitors": 4255}, {"y": 2025, "m": 5, "ch": "쿠팡", "sales": 2329000, "orders": null, "qty": null, "visitors": 631}, {"y": 2025, "m": 5, "ch": "합계", "sales": 12815600, "orders": null, "qty": null, "visitors": 17828}, {"y": 2025, "m": 6, "ch": "자사몰", "sales": 396000, "orders": null, "qty": null, "visitors": 1903}, {"y": 2025, "m": 6, "ch": "스마트스토어", "sales": 9677450, "orders": null, "qty": null, "visitors": 4705}, {"y": 2025, "m": 6, "ch": "쿠팡", "sales": 3377000, "orders": null, "qty": null, "visitors": 466}, {"y": 2025, "m": 6, "ch": "합계", "sales": 13450450, "orders": null, "qty": null, "visitors": 7074}, {"y": 2025, "m": 7, "ch": "자사몰", "sales": 1440250, "orders": null, "qty": null, "visitors": 1052}, {"y": 2025, "m": 7, "ch": "스마트스토어", "sales": 10184930, "orders": null, "qty": null, "visitors": 3326}, {"y": 2025, "m": 7, "ch": "쿠팡", "sales": 3693000, "orders": null, "qty": null, "visitors": 705}, {"y": 2025, "m": 7, "ch": "합계", "sales": 24678180, "orders": null, "qty": null, "visitors": 5083}, {"y": 2025, "m": 8, "ch": "자사몰", "sales": 1046000, "orders": null, "qty": null, "visitors": 1468}, {"y": 2025, "m": 8, "ch": "스마트스토어", "sales": 14116000, "orders": null, "qty": null, "visitors": 3012}, {"y": 2025, "m": 8, "ch": "쿠팡", "sales": 5047000, "orders": null, "qty": null, "visitors": 687}, {"y": 2025, "m": 8, "ch": "합계", "sales": 34947000, "orders": null, "qty": null, "visitors": 5167}, {"y": 2025, "m": 9, "ch": "자사몰", "sales": 6853000, "orders": null, "qty": null, "visitors": 1774}, {"y": 2025, "m": 9, "ch": "스마트스토어", "sales": 42494890, "orders": null, "qty": null, "visitors": 32301}, {"y": 2025, "m": 9, "ch": "쿠팡", "sales": 8059000, "orders": null, "qty": null, "visitors": 1180}, {"y": 2025, "m": 9, "ch": "합계", "sales": 57406890, "orders": null, "qty": null, "visitors": 35255}, {"y": 2025, "m": 10, "ch": "자사몰", "sales": 664000, "orders": null, "qty": null, "visitors": 991}, {"y": 2025, "m": 10, "ch": "스마트스토어", "sales": 16052200, "orders": null, "qty": null, "visitors": 8695}, {"y": 2025, "m": 10, "ch": "쿠팡", "sales": 2220000, "orders": null, "qty": null, "visitors": 607}, {"y": 2025, "m": 10, "ch": "합계", "sales": 20509200, "orders": null, "qty": null, "visitors": 10293}, {"y": 2025, "m": 11, "ch": "자사몰", "sales": 5508000, "orders": null, "qty": null, "visitors": 1266}, {"y": 2025, "m": 11, "ch": "스마트스토어", "sales": 35161700, "orders": null, "qty": null, "visitors": 13260}, {"y": 2025, "m": 11, "ch": "쿠팡", "sales": 9928540, "orders": null, "qty": null, "visitors": 1212}, {"y": 2025, "m": 11, "ch": "합계", "sales": 50598240, "orders": null, "qty": null, "visitors": 15738}, {"y": 2025, "m": 12, "ch": "자사몰", "sales": 9440000, "orders": null, "qty": null, "visitors": 21750}, {"y": 2025, "m": 12, "ch": "스마트스토어", "sales": 14714000, "orders": null, "qty": null, "visitors": 5436}, {"y": 2025, "m": 12, "ch": "쿠팡", "sales": 22085320, "orders": null, "qty": null, "visitors": 2240}, {"y": 2025, "m": 12, "ch": "합계", "sales": 46239320, "orders": null, "qty": null, "visitors": 29426}, {"y": 2026, "m": 1, "ch": "자사몰", "sales": 19385000, "orders": 27, "qty": 108, "visitors": 6904}, {"y": 2026, "m": 1, "ch": "스마트스토어", "sales": 15292000, "orders": 47, "qty": 95, "visitors": 12117}, {"y": 2026, "m": 1, "ch": "쿠팡", "sales": 8536640, "orders": 22, "qty": 41, "visitors": 1902}, {"y": 2026, "m": 1, "ch": "외부몰", "sales": 151218, "orders": 1, "qty": 1, "visitors": null}, {"y": 2026, "m": 2, "ch": "자사몰", "sales": 8628000, "orders": 14, "qty": 24, "visitors": 7790}, {"y": 2026, "m": 2, "ch": "스마트스토어", "sales": 18047000, "orders": 52, "qty": 99, "visitors": 8263}, {"y": 2026, "m": 2, "ch": "쿠팡", "sales": 11975320, "orders": 29, "qty": 60, "visitors": 1606}, {"y": 2026, "m": 2, "ch": "외부몰", "sales": 1083810, "orders": 7, "qty": 7, "visitors": null}, {"y": 2026, "m": 3, "ch": "자사몰", "sales": 3432000, "orders": 13, "qty": 18, "visitors": 15301}, {"y": 2026, "m": 3, "ch": "스마트스토어", "sales": 10459000, "orders": 29, "qty": 52, "visitors": 5582}, {"y": 2026, "m": 3, "ch": "쿠팡", "sales": 17220430, "orders": 52, "qty": 93, "visitors": 2383}, {"y": 2026, "m": 3, "ch": "외부몰", "sales": 1258664, "orders": 3, "qty": 7, "visitors": null}, {"y": 2026, "m": 4, "ch": "자사몰", "sales": 1706291, "orders": 7, "qty": 7, "visitors": 3775}, {"y": 2026, "m": 4, "ch": "스마트스토어", "sales": 21523000, "orders": 56, "qty": 75, "visitors": 16588}, {"y": 2026, "m": 4, "ch": "쿠팡", "sales": 16333760, "orders": 56, "qty": 69, "visitors": 2921}, {"y": 2026, "m": 4, "ch": "외부몰", "sales": 1649150, "orders": 7, "qty": 9, "visitors": null}, {"y": 2026, "m": 5, "ch": "자사몰", "sales": 2403479, "orders": 4, "qty": 8, "visitors": 2721}, {"y": 2026, "m": 5, "ch": "스마트스토어", "sales": 25176400, "orders": 82, "qty": 92, "visitors": 19493}, {"y": 2026, "m": 5, "ch": "쿠팡", "sales": 9698140, "orders": 23, "qty": 41, "visitors": 1523}, {"y": 2026, "m": 5, "ch": "외부몰", "sales": 1092608, "orders": 7, "qty": 8, "visitors": null}, {"y": 2026, "m": 6, "ch": "자사몰", "sales": 3651300, "orders": 13, "qty": 12.9, "visitors": 5795}, {"y": 2026, "m": 6, "ch": "스마트스토어", "sales": 28647740, "orders": 96, "qty": 122.6, "visitors": 18046}, {"y": 2026, "m": 6, "ch": "쿠팡", "sales": 15601410, "orders": 40, "qty": 73, "visitors": 2078}, {"y": 2026, "m": 6, "ch": "외부몰", "sales": 1542364, "orders": 6, "qty": 10, "visitors": null}, {"y": 2026, "m": 7, "ch": "자사몰", "sales": 25095480, "orders": 123, "qty": 127, "visitors": 68277}, {"y": 2026, "m": 7, "ch": "스마트스토어", "sales": 41758060, "orders": 141, "qty": 172.2, "visitors": 14917}, {"y": 2026, "m": 7, "ch": "쿠팡", "sales": 16530350, "orders": 49, "qty": 75, "visitors": 3411}, {"y": 2026, "m": 7, "ch": "외부몰", "sales": 11358042, "orders": 69, "qty": 97, "visitors": null}, {"y": 2026, "m": 8, "ch": "자사몰", "sales": 38589060, "orders": 139, "qty": 208.4, "visitors": 56441}, {"y": 2026, "m": 8, "ch": "스마트스토어", "sales": 34435980, "orders": 117, "qty": 148.3, "visitors": 13743}, {"y": 2026, "m": 8, "ch": "쿠팡", "sales": 16200750, "orders": 51, "qty": 71, "visitors": 5009}, {"y": 2026, "m": 8, "ch": "외부몰", "sales": 5148730, "orders": 22, "qty": 32.6, "visitors": null}, {"y": 2026, "m": 9, "ch": "자사몰", "sales": 25777940, "orders": 93, "qty": 163, "visitors": 260213}, {"y": 2026, "m": 9, "ch": "스마트스토어", "sales": 76951870, "orders": 255, "qty": 413.1, "visitors": 20485}, {"y": 2026, "m": 9, "ch": "쿠팡", "sales": 32385040, "orders": 111, "qty": 141, "visitors": 5075}, {"y": 2026, "m": 9, "ch": "외부몰", "sales": 22642720, "orders": 62, "qty": 147, "visitors": null}, {"y": 2026, "m": 10, "ch": "자사몰", "sales": 5144780, "orders": 16, "qty": 26, "visitors": null}, {"y": 2026, "m": 10, "ch": "스마트스토어", "sales": 13107270, "orders": 46, "qty": 58.9, "visitors": null}, {"y": 2026, "m": 10, "ch": "쿠팡", "sales": 12806880, "orders": 39, "qty": 60, "visitors": null}, {"y": 2026, "m": 10, "ch": "외부몰", "sales": 9237800, "orders": 13, "qty": 102, "visitors": null}, {"y": 2026, "m": 11, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 11, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 11, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 11, "ch": "외부몰", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 12, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 12, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 12, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 12, "ch": "외부몰", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2024, "m": 1, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 356}, {"y": 2024, "m": 1, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 222}, {"y": 2024, "m": 1, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 88}, {"y": 2024, "m": 2, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 353}, {"y": 2024, "m": 2, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 202}, {"y": 2024, "m": 2, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 115}, {"y": 2024, "m": 3, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 311}, {"y": 2024, "m": 3, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 112}, {"y": 2024, "m": 3, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 121}, {"y": 2024, "m": 4, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 253}, {"y": 2024, "m": 4, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 313}, {"y": 2024, "m": 4, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 136}, {"y": 2024, "m": 5, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 212}, {"y": 2024, "m": 5, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 463}, {"y": 2024, "m": 5, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 148}, {"y": 2024, "m": 6, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 244}, {"y": 2024, "m": 6, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 245}, {"y": 2024, "m": 6, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 137}, {"y": 2024, "m": 7, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 414}, {"y": 2024, "m": 7, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 443}, {"y": 2024, "m": 7, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 112}, {"y": 2024, "m": 8, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 511}, {"y": 2024, "m": 8, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 1250}, {"y": 2024, "m": 8, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 124}, {"y": 2024, "m": 9, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 513}, {"y": 2024, "m": 9, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 1300}, {"y": 2024, "m": 9, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 130}, {"y": 2024, "m": 10, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 307}, {"y": 2024, "m": 10, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 449}, {"y": 2024, "m": 10, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 55}, {"y": 2024, "m": 11, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 333}, {"y": 2024, "m": 11, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 401}, {"y": 2024, "m": 11, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 67}, {"y": 2024, "m": 12, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 309}, {"y": 2024, "m": 12, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 425}, {"y": 2024, "m": 12, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 52}], "daily": [{"date": "2026-10-01", "ch": "자사몰", "net": 2155480, "orders": 4, "qty": 9}, {"date": "2026-10-01", "ch": "스마트스토어", "net": 394600, "orders": 2, "qty": 2}, {"date": "2026-10-01", "ch": "쿠팡", "net": 1248000, "orders": 6, "qty": 6}, {"date": "2026-10-02", "ch": "자사몰", "net": 538000, "orders": 1, "qty": 2}, {"date": "2026-10-02", "ch": "스마트스토어", "net": 884000, "orders": 1, "qty": 3}, {"date": "2026-10-02", "ch": "쿠팡", "net": -786400, "orders": 0, "qty": -4}, {"date": "2026-10-03", "ch": "자사몰", "net": 168000, "orders": 1, "qty": 1}, {"date": "2026-10-03", "ch": "스마트스토어", "net": 536000, "orders": 2, "qty": 2}, {"date": "2026-10-03", "ch": "쿠팡", "net": 2711410, "orders": 8, "qty": 13}, {"date": "2026-10-04", "ch": "자사몰", "net": 325000, "orders": 1, "qty": 2}, {"date": "2026-10-04", "ch": "쿠팡", "net": 222430, "orders": 0, "qty": 1}, {"date": "2026-10-05", "ch": "자사몰", "net": 788000, "orders": 3, "qty": 5}, {"date": "2026-10-05", "ch": "스마트스토어", "net": 307000, "orders": 2, "qty": 1.3}, {"date": "2026-10-05", "ch": "쿠팡", "net": 416000, "orders": 2, "qty": 2}, {"date": "2026-10-06", "ch": "자사몰", "net": -214000, "orders": 0, "qty": -1}, {"date": "2026-10-06", "ch": "스마트스토어", "net": 616000, "orders": 2, "qty": 2}, {"date": "2026-10-06", "ch": "쿠팡", "net": 762000, "orders": 3, "qty": 4}, {"date": "2026-10-06", "ch": "오프라인", "net": 878800, "orders": 1, "qty": 10}, {"date": "2026-10-07", "ch": "스마트스토어", "net": 1306000, "orders": 8, "qty": 8}, {"date": "2026-10-07", "ch": "쿠팡", "net": 1603490, "orders": 5, "qty": 7}, {"date": "2026-10-07", "ch": "G마켓/옥션", "net": 690000, "orders": 1, "qty": 3}, {"date": "2026-10-07", "ch": "오프라인", "net": 948000, "orders": 1, "qty": 8}, {"date": "2026-10-08", "ch": "자사몰", "net": 258000, "orders": 1, "qty": 1}, {"date": "2026-10-08", "ch": "스마트스토어", "net": 465000, "orders": 5, "qty": 4.3}, {"date": "2026-10-09", "ch": "스마트스토어", "net": 964070, "orders": 2, "qty": 4}, {"date": "2026-10-09", "ch": "쿠팡", "net": 752000, "orders": 1, "qty": 4}, {"date": "2026-10-09", "ch": "국군복지몰", "net": 296000, "orders": 1, "qty": 2}, {"date": "2026-10-10", "ch": "스마트스토어", "net": 289060, "orders": 1, "qty": 1}, {"date": "2026-10-10", "ch": "쿠팡", "net": 624000, "orders": 3, "qty": 3}, {"date": "2026-10-10", "ch": "국군복지몰", "net": 392000, "orders": 1, "qty": 4}, {"date": "2026-10-11", "ch": "스마트스토어", "net": 2109670, "orders": 4, "qty": 9}, {"date": "2026-10-11", "ch": "쿠팡", "net": 604000, "orders": 2, "qty": 3}, {"date": "2026-10-11", "ch": "11번가", "net": 318000, "orders": 1, "qty": 1}, {"date": "2026-10-12", "ch": "자사몰", "net": 561000, "orders": 1, "qty": 3}, {"date": "2026-10-12", "ch": "스마트스토어", "net": 1037300, "orders": 2, "qty": 4}, {"date": "2026-10-12", "ch": "쿠팡", "net": 208000, "orders": 1, "qty": 1}, {"date": "2026-10-12", "ch": "공구", "net": 148000, "orders": 1, "qty": 1}, {"date": "2026-10-13", "ch": "스마트스토어", "net": 964200, "orders": 3, "qty": 4}, {"date": "2026-10-13", "ch": "쿠팡", "net": 298000, "orders": 1, "qty": 1}, {"date": "2026-10-13", "ch": "G마켓/옥션", "net": 230000, "orders": 1, "qty": 1}, {"date": "2026-10-13", "ch": "오프라인", "net": 2500000, "orders": 1, "qty": 50}, {"date": "2026-10-14", "ch": "자사몰", "net": 565300, "orders": 4, "qty": 4}, {"date": "2026-10-14", "ch": "스마트스토어", "net": 1098260, "orders": 5, "qty": 4.3}, {"date": "2026-10-14", "ch": "쿠팡", "net": 3193950, "orders": 5, "qty": 13}, {"date": "2026-10-14", "ch": "G마켓/옥션", "net": 230000, "orders": 1, "qty": 1}, {"date": "2026-10-14", "ch": "롯데온", "net": 228000, "orders": 1, "qty": 1}, {"date": "2026-10-14", "ch": "오프라인", "net": 2200000, "orders": 1, "qty": 20}, {"date": "2026-10-15", "ch": "스마트스토어", "net": 2136110, "orders": 7, "qty": 10}, {"date": "2026-10-15", "ch": "쿠팡", "net": 950000, "orders": 2, "qty": 6}, {"date": "2026-10-15", "ch": "오프라인", "net": 179000, "orders": 1, "qty": 0}], "mismatch": [[2026, 4, "자사몰", 1706291, 1729820, -23529, "정본 채택, 담당자 확인 필요"], [2026, 4, "쿠팡", 16333760, 16370060, -36300, "정본 채택, 담당자 확인 필요"], [2026, 5, "스마트스토어", 25176400, 25176500, -100, "정본 채택, 담당자 확인 필요"], [2026, 5, "쿠팡", 9698140, 9680140, 18000, "정본 채택, 담당자 확인 필요"], [2026, 6, "스마트스토어", 28647740, 29691740, -1044000, "정본 채택, 담당자 확인 필요"], [2026, 7, "자사몰", 25095480, 25123300, -27820, "정본 채택, 담당자 확인 필요"], [2026, 7, "스마트스토어", 41758060, 41465060, 293000, "정본 채택, 담당자 확인 필요"], [2026, 9, "자사몰", 25777940, 23107940, 2670000, "정본 채택, 담당자 확인 필요"], [2026, 9, "스마트스토어", 76951870, 75388570, 1563300, "정본 채택, 담당자 확인 필요"]]};
