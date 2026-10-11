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
