/* 메디패스 응급실 연결 · 화면 */
(function () {
  'use strict';
  var L = window.MPLogic;
  var SIDO = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도', '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도'];
  var DEMO_ORIGIN = { lat: 37.4979, lon: 127.0276 };
  var STATIC = window.MEDIPATH_DATA || null; // 서버 없이 미리보기할 때 주입되는 가상 데이터
  var S = { hospitals: [], origin: null, demo: false, fetchedAt: null, regions: [], pub: null, last: {}, routes: { key: null } };
  var RT = window.MPRoute ? new window.MPRoute.Router(window.MP_ROUTE_CFG || {}) : null; // 오픈스트리트맵 길찾기 · 검색
  var critical = false; // 지금 그리는 매칭이 시간 민감한 상황인지 (그러면 도보 안내를 하지 않는다)

  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return [].slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tel(n) { return String(n || '').replace(/[^\d+]/g, ''); }
  function fmtTime(t) { var d = new Date(t); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }

  /* ── 데이터 ── */
  // 데이터 출처: 기본은 같은 서버의 /api, 단일 HTML에서는 window.MPSource(직접 호출·프록시·가상)로 바뀐다
  var serverSource = {
    region: function (sido, gu) { return fetch('/api/region?sido=' + encodeURIComponent(sido) + '&sigungu=' + encodeURIComponent(gu)).then(function (r) { return r.json(); }); },
    nearby: function (lat, lon) { return fetch('/api/nearby?lat=' + lat + '&lon=' + lon).then(function (r) { return r.json(); }); },
    // '지금 여기 응급실' MCP (문 연 병·의원 · 약국 · 의약품) — 서버가 대신 호출한다
    hnr: function (q) { return fetch('/api/hnr?' + Object.keys(q).filter(function (k) { return q[k] != null && q[k] !== ''; }).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&')).then(function (r) { return r.json(); }); }
  };
  function source() { return window.MPSource || serverSource; }
  function load(req, note) {
    $('#status').textContent = '불러오는 중…';
    if (STATIC) return Promise.resolve(STATIC).then(apply);
    var src = source(), p = req.kind === 'nearby' ? src.nearby(req.lat, req.lon) : src.region(req.sido, req.gu);
    return Promise.resolve(p).then(function (d) {
      if (!d.ok && !(d.hospitals || []).length) throw new Error(d.message || (d.errors || []).join(', ') || '조회 실패');
      apply(d); $('#where-note').textContent = note || '';
    }).catch(function (e) { $('#status').innerHTML = '<span class="pill no">오류</span> ' + esc(e.message); });
  }
  function regionReq() { return { kind: 'region', sido: $('#sido').value, gu: $('#sigungu').value.trim() }; }
  function apply(d) {
    S.last = {}; S.hospitals = d.hospitals || []; S.demo = !!d.demo; S.fetchedAt = d.fetchedAt || Date.now(); S.regions = d.regions || [];
    if (d.origin) S.origin = d.origin;
    if (!S.origin && S.demo) { S.origin = DEMO_ORIGIN; S.originDemo = true; }
    if (S.originDemo && !S.demo) { S.origin = null; S.originDemo = false; }
    var warn = (d.errors || []).length ? ' · 일부 항목 조회 실패 ' + d.errors.length + '건' : '';
    $('#status').innerHTML = (S.demo ? '<span class="pill alt">가상 데이터 (DEMO)</span> ' : '<span class="pill ok">실시간</span> ') +
      '병원 ' + S.hospitals.length + '곳 · ' + esc(S.regions.join(', ')) + ' · ' + fmtTime(S.fetchedAt) + ' 기준' + (d.stale ? ' · <b>캐시된 이전 자료</b>' : '') + esc(warn);
    if (!S.origin) $('#where-note').textContent = '현재 위치를 쓰면 도착 예상 시간으로 순위를 매깁니다. 지역 조회만으로는 거리 계산을 하지 않습니다.';
    renderBoard(); renderPublic(); renderEms(); routeNote();
    if (!S.last[visibleTab()]) drawMap(null);
  }

  /* ── 길찾기 (OSRM): 출발지에서 가까운 병원 25곳의 차량·도보 시간을 표(table) 한 번씩으로 받는다 ── */
  function okey(o) { return o ? (+o.lat).toFixed(5) + ',' + (+o.lon).toFixed(5) : null; }
  function routesFor() { return S.routes.key && S.routes.key === okey(S.origin) ? S.routes : null; }
  function ensureRoutes() {
    if (!RT || !S.origin || !S.hospitals.length) return routeNote();
    var k = okey(S.origin);
    if (S.routes.key !== k) S.routes = { key: k, car: {}, foot: {}, tried: {}, pending: false, err: null };
    var R = S.routes;
    if (R.pending) return;
    var cand = S.hospitals.filter(function (h) { return h.lat != null && !R.tried[h.hpid]; })
      .sort(function (a, b) { return L.haversine(S.origin, a) - L.haversine(S.origin, b); }).slice(0, 25);
    if (!cand.length) return routeNote();
    cand.forEach(function (h) { R.tried[h.hpid] = 1; });
    R.pending = true; routeNote();
    Promise.all([RT.table('car', S.origin, cand), RT.table('foot', S.origin, cand).catch(function (e) { R.footErr = e.message; return {}; })])
      .then(function (x) { Object.assign(R.car, x[0]); Object.assign(R.foot, x[1]); R.err = null; })
      .catch(function (e) { R.err = e.message; })
      .then(function () { R.pending = false; if (S.routes === R) { renderPublic(); renderEms(); } routeNote(); });
  }
  function routeNote() {
    var el = $('#route-note'); if (!el) return;
    var R = routesFor();
    el.textContent = !RT ? '' : !S.origin ? '출발지를 정하면(현재 위치 · 검색 · 지도 클릭) 도로 기준 차량·도보 시간을 계산합니다.' :
      R && R.pending ? '길찾기 계산 중… (오픈스트리트맵 OSRM)' :
      R && R.err ? '길찾기 서버에 연결하지 못해 직선거리로 추정합니다 (' + R.err + ')' :
      R && Object.keys(R.car).length ? '도착 시간: 오픈스트리트맵 도로 기준 (OSRM) · 실시간 교통 미반영 · 지도를 누르면 출발지가 바뀝니다' : '';
  }

  /* ── 지도 (Leaflet + 오픈스트리트맵 타일) ── */
  var MAP = null, LAY = null;
  function initMap() {
    var LF = window.L, cfg = window.MP_ROUTE_CFG || {};
    if (!LF || !$('#map')) { var b = $('.mapbox'); if (b) b.classList.add('nomap'); return; }
    MAP = LF.map('map', { scrollWheelZoom: false }).setView([37.5665, 126.978], 12);
    LF.tileLayer(cfg.tiles || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자 · 길찾기 OSRM' }).addTo(MAP);
    LAY = LF.layerGroup().addTo(MAP);
    MAP.on('click', function (e) { setOrigin({ lat: e.latlng.lat, lon: e.latlng.lng }, '지도에서 고른 위치 기준'); });
  }
  function drawMap(m) {
    if (!MAP) return;
    var LF = window.L, pts = [], rank = {}, ex = {};
    LAY.clearLayers();
    if (m) { m.ranked.forEach(function (r, i) { rank[r.h.hpid] = r; r.i = i; }); m.excluded.forEach(function (r) { ex[r.h.hpid] = r; }); }
    S.hospitals.forEach(function (h) {
      if (h.lat == null) return;
      var r = rank[h.hpid], x = ex[h.hpid];
      var cls = r ? (r.i === 0 ? 'mk best' : 'mk ok') : x ? 'mk ex' : 'mk';
      var icon = LF.divIcon({ className: 'mkwrap', html: '<span class="' + cls + '">' + (r && r.i < 9 ? r.i + 1 : x ? '✕' : '') + '</span>', iconSize: [28, 28], iconAnchor: [14, 14] });
      var row = r || x, pop = '<b>' + esc(h.name) + '</b>' + (row && row.eta != null ? '<br>차량 ' + row.eta + '분' + (row.foot ? ' · 도보 ' + row.foot.min + '분' : '') : '') + (x ? '<br>제외: ' + esc(x.missing.map(function (c) { return c.label; }).join(', ')) : '');
      LF.marker([h.lat, h.lon], { icon: icon, title: h.name, zIndexOffset: r && r.i === 0 ? 1000 : 0 }).bindPopup(pop).addTo(LAY);
      pts.push([h.lat, h.lon]);
    });
    if (S.origin) { LF.circleMarker([S.origin.lat, S.origin.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#2563EB', fillOpacity: 1 }).bindTooltip('출발지').addTo(LAY); pts.push([S.origin.lat, S.origin.lon]); }
    var fk = okey(S.origin) + '|' + S.hospitals.length;
    if (pts.length && S.fitKey !== fk) { S.fitKey = fk; MAP.fitBounds(pts, { padding: [30, 30], maxZoom: 15 }); }
    var best = m && m.ranked[0];
    if (best && S.origin && RT && best.h.lat != null) {
      var key = okey(S.origin) + '>' + best.h.hpid; S.lineKey = key;
      RT.route('car', S.origin, best.h).then(function (rt) { if (S.lineKey === key) LF.polyline(rt.line, { color: '#111827', weight: 5, opacity: 0.8 }).addTo(LAY); }).catch(function () { /* 선 없이 표시 */ });
    }
  }
  function visibleTab() { var t = $$('.tab').filter(function (x) { return !x.hidden; })[0]; return t ? t.id : null; }
  function setOrigin(o, note) {
    S.origin = { lat: +o.lat, lon: +o.lon }; S.originDemo = false;
    return load({ kind: 'nearby', lat: S.origin.lat, lon: S.origin.lon }, note);
  }

  /* ── 매칭 결과 카드 ── */
  function cell(c) {
    var cls = c.ok === true ? 'ok' : c.ok === false ? (c.level === 'must' ? 'no' : 'off') : 'unk';
    var mark = c.ok === true ? '✓' : c.ok === false ? '✕' : '?';
    return '<span class="ck ' + cls + '" title="' + esc(c.why || '') + '">' + mark + ' ' + esc(c.label) + (c.level === 'must' ? '' : ' <small>선호</small>') + '</span>';
  }
  function crowdPill(r) {
    var er = r.h.beds && r.h.beds.er || {};
    var t = er.avail == null ? '병상 정보 없음' : '응급실 ' + er.avail + (er.total ? '/' + er.total : '');
    var c = { ok: 'ok', busy: 'alt', full: 'no', unknown: 'off' }[r.crowd];
    return '<span class="pill ' + c + '">' + esc(t) + '</span>';
  }
  function etaHtml(r) {
    if (r.eta == null) return '<span>위치 미지정</span>';
    var km = r.km != null ? r.km.toFixed(1) + 'km' : '';
    return '<b class="num">' + r.eta + '<small>분</small></b><span>' + (r.etaSrc === 'route' ? '차량 · 도로 ' + km : '추정 · 직선 ' + km) + '</span>' +
      (r.foot && !critical ? '<span>도보 ' + r.foot.min + '분</span>' : '');
  }
  function hospitalCard(r, first, p, grade) {
    var h = r.h, call = h.erTel || h.tel;
    var html = '<article class="hosp' + (first ? ' first' : '') + '">' +
      '<div class="hhead"><div>' + (first ? '<span class="tagline">추천</span>' : '') + '<h3>' + esc(h.name) + '</h3><div class="caption">' + esc([h.type, h.trauma ? '권역외상센터' : '', h.addr].filter(Boolean).join(' · ')) + '</div></div>' +
      '<div class="eta">' + etaHtml(r) + '</div></div>' +
      '<div class="pills">' + crowdPill(r) + (r.walkOk && !critical ? '<span class="pill ok">걸어가도 비슷해요 · 도보 ' + r.foot.min + '분</span>' : '') + (r.stale ? '<span class="pill alt">' + (r.ageMin == null ? '갱신시각 없음' : r.ageMin + '분 전 정보') + '</span>' : '<span class="pill off">' + r.ageMin + '분 전 갱신</span>') + '</div>' +
      '<div class="cells">' + r.cells.map(cell).join('') + '</div>';
    if (r.blocking.length || r.notes.length) html += '<ul class="notes">' + r.blocking.map(function (m) { return '<li class="msg">병원 메시지: ' + esc(m.text) + '</li>'; }).join('') + r.notes.filter(function (n) { return n.indexOf('병원 메시지') !== 0; }).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
    if (first) {
      html += '<div class="actions">' + (call ? '<a class="cta" href="tel:' + tel(call) + '">응급실 전화 ' + esc(call) + '</a>' : '') +
        (h.lat != null ? '<a class="ghost" target="_blank" rel="noopener" href="https://map.kakao.com/link/to/' + encodeURIComponent(h.name) + ',' + h.lat + ',' + h.lon + '">카카오맵 길안내</a>' : '') +
        (h.lat != null && S.origin ? '<a class="ghost" target="_blank" rel="noopener" href="https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=' + S.origin.lat + '%2C' + S.origin.lon + '%3B' + h.lat + '%2C' + h.lon + '">OSM 경로</a>' : '') + '</div>';
      if (p) {
        var txt = L.preNotify(p, r, grade);
        html += '<details class="pre" open><summary>사전 연락 문구 (전화 전 확인용)</summary><pre>' + esc(txt) + '</pre><button class="ghost copy" data-copy="' + esc(txt) + '">복사</button></details>';
      }
    }
    return html + '</article>';
  }
  function renderMatch(el, p, opts, grade) {
    if (!S.hospitals.length) { el.innerHTML = '<div class="card"><p class="caption">병원 정보를 먼저 조회하세요.</p></div>'; return; }
    ensureRoutes();
    opts = Object.assign({ routes: routesFor() }, opts); critical = !!opts.timeCritical;
    var needs = L.needsFor(p), m = L.match(S.hospitals, needs, S.origin, opts);
    var tab = el.closest('.tab'); if (tab) { S.last[tab.id] = m; if (tab.id === visibleTab()) drawMap(m); }
    var html = '<div class="card"><div class="cap">필요한 병원 자원</div><div class="cells">' + needs.map(function (n) { return '<span class="need ' + n.level + '" title="' + esc(n.why) + '">' + esc(L.RES[n.key].label) + ' <small>' + (n.level === 'must' ? '필수' : '선호') + '</small></span>'; }).join('') + '</div>' +
      '<p class="caption">필수 자원이 ‘불가’인 병원은 제외하고, 도착 시간 · 응급실 혼잡 · 병원 메시지 · 정보 신선도를 함께 따져 순위를 매깁니다.' +
      (opts.routes && Object.keys(opts.routes.car || {}).length ? ' 도착 시간은 오픈스트리트맵 도로 기준입니다.' : S.origin ? ' 도착 시간은 직선거리 추정치입니다.' : '') + '</p></div>';
    if (m.compare && m.compare.transferTotal) {
      html += '<div class="card compare"><b>가장 가까운 ' + esc(m.compare.nearest.h.name) + '</b>(' + m.compare.nearest.eta + '분)은 <b>' + esc(m.compare.reasons.join(', ')) + '</b> 불가로 표시되어 있습니다. 그곳에 갔다가 전원되면 약 <b class="num">' + m.compare.transferTotal + '분</b>, 추천 병원 직행은 약 <b class="num">' + m.compare.direct + '분</b>입니다 (평가 30분 · 전원 준비 10분 가정).</div>';
    }
    if (!m.ranked.length) html += '<div class="card"><p><b>조건을 모두 갖춘 병원이 이 지역에 없습니다.</b> 인접 지역을 조회하거나 119 구급상황관리센터에 병원 선정을 요청하세요.</p></div>';
    m.ranked.slice(0, 4).forEach(function (r, i) { html += hospitalCard(r, i === 0, p, grade); });
    if (m.excluded.length) html += '<details class="card excl"><summary>제외된 병원 ' + m.excluded.length + '곳</summary><ul>' + m.excluded.map(function (r) { return '<li><b>' + esc(r.h.name) + '</b>' + (r.eta != null ? ' · ' + r.eta + '분' + (r.etaSrc === 'route' ? '' : '(추정)') : '') + ' — ' + esc(r.missing.map(function (c) { return c.label; }).join(', ')) + ' 불가</li>'; }).join('') + '</ul></details>';
    el.innerHTML = html;
  }

  /* ── 일반인 ── */
  function renderSituations() {
    $('#sit').innerHTML = Object.keys(L.PUBLIC).map(function (k) { var s = L.PUBLIC[k]; return '<button class="case" data-sit="' + k + '" aria-pressed="false">' + esc(s.title) + (s.call === 'now' ? '<small>즉시 119</small>' : '') + '</button>'; }).join('');
    $('#sit').addEventListener('click', function (e) { var b = e.target.closest('[data-sit]'); if (!b) return; S.pub = { key: b.dataset.sit, flags: {}, age: S.pub && S.pub.age }; S.hnrOut = null; $$('#sit .case').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); renderPublic(); });
  }
  function renderPublic() {
    var out = $('#pub-out'); if (!S.pub) { out.innerHTML = ''; return; }
    var s = L.PUBLIC[S.pub.key], flagged = Object.keys(S.pub.flags).some(function (k) { return S.pub.flags[k]; });
    var now = s.call === 'now' || flagged;
    var html = '<div class="card ' + (now ? 'alarm' : 'go') + '">';
    if (now) html += '<div class="decide"><div><div class="big">지금 119에 전화하세요</div><p>' + (s.call === 'now' ? '이 상황은 시간이 생명입니다. 직접 운전해서 가지 마세요. 구급대가 치료 가능한 병원을 정해 이송합니다.' : '경고 증상이 있습니다. 119 구급대 이송이 안전합니다.') + '</p></div><a class="call" href="tel:119">119</a></div>';
    else html += '<div class="decide"><div><div class="big">응급실 진료가 필요할 수 있어요</div><p>아래 경고 증상이 하나라도 있으면 119에 전화하세요. 없다면 아래 추천 응급실로 가세요.</p></div></div>';
    if (s.redflags && s.redflags.length) html += '<div class="label">경고 증상 확인</div><div class="chks">' + s.redflags.map(function (f, i) { return '<label class="chk"><input type="checkbox" data-flag="' + i + '"' + (S.pub.flags[i] ? ' checked' : '') + '> ' + esc(f) + '</label>'; }).join('') + '</div>';
    html += '<div class="label">지금 할 일</div><ol class="steps">' + s.steps.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>';
    if (s.dont && s.dont.length) html += '<div class="label">하지 마세요</div><ul class="dont">' + s.dont.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    html += '<p class="caption">근거: ' + s.refs.map(function (r) { return '<a target="_blank" rel="noopener" href="' + esc(L.REFS[r].u) + '">' + esc(L.REFS[r].t) + '</a>'; }).join(' · ') + '</p>';
    html += '<label class="age">환자 나이 <input type="number" id="pub-age" min="0" max="120" value="' + esc(S.pub.age == null ? '' : S.pub.age) + '" inputmode="numeric"> 세</label></div>';
    if (!now) html += hnrCard();
    html += '<div class="sub">' + (now ? '<div class="cap">참고: 이 상황을 받을 수 있는 근처 응급실</div><p class="caption">병원 선정은 구급대가 합니다. 아래는 보호자 참고용입니다.</p>' : '<div class="cap">갈 수 있는 응급실</div>') + '</div><div id="pub-match"></div>';
    out.innerHTML = html;
    var p = { condition: s.condition, age: S.pub.age };
    if (s.condition === 'bleeding' && S.pub.flags[1]) p.amputation = true;
    if (s.condition === 'burn' && flagged) p.severeBurn = true;
    renderMatch($('#pub-match'), p, { timeCritical: now });
  }

  /* ── 지금 여기 응급실 (here-now-er MCP) 연동 ── */
  function hnrRegion() {
    var r = (S.regions[0] || '').split(' ');
    return r.length >= 2 ? { sido: r[0], sigungu: r[1] } : { sido: $('#sido').value, sigungu: $('#sigungu').value.trim() };
  }
  function hnrCard() {
    var child = S.pub && S.pub.age != null && S.pub.age < 15, rg = hnrRegion();
    return '<div class="card hnr"><div class="cap">응급실까지는 아니라면</div><p class="caption">경고 증상이 없으면 지금 문 연 병·의원이나 약국도 방법입니다. ' + esc(rg.sido + ' ' + rg.sigungu) + ' 기준 · ‘지금 여기 응급실’ MCP 연동</p>' +
      '<div class="actions"><button class="ghost" data-hnr="hospitals"' + (child ? ' data-dept="소아청소년과"' : '') + '>지금 진료 중인 ' + (child ? '소아청소년과' : '병·의원') + '</button><button class="ghost" data-hnr="pharmacies">지금 문 연 약국</button></div>' +
      '<form class="search-row hnr-drug"><label>집에 있는 약 확인 (e약은요)<input name="drug" placeholder="예: 타이레놀"></label><button class="ghost" type="submit">찾기</button></form>' +
      (S.hnrOut ? '<pre class="hnr-out' + (S.hnrOut.ok ? '' : ' err') + '">' + esc(S.hnrOut.text) + '</pre>' : '<pre class="hnr-out" hidden></pre>') + '</div>';
  }
  function hnrRun(q, out) {
    var src = source();
    out.hidden = false;
    if (!src.hnr) { out.textContent = '이 연결 방식에서는 쓸 수 없습니다. ‘메디패스 서버 경유’로 연결하면 지금 여기 응급실의 병원·약국·의약품 정보를 함께 볼 수 있습니다.'; return; }
    out.textContent = '지금 여기 응급실에 묻는 중…';
    function show(text, ok) { S.hnrOut = { text: text, ok: ok }; var o = $('#pub-out .hnr-out') || out; o.hidden = false; o.textContent = text; o.classList.toggle('err', !ok); }
    Promise.resolve(src.hnr(q)).then(function (d) { show(d.text || d.message || '결과가 없습니다', !!d.ok); })
      .catch(function (e) { show('지금 여기 응급실 서버에 연결할 수 없습니다: ' + e.message, false); });
  }

  /* ── 119 ── */
  function formData() {
    var f = $('#ems-form'), p = { injury: {}, mechanism: {}, race: {} };
    $$('input, select', f).forEach(function (el) {
      var v = el.type === 'checkbox' ? el.checked : el.value, n = el.name; if (!n) return;
      if (n.indexOf('inj.') === 0) p.injury[n.slice(4)] = v; else if (n.indexOf('mech.') === 0) p.mechanism[n.slice(5)] = v; else if (n.indexOf('race.') === 0) p.race[n.slice(5)] = v; else p[n] = v;
    });
    ['age', 'sbp', 'dbp', 'hr', 'rr', 'spo2', 'temp', 'gcs', 'gcsMotor', 'pain', 'lkwMin'].forEach(function (k) { p[k] = p[k] === '' ? null : +p[k]; });
    if (p.noPulse) p.condition = 'arrest';
    p.raceTotal = L.race(p.race).total;
    if (p.lkwMin != null) p.lkwText = p.lkwMin >= 60 ? Math.floor(p.lkwMin / 60) + '시간 ' + (p.lkwMin % 60) + '분 전' : p.lkwMin + '분 전';
    if (p.amputation || p.injury.amputation) p.amputation = true;
    p.fieldTriage = L.fieldTriage(p);
    return p;
  }
  function renderEms() {
    var p = formData();
    $$('#ems-form fieldset').forEach(function (fs) { fs.hidden = fs.dataset.for.split(' ').indexOf(p.condition) < 0; });
    var g = L.refGrade(p), ft = p.fieldTriage;
    var html = '<div class="card"><div class="gradebox g' + g.grade + '"><div><span class="label">참고 등급 (비공식 · KTAS 아님)</span><b>' + g.grade + '</b></div><ul>' + g.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
    if (ft.level !== 'none') html += '<div class="ft ' + ft.level + '"><b>2021 현장 외상 분류: ' + (ft.level === 'red' ? 'Red → 최상위 외상센터' : 'Yellow → 외상센터 권고') + '</b><div>' + ft.red.concat(ft.yellow).map(esc).join(' · ') + '</div></div>';
    if (p.condition === 'stroke') html += '<div class="ft ' + (p.raceTotal >= 5 ? 'red' : 'yellow') + '"><b>RACE ' + p.raceTotal + '점</b> ' + (p.raceTotal >= 5 ? '대혈관폐색 의심 → 혈전제거술 가능 병원' : '대혈관폐색 가능성 낮음 → 정맥 혈전용해 가능 병원') + '</div>';
    html += '</div><div id="ems-match"></div>';
    $('#ems-out').innerHTML = html;
    renderMatch($('#ems-match'), p, { timeCritical: g.grade <= 2 }, g);
  }

  /* ── 현황판 ── */
  function yn(v) { return v === true ? '<span class="y">●</span>' : v === false ? '<span class="n">–</span>' : '<span class="u">?</span>'; }
  function bedTxt(b) { if (!b || b.avail == null) return '<span class="u">-</span>'; return '<span class="num ' + (b.avail <= 0 ? 'neg' : '') + '">' + b.avail + (b.total ? '<small>/' + b.total + '</small>' : '') + '</span>'; }
  function renderBoard() {
    var rows = S.hospitals.slice().sort(function (a, b) { return (b.beds.er && b.beds.er.avail || -99) - (a.beds.er && a.beds.er.avail || -99); });
    var now = Date.now();
    var head = '<thead><tr><th>병원</th><th>응급실</th><th>소아</th><th>음압격리</th><th>수술실</th><th>중환자</th><th>CT</th><th>MRI</th><th>혈관촬영</th><th>심근경색</th><th>뇌경색</th><th>복부수술</th><th>영유아 장중첩</th><th>메시지</th><th>갱신</th></tr></thead>';
    var body = rows.map(function (h) {
      var t = L.parseTime(h.updated), age = t ? Math.round((now - t) / 60000) : null, f = h.severe.flags || {};
      return '<tr><td><b>' + esc(h.name) + '</b><small>' + esc(h.type || '') + (h.trauma ? ' · 외상센터' : '') + '</small></td><td>' + bedTxt(h.beds.er) + '</td><td>' + bedTxt(h.beds.peds) + '</td><td>' + bedTxt(h.beds.isoNeg) + '</td><td>' + bedTxt(h.beds.or) + '</td><td>' + bedTxt(h.beds.icuGeneral) + '</td>' +
        '<td>' + yn(h.equip.ct) + '</td><td>' + yn(h.equip.mri) + '</td><td>' + yn(h.equip.angio) + '</td><td>' + yn(f[1]) + '</td><td>' + yn(f[2]) + '</td><td>' + yn(f[9]) + '</td><td>' + yn(f[10]) + '</td>' +
        '<td class="m">' + h.messages.map(function (m) { return esc(m.text); }).join('<br>') + '</td><td class="' + (age == null || age > 30 ? 'stale' : '') + '">' + (age == null ? '-' : age + '분 전') + '</td></tr>';
    }).join('');
    $('#board').innerHTML = head + '<tbody>' + body + '</tbody>';
    $('#board-note').textContent = '● 가능 · – 불가 · ? 정보 없음. 병상은 가용/기준 병상. 30분 넘게 갱신되지 않은 병원은 갱신 칸이 강조됩니다.';
  }

  function renderRefs() { $('#refs').innerHTML = Object.keys(L.REFS).map(function (k) { return '<li><a target="_blank" rel="noopener" href="' + esc(L.REFS[k].u) + '">' + esc(L.REFS[k].t) + '</a></li>'; }).join(''); }

  /* ── 초기화 ── */
  function init() {
    $('#sido').innerHTML = SIDO.map(function (s) { return '<option>' + s + '</option>'; }).join('');
    $('#sigungu').value = '강남구';
    $('#cond').innerHTML = Object.keys(L.CONDITIONS).map(function (k) { return '<option value="' + k + '">' + esc(L.CONDITIONS[k]) + '</option>'; }).join('');
    $('#cond').value = 'other';
    renderSituations(); renderRefs();
    $$('.tabs [role=tab]').forEach(function (b) { b.addEventListener('click', function () { $$('.tabs [role=tab]').forEach(function (x) { x.setAttribute('aria-selected', x === b); }); $$('.tab').forEach(function (t) { t.hidden = t.id !== 'tab-' + b.dataset.tab; }); drawMap(S.last['tab-' + b.dataset.tab] || null); }); });
    $('#ems-form').addEventListener('input', renderEms); $('#ems-form').addEventListener('change', renderEms);
    $('#pub-out').addEventListener('change', function (e) {
      if (e.target.dataset.flag != null) { S.pub.flags[e.target.dataset.flag] = e.target.checked; renderPublic(); }
      if (e.target.id === 'pub-age') { S.pub.age = e.target.value === '' ? null : +e.target.value; renderPublic(); }
    });
    $('#pub-out').addEventListener('click', function (e) {
      var b = e.target.closest('[data-hnr]'); if (!b) return;
      hnrRun(Object.assign({ kind: b.dataset.hnr, department: b.dataset.dept }, hnrRegion()), $('#pub-out .hnr-out'));
    });
    $('#pub-out').addEventListener('submit', function (e) {
      if (!e.target.classList.contains('hnr-drug')) return; e.preventDefault();
      var v = e.target.drug.value.trim(); if (v) hnrRun({ kind: 'drug', drugName: v }, $('#pub-out .hnr-out'));
    });
    document.addEventListener('click', function (e) { var c = e.target.closest('.copy'); if (!c) return; navigator.clipboard && navigator.clipboard.writeText(c.dataset.copy).then(function () { c.textContent = '복사됨'; }); });
    $('#btn-region').addEventListener('click', function () { S.origin = S.demo ? S.origin : null; load(regionReq()); });
    $('#btn-geo').addEventListener('click', geo);
    initMap();
    $('#search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('#search-q').value, ul = $('#search-res');
      if (!RT || !q.trim()) return;
      ul.hidden = false; ul.innerHTML = '<li class="caption">검색 중…</li>';
      RT.search(q, S.origin).then(function (rs) {
        ul.innerHTML = rs.length ? rs.map(function (r, i) { return '<li><button type="button" class="res" data-i="' + i + '"><b>' + esc(r.name) + '</b><small>' + esc(r.addr) + '</small></button></li>'; }).join('') : '<li class="caption">검색 결과가 없습니다. 다른 이름이나 도로명 주소로 찾아보세요.</li>';
        ul.onclick = function (ev) { var b = ev.target.closest('.res'); if (!b) return; var r = rs[+b.dataset.i]; ul.hidden = true; $('#search-q').value = r.name; setOrigin(r, r.name + ' 기준'); };
      }).catch(function (err) { ul.innerHTML = '<li class="caption">검색 서버에 연결할 수 없습니다 (' + esc(err.message) + ')</li>'; });
    });
    if (STATIC) return load();
    geo(true);
  }
  function geo(initial) {
    if (!navigator.geolocation) return load(regionReq());
    navigator.geolocation.getCurrentPosition(function (pos) {
      S.origin = { lat: pos.coords.latitude, lon: pos.coords.longitude }; S.originDemo = false;
      load({ kind: 'nearby', lat: S.origin.lat, lon: S.origin.lon }, '현재 위치 기준 (정확도 약 ' + Math.round(pos.coords.accuracy) + 'm)');
    }, function () {
      load(regionReq(), initial === true ? '' : '위치 권한이 없어 지역으로 조회합니다.');
    }, { timeout: 8000, maximumAge: 60000 });
  }
  window.MPApp = { reload: function () { if (S.originDemo) { S.origin = null; S.originDemo = false; } return S.origin ? load({ kind: 'nearby', lat: S.origin.lat, lon: S.origin.lon }) : load(regionReq()); }, geo: geo };
  init();
})();
