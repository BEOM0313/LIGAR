'use strict';
// node --test test/
var test = require('node:test'), assert = require('node:assert');
var fs = require('fs'), path = require('path');
var X = require('../lib/xml'), N = require('../lib/normalize'), Client = require('../lib/api').Client, L = require('../public/logic');
var FIX = path.join(__dirname, '..', 'fixtures');

test('XML: 정상 응답 · 대소문자 혼합 태그 · 엔티티', function () {
  var r = X.parseResponse('<response><header><resultCode>00</resultCode></header><body><items><item><hpid>A1</hpid><MKioskTy1>Y</MKioskTy1><dutyName>가&amp;나</dutyName></item></items><totalCount>1</totalCount></body></response>');
  assert.ok(r.ok); assert.strictEqual(r.items[0].mkioskty1, 'Y'); assert.strictEqual(r.items[0].dutyname, '가&나'); assert.strictEqual(r.totalCount, 1);
});
test('XML: 게이트웨이 오류 응답 (인증키 오류 등)', function () {
  var r = X.parseResponse('<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>');
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, '30'); assert.match(r.message, /SERVICE_KEY/);
});
test('XML: 결과코드 오류', function () {
  var r = X.parseResponse('<response><header><resultCode>99</resultCode><resultMsg>오류</resultMsg></header></response>');
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, '99');
});

test('정규화: Y/N/불가능/정보미제공', function () {
  assert.strictEqual(N.yn('Y'), true); assert.strictEqual(N.yn('N1'), false); assert.strictEqual(N.yn('불가능'), false); assert.strictEqual(N.yn('정보미제공'), null); assert.strictEqual(N.yn(''), null);
});
test('정규화: 가상 데이터 병합', async function () {
  var c = new Client({ demo: true, fixtures: FIX }), q = { STAGE1: '서울특별시', STAGE2: '강남구', Q0: '서울특별시', Q1: '강남구' };
  var r = await Promise.all(['list', 'beds', 'severe', 'messages', 'traumaList'].map(function (o) { return c.call(o, q); }));
  var hs = N.merge({ list: r[0].items, beds: r[1].items, severe: r[2].items, messages: r[3].items, trauma: r[4].items });
  assert.strictEqual(hs.length, 3);
  var a = hs.find(function (h) { return h.hpid === 'A0000001'; });
  assert.deepStrictEqual(a.beds.er, { avail: 3, total: 40 }); assert.strictEqual(a.equip.ct, true); assert.strictEqual(a.severe.flags[12], false);
  assert.strictEqual(a.messages.length, 1); assert.ok(a.lat > 37 && a.lon > 127); assert.match(a.updated, /^\d{14}$/);
  var b = hs.find(function (h) { return h.hpid === 'A0000002'; }); assert.strictEqual(b.severe.flags[26], null);
});
test('API 클라이언트: 키 인코딩', function () {
  assert.strictEqual(new Client({ key: 'ab%2Bcd%3D%3D' }).keyParam(), 'ab%2Bcd%3D%3D');
  assert.strictEqual(new Client({ key: 'ab+cd==' }).keyParam(), 'ab%2Bcd%3D%3D');
});
test('API 클라이언트: 일일 한도 초과 시 호출하지 않음', async function () {
  var c = new Client({ key: 'x' }); c.calls[require('../lib/api').OPS.beds] = 1e9;
  var r = await c.call('beds', { STAGE1: 'a', STAGE2: 'b' }); assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'LIMIT');
});
test('API 클라이언트: 네트워크 오류 시 이전 캐시 반환', async function () {
  var c = new Client({ key: 'x' }), realFetch = global.fetch;
  var xml = fs.readFileSync(path.join(FIX, 'list.xml'), 'utf8');
  global.fetch = async function () { return { text: async function () { return xml; } }; };
  try {
    var first = await c.call('beds', { STAGE1: 'a' }); assert.ok(first.ok);
    c.cache.forEach(function (v) { v.at -= 3600e3; }); // 캐시 만료시키기
    global.fetch = async function () { throw new Error('down'); };
    var second = await c.call('beds', { STAGE1: 'a' }); assert.ok(second.stale); assert.strictEqual(second.items.length, first.items.length);
  } finally { global.fetch = realFetch; }
});

test('2021 현장 외상 분류: Red / Yellow / 연령별 혈압', function () {
  assert.strictEqual(L.fieldTriage({ age: 30, sbp: 85 }).level, 'red');
  assert.strictEqual(L.fieldTriage({ age: 70, sbp: 105 }).level, 'red');
  assert.strictEqual(L.fieldTriage({ age: 30, sbp: 105 }).level, 'none');
  assert.strictEqual(L.fieldTriage({ age: 5, sbp: 75 }).level, 'red'); // 70+2×5 = 80
  assert.strictEqual(L.fieldTriage({ age: 5, sbp: 85 }).level, 'none');
  assert.strictEqual(L.fieldTriage({ age: 40, gcsMotor: 5 }).level, 'red');
  assert.strictEqual(L.fieldTriage({ age: 40, mechanism: { fall: true } }).level, 'yellow');
  assert.strictEqual(L.fieldTriage({ age: 40, rr: 32 }).level, 'red');
});
test('RACE 척도', function () {
  assert.deepStrictEqual(L.race({ face: 2, arm: 2, leg: 1 }), { total: 5, lvo: true });
  assert.strictEqual(L.race({ face: 1, arm: 1 }).lvo, false);
});
test('참고 등급', function () {
  assert.strictEqual(L.refGrade({ condition: 'arrest' }).grade, 1);
  assert.strictEqual(L.refGrade({ condition: 'chest', stemi: true }).grade, 2);
  assert.strictEqual(L.refGrade({ condition: 'peds_abd', age: 7 }).grade, 3);
  assert.strictEqual(L.refGrade({ condition: 'other', pain: 2 }).grade, 4);
});

async function demoHospitals() {
  var c = new Client({ demo: true, fixtures: FIX }), q = { STAGE1: '서울특별시', Q0: '서울특별시' };
  var r = await Promise.all(['list', 'beds', 'severe', 'messages', 'traumaList', 'basic'].map(function (o) { return c.call(o, q); }));
  return N.merge({ list: r[0].items, beds: r[1].items, severe: r[2].items, messages: r[3].items, trauma: r[4].items, basic: r[5].items });
}
var ORIGIN = { lat: 37.4979, lon: 127.0276 };

test('매칭: 소아 충수염 의심 → CT·복부수술 없는 병원 제외', async function () {
  var hs = await demoHospitals(), m = L.match(hs, L.needsFor({ condition: 'peds_abd', age: 8 }), ORIGIN);
  var ex = m.excluded.map(function (r) { return r.h.hpid; });
  assert.ok(ex.indexOf('A0000005') >= 0, 'CT 없는 의원 제외'); assert.ok(ex.indexOf('A0000006') >= 0, '복부수술 불가 제외'); assert.ok(ex.indexOf('A0000002') >= 0, '소아청소년과 없는 병원 제외');
  assert.ok(m.ranked.length >= 2); assert.ok(m.ranked.every(function (r) { return r.h.equip.ct === true; }));
  assert.ok(m.compare && m.compare.transferTotal > m.compare.direct, '가까운 병원 경유 전원보다 직행이 빠름');
});
test('매칭: 영유아 → 장중첩(영유아) 필수', async function () {
  var hs = await demoHospitals(), m = L.match(hs, L.needsFor({ condition: 'peds_abd', age: 2 }), ORIGIN);
  assert.ok(m.ranked.every(function (r) { return r.h.severe.flags[10] === true; }));
});
test('매칭: STEMI → 심근경색 재관류 가능 병원만', async function () {
  var hs = await demoHospitals(), m = L.match(hs, L.needsFor({ condition: 'chest', stemi: true }), ORIGIN, { timeCritical: true });
  assert.ok(m.ranked.length > 0); assert.strictEqual(m.ranked[0].h.severe.flags[1], true);
  assert.ok(m.ranked.every(function (r) { return r.h.severe.flags[1] !== false; }));
  var unk = m.ranked.findIndex(function (r) { return r.unknown.length; }); assert.ok(unk < 0 || m.ranked.slice(unk).every(function (r) { return r.unknown.length; }), '미확인 병원은 뒤로');
});
test('매칭: 뇌졸중 메시지("뇌졸중 수용 불가")가 있는 병원은 감점', async function () {
  var hs = await demoHospitals(), m = L.match(hs, L.needsFor({ condition: 'stroke', raceTotal: 6 }), ORIGIN);
  var b = m.ranked.concat(m.excluded).find(function (r) { return r.h.hpid === 'A0000002'; });
  assert.ok(!b.eligible || b.blocking.length > 0);
});
test('매칭: Red 외상 → 권역외상센터만', async function () {
  var hs = await demoHospitals(), p = { condition: 'trauma', age: 40, sbp: 80 };
  var m = L.match(hs, L.needsFor(p), ORIGIN);
  assert.deepStrictEqual(m.ranked.map(function (r) { return r.h.hpid; }), ['A0000004']);
});
test('매칭: 오래된 정보 표시', async function () {
  var hs = await demoHospitals(), m = L.match(hs, L.needsFor({ condition: 'other' }), ORIGIN);
  var old = m.ranked.concat(m.excluded).find(function (r) { return r.h.hpid === 'A0000005'; });
  assert.ok(old.stale && old.ageMin >= 90);
});
test('사전 연락 문구', async function () {
  var hs = await demoHospitals(), p = { condition: 'chest', stemi: true, age: 62, sex: '남', sbp: 100, hr: 110 };
  var m = L.match(hs, L.needsFor(p), ORIGIN), t = L.preNotify(p, m.ranked[0], L.refGrade(p));
  assert.match(t, /STEMI/); assert.match(t, /62세 남/); assert.match(t, /심근경색 재관류중재술/);
});

test('서버: 가상 데이터로 /api/region · /api/nearby', async function () {
  process.env.DEMO = '1';
  var S = require('../server'); await new Promise(function (r) { S.server.listen(0, r); });
  var port = S.server.address().port;
  try {
    var a = await (await fetch('http://127.0.0.1:' + port + '/api/region?sido=' + encodeURIComponent('서울특별시') + '&sigungu=' + encodeURIComponent('서초구'))).json();
    assert.ok(a.demo); assert.strictEqual(a.hospitals.length, 3); assert.ok(a.hospitals.some(function (h) { return h.trauma; }));
    assert.ok(a.hospitals.every(function (h) { return h.depts && h.depts.length; }));
    var b = await (await fetch('http://127.0.0.1:' + port + '/api/nearby?lat=37.4979&lon=127.0276')).json();
    assert.strictEqual(b.hospitals.length, 6); assert.strictEqual(b.regions.length, 2);
    var bad = await fetch('http://127.0.0.1:' + port + '/../server.js'); assert.strictEqual(bad.status, 404);
    var idx = await fetch('http://127.0.0.1:' + port + '/'); assert.strictEqual(idx.status, 200);
  } finally { S.server.close(); }
});

/* ── 오픈스트리트맵 길찾기 (OSRM · Photon · Nominatim 응답 형식) ── */
var RouteMod = require('../public/route');
function fakeRouter(handler) { var seen = []; var r = new RouteMod.Router({ gapMs: 0, fetchJson: function (u) { seen.push(u); return Promise.resolve(handler(u)); } }); r.seen = seen; return r; }

test('OSRM table: 출발지 1곳 → 병원별 분·km, 경로 없는 병원 제외', async function () {
  var rt = fakeRouter(function () { return { code: 'Ok', durations: [[0, 420, null, 1250]], distances: [[0, 3100, null, 9800]] }; });
  var out = await rt.table('car', ORIGIN, [{ hpid: 'A', lat: 37.5, lon: 127.04 }, { hpid: 'B', lat: 37.51, lon: 127.0 }, { hpid: 'C', lat: 37.48, lon: 127.01 }]);
  assert.deepStrictEqual(out, { A: { min: 7, km: 3.1 }, C: { min: 21, km: 9.8 } });
  assert.match(rt.seen[0], /^https:\/\/routing\.openstreetmap\.de\/routed-car\/table\/v1\/driving\/127\.027600,37\.497900;127\.040000,37\.500000;/);
  assert.match(rt.seen[0], /sources=0&annotations=duration,distance$/);
});
test('OSRM route: GeoJSON 좌표를 [위도, 경도]로 변환', async function () {
  var rt = fakeRouter(function () { return { code: 'Ok', routes: [{ duration: 600, distance: 4200, geometry: { type: 'LineString', coordinates: [[127.0276, 37.4979], [127.04, 37.5]] } }] }; });
  var r = await rt.route('foot', ORIGIN, { lat: 37.5, lon: 127.04 });
  assert.deepStrictEqual(r, { min: 10, km: 4.2, line: [[37.4979, 127.0276], [37.5, 127.04]] });
  assert.match(rt.seen[0], /routed-foot\/route\/v1\/driving\//);
});
test('OSRM 오류 코드는 예외', async function () {
  var rt = fakeRouter(function () { return { code: 'NoRoute' }; });
  await assert.rejects(rt.route('car', ORIGIN, { lat: 1, lon: 1 }), /NoRoute/);
});
test('장소 검색: Photon 결과 → 없으면 Nominatim', async function () {
  var rt = fakeRouter(function (u) {
    if (/photon/.test(u)) return /없는곳/.test(decodeURIComponent(u)) ? { features: [] } : { features: [{ geometry: { coordinates: [127.0327, 37.4837] }, properties: { name: '서초구청', countrycode: 'KR', state: '서울특별시', district: '서초구', street: '남부순환로' } }] };
    return [{ lat: '37.1', lon: '127.1', name: '없는곳', display_name: '없는곳, 어떤동, 어떤구, 서울특별시, 06750, 대한민국' }];
  });
  var a = await rt.search('서초구청');
  assert.strictEqual(a[0].name, '서초구청'); assert.strictEqual(a[0].lat, 37.4837); assert.strictEqual(a[0].src, 'photon');
  var b = await rt.search('없는곳');
  assert.strictEqual(b[0].src, 'nominatim'); assert.strictEqual(b[0].addr, '서울특별시 어떤구 어떤동');
  assert.ok(rt.seen.some(function (u) { return /nominatim.*countrycodes=kr/.test(u); }));
});
test('요청 간격: 같은 호스트는 줄 세워 보낸다', async function () {
  var t = [], r = new RouteMod.Router({ gapMs: 50, fetchJson: function () { t.push(Date.now()); return Promise.resolve({ code: 'Ok', durations: [[0, 60]], distances: [[0, 1]] }); } });
  await Promise.all([r.table('car', ORIGIN, [{ hpid: 'A', lat: 1, lon: 1 }]), r.table('foot', ORIGIN, [{ hpid: 'A', lat: 1, lon: 1 }])]);
  assert.ok(t[1] - t[0] >= 45, '두 번째 요청은 간격을 두고');
});
test('매칭: 길찾기 시간이 있으면 직선거리 대신 사용 · 순위가 바뀜', async function () {
  var hs = await demoHospitals(), needs = L.needsFor({ condition: 'other' });
  var est = L.match(hs, needs, ORIGIN);
  var first = est.ranked[0].h.hpid, car = {}, foot = {};
  hs.forEach(function (h) { car[h.hpid] = { min: h.hpid === first ? 40 : 8, km: 3 }; foot[h.hpid] = { min: h.hpid === first ? 90 : 10, km: 1 }; }); // 직선으로는 가깝지만 강 건너 우회
  var rt = L.match(hs, needs, ORIGIN, { routes: { car: car, foot: foot } });
  assert.notStrictEqual(rt.ranked[0].h.hpid, first);
  assert.strictEqual(rt.ranked[0].etaSrc, 'route'); assert.strictEqual(rt.ranked[0].eta, 8); assert.strictEqual(rt.ranked[0].foot.min, 10);
  assert.ok(rt.ranked[0].walkOk, '차량 8분 · 도보 10분이면 걸어가도 비슷');
  var far = rt.ranked.concat(rt.excluded).find(function (r) { return r.h.hpid === first; }); assert.strictEqual(far.walkOk, false);
});
test('병원 메시지: 질환 분류가 다르면 감점하지 않음', async function () {
  var hs = await demoHospitals(), m = L.match(hs, L.needsFor({ condition: 'peds_abd', age: 8 }), ORIGIN);
  var a = m.ranked.find(function (r) { return r.h.hpid === 'A0000001'; });
  assert.strictEqual(a.blocking.length, 0, '영유아 내시경 불가 메시지는 충수염과 무관');
  var g = L.match(hs, L.needsFor({ condition: 'gi_bleed', age: 2 }), ORIGIN), all = g.ranked.concat(g.excluded);
  assert.ok(all.find(function (r) { return r.h.hpid === 'A0000001'; }).blocking.length > 0 || !all.find(function (r) { return r.h.hpid === 'A0000001'; }).eligible);
});

/* ── MCP: 메디패스 서버 (POST /mcp) · 지금 여기 응급실 클라이언트 ── */
var MCPmod = require('../lib/mcp'), HNRmod = require('../lib/hnr'), http = require('http');
function demoTools() {
  var Service = require('../lib/service').Service;
  var rt = fakeRouter(function (u) { var n = u.split('/table/v1/driving/')[1].split('?')[0].split(';').length; return { code: 'Ok', durations: [Array.from({ length: n }, function (_, i) { return i * 120; })], distances: [Array.from({ length: n }, function (_, i) { return i * 900; })] }; });
  rt.search = function () { return Promise.resolve([{ name: '서초구청', addr: '서울특별시 서초구', lat: 37.4837, lon: 127.0327 }]); };
  return new MCPmod.Tools({ service: new Service(new Client({ demo: true, fixtures: FIX })), router: rt });
}
test('MCP: initialize · tools/list · 알림 · 없는 메서드', async function () {
  var t = demoTools();
  var init = await MCPmod.handle(t, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
  assert.strictEqual(init.result.protocolVersion, '2025-03-26'); assert.strictEqual(init.result.serverInfo.name, 'medipath-er');
  var unk = await MCPmod.handle(t, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.strictEqual(unk.result.protocolVersion, '2025-06-18');
  var list = await MCPmod.handle(t, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.deepStrictEqual(list.result.tools.map(function (x) { return x.name; }), ['recommend_emergency_room', 'first_aid_guide', 'field_triage_119']);
  list.result.tools.forEach(function (x) { assert.strictEqual(x.inputSchema.type, 'object'); assert.ok(x.annotations.readOnlyHint); });
  assert.strictEqual(await MCPmod.handle(t, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.strictEqual((await MCPmod.handle(t, { jsonrpc: '2.0', id: 4, method: 'resources/list' })).error.code, -32601);
  assert.strictEqual((await MCPmod.handle(t, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } })).error.code, -32602);
});
test('MCP 도구: 응급실 추천 (장소 검색 → 도로 기준 시간 · 부적합 병원 제외)', async function () {
  var r = await demoTools().call('recommend_emergency_room', { condition: 'peds_abd', age: 8, place: '서초구청' });
  var t = r.content[0].text;
  assert.ok(!r.isError, t); assert.match(t, /출발지: 서초구청/); assert.match(t, /차량 \d+분 \(도로/); assert.match(t, /제외: .*가상연합의원/);
  assert.match(t, /119/); assert.match(t, /KTAS/);
});
test('MCP 도구: 시간 민감 상황은 119 안내 · 도보 안내 없음', async function () {
  var t = (await demoTools().call('recommend_emergency_room', { condition: 'chest', stemi: true, age: 60, lat: 37.4979, lon: 127.0276 })).content[0].text;
  assert.match(t, /119에 신고하세요/); assert.doesNotMatch(t, /도보/);
});
test('MCP 도구: 응급처치 · 현장 평가 · 입력 오류', async function () {
  var t = demoTools();
  assert.match((await t.call('first_aid_guide', { situation: 'arrest' })).content[0].text, /119에 전화/);
  assert.match((await t.call('field_triage_119', { condition: 'trauma', age: 40, sbp: 85, mechanism: ['fall'] })).content[0].text, /Red/);
  assert.ok((await t.call('recommend_emergency_room', { condition: 'peds_abd' })).isError);
  assert.ok((await t.call('recommend_emergency_room', { condition: 'xx', lat: 1, lon: 1 })).isError);
});
test('MCP HTTP: POST /mcp JSON 응답 · 알림 202 · GET 405 · 일괄 요청', async function () {
  process.env.DEMO = '1'; process.env.HERE_NOW_ER_MCP_URL = 'off';
  var S = require('../server'); if (!S.server.listening) await new Promise(function (r) { S.server.listen(0, r); });
  var base = 'http://127.0.0.1:' + S.server.address().port + '/mcp', H = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  try {
    var a = await (await fetch(base, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json();
    assert.strictEqual(a.result.tools.length, 3);
    assert.strictEqual((await fetch(base, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).status, 202);
    assert.strictEqual((await fetch(base)).status, 405);
    var batch = await (await fetch(base, { method: 'POST', headers: H, body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'first_aid_guide', arguments: { situation: 'burn' } } }]) })).json();
    assert.strictEqual(batch.length, 2); assert.match(batch[1].result.content[0].text, /시원한/);
    assert.strictEqual((await fetch(base, { method: 'POST', headers: H, body: '{bad' })).status, 400);
  } finally { S.server.close(); }
});
test('지금 여기 응급실 클라이언트: JSON · SSE 응답 · 도구 오류', async function () {
  var calls = [];
  var srv = http.createServer(function (req, res) {
    var b = ''; req.on('data', function (c) { b += c; }); req.on('end', function () {
      var m = JSON.parse(b); calls.push(m);
      var result = m.method === 'tools/list' ? { tools: [{ name: 'find_open_pharmacies' }] } : { content: [{ type: 'text', text: '💊 ' + m.params.name + ' ' + JSON.stringify(m.params.arguments) }], isError: m.params.name === 'get_drug_info' };
      var body = JSON.stringify({ jsonrpc: '2.0', id: m.id, result: result });
      if (m.params && m.params.arguments && m.params.arguments.sse) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('event: message\ndata: ' + body + '\n\n'); }
      else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body); }
    });
  });
  await new Promise(function (r) { srv.listen(0, r); });
  var c = new HNRmod.Client({ url: 'http://127.0.0.1:' + srv.address().port + '/mcp' });
  try {
    assert.strictEqual((await c.listTools())[0].name, 'find_open_pharmacies');
    var p = await c.call('pharmacies', { sido: '서울', sigungu: '강남구' }); assert.ok(p.ok); assert.match(p.text, /find_open_pharmacies.*강남구/);
    var s = await c.call('hospitals', { sido: '서울', sse: true }); assert.match(s.text, /find_open_hospitals/);
    var d = await c.call('drug', { drugName: 'x' }); assert.strictEqual(d.ok, false);
    assert.strictEqual(calls[1].method, 'tools/call'); assert.strictEqual(calls[1].jsonrpc, '2.0');
  } finally { srv.close(); }
});
