'use strict';
// 메디패스 MCP 서버 (Streamable HTTP · stateless · JSON 응답)
// '지금 여기 응급실'(here-now-er-mcp)과 같은 방식으로 PlayMCP 등에 등록할 수 있다. 외부 패키지 없이 JSON-RPC 2.0을 직접 처리한다.
var L = require('../public/logic'), Router = require('../public/route').Router;

var VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
var DISCLAIMER = '⚠️ 병상·수용 정보는 병원 입력 시점 기준이며 실제와 다를 수 있습니다. 출발 전 응급실에 전화로 확인하세요. 위급하면 지체 없이 119에 신고하세요. 참고 등급은 KTAS·Pre-KTAS 공식 판정이 아닙니다.';
var SOURCE = '출처: 국립중앙의료원 응급의료정보(공공데이터포털) · 경로/검색 © OpenStreetMap 기여자 (OSRM · Photon/Nominatim)';
var RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

var SIDO = { 서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시', 광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시', 경기: '경기도', 강원: '강원특별자치도', 충북: '충청북도', 충남: '충청남도', 전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도', 제주: '제주특별자치도' };
function normalizeSido(s) {
  s = String(s || '').trim(); var full = Object.keys(SIDO).map(function (k) { return SIDO[k]; });
  if (full.indexOf(s) >= 0) return s;
  for (var k in SIDO) if (s.indexOf(k) === 0) return SIDO[k];
  return s;
}
function kst() { var p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); return p.month + '/' + p.day + ' ' + p.hour + ':' + p.minute + ' KST'; }

var conditionKeys = Object.keys(L.CONDITIONS), situationKeys = Object.keys(L.PUBLIC);
var LOCATION = {
  place: { type: 'string', description: '출발지 주소나 장소 이름 (예: 서초구청, 테헤란로 152). 오픈스트리트맵으로 위치를 찾아 도로 기준 시간을 계산합니다' },
  lat: { type: 'number', description: '출발지 위도 (WGS84)' }, lon: { type: 'number', description: '출발지 경도 (WGS84)' },
  sido: { type: 'string', description: '시/도 (예: 서울). 위치를 모를 때 지역 단위 조회' }, sigungu: { type: 'string', description: '시/군/구 (예: 강남구)' }
};
var TOOLS = [
  {
    name: 'recommend_emergency_room',
    title: '환자 상태에 맞는 응급실 추천',
    description: '[메디패스] 환자 상태(질환군·나이·주요 소견)에 필요한 시설·진료(CT, 소아청소년과, 심근경색·뇌경색 재관류, 외상센터 등)를 국립중앙의료원 실시간 정보와 대조해, 치료 가능한 응급실을 도로 기준 이동 시간 순으로 추천합니다. 가장 가까운 병원이 부적합하면 전원 지연을 비교해 알려줍니다. "아이가 오른쪽 아랫배가 아파요, 어느 응급실?" 같은 질문에 사용하세요.',
    inputSchema: { type: 'object', properties: Object.assign({
      condition: { type: 'string', enum: conditionKeys, description: '질환군: ' + conditionKeys.map(function (k) { return k + '=' + L.CONDITIONS[k]; }).join(', ') },
      age: { type: 'number', description: '환자 나이 (세)' },
      stemi: { type: 'boolean', description: '12유도 심전도 STEMI (흉통)' },
      raceScore: { type: 'number', description: 'RACE 뇌졸중 척도 0~9 (5 이상 대혈관폐색 의심)' },
      lastKnownWellMin: { type: 'number', description: '뇌졸중: 마지막 정상 시각으로부터 경과 분' },
      sbp: { type: 'number', description: '수축기 혈압' }, hr: { type: 'number', description: '맥박' }, rr: { type: 'number', description: '호흡수' }, spo2: { type: 'number', description: '산소포화도 %' }, gcs: { type: 'number', description: 'GCS 3~15' },
      traumaMechanism: { type: 'boolean', description: '고위험 손상 기전 (3m 이상 추락, 차량 밖 튕김, 보행자 충돌 등)' },
      amputation: { type: 'boolean', description: '절단 (접합 필요)' }, severeBurn: { type: 'boolean', description: '중증 화상' }, infectious: { type: 'boolean', description: '감염병 의심 (격리 필요)' },
      limit: { type: 'number', description: '추천 병원 수 (기본 3, 최대 5)' }
    }, LOCATION), required: ['condition'] },
    annotations: Object.assign({ title: '환자 상태에 맞는 응급실 추천' }, RO)
  },
  {
    name: 'first_aid_guide',
    title: '일반인 응급처치 안내',
    description: '[메디패스] 쓰러짐·뇌졸중 의심·흉통·출혈·화상·소아 복통·경련·기도폐쇄·알레르기·사고 상황에서 119 신고가 필요한지와 지금 할 일·하지 말 일을 근거(2020 한국 심폐소생술 지침, ILCOR·AHA 응급처치)와 함께 안내합니다.',
    inputSchema: { type: 'object', properties: { situation: { type: 'string', enum: situationKeys, description: situationKeys.map(function (k) { return k + '=' + L.PUBLIC[k].title; }).join(', ') } }, required: ['situation'] },
    annotations: Object.assign({ title: '일반인 응급처치 안내' }, RO, { openWorldHint: false })
  },
  {
    name: 'field_triage_119',
    title: '119 현장 평가 보조',
    description: '[메디패스] 구급대원용. 활력징후와 손상 소견으로 2021 현장 외상 분류(Red/Yellow), RACE 척도 판정, 참고 등급(비공식)과 필요한 병원 자원, 병원 사전연락 문구를 만듭니다.',
    inputSchema: { type: 'object', properties: {
      condition: { type: 'string', enum: conditionKeys }, age: { type: 'number' }, sex: { type: 'string', enum: ['남', '여'] },
      sbp: { type: 'number' }, hr: { type: 'number' }, rr: { type: 'number' }, spo2: { type: 'number' }, gcs: { type: 'number' }, gcsMotor: { type: 'number', description: 'GCS 운동반응 1~6' },
      redFindings: { type: 'array', items: { type: 'string', enum: ['penetrating', 'skull', 'chestWall', 'longBones', 'crush', 'amputation', 'pelvis', 'paralysis', 'tourniquet'] }, description: '2021 Red 손상 소견' },
      mechanism: { type: 'array', items: { type: 'string', enum: ['ejection', 'deathSame', 'fall', 'intrusion', 'extrication', 'pedestrian', 'motorcycle', 'childUnrestrained'] }, description: '2021 Yellow 손상 기전' },
      raceScore: { type: 'number' }, stemi: { type: 'boolean' }, chiefComplaint: { type: 'string', description: '주호소 자유 입력' }
    }, required: ['condition'] },
    annotations: Object.assign({ title: '119 현장 평가 보조' }, RO, { openWorldHint: false })
  }
];

function text(t, isError) { var r = { content: [{ type: 'text', text: t }] }; if (isError) r.isError = true; return r; }
function arr(a) { var o = {}; (a || []).forEach(function (k) { o[k] = true; }); return o; }
function patientFrom(a) {
  var p = { condition: a.condition, age: a.age, sex: a.sex, sbp: a.sbp, hr: a.hr, rr: a.rr, spo2: a.spo2, gcs: a.gcs, gcsMotor: a.gcsMotor, stemi: !!a.stemi,
    raceTotal: a.raceScore || 0, lkwMin: a.lastKnownWellMin, amputation: !!a.amputation, severeBurn: !!a.severeBurn, infectious: !!a.infectious, ccText: a.chiefComplaint,
    injury: arr(a.redFindings), mechanism: arr(a.mechanism) };
  if (a.traumaMechanism) p.mechanism.fall = true;
  if (p.injury.amputation) p.amputation = true;
  p.fieldTriage = L.fieldTriage(p);
  return p;
}

// deps: { service, router }
function Tools(deps) { this.service = deps.service; this.router = deps.router || new Router({}); }

Tools.prototype.locate = async function (a) {
  if (a.lat != null && a.lon != null) return { origin: { lat: +a.lat, lon: +a.lon }, label: '좌표 ' + (+a.lat).toFixed(4) + ', ' + (+a.lon).toFixed(4) };
  if (a.place) {
    var rs = await this.router.search(a.place).catch(function () { return []; });
    if (rs.length) return { origin: { lat: rs[0].lat, lon: rs[0].lon }, label: rs[0].name + (rs[0].addr ? ' (' + rs[0].addr + ')' : '') };
    if (!a.sido) throw new Error("'" + a.place + "' 위치를 찾지 못했습니다. 도로명 주소나 시/도·시/군/구로 다시 입력해 주세요.");
  }
  if (a.sido && a.sigungu) return { region: [normalizeSido(a.sido), a.sigungu.trim()], label: normalizeSido(a.sido) + ' ' + a.sigungu.trim() + ' (위치 미지정 · 거리 계산 없음)' };
  throw new Error('출발지가 필요합니다: place(주소·장소), lat/lon, 또는 sido+sigungu 중 하나를 넣어 주세요.');
};

Tools.prototype.recommend = async function (a) {
  var loc = await this.locate(a), p = patientFrom(a);
  var d = loc.origin ? await this.service.nearby(loc.origin.lat, loc.origin.lon, 3) : await this.service.region(loc.region[0], loc.region[1]);
  if (!d.ok && !(d.hospitals || []).length) throw new Error(d.message || (d.errors || []).join(', ') || '응급실 정보 조회 실패');
  var hs = d.hospitals || [], routes = null, routeErr = null;
  if (loc.origin && hs.length) {
    var o = loc.origin, cand = hs.filter(function (h) { return h.lat != null; }).sort(function (x, y) { return L.haversine(o, x) - L.haversine(o, y); }).slice(0, 25);
    try {
      var r = await Promise.all([this.router.table('car', o, cand), this.router.table('foot', o, cand).catch(function () { return {}; })]);
      routes = { car: r[0], foot: r[1] };
    } catch (e) { routeErr = e.message; }
  }
  var grade = L.refGrade(p), critical = grade.grade <= 2 || ['arrest', 'stroke', 'chest', 'trauma', 'anaphylaxis'].indexOf(p.condition) >= 0;
  var needs = L.needsFor(p), m = L.match(hs, needs, loc.origin || null, { routes: routes, timeCritical: critical });
  var max = Math.min(5, a.limit || 3), out = [];
  out.push('🚑 메디패스 응급실 추천 — ' + L.conditionLabel(p.condition) + (p.age != null ? ', ' + p.age + '세' : '') + (d.demo ? ' [테스트 데이터]' : ''));
  out.push('출발지: ' + loc.label + ' · 조회 ' + kst());
  if (critical) out.push('☎️ 시간이 생명인 상황입니다. 직접 이동하지 말고 119에 신고하세요. 아래는 구급대·보호자 참고용입니다.');
  out.push('필요 자원: 필수 ' + (needs.filter(function (n) { return n.level === 'must'; }).map(function (n) { return L.RES[n.key].label; }).join(', ') || '없음') + ' / 선호 ' + needs.filter(function (n) { return n.level === 'pref'; }).map(function (n) { return L.RES[n.key].label; }).join(', '));
  out.push('참고 등급(비공식): ' + grade.grade + ' — ' + grade.why.slice(0, 3).join(', '));
  out.push('');
  if (!m.ranked.length) out.push('조건을 모두 갖춘 응급실을 이 지역에서 찾지 못했습니다. 인접 지역을 조회하거나 119 구급상황관리센터에 병원 선정을 요청하세요.');
  m.ranked.slice(0, max).forEach(function (r, i) {
    var er = r.h.beds && r.h.beds.er || {}, t = [];
    if (r.eta != null) t.push((r.etaSrc === 'route' ? '차량 ' + r.eta + '분 (도로 ' + (r.km != null ? r.km.toFixed(1) + 'km' : '') + ')' : '약 ' + r.eta + '분 (직선거리 추정)') + (r.foot && !critical ? ' · 도보 ' + r.foot.min + '분' : ''));
    out.push((i + 1) + '. ' + r.h.name + (r.h.type ? ' (' + r.h.type + ')' : '') + (t.length ? ' — ' + t[0] : ''));
    out.push('   - 응급실 병상 ' + (er.avail == null ? '정보없음' : er.avail + (er.total ? '/' + er.total : '')) + (r.ageMin != null ? ' · ' + r.ageMin + '분 전 갱신' : ''));
    var ok = r.cells.filter(function (c) { return c.ok === true; }).map(function (c) { return c.label; }), unk = r.cells.filter(function (c) { return c.level === 'must' && c.ok == null; }).map(function (c) { return c.label; });
    out.push('   - 가능: ' + (ok.join(', ') || '-') + (unk.length ? ' / 확인 필요: ' + unk.join(', ') : ''));
    r.blocking.forEach(function (b) { out.push('   - 병원 메시지: ' + b.text); });
    out.push('   - 응급실 전화: ' + (r.h.erTel || r.h.tel || '정보없음'));
  });
  if (m.compare && m.compare.transferTotal) out.push('', '⚠️ 가장 가까운 ' + m.compare.nearest.h.name + '(' + m.compare.nearest.eta + '분)은 ' + m.compare.reasons.join(', ') + ' 불가 → 거기 갔다가 전원되면 약 ' + m.compare.transferTotal + '분, 추천 병원 직행은 약 ' + m.compare.direct + '분입니다.');
  if (m.excluded.length) out.push('', '제외: ' + m.excluded.slice(0, 5).map(function (r) { return r.h.name + '(' + r.missing.map(function (c) { return c.label; }).join(', ') + ' 불가)'; }).join(', '));
  if (routeErr) out.push('', '길찾기 서버에 연결하지 못해 시간은 직선거리 추정입니다.');
  out.push('', DISCLAIMER, SOURCE);
  return text(out.join('\n'));
};

Tools.prototype.firstAid = function (a) {
  var s = L.PUBLIC[a.situation]; if (!s) return text('알 수 없는 상황입니다: ' + a.situation, true);
  var out = ['🩹 ' + s.title];
  out.push(s.call === 'now' ? '☎️ 지금 119에 전화하세요 (스피커폰으로 상황요원 안내를 받으세요). 직접 운전해서 가지 마세요.' : '아래 경고 증상이 하나라도 있으면 119에 전화하세요.');
  if (s.redflags && s.redflags.length) out.push('경고 증상: ' + s.redflags.join(' / '));
  out.push('', '지금 할 일:'); s.steps.forEach(function (t, i) { out.push((i + 1) + '. ' + t); });
  if (s.dont && s.dont.length) { out.push('', '하지 마세요:'); s.dont.forEach(function (t) { out.push('- ' + t); }); }
  out.push('', '근거: ' + s.refs.map(function (r) { return L.REFS[r].t + ' ' + L.REFS[r].u; }).join(' · '));
  out.push('⚠️ 일반 정보이며 의료진의 판단을 대신하지 않습니다.');
  return text(out.join('\n'));
};

Tools.prototype.triage = function (a) {
  var p = patientFrom(a), g = L.refGrade(p), ft = p.fieldTriage, needs = L.needsFor(p), out = [];
  out.push('🚑 현장 평가 — ' + L.conditionLabel(p.condition) + (p.age != null ? ', ' + p.age + '세' : ''));
  out.push('참고 등급(비공식, KTAS 아님): ' + g.grade + ' — ' + g.why.join(', '));
  if (ft.level !== 'none') out.push('2021 현장 외상 분류: ' + (ft.level === 'red' ? 'Red → 최상위 외상센터' : 'Yellow → 외상센터 권고') + ' (' + ft.red.concat(ft.yellow).join(', ') + ')');
  if (p.condition === 'stroke') out.push('RACE ' + p.raceTotal + '점: ' + (p.raceTotal >= 5 ? '대혈관폐색 의심 → 혈전제거술 가능 병원' : '대혈관폐색 가능성 낮음'));
  out.push('필요 자원: ' + needs.map(function (n) { return L.RES[n.key].label + (n.level === 'must' ? '(필수)' : ''); }).join(', '));
  out.push('', '사전연락 문구:', L.preNotify(p, null, g));
  out.push('', '병원 추천은 recommend_emergency_room에 같은 값과 위치를 넣어 호출하세요.', DISCLAIMER);
  return text(out.join('\n'));
};

Tools.prototype.call = async function (name, a) {
  a = a || {};
  try {
    if (name === 'recommend_emergency_room') { if (!L.CONDITIONS[a.condition]) return text('condition 값이 올바르지 않습니다: ' + conditionKeys.join(', '), true); return await this.recommend(a); }
    if (name === 'first_aid_guide') return this.firstAid(a);
    if (name === 'field_triage_119') { if (!L.CONDITIONS[a.condition]) return text('condition 값이 올바르지 않습니다', true); return this.triage(a); }
    return null;
  } catch (e) { return text('조회에 실패했습니다: ' + e.message, true); }
};

// JSON-RPC 2.0 메시지 하나 처리 → 응답 객체(알림이면 null)
async function handle(tools, msg) {
  var id = msg && msg.id, isNote = !msg || msg.id === undefined;
  function ok(result) { return isNote ? null : { jsonrpc: '2.0', id: id, result: result }; }
  function err(code, message) { return isNote ? null : { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code: code, message: message } }; }
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(-32600, 'Invalid Request');
  var params = msg.params || {};
  switch (msg.method) {
    case 'initialize':
      return ok({ protocolVersion: VERSIONS.indexOf(params.protocolVersion) >= 0 ? params.protocolVersion : VERSIONS[0], capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'medipath-er', title: '메디패스 응급실 연결', version: '0.2.0' },
        instructions: '환자 상태에 맞는 응급실 추천(recommend_emergency_room), 일반인 응급처치(first_aid_guide), 119 현장 평가(field_triage_119)를 제공합니다. 생명이 위급하면 항상 119 신고를 먼저 안내하세요.' });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call': {
      var r = await tools.call(params.name, params.arguments);
      return r ? ok(r) : err(-32602, 'Unknown tool: ' + params.name);
    }
    default:
      if (msg.method.indexOf('notifications/') === 0) return null;
      return err(-32601, 'Method not found: ' + msg.method);
  }
}

// HTTP 요청 처리 (POST /mcp)
async function serveHttp(tools, req, res, body) {
  var headers = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };
  if (req.method !== 'POST') { res.writeHead(405, headers); return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null })); }
  var msg;
  try { msg = JSON.parse(body || ''); } catch (e) { res.writeHead(400, headers); return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null })); }
  var out = Array.isArray(msg) ? (await Promise.all(msg.map(function (m) { return handle(tools, m); }))).filter(Boolean) : await handle(tools, msg);
  if (out == null || (Array.isArray(out) && !out.length)) { res.writeHead(202, headers); return res.end(); }
  res.writeHead(200, headers); res.end(JSON.stringify(out));
}

module.exports = { Tools: Tools, TOOLS: TOOLS, handle: handle, serveHttp: serveHttp, normalizeSido: normalizeSido };
