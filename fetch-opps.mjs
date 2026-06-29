/**
 * AUTUS Builder — 실공고 데이터 수집·정규화 (Discovery 파이프라인)
 * ------------------------------------------------------------------
 * 소스: data.go.kr "창업진흥원_K-Startup 조회서비스" (data 15125364)
 *   Base : https://apis.data.go.kr/B552735/kisedKstartupService01
 *   공고 : GET /getAnnouncementInformation01  (지원사업 공고 정보)
 *   응답 : { currentCount, matchCount, page, perPage, totalCount, data:[ {...} ] }
 *   심의 : 개발/운영 자동승인(즉시) · 개발계정 10,000건/일
 *   키   : data.go.kr 마이페이지 > 인증키 발급현황 의 "일반 인증키(Decoding)"
 *          → 환경변수 DATA_GO_KR_KEY
 * 출력: opps.json  (앱이 같은 출처에서 로드 → CORS 없음)
 *
 * 사용:
 *   DATA_GO_KR_KEY=xxxx node fetch-opps.mjs   # 실데이터
 *   node fetch-opps.mjs --mock                # 키 없이 파이프라인 검증
 *   DATA_GO_KR_KEY=xxxx node fetch-opps.mjs --probe   # 응답 1건 원본 필드 확인용
 */
import { writeFileSync } from 'node:fs';

const OUT = new URL('./opps.json', import.meta.url);
const KEY = process.env.DATA_GO_KR_KEY || '';
const MOCK = process.argv.includes('--mock');
const PROBE = process.argv.includes('--probe');
const BASE = 'https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01';

// ---------- 분류 휴리스틱 (공고명/분야/대상 → 빌더 자격모델) ----------
function classify(text) {
  const t = text || '';
  let group = 'A', gtag = '창업';
  if (/재도전|재창업|폐업/.test(t))                 { group = 'A'; gtag = '재창업'; }
  else if (/예비/.test(t))                          { group = 'A'; gtag = '예비창업'; }
  else if (/도약|초기|성장|스케일업/.test(t))         { group = 'B'; gtag = '창업도약'; }
  else if (/글로벌|수출|해외|판로/.test(t))           { group = 'B'; gtag = '글로벌·판로'; }
  else if (/기술|R&D|연구|AI|디지털|딥테크|혁신/.test(t)) { group = 'D'; gtag = '기술·디지털'; }
  else if (/고용|인력|일자리|채용/.test(t))           { group = 'C'; gtag = '고용·인력'; }

  const stage = /예비창업|예비 창업/.test(t) ? ['예비']
    : /재도전|재창업/.test(t) ? ['예비', '3년내']
    : /도약|초기창업|[1-7]년/.test(t) ? ['예비', '3년내']
    : ['예비', '3년내', '운영중'];
  const age = /청년|만\s?39|39세|만\s?34|34세/.test(t) ? 'young' : 'any';
  return { group, gtag, elig: { stage, age, hire: false } };
}

function toYmd(s) {
  const m = String(s || '').match(/(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
function decodeEnt(s) {
  return String(s == null ? '' : s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');
}
function clip(s, n) {
  s = decodeEnt(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function pick(o, keys) { for (const k of keys) if (o[k] != null && String(o[k]).trim() !== '') return o[k]; return ''; }

// ---------- 정규화 (K-Startup 공고 → 표준 스키마) ----------
// 표준 매핑(schema.org/MonetaryGrant): title→name, agency→funder, amount→amount,
//   deadline→applicationDeadline, url→url, note→description, elig→eligibility.
// 필드명은 알려진 K-Startup 표준 + 방어적 폴백. 첫 실호출 로그로 검증/보정.
function normalize(it, i, src) {
  const title   = decodeEnt(pick(it, ['intg_pbanc_biz_nm', 'biz_pbanc_nm', 'pbanc_nm', 'title'])).replace(/\s+/g, ' ').trim();
  const agency  = pick(it, ['pbanc_ntrp_nm', 'excutInsttNm', 'spnsr_organ_nm']) || '창업진흥원';
  const category= pick(it, ['supt_biz_clsfc', 'biz_clsfc', 'pld_clsfc']) || '창업지원';
  const target  = pick(it, ['aply_trgt_ctnt', 'aply_trgt', 'supt_trgt']);
  const age     = pick(it, ['biz_trgt_age', 'aply_trgt_age']);
  const region  = pick(it, ['supt_regin', 'biz_aply_regin']);
  const begin   = pick(it, ['pbanc_rcpt_bgng_dt', 'rcrt_pbanc_bgng_de']);
  const end     = pick(it, ['pbanc_rcpt_end_dt', 'rcrt_pbanc_end_de']);
  const url     = pick(it, ['detl_pg_url', 'biz_gdnc_url', 'pbanc_url']) || 'https://www.k-startup.go.kr';
  const sn      = pick(it, ['pbanc_sn', 'id']) || i;
  const c = classify(`${title} ${category} ${target} ${age} ${region}`);
  return {
    id: 'ks' + sn,
    group: c.group, gtag: c.gtag,
    title, agency, category,
    elig: c.elig,
    amount: '공고 참조',
    deadline: toYmd(end) || '상시',
    docs: ['사업계획서(PSST)', '사업자등록증(해당시)', '대표자 신분증'],
    url, status: 'open',
    note: clip(target || title, 80),
    star: c.group === 'A' || c.group === 'D',
    source: src || '공고',
  };
}

function isOpen(o) {
  if (o.deadline === '상시') return true;
  const today = new Date().toISOString().slice(0, 10);
  return o.deadline >= today;
}

// ---------- 실데이터 (다중소스: 같은 키로 공고 + 통합공고) ----------
const GW = 'https://apis.data.go.kr/B552735/kisedKstartupService01';
async function fetchOp(op, perPage = 200) {
  const url = `${GW}/${op}?serviceKey=${encodeURIComponent(KEY)}&page=1&perPage=${perPage}&returnType=json`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(op + ' JSON 파싱 실패: ' + text.slice(0, 140)); }
  return json.data || json.items || [];
}
async function fetchLive() {
  // 1차 소스 — 개별 지원사업 공고 (필수)
  const ann = await fetchOp('getAnnouncementInformation01');
  if (!Array.isArray(ann) || !ann.length) throw new Error('공고 빈 응답/인증 실패');
  console.log('공고 필드:', Object.keys(ann[0]).join(', '));
  if (PROBE) { console.log(JSON.stringify(ann[0], null, 1)); process.exit(0); }
  // 2차 소스 — 통합공고(연간 지원사업 카탈로그). best-effort: 실패해도 공고는 유지
  let biz = [];
  try {
    biz = await fetchOp('getBusinessInformation01');
    if (biz.length) console.log('통합공고 필드:', Object.keys(biz[0]).join(', '));
  } catch (e) { console.log('통합공고 스킵:', e.message); }

  const merged = ann.map((x, i) => normalize(x, i, '공고'))
    .concat(biz.map((x, i) => normalize(x, 'b' + i, '통합공고')));
  // id 중복 제거 + 제목 있는 것만
  const seen = new Set(), uniq = [];
  for (const o of merged) { if (o.title && !seen.has(o.id)) { seen.add(o.id); uniq.push(o); } }
  return uniq.filter(isOpen);
}

// ---------- 검증용 목데이터 (키 없이 파이프라인 점검) ----------
function mock() {
  const raw = [
    { pbanc_sn: 'M1', intg_pbanc_biz_nm: '예비창업패키지 일반분야 예비창업자 모집', supt_biz_clsfc: '창업사업화', pbanc_ntrp_nm: '창업진흥원', pbanc_rcpt_end_dt: '20260820', aply_trgt_ctnt: '사업자등록 전 예비창업자', detl_pg_url: 'https://www.k-startup.go.kr' },
    { pbanc_sn: 'M2', intg_pbanc_biz_nm: '청년창업사관학교 입교생 모집', supt_biz_clsfc: '창업사업화', pbanc_ntrp_nm: '중소벤처기업진흥공단', pbanc_rcpt_end_dt: '20260731', aply_trgt_ctnt: '만 39세 이하 청년 창업자', detl_pg_url: 'https://www.k-startup.go.kr' },
    { pbanc_sn: 'M3', intg_pbanc_biz_nm: '창업도약패키지 성장지원', supt_biz_clsfc: '창업사업화', pbanc_ntrp_nm: '창업진흥원', pbanc_rcpt_end_dt: '20260910', aply_trgt_ctnt: '창업 3~7년 도약기 기업', detl_pg_url: 'https://www.k-startup.go.kr' },
    { pbanc_sn: 'M4', intg_pbanc_biz_nm: '재도전 성공패키지 재창업자 모집', supt_biz_clsfc: '재창업', pbanc_ntrp_nm: '창업진흥원', pbanc_rcpt_end_dt: '20260930', aply_trgt_ctnt: '폐업 후 재창업 예정자', detl_pg_url: 'https://www.k-startup.go.kr' },
    { pbanc_sn: 'M5', intg_pbanc_biz_nm: '글로벌 창업사관학교(딥테크)', supt_biz_clsfc: '글로벌', pbanc_ntrp_nm: '창업진흥원', pbanc_rcpt_end_dt: '20260815', aply_trgt_ctnt: 'AI·딥테크 분야 창업기업', detl_pg_url: 'https://www.k-startup.go.kr' },
  ];
  return raw.map((x, i) => normalize(x, i, '공고'));
}

// ---------- 실행 ----------
async function main() {
  let opps, source;
  if (MOCK) {
    opps = mock(); source = 'K-Startup(샘플)';
    console.log(`[mock] ${opps.length}건`);
  } else if (!KEY) {
    console.error('DATA_GO_KR_KEY 없음 → opps.json 갱신 건너뜀(앱은 내장 샘플 사용). 검증은 --mock.');
    process.exit(0);
  } else {
    opps = await fetchLive(); source = 'K-Startup';
    console.log(`[live] ${opps.length}건 (마감 안 지난 공고만)`);
  }
  // 표준 정렬: schema.org/MonetaryGrant (name·funder·amount·applicationDeadline·url·description·eligibility)
  const payload = { schema: 'schema.org/MonetaryGrant', source, updated: new Date().toISOString(), count: opps.length, opps };
  writeFileSync(OUT, JSON.stringify(payload, null, 1));
  console.log('opps.json 작성:', OUT.pathname);
}
main().catch(e => { console.error('실패:', e.message); process.exit(1); });
