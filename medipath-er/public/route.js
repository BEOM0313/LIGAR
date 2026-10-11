/* 오픈스트리트맵 길찾기(OSRM) · 장소 검색(Photon / Nominatim) — 브라우저와 Node 공용
 * 공개 서버는 키가 필요 없지만 '초당 1건 이하, 비상업적·적정 사용' 정책이 있으므로
 * 호스트별로 요청을 1초 간격으로 줄 세우고 결과를 캐시한다. 대량 운영 시에는 자체 OSRM 서버 주소로 바꾼다. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.MPRoute = factory(); })(this, function () {
'use strict';

var DEFAULTS = {
  car: 'https://routing.openstreetmap.de/routed-car',    // FOSSGIS OSRM (차량)
  foot: 'https://routing.openstreetmap.de/routed-foot',  // FOSSGIS OSRM (도보)
  photon: 'https://photon.komoot.io',                     // 장소 검색 (한국어 검색에 유리)
  nominatim: 'https://nominatim.openstreetmap.org',       // 장소 검색 예비
  gapMs: 1100
};

function Router(opts) {
  opts = opts || {};
  this.cfg = Object.assign({}, DEFAULTS, opts);
  this.fetchJson = opts.fetchJson || function (url) { return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); };
  this.queue = {}; this.cache = new Map();
}
// 호스트별 직렬 큐: 이전 요청이 끝나고 gapMs가 지나야 다음 요청
Router.prototype.get = function (url) {
  var self = this, host = url.split('/')[2], hit = this.cache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60e3) return Promise.resolve(hit.data);
  var prev = this.queue[host] || Promise.resolve();
  var run = prev.then(function () { return self.fetchJson(url); });
  this.queue[host] = run.catch(function () {}).then(function () { return new Promise(function (r) { setTimeout(r, self.cfg.gapMs); }); });
  return run.then(function (d) { self.cache.set(url, { at: Date.now(), data: d }); return d; });
};

function ll(p) { return (+p.lon).toFixed(6) + ',' + (+p.lat).toFixed(6); }

// 출발지 1곳 → 병원 여러 곳의 이동 시간 (OSRM table 서비스 1회 호출)
// 반환: { hpid: { min, km } } · 경로가 없으면 해당 병원은 빠진다
Router.prototype.table = function (mode, origin, dests) {
  dests = dests.filter(function (d) { return d.lat != null && d.lon != null; });
  if (!dests.length) return Promise.resolve({});
  var url = this.cfg[mode] + '/table/v1/driving/' + [ll(origin)].concat(dests.map(ll)).join(';') + '?sources=0&annotations=duration,distance';
  return this.get(url).then(function (d) {
    if (d.code !== 'Ok') throw new Error('OSRM ' + d.code);
    var out = {};
    dests.forEach(function (h, i) {
      var sec = d.durations && d.durations[0] ? d.durations[0][i + 1] : null, m = d.distances && d.distances[0] ? d.distances[0][i + 1] : null;
      if (sec != null) out[h.hpid] = { min: Math.max(1, Math.round(sec / 60)), km: m != null ? Math.round(m / 100) / 10 : null };
    });
    return out;
  });
};
// 경로 선(지도 표시용)과 시간
Router.prototype.route = function (mode, origin, dest) {
  var url = this.cfg[mode] + '/route/v1/driving/' + ll(origin) + ';' + ll(dest) + '?overview=full&geometries=geojson&steps=false';
  return this.get(url).then(function (d) {
    if (d.code !== 'Ok' || !d.routes || !d.routes.length) throw new Error('OSRM ' + d.code);
    var r = d.routes[0];
    return { min: Math.max(1, Math.round(r.duration / 60)), km: Math.round(r.distance / 100) / 10, line: r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }) };
  });
};

// 장소 검색: Photon → 실패하거나 결과가 없으면 Nominatim. 자동완성 금지 정책에 따라 '검색' 버튼을 눌렀을 때만 호출한다.
Router.prototype.search = function (q, near) {
  var self = this; q = String(q || '').trim(); if (!q) return Promise.resolve([]);
  var purl = this.cfg.photon + '/api/?limit=6&q=' + encodeURIComponent(q) + (near ? '&lat=' + near.lat + '&lon=' + near.lon : '');
  return this.get(purl).then(function (d) {
    var out = (d.features || []).filter(function (f) { return !f.properties.countrycode || f.properties.countrycode === 'KR'; }).map(function (f) {
      var p = f.properties, addr = [p.state, p.city || p.county, p.district, p.street, p.housenumber].filter(Boolean).join(' ');
      return { name: p.name || addr || q, addr: addr, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], src: 'photon' };
    });
    if (out.length) return out;
    throw new Error('empty');
  }).catch(function () {
    var nurl = self.cfg.nominatim + '/search?format=jsonv2&countrycodes=kr&accept-language=ko&limit=6&q=' + encodeURIComponent(q);
    return self.get(nurl).then(function (d) {
      return (d || []).map(function (r) { var parts = String(r.display_name || '').split(', '); return { name: r.name || parts[0], addr: parts.slice(1).reverse().filter(function (s) { return !/^\d{5}$/.test(s) && s !== '대한민국'; }).join(' '), lat: +r.lat, lon: +r.lon, src: 'nominatim' }; });
    });
  });
};

// 좌표 → 주소 (119 신고 시 위치 안내용). Nominatim reverse, 결과는 캐시된다.
Router.prototype.reverse = function (lat, lon) {
  var url = this.cfg.nominatim + '/reverse?format=jsonv2&accept-language=ko&zoom=18&lat=' + (+lat).toFixed(6) + '&lon=' + (+lon).toFixed(6);
  return this.get(url).then(function (d) {
    if (!d || d.error) throw new Error((d && d.error) || '주소 없음');
    var a = d.address || {}, road = [a.road, a.house_number].filter(Boolean).join(' ');
    var parts = [a.province || a.state, a.city, a.borough || a.county || a.city_district, a.suburb || a.quarter || a.neighbourhood, road].filter(function (x, i, arr) { return x && arr.indexOf(x) === i; });
    var addr = parts.length >= 2 ? parts.join(' ') : String(d.display_name || '').split(', ').reverse().filter(function (s) { return !/^\d{5}$/.test(s) && s !== '대한민국'; }).join(' ');
    return { addr: addr, place: d.name || a.amenity || a.building || '' };
  });
};

return { Router: Router, DEFAULTS: DEFAULTS };
});
