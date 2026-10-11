'use strict';
// 메디패스 응급실 연결 · 서버
// - 공공데이터포털 인증키는 서버 환경변수(DATA_GO_KR_KEY)에만 둔다. 브라우저로 내려보내지 않는다.
// - 키가 없거나 DEMO=1이면 fixtures/의 가상 데이터로 동작한다.
var http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
var Client = require('./lib/api').Client, N = require('./lib/normalize');

loadEnv(path.join(__dirname, '.env'));
var PORT = +(process.env.PORT || 8080);
var client = new Client({ key: process.env.DATA_GO_KR_KEY || '', demo: process.env.DEMO === '1' });

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
    var m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

// 한 지역(시도+시군구)의 실시간 정보 묶음
async function regionData(sido, gu) {
  var r = await Promise.all([
    client.call('list', { Q0: sido, Q1: gu, pageNo: 1, numOfRows: 100 }),
    client.call('beds', { STAGE1: sido, STAGE2: gu, pageNo: 1, numOfRows: 100 }),
    client.call('severe', { STAGE1: sido, STAGE2: gu, pageNo: 1, numOfRows: 100 }),
    client.call('messages', { Q0: sido, Q1: gu, pageNo: 1, numOfRows: 200 }),
    client.call('traumaList', { Q0: sido, Q1: gu, pageNo: 1, numOfRows: 50 })
  ]);
  var errors = r.filter(function (x) { return !x.ok; }).map(function (x) { return x.message; });
  // 진료과목(dgidIdName)은 기관별 기본정보에만 있다. 하루 캐시되므로 지역당 최초 1회만 호출된다.
  var ids = (r[1].items || []).map(function (b) { return b.hpid; }).filter(Boolean).slice(0, +(process.env.BASIC_PER_REGION || 40));
  var basic = await Promise.all(ids.map(function (id) { return client.call('basic', { HPID: id, pageNo: 1, numOfRows: 1 }); }));
  return {
    sido: sido, sigungu: gu, errors: errors, demo: r.some(function (x) { return x.demo; }),
    fetchedAt: Math.min.apply(null, r.map(function (x) { return x.fetchedAt || Date.now(); })), stale: r.some(function (x) { return x.stale; }),
    raw: { list: r[0].items || [], beds: r[1].items || [], severe: r[2].items || [], messages: r[3].items || [], trauma: r[4].items || [],
      basic: [].concat.apply([], basic.map(function (x) { return x.ok ? x.items || [] : []; })) }
  };
}

async function handleApi(pathname, q, res) {
  if (pathname === '/api/status') return json(res, 200, { ok: true, usage: client.usage() });
  if (pathname === '/api/region') {
    if (!q.sido || !q.sigungu) return json(res, 400, { ok: false, message: 'sido, sigungu가 필요합니다' });
    var d = await regionData(q.sido, q.sigungu);
    return json(res, 200, { ok: d.errors.length < 5, demo: d.demo, stale: d.stale, fetchedAt: d.fetchedAt, errors: d.errors, regions: [q.sido + ' ' + q.sigungu], hospitals: N.merge(d.raw) });
  }
  if (pathname === '/api/nearby') {
    var lat = +q.lat, lon = +q.lon;
    if (!isFinite(lat) || !isFinite(lon)) return json(res, 400, { ok: false, message: 'lat, lon이 필요합니다' });
    // 1) 위치 기준 가까운 응급의료기관 → 2) 그 기관들의 시도·시군구 → 3) 지역별 실시간 정보 (최대 4개 지역)
    var near = await client.call('nearby', { WGS84_LON: lon, WGS84_LAT: lat, pageNo: 1, numOfRows: 30 });
    if (!near.ok) return json(res, 502, { ok: false, message: near.message });
    var regions = [], seen = {};
    (near.items || []).forEach(function (it) { var rg = N.regionOf(it.dutyaddr); if (rg && !seen[rg.join(' ')] && regions.length < +(q.maxRegions || 4)) { seen[rg.join(' ')] = 1; regions.push(rg); } });
    var all = await Promise.all(regions.map(function (rg) { return regionData(rg[0], rg[1]); }));
    var raw = { list: [], beds: [], severe: [], messages: [], trauma: [], basic: [] };
    all.forEach(function (d) { Object.keys(raw).forEach(function (k) { raw[k] = raw[k].concat(d.raw[k]); }); });
    (near.items || []).forEach(function (it) { raw.list.push({ hpid: it.hpid, dutyname: it.dutyname, dutyaddr: it.dutyaddr, latitude: it.latitude, longitude: it.longitude, dutytel1: it.dutytel1 }); });
    var errors = [].concat.apply([], all.map(function (d) { return d.errors; }));
    return json(res, 200, { ok: true, demo: all.some(function (d) { return d.demo; }) || !!near.demo, stale: all.some(function (d) { return d.stale; }), fetchedAt: Date.now(), errors: errors, regions: regions.map(function (r) { return r.join(' '); }), hospitals: N.merge(raw) });
  }
  if (pathname === '/api/basic') {
    if (!q.hpid) return json(res, 400, { ok: false, message: 'hpid가 필요합니다' });
    var b = await client.call('basic', { HPID: q.hpid, pageNo: 1, numOfRows: 1 });
    return json(res, b.ok ? 200 : 502, b.ok ? { ok: true, item: (b.items || [])[0] || null } : { ok: false, message: b.message });
  }
  return json(res, 404, { ok: false, message: 'not found' });
}

function json(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

var server = http.createServer(async function (req, res) {
  var u = url.parse(req.url, true);
  try {
    if (u.pathname.indexOf('/api/') === 0) return await handleApi(u.pathname, u.query, res);
    var file = path.normalize(path.join(__dirname, 'public', u.pathname === '/' ? 'index.html' : u.pathname));
    if (file.indexOf(path.join(__dirname, 'public')) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { json(res, 500, { ok: false, message: e.message }); }
});
if (require.main === module) server.listen(PORT, function () { console.log('메디패스 응급실 연결: http://localhost:' + PORT + (client.demo ? '  (DEMO: 가상 데이터)' : '  (공공데이터포털 연동)')); });
module.exports = { server: server, client: client };
