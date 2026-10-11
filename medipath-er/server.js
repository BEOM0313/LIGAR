'use strict';
// 메디패스 응급실 연결 · 서버
// - 공공데이터포털 인증키는 서버 환경변수(DATA_GO_KR_KEY)에만 둔다. 브라우저로 내려보내지 않는다.
// - 키가 없거나 DEMO=1이면 fixtures/의 가상 데이터로 동작한다.
var http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
var Client = require('./lib/api').Client, Service = require('./lib/service').Service;
var MCP = require('./lib/mcp'), HNR = require('./lib/hnr'), Router = require('./public/route').Router;

loadEnv(path.join(__dirname, '.env'));
var PORT = +(process.env.PORT || 8080);
var client = new Client({ key: process.env.DATA_GO_KR_KEY || '', demo: process.env.DEMO === '1' });
var service = new Service(client, { basicPerRegion: +(process.env.BASIC_PER_REGION || 40) });
// 메디패스 자체 MCP 도구 (POST /mcp) · 오픈스트리트맵 길찾기는 서버에서도 같은 모듈을 쓴다
var tools = new MCP.Tools({ service: service, router: new Router({}) });
// '지금 여기 응급실' MCP 서버 (문 연 병·의원 · 약국 · 의약품). HERE_NOW_ER_MCP_URL=off 이면 끈다
var HNR_URL = process.env.HERE_NOW_ER_MCP_URL || 'http://210.109.60.53/mcp';
var hnr = HNR_URL === 'off' ? null : new HNR.Client({ url: HNR_URL });

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
    var m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

async function handleApi(pathname, q, res) {
  if (pathname === '/api/status') return json(res, 200, { ok: true, usage: client.usage() });
  if (pathname === '/api/region') {
    if (!q.sido || !q.sigungu) return json(res, 400, { ok: false, message: 'sido, sigungu가 필요합니다' });
    return json(res, 200, await service.region(q.sido, q.sigungu));
  }
  if (pathname === '/api/nearby') {
    var lat = +q.lat, lon = +q.lon;
    if (!isFinite(lat) || !isFinite(lon)) return json(res, 400, { ok: false, message: 'lat, lon이 필요합니다' });
    var d = await service.nearby(lat, lon, +(q.maxRegions || 4));
    return json(res, d.ok ? 200 : 502, d);
  }
  if (pathname === '/api/hnr') {
    // kind: hospitals | pharmacies | drug | pill
    if (!hnr) return json(res, 503, { ok: false, message: '지금 여기 응급실 연동이 꺼져 있습니다 (HERE_NOW_ER_MCP_URL)' });
    var kind = q.kind, args;
    if (kind === 'hospitals') args = { sido: q.sido, sigungu: q.sigungu || undefined, department: q.department || undefined, openNowOnly: q.openNowOnly !== 'false', limit: 6 };
    else if (kind === 'pharmacies') args = { sido: q.sido, sigungu: q.sigungu || undefined, openNowOnly: q.openNowOnly !== 'false', limit: 6 };
    else if (kind === 'drug') args = { drugName: q.drugName, limit: 2 };
    else return json(res, 400, { ok: false, message: 'kind는 hospitals, pharmacies, drug 중 하나' });
    if ((kind === 'drug' && !q.drugName) || (kind !== 'drug' && !q.sido)) return json(res, 400, { ok: false, message: kind === 'drug' ? 'drugName이 필요합니다' : 'sido가 필요합니다' });
    try { var r = await hnr.call(kind, args); return json(res, 200, Object.assign({ source: '지금 여기 응급실 MCP' }, r)); }
    catch (e) { return json(res, 502, { ok: false, message: '지금 여기 응급실 서버에 연결할 수 없습니다: ' + e.message }); }
  }
  if (pathname === '/api/basic') {
    if (!q.hpid) return json(res, 400, { ok: false, message: 'hpid가 필요합니다' });
    var b = await client.call('basic', { HPID: q.hpid, pageNo: 1, numOfRows: 1 });
    return json(res, b.ok ? 200 : 502, b.ok ? { ok: true, item: (b.items || [])[0] || null } : { ok: false, message: b.message });
  }
  return json(res, 404, { ok: false, message: 'not found' });
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0;
    req.on('data', function (c) { size += c.length; if (size > 1e6) { reject(new Error('요청이 너무 큽니다')); req.destroy(); } else chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); }); req.on('error', reject);
  });
}
function json(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(body)); }
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

var server = http.createServer(async function (req, res) {
  var u = url.parse(req.url, true);
  try {
    if (u.pathname === '/mcp') {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version' }); return res.end(); }
      return await MCP.serveHttp(tools, req, res, await readBody(req));
    }
    if (u.pathname === '/healthz') return json(res, 200, { ok: true, service: 'medipath-er', demo: client.demo, hereNowEr: HNR_URL === 'off' ? null : HNR_URL });
    if (u.pathname.indexOf('/api/') === 0) return await handleApi(u.pathname, u.query, res);
    var file = path.normalize(path.join(__dirname, 'public', u.pathname === '/' ? 'index.html' : u.pathname));
    if (file.indexOf(path.join(__dirname, 'public')) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { json(res, 500, { ok: false, message: e.message }); }
});
if (require.main === module) server.listen(PORT, function () { console.log('메디패스 응급실 연결: http://localhost:' + PORT + (client.demo ? '  (DEMO: 가상 데이터)' : '  (공공데이터포털 연동)')); console.log('MCP 엔드포인트: http://localhost:' + PORT + '/mcp · 지금 여기 응급실 연동: ' + HNR_URL); });
module.exports = { server: server, client: client, tools: tools };
