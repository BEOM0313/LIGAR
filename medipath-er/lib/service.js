'use strict';
// 지역·위치 단위로 여러 오퍼레이션을 묶어 병원 목록을 만든다 (Node 서버와 단일 HTML 공용)
var N = require('./normalize');

function Service(client, opts) { this.client = client; this.basicPerRegion = (opts && opts.basicPerRegion) || 40; }

// 한 지역(시도+시군구)의 실시간 정보 묶음
Service.prototype.regionData = async function (sido, gu) {
  var c = this.client;
  var r = await Promise.all([
    c.call('list', { Q0: sido, Q1: gu, pageNo: 1, numOfRows: 100 }),
    c.call('beds', { STAGE1: sido, STAGE2: gu, pageNo: 1, numOfRows: 100 }),
    c.call('severe', { STAGE1: sido, STAGE2: gu, pageNo: 1, numOfRows: 100 }),
    c.call('messages', { Q0: sido, Q1: gu, pageNo: 1, numOfRows: 200 }),
    c.call('traumaList', { Q0: sido, Q1: gu, pageNo: 1, numOfRows: 50 })
  ]);
  var errors = r.filter(function (x) { return !x.ok; }).map(function (x) { return x.message; });
  // 진료과목(dgidIdName)은 기관별 기본정보에만 있다. 하루 캐시되므로 지역당 최초 1회만 호출된다.
  var ids = (r[1].items || []).map(function (b) { return b.hpid; }).filter(Boolean).slice(0, this.basicPerRegion);
  var basic = await Promise.all(ids.map(function (id) { return c.call('basic', { HPID: id, pageNo: 1, numOfRows: 1 }); }));
  return {
    sido: sido, sigungu: gu, errors: errors, demo: r.some(function (x) { return x.demo; }),
    fetchedAt: Math.min.apply(null, r.map(function (x) { return x.fetchedAt || Date.now(); })), stale: r.some(function (x) { return x.stale; }),
    raw: { list: r[0].items || [], beds: r[1].items || [], severe: r[2].items || [], messages: r[3].items || [], trauma: r[4].items || [],
      basic: [].concat.apply([], basic.map(function (x) { return x.ok ? x.items || [] : []; })) }
  };
};

Service.prototype.region = async function (sido, gu) {
  var d = await this.regionData(sido, gu);
  return { ok: d.errors.length < 5, demo: d.demo, stale: d.stale, fetchedAt: d.fetchedAt, errors: d.errors, regions: [sido + ' ' + gu], hospitals: N.merge(d.raw) };
};

// 1) 위치 기준 가까운 응급의료기관 → 2) 그 기관들의 시도·시군구 → 3) 지역별 실시간 정보
Service.prototype.nearby = async function (lat, lon, maxRegions) {
  var self = this, max = maxRegions || 4;
  var near = await this.client.call('nearby', { WGS84_LON: lon, WGS84_LAT: lat, pageNo: 1, numOfRows: 30 });
  if (!near.ok) return { ok: false, message: near.message, code: near.code };
  var regions = [], seen = {};
  (near.items || []).forEach(function (it) { var rg = N.regionOf(it.dutyaddr); if (rg && !seen[rg.join(' ')] && regions.length < max) { seen[rg.join(' ')] = 1; regions.push(rg); } });
  var all = await Promise.all(regions.map(function (rg) { return self.regionData(rg[0], rg[1]); }));
  var raw = { list: [], beds: [], severe: [], messages: [], trauma: [], basic: [] };
  all.forEach(function (d) { Object.keys(raw).forEach(function (k) { raw[k] = raw[k].concat(d.raw[k]); }); });
  (near.items || []).forEach(function (it) { raw.list.push({ hpid: it.hpid, dutyname: it.dutyname, dutyaddr: it.dutyaddr, latitude: it.latitude, longitude: it.longitude, dutytel1: it.dutytel1 }); });
  var errors = [].concat.apply([], all.map(function (d) { return d.errors; }));
  return { ok: true, demo: all.some(function (d) { return d.demo; }) || !!near.demo, stale: all.some(function (d) { return d.stale; }), fetchedAt: Date.now(), errors: errors, regions: regions.map(function (r) { return r.join(' '); }), hospitals: N.merge(raw) };
};

module.exports = { Service: Service };
