/**
 * AUTUS Builder — 실공고 데이터 수집·정규화 (Discovery 파이프라인)
 * ------------------------------------------------------------------
 * 소스: 기업마당(bizinfo) OpenAPI — 무료 인증키 필요(BIZINFO_KEY)
 *   키 발급: https://www.bizinfo.go.kr  또는 data.go.kr "기업마당 지원사업정보"
 * 출력: opps.json  (앱이 같은 출처에서 로드 → CORS 없음)
 *
 * 사용:
 *   node fetch-opps.mjs            # 실데이터 (BIZINFO_KEY 환경변수 필요)
 *   node fetch-opps.mjs --mock     # 키 없이 파이프라인 검증용 샘플 생성
 *
 * 표준 스키마(글로벌 5단계 문서 §3)로 정규화:
 *   id·group·gtag·title·agency·category·elig{stage,age,hire}
 *   ·amount·deadline·docs[]·url·status·note·star
 */
import { writeFileSync } from 'node:fs';

const OUT = new URL('./opps.json', import.meta.url);
const KEY = process.env.BIZINFO_KEY || '';
const MOCK = process.argv.includes('--mock');
const API = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';

// ---------- 분류 휴리스틱 (대상/분야 텍스트 → 빌더 자격모델) ----------
function classify(text) {
  const t = (text || '');
  let group = 'C', gtag = '경영·운영';
  if (/창업|예비|도약|스타트업/.test(t))      { group = 'A'; gtag = '창업'; }
  else if (/고용|인력|일자리|채용|청년채용/.test(t)) { group = 'C'; gtag = '고용·인력'; }
  else if (/융자|정책자금|보증|자금|금융/.test(t))   { group = 'C'; gtag = '자금·융자'; }
  else if (/수출|글로벌|판로|해외|내수/.test(t))     { group = 'B'; gtag = '판로·수출'; }
  else if (/기술|R&D|연구|개발|디지털|AI|혁신/.test(t)) { group = 'D'; gtag = '기술·디지털'; }

  // 자격(보수적·permissive): 명확할 때만 좁힌다 → 실데이터를 과도 필터링하지 않음
  const stage = /예비창업|예비 창업/.test(t) ? ['예비']
    : /창업\s?[1-7]년|초기창업|도약/.test(t) ? ['예비', '3년내']
    : ['예비', '3년내', '운영중'];
  const age = /청년|만\s?39|39세|만 34/.test(t) ? 'young' : 'any';
  const hire = false; // 고용요건은 신뢰성 있게 추출 어려움 → 기본 미적용
  return { group, gtag, elig: { stage, age, hire } };
}

function toYmd(s) {
  const m = String(s || '').match(/(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
function parseDeadline(reqstBeginEndDe) {
  if (!reqstBeginEndDe) return '상시';
  if (/예산|소진|상시|마감시/.test(reqstBeginEndDe)) return '상시';
  const parts = String(reqstBeginEndDe).split('~');
  const end = toYmd(parts[parts.length - 1]);
  return end || '상시';
}
function abs(url) {
  if (!url) return 'https://www.bizinfo.go.kr';
  return /^https?:\/\//.test(url) ? url : 'https://www.bizinfo.go.kr' + url;
}
function clip(s, n) { s = String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }

// ---------- 정규화 ----------
function normalize(item, i) {
  const title = item.pblancNm || item.title || '';
  const category = item.pldirSportRealmLclasCodeNm || item.category || '기타';
  const agency = item.jrsdInsttNm || item.excInsttNm || '소관기관';
  const target = item.trgetNm || item.bsnsSumryCn || '';
  const c = classify(`${title} ${category} ${target}`);
  return {
    id: 'bz' + (item.pblancId || i),
    group: c.group, gtag: c.gtag,
    title, agency, category,
    elig: c.elig,
    amount: '공고 참조',
    deadline: parseDeadline(item.reqstBeginEndDe),
    docs: ['사업계획서', '사업자등록증(해당시)', '대표자 신분증'],
    url: abs(item.pblancUrl || item.rceptInstUrl),
    status: 'open',
    note: clip(item.bsnsSumryCn || target || title, 80),
    star: c.group === 'A' || c.group === 'D',
  };
}

// ---------- 실데이터 ----------
async function fetchLive() {
  const u = `${API}?crtfcKey=${encodeURIComponent(KEY)}&dataType=json&searchCnt=200`;
  const res = await fetch(u, { headers: { 'User-Agent': 'AUTUS-Builder/1.0' } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('JSON 파싱 실패: ' + text.slice(0, 120)); }
  const arr = json.jsonArray || json.items || json.list || [];
  if (!Array.isArray(arr) || !arr.length) throw new Error('빈 응답/인증 실패: ' + text.slice(0, 120));
  return arr.map(normalize).filter(o => o.title);
}

// ---------- 검증용 목데이터 ----------
function mock() {
  const raw = [
    { pblancId: 'M1', pblancNm: '예비창업패키지 일반분야', pldirSportRealmLclasCodeNm: '창업', jrsdInsttNm: '중소벤처기업부', reqstBeginEndDe: '20260701 ~ 20260820', bsnsSumryCn: '예비창업자 사업화 자금 및 멘토링 지원', pblancUrl: '/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=M1' },
    { pblancId: 'M2', pblancNm: '청년창업 사관학교 입교생 모집', pldirSportRealmLclasCodeNm: '창업', jrsdInsttNm: '중소벤처기업진흥공단', reqstBeginEndDe: '20260705 ~ 20260731', bsnsSumryCn: '만 39세 이하 청년 창업자 사업화 공간·교육·자금', pblancUrl: '/web/lay1/bbs/view.do?pblancId=M2' },
    { pblancId: 'M3', pblancNm: '소상공인 디지털전환 지원사업', pldirSportRealmLclasCodeNm: '디지털', jrsdInsttNm: '소상공인시장진흥공단', reqstBeginEndDe: '20260710 ~ 20260930', bsnsSumryCn: 'AI·키오스크 등 소상공인 디지털 솔루션 도입 지원', pblancUrl: '/web/lay1/bbs/view.do?pblancId=M3' },
    { pblancId: 'M4', pblancNm: '청년 일자리 도약장려금', pldirSportRealmLclasCodeNm: '고용', jrsdInsttNm: '고용노동부', reqstBeginEndDe: '20260601 ~ 20261231', bsnsSumryCn: '청년 정규직 채용 기업 인건비 지원', pblancUrl: '/web/lay1/bbs/view.do?pblancId=M4' },
    { pblancId: 'M5', pblancNm: '소상공인 정책자금(일반경영안정)', pldirSportRealmLclasCodeNm: '금융', jrsdInsttNm: '소상공인시장진흥공단', reqstBeginEndDe: '예산 소진시까지', bsnsSumryCn: '운영비·임대료 저리 융자', pblancUrl: '/web/lay1/bbs/view.do?pblancId=M5' },
    { pblancId: 'M6', pblancNm: '수출바우처 참여기업 모집', pldirSportRealmLclasCodeNm: '수출', jrsdInsttNm: 'KOTRA', reqstBeginEndDe: '20260715 ~ 20260815', bsnsSumryCn: '내수기업 수출기업화 마케팅 바우처', pblancUrl: '/web/lay1/bbs/view.do?pblancId=M6' },
  ];
  return raw.map(normalize);
}

// ---------- 실행 ----------
async function main() {
  let opps, source;
  if (MOCK) {
    opps = mock(); source = '기업마당(샘플)';
    console.log(`[mock] ${opps.length}건 생성`);
  } else if (!KEY) {
    console.error('BIZINFO_KEY 없음 → opps.json 갱신 건너뜀(앱은 내장 샘플 사용). 검증은 --mock 사용.');
    process.exit(0);
  } else {
    opps = await fetchLive(); source = '기업마당';
    console.log(`[live] ${opps.length}건 수집`);
  }
  const payload = { source, updated: new Date().toISOString(), count: opps.length, opps };
  writeFileSync(OUT, JSON.stringify(payload, null, 1));
  console.log('opps.json 작성 완료:', OUT.pathname);
}
main().catch(e => { console.error('실패:', e.message); process.exit(1); });
