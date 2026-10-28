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

function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onFormSubmit_').forSpreadsheet(getSS_()).onFormSubmit().create();
  ScriptApp.newTrigger('armDailyPush_').timeBased().everyDays(1).atHour(6).create(); // 06~07시에 08:00 정시 트리거를 건다
}

/* ============ 2. 폼 응답 → 원장 ============ */
function onFormSubmit_(e) {
  const nv = e.namedValues || {};
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
function upsertLedger_(rows) {
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
      case 'alert': { return out({ ok: true, sent: tg_(String(p.text || '').slice(0, 3500)) });
      }
      case 'push': return out({ ok: true, sent: sendDaily_(p.date) });
      case 'weekly': return out({ ok: true, sent: sendWeekly_() });
      case 'monthly': return out({ ok: true, sent: sendMonthly_() });
      case 'preview': return out({ ok: true, text: dailyText_(p.date) });
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
      const a = agg[ym + '|' + h.채널명]; histKeys.add(ym + '|' + h.채널명);
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
    if (last > 1) sh.getRange(2, 1, last - 1, W).clearContent();
    if (all.length) sh.getRange(2, 1, all.length, W).setValues(all);
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
/** 대시보드용: 월별(전체 기간) + 일별(최근 120일), 표준제품명 기준. 배열로 압축 */
function buildProducts_(asof) {
  const ss = getSS_(); const sh = ss.getSheetByName('제품원장'); if (!sh || sh.getLastRow() < 2) return { cols: [], m: [], d: [] };
  const std = {}; sheetObjects_(ss.getSheetByName('제품마스터')).forEach(m => { std[m.채널 + '|' + m.상품코드] = String(m.표준제품명 || m['상품명(채널 원본)'] || m.상품코드).trim(); });
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues();
  const cut = asof ? ymd_(addDays_(new Date(asof + 'T12:00:00+09:00'), -119)) : '0000';
  const M = {}, Dd = {};
  const addTo = (map, k, head, r) => { const a = map[k] || (map[k] = head.concat([0, 0, 0, 0, 0, 0, 0])); for (let i = 0; i < 7; i++) a[head.length + i] += Number(r[4 + i]) || 0; };
  v.forEach(r => { if (!r[0]) return; const d = normDate_(r[0]); const ch = r[1]; const name = std[ch + '|' + r[2]] || normProd_(r[3]);
    addTo(M, d.slice(0, 7) + '|' + ch + '|' + name, [d.slice(0, 7), ch, name], r);
    if (d >= cut) addTo(Dd, d + '|' + ch + '|' + name, [d, ch, name], r); });
  const round = a => a.map((x, i) => i < 3 ? x : Math.round(x * 10) / 10);
  return { cols: ['기간', '채널', '제품', '판매수량', '판매금액', '취소수량', '취소금액', '반품수량', '반품금액', '교환수량'], m: Object.values(M).map(round), d: Object.values(Dd).map(round) };
}

/* ============ 4. 텔레그램 ============ */
function armDailyPush_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyPush_').forEach(t => ScriptApp.deleteTrigger(t));
  const h = Number(getSetting_('REPORT_HOUR') || 8);
  const at = new Date(); at.setHours(h, 0, 0, 0); if (at < new Date()) at.setDate(at.getDate() + 1);
  ScriptApp.newTrigger('dailyPush_').timeBased().at(at).create();
}
function dailyPush_() {
  const today = new Date();
  sendDaily_();
  if (today.getDay() === 1) sendWeekly_();
  if (today.getDate() === 1) sendMonthly_();
}
function tg_(text) {
  const p = PropertiesService.getScriptProperties(); const token = p.getProperty('TG_TOKEN'), chat = p.getProperty('TG_CHAT');
  if (!token || !chat) return 'telegram-not-configured';
  const res = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
  return res.getResponseCode();
}
function sendDaily_(date) { return tg_(dailyText_(date)); }

function dailyText_(dateStr) {
  const d = dateStr ? normDate_(dateStr) : ymd_(addDays_(new Date(), -1));
  const led = readLedger_();
  const day = x => led.filter(r => r.date === x);
  const sumBy = (rows, k) => rows.reduce((a, r) => a + (nz_(r[k]) || 0), 0);
  const tot = x => sumBy(day(x), 'net');
  const y = tot(d), pd = tot(ymd_(addDays_(new Date(d), -1)));
  const range = (from, to) => led.filter(r => r.date >= from && r.date <= to);
  const w = sumBy(range(ymd_(addDays_(new Date(d), -6)), d), 'net'), pw = sumBy(range(ymd_(addDays_(new Date(d), -13)), ymd_(addDays_(new Date(d), -7))), 'net');
  const ym = d.slice(0, 7), mtdRows = led.filter(r => r.date.slice(0, 7) === ym && r.date <= d), mtd = sumBy(mtdRows, 'net');
  const dim = new Date(+d.slice(0, 4), +d.slice(5, 7), 0).getDate(), dn = +d.slice(8), pace = mtd / dn * dim;
  const prevYm = ymd_(new Date(+d.slice(0, 4), +d.slice(5, 7) - 2, 1)).slice(0, 7);
  const prevM = monthTotal_(prevYm);
  const target = targetFor_(ym);
  const L = [];
  L.push(`📊 <b>보고바이오 데일리 현황</b> (${d})`, '');
  L.push(`• 순매출: <b>${won_(y)}</b> (전일 대비 ${pct_(y, pd)})`);
  L.push(`• 최근 7일: ${won_(w)} (직전 7일 대비 ${pct_(w, pw)})`);
  L.push(`• ${+d.slice(5, 7)}월 누적(${dn}일): ${won_(mtd)} · 월말 페이스 ${won_(pace)}${prevM ? ` (전월 대비 ${pct_(pace, prevM)})` : ''}`);
  L.push(target ? `• 목표 달성률: ${(mtd / target * 100).toFixed(1)}% (목표 ${won_(target)})` : '• 월 목표: 미설정 (월목표 시트)');
  L.push('', '<b>채널별</b>');
  CH_GROUPS.forEach(g => { const rs = day(d).filter(r => GROUP_OF[r.ch] === g); const prs = day(ymd_(addDays_(new Date(d), -1))).filter(r => GROUP_OF[r.ch] === g);
    const v = sumBy(rs, 'net'); L.push(`  ${g} ${won_(v)} (${pct_(v, sumBy(prs, 'net'))}) 주문 ${sumBy(rs, 'orders')}건`); });
  const flags = []; const dropPct = Number(getSetting_('ALERT_DROP_PCT') || -30);
  const miss = missingChannels_(d); if (miss.length) flags.push(`⚠️ 미입력 채널 ${miss.length}개: ${miss.join(', ')}`);
  const unans = sumBy(day(d), 'unans'); if (unans > 0) flags.push(`⚠️ 미답변 문의 ${unans}건`);
  const canc = sumBy(day(d), 'cancel') + sumBy(day(d), 'refund'); if (y > 0 && canc / (y + canc) > 0.15) flags.push(`⚠️ 취소·환불 비중 ${(canc / (y + canc) * 100).toFixed(0)}% (${won_(canc)})`);
  if (pd > 0 && (y - pd) / pd * 100 <= dropPct) flags.push(`⚠️ 전일 대비 ${pct_(y, pd)} 급감`);
  if (target && dn >= 7 && pace < target * 0.85) flags.push(`⚠️ 현재 페이스로는 목표 미달 예상 (${(pace / target * 100).toFixed(0)}%)`);
  CH_GROUPS.forEach(g => { const last3 = [0, 1, 2].map(i => sumBy(day(ymd_(addDays_(new Date(d), -i))).filter(r => GROUP_OF[r.ch] === g), 'net')); if (day(d).length && last3.every(v => v <= 0)) flags.push(`⚠️ ${g} 3일 연속 매출 0`); });
  L.push('', flags.length ? '<b>특이사항</b>\n' + flags.join('\n') : '특이사항 없음');
  L.push('', `🔗 대시보드: ${getSetting_('DASHBOARD_URL')}`);
  return L.join('\n');
}

function sendWeekly_() {
  const led = readLedger_(); const end = ymd_(addDays_(new Date(), -1)), start = ymd_(addDays_(new Date(), -7)), pStart = ymd_(addDays_(new Date(), -14)), pEnd = ymd_(addDays_(new Date(), -8));
  const rng = (a, b) => led.filter(r => r.date >= a && r.date <= b); const S = (rows, k) => rows.reduce((x, r) => x + (nz_(r[k]) || 0), 0);
  const cur = rng(start, end), prev = rng(pStart, pEnd);
  const L = [`📅 <b>주간 보고</b> (${start} ~ ${end})`, '', `• 순매출 <b>${won_(S(cur, 'net'))}</b> (전주 대비 ${pct_(S(cur, 'net'), S(prev, 'net'))})`, `• 주문 ${S(cur, 'orders')}건 · 객단가 ${won_(S(cur, 'net') / Math.max(1, S(cur, 'orders')))}`,
    `• 취소·환불 ${won_(S(cur, 'cancel') + S(cur, 'refund'))} · 신규문의 ${S(cur, 'inq')}건 · 신규리뷰 ${S(cur, 'reviews')}건`, '', '<b>채널별 (점유율 · 전주 대비)</b>'];
  const tot = S(cur, 'net');
  CH_GROUPS.forEach(g => { const c = S(cur.filter(r => GROUP_OF[r.ch] === g), 'net'), p = S(prev.filter(r => GROUP_OF[r.ch] === g), 'net'); L.push(`  ${g} ${won_(c)} (${tot ? (c / tot * 100).toFixed(0) : 0}% · ${pct_(c, p)})`); });
  const best = cur.reduce((m, r) => { const k = r.date; m[k] = (m[k] || 0) + (nz_(r.net) || 0); return m; }, {}); const top = Object.entries(best).sort((a, b) => b[1] - a[1])[0];
  if (top) L.push('', `최고 매출일: ${top[0]} ${won_(top[1])}`);
  L.push('', `🔗 ${getSetting_('DASHBOARD_URL')}`);
  return tg_(L.join('\n'));
}

function sendMonthly_() {
  const now = new Date(); const ym = ymd_(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7), prevYm = ymd_(new Date(now.getFullYear(), now.getMonth() - 2, 1)).slice(0, 7), lyYm = (+ym.slice(0, 4) - 1) + ym.slice(4);
  const led = readLedger_().filter(r => r.date.slice(0, 7) === ym); const S = (rows, k) => rows.reduce((x, r) => x + (nz_(r[k]) || 0), 0);
  const tot = S(led, 'net'), prev = monthTotal_(prevYm), ly = monthTotal_(lyYm), target = targetFor_(ym);
  const L = [`🗓 <b>월간 보고</b> (${ym})`, '', `• 순매출 <b>${won_(tot)}</b> · 전월 대비 ${pct_(tot, prev)} · 전년 동월 대비 ${pct_(tot, ly)}`, target ? `• 목표 ${won_(target)} → 달성률 ${(tot / target * 100).toFixed(1)}%` : '• 월 목표 미설정',
    `• 주문 ${S(led, 'orders')}건 · 객단가 ${won_(tot / Math.max(1, S(led, 'orders')))} · 취소·환불 ${won_(S(led, 'cancel') + S(led, 'refund'))}`, `• 신규문의 ${S(led, 'inq')}건 · 신규리뷰 ${S(led, 'reviews')}건`, '', '<b>채널별 (점유율 · 전월 대비)</b>'];
  CH_GROUPS.forEach(g => { const c = S(led.filter(r => GROUP_OF[r.ch] === g), 'net'), p = monthTotal_(prevYm, g); L.push(`  ${g} ${won_(c)} (${tot ? (c / tot * 100).toFixed(0) : 0}% · ${pct_(c, p)})`); });
  const days = new Set(led.map(r => r.date)).size, dim = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
  if (days < dim) L.push('', `⚠️ 입력된 날짜 ${days}/${dim}일 — 누락일 보완 필요`);
  L.push('', `🔗 ${getSetting_('DASHBOARD_URL')}`);
  return tg_(L.join('\n'));
}

/* ============ 5. 보조 ============ */
function missingChannels_(dateStr) {
  const d = dateStr ? normDate_(dateStr) : ymd_(addDays_(new Date(), -1));
  const have = new Set(readLedger_().filter(r => r.date === d).map(r => r.ch));
  return CHANNELS.map(c => c[1]).filter(n => !have.has(n));
}
function monthTotal_(ym, group) {
  const rows = mergedMonthly_(readLedger_().map(r => ({ date: r.date, ch: r.ch, net: nz_(r.net), orders: nz_(r.orders), qty: nz_(r.qty), visitors: nz_(r.visitors) })),
    sheetObjects_(getSS_().getSheetByName('월별실적_과거'))).filter(r => `${r.y}-${pad_(r.m)}` === ym);
  if (!rows.length) return null;
  if (group) { const r = rows.find(x => x.ch === group); return r ? r.sales : null; }
  const sum = rows.find(x => x.ch === '합계'); if (sum && sum.sales != null) return sum.sales;
  return rows.filter(x => CH_GROUPS.includes(x.ch)).reduce((a, x) => a + (x.sales || 0), 0) || null;
}
function targetFor_(ym) { const t = sheetObjects_(getSS_().getSheetByName('월목표')).find(x => x.연월 === ym); return t && num_(t.합계) ? num_(t.합계) : null; }
function readLedger_() {
  const sh = getSS_().getSheetByName('원장'); if (sh.getLastRow() < 2) return [];
  const keys = ['date', 'ch', 'pay', 'orders', 'qty', 'cancel', 'cancelCnt', 'refund', 'refundCnt', 'net', 'visitors', 'inq', 'unans', 'reviews', 'note', 'method', 'at'];
  return sh.getRange(2, 1, sh.getLastRow() - 1, LEDGER_HEAD.length).getValues().filter(r => r[0] && r[1]).map(r => { const o = {}; keys.forEach((k, i) => o[k] = r[i]); o.date = normDate_(o.date); return o; });
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
function won_(n) { if (n == null || isNaN(n)) return '–'; return Math.abs(n) >= 1e8 ? (n / 1e8).toFixed(2) + '억' : Math.round(n / 1e4).toLocaleString() + '만'; }
function pct_(a, b) { if (!b) return '–'; const p = (a - b) / Math.abs(b) * 100; return (p > 0 ? '+' : '') + p.toFixed(1) + '%'; }
function sha256_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join(''); }

/* ============ 과거 데이터 (기존 엑셀에서 추출) ============ */
const HISTORY = {"monthly": [{"y": 2025, "m": 1, "ch": "자사몰", "sales": 595000, "orders": null, "qty": null, "visitors": 507}, {"y": 2025, "m": 1, "ch": "스마트스토어", "sales": 1386000, "orders": null, "qty": null, "visitors": 530}, {"y": 2025, "m": 1, "ch": "쿠팡", "sales": 396000, "orders": null, "qty": null, "visitors": 44}, {"y": 2025, "m": 1, "ch": "합계", "sales": 2975000, "orders": null, "qty": null, "visitors": 1081}, {"y": 2025, "m": 2, "ch": "자사몰", "sales": 792000, "orders": null, "qty": null, "visitors": 258}, {"y": 2025, "m": 2, "ch": "스마트스토어", "sales": 990000, "orders": null, "qty": null, "visitors": 231}, {"y": 2025, "m": 2, "ch": "쿠팡", "sales": 0, "orders": null, "qty": null, "visitors": 60}, {"y": 2025, "m": 2, "ch": "합계", "sales": 2081000, "orders": null, "qty": null, "visitors": 549}, {"y": 2025, "m": 3, "ch": "자사몰", "sales": 198000, "orders": null, "qty": null, "visitors": 177}, {"y": 2025, "m": 3, "ch": "스마트스토어", "sales": 1678000, "orders": null, "qty": null, "visitors": 276}, {"y": 2025, "m": 3, "ch": "쿠팡", "sales": 198000, "orders": null, "qty": null, "visitors": 67}, {"y": 2025, "m": 3, "ch": "합계", "sales": 2074000, "orders": null, "qty": null, "visitors": 520}, {"y": 2025, "m": 4, "ch": "자사몰", "sales": 396000, "orders": null, "qty": null, "visitors": 4515}, {"y": 2025, "m": 4, "ch": "스마트스토어", "sales": 4238000, "orders": null, "qty": null, "visitors": 1950}, {"y": 2025, "m": 4, "ch": "쿠팡", "sales": 7764000, "orders": null, "qty": null, "visitors": 418}, {"y": 2025, "m": 4, "ch": "합계", "sales": 12398000, "orders": null, "qty": null, "visitors": 6883}, {"y": 2025, "m": 5, "ch": "자사몰", "sales": 1579000, "orders": null, "qty": null, "visitors": 12942}, {"y": 2025, "m": 5, "ch": "스마트스토어", "sales": 8907600, "orders": null, "qty": null, "visitors": 4255}, {"y": 2025, "m": 5, "ch": "쿠팡", "sales": 2329000, "orders": null, "qty": null, "visitors": 631}, {"y": 2025, "m": 5, "ch": "합계", "sales": 12815600, "orders": null, "qty": null, "visitors": 17828}, {"y": 2025, "m": 6, "ch": "자사몰", "sales": 396000, "orders": null, "qty": null, "visitors": 1903}, {"y": 2025, "m": 6, "ch": "스마트스토어", "sales": 9677450, "orders": null, "qty": null, "visitors": 4705}, {"y": 2025, "m": 6, "ch": "쿠팡", "sales": 3377000, "orders": null, "qty": null, "visitors": 466}, {"y": 2025, "m": 6, "ch": "합계", "sales": 13450450, "orders": null, "qty": null, "visitors": 7074}, {"y": 2025, "m": 7, "ch": "자사몰", "sales": 1440250, "orders": null, "qty": null, "visitors": 1052}, {"y": 2025, "m": 7, "ch": "스마트스토어", "sales": 10184930, "orders": null, "qty": null, "visitors": 3326}, {"y": 2025, "m": 7, "ch": "쿠팡", "sales": 3693000, "orders": null, "qty": null, "visitors": 705}, {"y": 2025, "m": 7, "ch": "합계", "sales": 24678180, "orders": null, "qty": null, "visitors": 5083}, {"y": 2025, "m": 8, "ch": "자사몰", "sales": 1046000, "orders": null, "qty": null, "visitors": 1468}, {"y": 2025, "m": 8, "ch": "스마트스토어", "sales": 14116000, "orders": null, "qty": null, "visitors": 3012}, {"y": 2025, "m": 8, "ch": "쿠팡", "sales": 5047000, "orders": null, "qty": null, "visitors": 687}, {"y": 2025, "m": 8, "ch": "합계", "sales": 34947000, "orders": null, "qty": null, "visitors": 5167}, {"y": 2025, "m": 9, "ch": "자사몰", "sales": 6853000, "orders": null, "qty": null, "visitors": 1774}, {"y": 2025, "m": 9, "ch": "스마트스토어", "sales": 42494890, "orders": null, "qty": null, "visitors": 32301}, {"y": 2025, "m": 9, "ch": "쿠팡", "sales": 8059000, "orders": null, "qty": null, "visitors": 1180}, {"y": 2025, "m": 9, "ch": "합계", "sales": 57406890, "orders": null, "qty": null, "visitors": 35255}, {"y": 2025, "m": 10, "ch": "자사몰", "sales": 664000, "orders": null, "qty": null, "visitors": 991}, {"y": 2025, "m": 10, "ch": "스마트스토어", "sales": 16052200, "orders": null, "qty": null, "visitors": 8695}, {"y": 2025, "m": 10, "ch": "쿠팡", "sales": 2220000, "orders": null, "qty": null, "visitors": 607}, {"y": 2025, "m": 10, "ch": "합계", "sales": 20509200, "orders": null, "qty": null, "visitors": 10293}, {"y": 2025, "m": 11, "ch": "자사몰", "sales": 5508000, "orders": null, "qty": null, "visitors": 1266}, {"y": 2025, "m": 11, "ch": "스마트스토어", "sales": 35161700, "orders": null, "qty": null, "visitors": 13260}, {"y": 2025, "m": 11, "ch": "쿠팡", "sales": 9928540, "orders": null, "qty": null, "visitors": 1212}, {"y": 2025, "m": 11, "ch": "합계", "sales": 50598240, "orders": null, "qty": null, "visitors": 15738}, {"y": 2025, "m": 12, "ch": "자사몰", "sales": 9440000, "orders": null, "qty": null, "visitors": 21750}, {"y": 2025, "m": 12, "ch": "스마트스토어", "sales": 14714000, "orders": null, "qty": null, "visitors": 5436}, {"y": 2025, "m": 12, "ch": "쿠팡", "sales": 22085320, "orders": null, "qty": null, "visitors": 2240}, {"y": 2025, "m": 12, "ch": "합계", "sales": 46239320, "orders": null, "qty": null, "visitors": 29426}, {"y": 2026, "m": 1, "ch": "자사몰", "sales": 19385000, "orders": 27, "qty": 108, "visitors": 6904}, {"y": 2026, "m": 1, "ch": "스마트스토어", "sales": 15292000, "orders": 47, "qty": 95, "visitors": 12117}, {"y": 2026, "m": 1, "ch": "쿠팡", "sales": 8536640, "orders": 22, "qty": 41, "visitors": 1902}, {"y": 2026, "m": 1, "ch": "외부몰", "sales": 151218, "orders": 1, "qty": 1, "visitors": null}, {"y": 2026, "m": 2, "ch": "자사몰", "sales": 8628000, "orders": 14, "qty": 24, "visitors": 7790}, {"y": 2026, "m": 2, "ch": "스마트스토어", "sales": 18047000, "orders": 52, "qty": 99, "visitors": 8263}, {"y": 2026, "m": 2, "ch": "쿠팡", "sales": 11975320, "orders": 29, "qty": 60, "visitors": 1606}, {"y": 2026, "m": 2, "ch": "외부몰", "sales": 1083810, "orders": 7, "qty": 7, "visitors": null}, {"y": 2026, "m": 3, "ch": "자사몰", "sales": 3432000, "orders": 13, "qty": 18, "visitors": 15301}, {"y": 2026, "m": 3, "ch": "스마트스토어", "sales": 10459000, "orders": 29, "qty": 52, "visitors": 5582}, {"y": 2026, "m": 3, "ch": "쿠팡", "sales": 17220430, "orders": 52, "qty": 93, "visitors": 2383}, {"y": 2026, "m": 3, "ch": "외부몰", "sales": 1258664, "orders": 3, "qty": 7, "visitors": null}, {"y": 2026, "m": 4, "ch": "자사몰", "sales": 1706291, "orders": 7, "qty": 7, "visitors": 3775}, {"y": 2026, "m": 4, "ch": "스마트스토어", "sales": 21523000, "orders": 56, "qty": 75, "visitors": 16588}, {"y": 2026, "m": 4, "ch": "쿠팡", "sales": 16333760, "orders": 56, "qty": 69, "visitors": 2921}, {"y": 2026, "m": 4, "ch": "외부몰", "sales": 1649150, "orders": 7, "qty": 9, "visitors": null}, {"y": 2026, "m": 5, "ch": "자사몰", "sales": 2403479, "orders": 4, "qty": 8, "visitors": 2721}, {"y": 2026, "m": 5, "ch": "스마트스토어", "sales": 25176400, "orders": 82, "qty": 92, "visitors": 19493}, {"y": 2026, "m": 5, "ch": "쿠팡", "sales": 9698140, "orders": 23, "qty": 41, "visitors": 1523}, {"y": 2026, "m": 5, "ch": "외부몰", "sales": 1092608, "orders": 7, "qty": 8, "visitors": null}, {"y": 2026, "m": 6, "ch": "자사몰", "sales": 3651300, "orders": 13, "qty": 12.9, "visitors": 5795}, {"y": 2026, "m": 6, "ch": "스마트스토어", "sales": 28647740, "orders": 96, "qty": 122.6, "visitors": 18046}, {"y": 2026, "m": 6, "ch": "쿠팡", "sales": 15601410, "orders": 40, "qty": 73, "visitors": 2078}, {"y": 2026, "m": 6, "ch": "외부몰", "sales": 1542364, "orders": 6, "qty": 10, "visitors": null}, {"y": 2026, "m": 7, "ch": "자사몰", "sales": 25095480, "orders": 123, "qty": 127, "visitors": 68277}, {"y": 2026, "m": 7, "ch": "스마트스토어", "sales": 41758060, "orders": 141, "qty": 172.2, "visitors": 14917}, {"y": 2026, "m": 7, "ch": "쿠팡", "sales": 16530350, "orders": 49, "qty": 75, "visitors": 3411}, {"y": 2026, "m": 7, "ch": "외부몰", "sales": 11358042, "orders": 69, "qty": 97, "visitors": null}, {"y": 2026, "m": 8, "ch": "자사몰", "sales": 38589060, "orders": 139, "qty": 208.4, "visitors": 56441}, {"y": 2026, "m": 8, "ch": "스마트스토어", "sales": 34435980, "orders": 117, "qty": 148.3, "visitors": 13743}, {"y": 2026, "m": 8, "ch": "쿠팡", "sales": 16200750, "orders": 51, "qty": 71, "visitors": 5009}, {"y": 2026, "m": 8, "ch": "외부몰", "sales": 5148730, "orders": 22, "qty": 32.6, "visitors": null}, {"y": 2026, "m": 9, "ch": "자사몰", "sales": 25777940, "orders": 93, "qty": 163, "visitors": 260213}, {"y": 2026, "m": 9, "ch": "스마트스토어", "sales": 76951870, "orders": 255, "qty": 413.1, "visitors": 20485}, {"y": 2026, "m": 9, "ch": "쿠팡", "sales": 32385040, "orders": 111, "qty": 141, "visitors": 5075}, {"y": 2026, "m": 9, "ch": "외부몰", "sales": 22642720, "orders": 62, "qty": 147, "visitors": null}, {"y": 2026, "m": 10, "ch": "자사몰", "sales": 5144780, "orders": 16, "qty": 26, "visitors": null}, {"y": 2026, "m": 10, "ch": "스마트스토어", "sales": 13107270, "orders": 46, "qty": 58.9, "visitors": null}, {"y": 2026, "m": 10, "ch": "쿠팡", "sales": 12806880, "orders": 39, "qty": 60, "visitors": null}, {"y": 2026, "m": 10, "ch": "외부몰", "sales": 9237800, "orders": 13, "qty": 102, "visitors": null}, {"y": 2026, "m": 11, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 11, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 11, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 11, "ch": "외부몰", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 12, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 12, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 12, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2026, "m": 12, "ch": "외부몰", "sales": null, "orders": null, "qty": null, "visitors": null}, {"y": 2024, "m": 1, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 356}, {"y": 2024, "m": 1, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 222}, {"y": 2024, "m": 1, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 88}, {"y": 2024, "m": 2, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 353}, {"y": 2024, "m": 2, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 202}, {"y": 2024, "m": 2, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 115}, {"y": 2024, "m": 3, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 311}, {"y": 2024, "m": 3, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 112}, {"y": 2024, "m": 3, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 121}, {"y": 2024, "m": 4, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 253}, {"y": 2024, "m": 4, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 313}, {"y": 2024, "m": 4, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 136}, {"y": 2024, "m": 5, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 212}, {"y": 2024, "m": 5, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 463}, {"y": 2024, "m": 5, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 148}, {"y": 2024, "m": 6, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 244}, {"y": 2024, "m": 6, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 245}, {"y": 2024, "m": 6, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 137}, {"y": 2024, "m": 7, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 414}, {"y": 2024, "m": 7, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 443}, {"y": 2024, "m": 7, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 112}, {"y": 2024, "m": 8, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 511}, {"y": 2024, "m": 8, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 1250}, {"y": 2024, "m": 8, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 124}, {"y": 2024, "m": 9, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 513}, {"y": 2024, "m": 9, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 1300}, {"y": 2024, "m": 9, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 130}, {"y": 2024, "m": 10, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 307}, {"y": 2024, "m": 10, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 449}, {"y": 2024, "m": 10, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 55}, {"y": 2024, "m": 11, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 333}, {"y": 2024, "m": 11, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 401}, {"y": 2024, "m": 11, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 67}, {"y": 2024, "m": 12, "ch": "자사몰", "sales": null, "orders": null, "qty": null, "visitors": 309}, {"y": 2024, "m": 12, "ch": "스마트스토어", "sales": null, "orders": null, "qty": null, "visitors": 425}, {"y": 2024, "m": 12, "ch": "쿠팡", "sales": null, "orders": null, "qty": null, "visitors": 52}], "daily": [{"date": "2026-10-01", "ch": "자사몰", "net": 2155480, "orders": 4, "qty": 9}, {"date": "2026-10-01", "ch": "스마트스토어", "net": 394600, "orders": 2, "qty": 2}, {"date": "2026-10-01", "ch": "쿠팡", "net": 1248000, "orders": 6, "qty": 6}, {"date": "2026-10-02", "ch": "자사몰", "net": 538000, "orders": 1, "qty": 2}, {"date": "2026-10-02", "ch": "스마트스토어", "net": 884000, "orders": 1, "qty": 3}, {"date": "2026-10-02", "ch": "쿠팡", "net": -786400, "orders": 0, "qty": -4}, {"date": "2026-10-03", "ch": "자사몰", "net": 168000, "orders": 1, "qty": 1}, {"date": "2026-10-03", "ch": "스마트스토어", "net": 536000, "orders": 2, "qty": 2}, {"date": "2026-10-03", "ch": "쿠팡", "net": 2711410, "orders": 8, "qty": 13}, {"date": "2026-10-04", "ch": "자사몰", "net": 325000, "orders": 1, "qty": 2}, {"date": "2026-10-04", "ch": "쿠팡", "net": 222430, "orders": 0, "qty": 1}, {"date": "2026-10-05", "ch": "자사몰", "net": 788000, "orders": 3, "qty": 5}, {"date": "2026-10-05", "ch": "스마트스토어", "net": 307000, "orders": 2, "qty": 1.3}, {"date": "2026-10-05", "ch": "쿠팡", "net": 416000, "orders": 2, "qty": 2}, {"date": "2026-10-06", "ch": "자사몰", "net": -214000, "orders": 0, "qty": -1}, {"date": "2026-10-06", "ch": "스마트스토어", "net": 616000, "orders": 2, "qty": 2}, {"date": "2026-10-06", "ch": "쿠팡", "net": 762000, "orders": 3, "qty": 4}, {"date": "2026-10-06", "ch": "오프라인", "net": 878800, "orders": 1, "qty": 10}, {"date": "2026-10-07", "ch": "스마트스토어", "net": 1306000, "orders": 8, "qty": 8}, {"date": "2026-10-07", "ch": "쿠팡", "net": 1603490, "orders": 5, "qty": 7}, {"date": "2026-10-07", "ch": "G마켓/옥션", "net": 690000, "orders": 1, "qty": 3}, {"date": "2026-10-07", "ch": "오프라인", "net": 948000, "orders": 1, "qty": 8}, {"date": "2026-10-08", "ch": "자사몰", "net": 258000, "orders": 1, "qty": 1}, {"date": "2026-10-08", "ch": "스마트스토어", "net": 465000, "orders": 5, "qty": 4.3}, {"date": "2026-10-09", "ch": "스마트스토어", "net": 964070, "orders": 2, "qty": 4}, {"date": "2026-10-09", "ch": "쿠팡", "net": 752000, "orders": 1, "qty": 4}, {"date": "2026-10-09", "ch": "국군복지몰", "net": 296000, "orders": 1, "qty": 2}, {"date": "2026-10-10", "ch": "스마트스토어", "net": 289060, "orders": 1, "qty": 1}, {"date": "2026-10-10", "ch": "쿠팡", "net": 624000, "orders": 3, "qty": 3}, {"date": "2026-10-10", "ch": "국군복지몰", "net": 392000, "orders": 1, "qty": 4}, {"date": "2026-10-11", "ch": "스마트스토어", "net": 2109670, "orders": 4, "qty": 9}, {"date": "2026-10-11", "ch": "쿠팡", "net": 604000, "orders": 2, "qty": 3}, {"date": "2026-10-11", "ch": "11번가", "net": 318000, "orders": 1, "qty": 1}, {"date": "2026-10-12", "ch": "자사몰", "net": 561000, "orders": 1, "qty": 3}, {"date": "2026-10-12", "ch": "스마트스토어", "net": 1037300, "orders": 2, "qty": 4}, {"date": "2026-10-12", "ch": "쿠팡", "net": 208000, "orders": 1, "qty": 1}, {"date": "2026-10-12", "ch": "공구", "net": 148000, "orders": 1, "qty": 1}, {"date": "2026-10-13", "ch": "스마트스토어", "net": 964200, "orders": 3, "qty": 4}, {"date": "2026-10-13", "ch": "쿠팡", "net": 298000, "orders": 1, "qty": 1}, {"date": "2026-10-13", "ch": "G마켓/옥션", "net": 230000, "orders": 1, "qty": 1}, {"date": "2026-10-13", "ch": "오프라인", "net": 2500000, "orders": 1, "qty": 50}, {"date": "2026-10-14", "ch": "자사몰", "net": 565300, "orders": 4, "qty": 4}, {"date": "2026-10-14", "ch": "스마트스토어", "net": 1098260, "orders": 5, "qty": 4.3}, {"date": "2026-10-14", "ch": "쿠팡", "net": 3193950, "orders": 5, "qty": 13}, {"date": "2026-10-14", "ch": "G마켓/옥션", "net": 230000, "orders": 1, "qty": 1}, {"date": "2026-10-14", "ch": "롯데온", "net": 228000, "orders": 1, "qty": 1}, {"date": "2026-10-14", "ch": "오프라인", "net": 2200000, "orders": 1, "qty": 20}, {"date": "2026-10-15", "ch": "스마트스토어", "net": 2136110, "orders": 7, "qty": 10}, {"date": "2026-10-15", "ch": "쿠팡", "net": 950000, "orders": 2, "qty": 6}, {"date": "2026-10-15", "ch": "오프라인", "net": 179000, "orders": 1, "qty": 0}], "mismatch": [[2026, 4, "자사몰", 1706291, 1729820, -23529, "정본 채택, 담당자 확인 필요"], [2026, 4, "쿠팡", 16333760, 16370060, -36300, "정본 채택, 담당자 확인 필요"], [2026, 5, "스마트스토어", 25176400, 25176500, -100, "정본 채택, 담당자 확인 필요"], [2026, 5, "쿠팡", 9698140, 9680140, 18000, "정본 채택, 담당자 확인 필요"], [2026, 6, "스마트스토어", 28647740, 29691740, -1044000, "정본 채택, 담당자 확인 필요"], [2026, 7, "자사몰", 25095480, 25123300, -27820, "정본 채택, 담당자 확인 필요"], [2026, 7, "스마트스토어", 41758060, 41465060, 293000, "정본 채택, 담당자 확인 필요"], [2026, 9, "자사몰", 25777940, 23107940, 2670000, "정본 채택, 담당자 확인 필요"], [2026, 9, "스마트스토어", 76951870, 75388570, 1563300, "정본 채택, 담당자 확인 필요"]]};
