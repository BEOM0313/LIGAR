'use strict';
// 국립중앙의료원 전국 응급의료정보조회 서비스 (B552657/ErmctInfoInqireService) 호출 · 캐시 · 일일 호출 한도 관리
var fs = require('fs'), path = require('path');
var parseResponse = require('./xml').parseResponse;

var BASE = 'https://apis.data.go.kr/B552657/ErmctInfoInqireService/';
var OPS = {
  beds: 'getEmrrmRltmUsefulSckbdInfoInqire',      // 응급실 실시간 가용병상 (STAGE1, STAGE2)
  severe: 'getSrsillDissAceptncPosblInfoInqire',  // 중증질환자 수용가능 (STAGE1, STAGE2, SM_TYPE)
  list: 'getEgytListInfoInqire',                  // 응급의료기관 목록 (Q0, Q1 …) · 좌표 포함
  nearby: 'getEgytLcinfoInqire',                  // 위치 기준 응급의료기관 (WGS84_LON, WGS84_LAT)
  basic: 'getEgytBassInfoInqire',                 // 기본정보 (HPID) · 진료과목
  traumaList: 'getStrmListInfoInqire',            // 외상센터 목록 (Q0, Q1)
  traumaNearby: 'getStrmLcinfoInqire',            // 외상센터 위치 (WGS84_LON, WGS84_LAT)
  traumaBasic: 'getStrmBassInfoInqire',           // 외상센터 기본정보
  messages: 'getEmrrmSrsillDissMsgInqire'         // 응급실·중증질환 메시지 (HPID, Q0, Q1)
};
// 캐시 유효시간(ms): 실시간 항목은 짧게, 기관 정보는 길게
var TTL = { beds: 120e3, severe: 300e3, messages: 120e3, list: 864e5, nearby: 864e5, basic: 864e5, traumaList: 864e5, traumaNearby: 864e5, traumaBasic: 864e5 };
var DAILY_LIMIT = +(process.env.DAILY_LIMIT || 950); // 포털 개발계정 기능별 1,000건/일 · 여유 50건

function Client(opts) {
  this.key = opts.key || '';
  this.demo = !!opts.demo || !this.key;
  this.fixtures = opts.fixtures || path.join(__dirname, '..', 'fixtures');
  this.cache = new Map();
  this.calls = {}; this.day = new Date().toDateString();
}
Client.prototype.keyParam = function () {
  // 포털의 Encoding 키(%2B…)는 그대로, Decoding 키(+,/,=)는 인코딩해서 사용
  return /%[0-9A-F]{2}/i.test(this.key) ? this.key : encodeURIComponent(this.key);
};
Client.prototype.count = function (op) {
  var today = new Date().toDateString();
  if (today !== this.day) { this.calls = {}; this.day = today; }
  this.calls[op] = (this.calls[op] || 0) + 1;
  return this.calls[op];
};
Client.prototype.usage = function () { return { day: this.day, calls: this.calls, limit: DAILY_LIMIT, demo: this.demo }; };

Client.prototype.call = async function (opName, params) {
  var op = OPS[opName]; if (!op) throw new Error('unknown op ' + opName);
  var qs = Object.keys(params).filter(function (k) { return params[k] != null && params[k] !== ''; }).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  var ck = opName + '?' + qs, hit = this.cache.get(ck);
  if (hit && Date.now() - hit.at < TTL[opName]) return Object.assign({ cached: true, fetchedAt: hit.at }, hit.data);
  var data;
  if (this.demo) {
    var file = path.join(this.fixtures, opName + '.xml');
    if (!fs.existsSync(file)) return { ok: true, items: [], totalCount: 0, demo: true };
    // 가상 데이터의 갱신 시각은 '지금으로부터 N분 전'으로 채운다
    data = parseResponse(fs.readFileSync(file, 'utf8').replace(/__NOW_MINUS_(\d+)__/g, function (_, m) { return stamp(new Date(Date.now() - m * 60e3)); })); data.demo = true;
    if (data.ok && opName !== 'nearby' && opName !== 'traumaNearby') data.items = filterDemo(data.items, params, this.demoAddr());
  } else {
    if ((this.calls[op] || 0) >= DAILY_LIMIT) {
      if (hit) return Object.assign({ cached: true, stale: true, fetchedAt: hit.at }, hit.data);
      return { ok: false, code: 'LIMIT', message: '오늘 호출 한도에 도달했습니다 (' + op + ')' };
    }
    this.count(op);
    var url = BASE + op + '?serviceKey=' + this.keyParam() + '&' + qs;
    try {
      var res = await fetch(url, { headers: { Accept: 'application/xml' }, signal: AbortSignal.timeout(8000) });
      data = parseResponse(await res.text());
    } catch (e) {
      if (hit) return Object.assign({ cached: true, stale: true, fetchedAt: hit.at }, hit.data);
      return { ok: false, code: 'NETWORK', message: '공공데이터포털에 연결할 수 없습니다: ' + e.message };
    }
  }
  if (data.ok) this.cache.set(ck, { at: Date.now(), data: data });
  else if (hit) return Object.assign({ cached: true, stale: true, fetchedAt: hit.at, upstreamError: data.message }, hit.data);
  return Object.assign({ fetchedAt: Date.now() }, data);
};
function stamp(d) { function z(n) { return (n < 10 ? '0' : '') + n; } return '' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds()); }
// 병상·중증·메시지 응답에는 주소가 없어 가상 목록(list.xml)의 주소로 지역을 거른다
Client.prototype.demoAddr = function () {
  if (this._addr) return this._addr;
  var f = path.join(this.fixtures, 'list.xml'), m = {};
  if (fs.existsSync(f)) (parseResponse(fs.readFileSync(f, 'utf8')).items || []).forEach(function (it) { m[it.hpid] = it.dutyaddr; });
  return (this._addr = m);
};
function filterDemo(items, p, addrs) {
  var sido = p.STAGE1 || p.Q0, gu = p.STAGE2 || p.Q1;
  if (p.HPID) return items.filter(function (it) { return it.hpid === p.HPID; });
  return items.filter(function (it) {
    var addr = it.dutyaddr || (addrs && addrs[it.hpid]) || '';
    return (!sido || addr.indexOf(sido) === 0 || it._sido === sido) && (!gu || addr.indexOf(gu) >= 0 || it._sigungu === gu);
  });
}
module.exports = { Client: Client, OPS: OPS };
