/* 메디패스 응급실 연결 · 화면 */
(function () {
  'use strict';
  var L = window.MPLogic;
  var SIDO = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도', '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도'];
  var S = { hospitals: [], origin: null, demo: false, fetchedAt: null, regions: [], pub: null, last: {}, routes: { key: null },
    calls: {}, needOv: {}, tops: {}, notice: {}, gen: 0, addr: {}, lastReq: null, loadedAt: 0 };
  var RT = window.MPRoute ? new window.MPRoute.Router(window.MP_ROUTE_CFG || {}) : null; // 오픈스트리트맵 길찾기 · 검색
  var critical = false; // 지금 그리는 매칭이 시간 민감한 상황인지 (그러면 도보 안내를 하지 않는다)

  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return [].slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tel(n) { return String(n || '').replace(/[^\d+]/g, ''); }
  function fmtTime(t) { var d = new Date(t); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }

  /* ── 데이터 ── */
  // 데이터 출처: 기본은 같은 서버의 /api, 단일 HTML에서는 window.MPSource(직접 호출 · 서버 경유)로 바뀐다
  var serverSource = {
    region: function (sido, gu) { return fetch('/api/region?sido=' + encodeURIComponent(sido) + '&sigungu=' + encodeURIComponent(gu)).then(function (r) { return r.json(); }); },
    nearby: function (lat, lon) { return fetch('/api/nearby?lat=' + lat + '&lon=' + lon).then(function (r) { return r.json(); }); },
    // '지금 여기 응급실' MCP (문 연 병·의원 · 약국 · 의약품) — 서버가 대신 호출한다
    hnr: function (q) { return fetch('/api/hnr?' + Object.keys(q).filter(function (k) { return q[k] != null && q[k] !== ''; }).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&')).then(function (r) { return r.json(); }); }
  };
  function source() { return window.MPSource || serverSource; }
  function load(req, note) {
    S.lastReq = req; S.loading = true;
    $('#status').textContent = '불러오는 중…';
    var src = source(), p = req.kind === 'nearby' ? src.nearby(req.lat, req.lon) : src.region(req.sido, req.gu);
    return Promise.resolve(p).then(function (d) {
      if (!d.ok && !(d.hospitals || []).length) throw new Error(d.message || (d.errors || []).join(', ') || '조회 실패');
      apply(d); $('#where-note').textContent = note || '';
    }).catch(function (e) { $('#status').innerHTML = '<span class="pill no">오류</span> ' + esc(e.message); })
      .then(function () { S.loading = false; });
  }
  function regionReq() { return { kind: 'region', sido: $('#sido').value, gu: $('#sigungu').value.trim() }; }
  function apply(d) {
    S.last = {}; S.gen++; S.loadedAt = Date.now(); S.hospitals = d.hospitals || []; S.demo = !!d.demo; S.fetchedAt = d.fetchedAt || Date.now(); S.regions = d.regions || [];
    if (d.origin) S.origin = d.origin;
    var warn = (d.errors || []).length ? ' · 일부 항목 조회 실패 ' + d.errors.length + '건' : '';
    $('#status').innerHTML = (S.demo ? '<span class="pill alt">테스트 데이터</span> ' : '<span class="pill ok">실시간</span> ') +
      '병원 ' + S.hospitals.length + '곳 · ' + esc(S.regions.join(', ')) + ' · ' + fmtTime(S.fetchedAt) + ' 기준 · ' + refreshMin() + '분마다 자동 갱신' + (d.stale ? ' · <b>캐시된 이전 자료</b>' : '') + esc(warn);
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
      var cls = r ? (r.i === 0 ? 'mk best' : 'mk ok') : x ? 'mk ex' : 'mk c-' + crowdOf(h);
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
    S.origin = { lat: +o.lat, lon: +o.lon };
    return load({ kind: 'nearby', lat: S.origin.lat, lon: S.origin.lon }, note);
  }

  /* ── 자동 갱신 · 추천 변경 알림 (매칭 화면의 '현황 변화'를 실제 갱신으로) ── */
  function refreshMin() { return window.MPSource && window.MPSource.direct ? 5 : 2; } // 브라우저 직접 호출은 한도 때문에 더 느리게
  function autoRefresh() {
    setInterval(function () {
      if (document.hidden || !S.lastReq || S.loading || Date.now() - S.loadedAt < refreshMin() * 60e3) return;
      load(S.lastReq, $('#where-note').textContent);
    }, 30e3);
  }
  function trackTop(tab, ctx, m) {
    var top = m.ranked[0], prev = S.tops[tab];
    if (S.notice[tab] && S.notice[tab].ctx !== ctx) delete S.notice[tab];
    if (prev && prev.ctx === ctx && prev.gen !== S.gen && top && prev.hpid !== top.h.hpid) {
      var old = m.ranked.concat(m.excluded).filter(function (r) { return r.h.hpid === prev.hpid; })[0];
      var why = !old ? '조회 목록에서 빠짐' : !old.eligible ? old.missing.map(function (c) { return c.label; }).join(', ') + ' 불가로 바뀜' : (old.notes.join(', ') || '다른 병원의 도착 시간·병상 여건이 더 나아짐');
      S.notice[tab] = { at: Date.now(), from: prev.name, to: top.h.name, why: why, ctx: ctx };
    }
    if (top) S.tops[tab] = { hpid: top.h.hpid, name: top.h.name, ctx: ctx, gen: S.gen };
  }
  function noticeHtml(tab) {
    var n = S.notice[tab]; if (!n) return '';
    return '<div class="card notice"><b>' + fmtTime(n.at) + ' 현황 갱신으로 추천 병원이 바뀌었습니다</b><div>' + esc(n.from) + ' → <b>' + esc(n.to) + '</b></div><small>' + esc(n.from) + ': ' + esc(n.why) + '</small><button class="linkbtn" data-dismiss="' + tab + '">닫기</button></div>';
  }

  /* ── 연락 결과 기록 (연결 화면의 '동시 요청 · 회신'을 실제 전화 확인 기록으로) ── */
  function callSt(id) { var c = S.calls[id]; return c && Date.now() - c.at < 30 * 60e3 ? c : null; } // 30분 유효
  function applyCalls(m) {
    var dec = [], acc = [], rest = [];
    m.ranked.forEach(function (r) {
      var c = callSt(r.h.hpid);
      if (c && c.st === 'no') { r.eligible = false; r.missing = [{ label: '전화 확인(' + fmtTime(c.at) + ') 결과 수용' }]; dec.push(r); }
      else if (c && c.st === 'yes') acc.push(r); else rest.push(r);
    });
    m.ranked = acc.concat(rest); m.excluded = dec.concat(m.excluded);
    return m;
  }
  function callRec(r) {
    var c = callSt(r.h.hpid);
    return '<div class="callrec"><span class="label">전화 확인</span>' +
      '<button class="ghost sm' + (c && c.st === 'yes' ? ' on-ok' : '') + '" data-call="' + r.h.hpid + '" data-st="yes">수용 가능</button>' +
      '<button class="ghost sm' + (c && c.st === 'no' ? ' on-no' : '') + '" data-call="' + r.h.hpid + '" data-st="no">수용 불가</button>' +
      (c ? '<span class="caption">' + fmtTime(c.at) + ' 기록 · 30분 유효</span>' : '') + '</div>';
  }

  /* ── 필요 자원 조정 (매칭 화면의 자원 편집) ── */
  function ovKey(tab, p) { return tab + ':' + p.condition + ':' + (p.age != null && p.age < 15 ? 'child' : 'adult'); }
  function withOverrides(base, k) {
    var ov = S.needOv[k] || {}, list = base.map(function (n) { return Object.assign({}, n); });
    Object.keys(ov).forEach(function (key) {
      var n = list.filter(function (x) { return x.key === key; })[0];
      if (n) n.level = ov[key]; else list.push({ key: key, level: ov[key], why: '직접 추가' });
    });
    return list;
  }
  function needEditor(needs, k) {
    var have = {}; needs.forEach(function (n) { have[n.key] = 1; });
    var LV = { must: '필수', pref: '선호', off: '제외' };
    return '<div class="cells">' + needs.map(function (n) { return '<button class="need ' + n.level + '" data-need="' + n.key + '" data-ov="' + k + '" data-lv="' + n.level + '" title="' + esc((n.why ? n.why + ' · ' : '') + '누르면 필수 → 선호 → 제외') + '">' + esc(L.RES[n.key].label) + ' <small>' + LV[n.level] + '</small></button>'; }).join('') +
      '<select class="need-add" data-ov="' + k + '" aria-label="자원 추가"><option value="">+ 자원 추가</option>' + Object.keys(L.RES).filter(function (x) { return !have[x]; }).map(function (x) { return '<option value="' + x + '">' + esc(L.RES[x].label) + '</option>'; }).join('') + '</select>' +
      (S.needOv[k] && Object.keys(S.needOv[k]).length ? '<button class="linkbtn" data-ovreset="' + k + '">기본값으로</button>' : '') + '</div>';
  }

  /* ── 병원별 대조표 · 전원 비교 타임라인 (매칭 화면) ── */
  function mark(c) { return c.ok === true ? '<span class="y">✓</span>' : c.ok === false ? '<span class="' + (c.level === 'must' ? 'n-must' : 'n') + '">✕</span>' : '<span class="u">?</span>'; }
  function compareTable(m, needs) {
    var rows = m.ranked.slice(0, 6).concat(m.excluded.slice(0, 4)); if (!rows.length) return '';
    var head = '<tr><th>병원</th><th>도착</th><th>응급실</th>' + needs.map(function (n) { return '<th>' + esc(L.RES[n.key].label) + (n.level === 'must' ? '' : '<small>선호</small>') + '</th>'; }).join('') + '<th>판정</th></tr>';
    var body = rows.map(function (r, i) {
      var er = r.h.beds && r.h.beds.er || {};
      var verdict = !r.eligible ? '<span class="pill no">제외</span>' : i === 0 ? '<span class="pill ok">추천</span>' : r.unknown.length ? '<span class="pill alt">확인 필요</span>' : '<span class="pill off">가능</span>';
      return '<tr class="' + (r.eligible ? '' : 'ex') + '"><td><b>' + esc(r.h.name) + '</b></td><td class="num">' + (r.eta != null ? r.eta + '분' + (r.etaSrc === 'route' ? '' : '*') : '-') + '</td><td>' + bedTxt(er) + '</td>' + r.cells.map(function (c) { return '<td>' + mark(c) + '</td>'; }).join('') + '<td>' + verdict + '</td></tr>';
    }).join('');
    return '<details class="card cmp" open><summary><span class="cap">병원별 대조</span> <span class="caption">✓ 가능 · ✕ 불가 · ? 정보 없음 · * 직선거리 추정</span></summary><div class="tablewrap"><table class="board">' + '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></details>';
  }
  function timeline(m) {
    var c = m.compare; if (!c || !c.transferTotal || !m.ranked[0]) return '';
    var tr = Math.max(1, c.transferTotal - c.nearest.eta - 40), tot = c.transferTotal;
    function seg(cls, min, label) { return '<i class="' + cls + '" style="flex:' + Math.max(min, 1) + '" title="' + label + ' ' + min + '분">' + label + ' ' + min + '</i>'; }
    return '<div class="card compare"><div class="cap">가장 가까운 응급실로 먼저 갔다면</div><p class="caption">가장 가까운 <b>' + esc(c.nearest.h.name) + '</b>은 <b>' + esc(c.reasons.join(', ')) + '</b> 불가로 표시되어 있어 전원될 가능성이 큽니다 (평가 30분 · 전원 준비 10분 가정).</p>' +
      '<div class="tl"><div class="tl-row"><span class="tl-name">' + esc(c.nearest.h.name) + ' 경유</span><div class="tl-track"><div class="tl-bar">' + seg('go', c.nearest.eta, '이동') + seg('eval', 30, '평가') + seg('prep', 10, '준비') + seg('go', tr, '전원') + '</div></div><b class="num">' + tot + '분</b></div>' +
      '<div class="tl-row"><span class="tl-name">' + esc(m.ranked[0].h.name) + ' 직행</span><div class="tl-track"><div class="tl-bar" style="width:' + Math.max(6, Math.round(c.direct / tot * 100)) + '%">' + seg('go best', c.direct, '이동') + '</div></div><b class="num">' + c.direct + '분</b></div></div></div>';
  }

  /* ── 119 신고 도우미 (연결 화면의 '119에 이렇게 말하세요') ── */
  var SAY = { arrest: '사람이 쓰러졌는데 반응이 없고 숨을 제대로 쉬지 않습니다.', stroke: '갑자기 한쪽 얼굴과 팔에 힘이 빠지고 말이 어눌해졌습니다.', chest: '가슴을 조이는 듯한 통증을 호소합니다.', allergy: '심한 알레르기 반응으로 숨쉬기 힘들어합니다.', trauma: '사고로 크게 다쳤습니다.', bleeding: '피가 많이 나고 멈추지 않습니다.', burn: '화상을 크게 입었습니다.', child_abd: '아이가 배를 심하게 아파합니다.', seizure: '경련을 하고 있습니다.', choking: '목에 무엇이 걸려 숨을 못 쉽니다.' };
  function call119Card(s) {
    var o = S.origin, k = okey(o), a = o ? S.addr[k] : null;
    if (o && !a && RT && S.addrPending !== k) {
      S.addrPending = k;
      RT.reverse(o.lat, o.lon).then(function (r) { S.addr[k] = r; }).catch(function () { S.addr[k] = { err: true }; }).then(function () { S.addrPending = null; if (S.pub) renderPublic(); });
    }
    var where = !o ? '<i>현재 위치를 켜거나 출발지를 검색하면 주소를 띄워 드립니다.</i> 모르면 주변 건물 이름·큰 간판·전봇대 번호를 말하세요.' :
      a && a.addr ? '<b>' + esc(a.addr) + '</b>' + (a.place ? ' (' + esc(a.place) + ')' : '') : a && a.err ? '주소를 찾지 못했습니다. 주변 건물 이름이나 큰 간판을 말하세요.' : '주소 확인 중…';
    var age = S.pub.age != null ? ' 환자는 ' + S.pub.age + '세입니다.' : '';
    return '<div class="card call119"><div class="cap">119에 이렇게 말하세요</div><ol class="script">' +
      '<li><span class="label">어디</span>여기는 ' + where + (o ? ' <small class="num">(' + o.lat.toFixed(5) + ', ' + o.lon.toFixed(5) + ')</small>' : '') + '</li>' +
      '<li><span class="label">무슨 일</span>' + esc(SAY[S.pub.key] || s.title) + esc(age) + '</li>' +
      (S.pub.key === 'stroke' ? '<li><span class="label">언제</span>증상이 시작된(마지막으로 정상이던) 시각은 ___시 ___분입니다.</li>' : '') +
      '<li><span class="label">그다음</span>전화를 먼저 끊지 말고 스피커폰으로 바꿔 상황요원 안내를 따르세요.</li></ol></div>';
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
      '<div class="pills">' + (callSt(h.hpid) && callSt(h.hpid).st === 'yes' ? '<span class="pill ok">전화로 수용 확인됨</span>' : '') + crowdPill(r) + (r.walkOk && !critical ? '<span class="pill ok">걸어가도 비슷해요 · 도보 ' + r.foot.min + '분</span>' : '') + (r.stale ? '<span class="pill alt">' + (r.ageMin == null ? '갱신시각 없음' : r.ageMin + '분 전 정보') + '</span>' : '<span class="pill off">' + r.ageMin + '분 전 갱신</span>') + '</div>' +
      '<div class="cells">' + r.cells.map(cell).join('') + '</div>';
    if (r.blocking.length || r.notes.length) html += '<ul class="notes">' + r.blocking.map(function (m) { return '<li class="msg">병원 메시지: ' + esc(m.text) + '</li>'; }).join('') + r.notes.filter(function (n) { return n.indexOf('병원 메시지') !== 0; }).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
    if (!first && call) html += '<div class="actions"><a class="ghost" href="tel:' + tel(call) + '">응급실 전화 ' + esc(call) + '</a></div>';
    html += callRec(r);
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
    var tab = el.closest('.tab'), tid = tab ? tab.id : 'x', ok = ovKey(tid, p);
    var all = withOverrides(L.needsFor(p), ok), needs = all.filter(function (n) { return n.level !== 'off'; });
    var m = applyCalls(L.match(S.hospitals, needs, S.origin, opts));
    if (tab) { S.last[tid] = m; if (tid === visibleTab()) drawMap(m); }
    trackTop(tid, JSON.stringify([p, S.needOv[ok] || null]), m);
    var html = noticeHtml(tid) + '<div class="card"><div class="cap">필요한 병원 자원</div>' + needEditor(all, ok) +
      '<p class="caption">필수 자원이 ‘불가’인 병원은 제외하고, 도착 시간 · 응급실 혼잡 · 병원 메시지 · 정보 신선도를 함께 따져 순위를 매깁니다.' +
      (opts.routes && Object.keys(opts.routes.car || {}).length ? ' 도착 시간은 오픈스트리트맵 도로 기준입니다.' : S.origin ? ' 도착 시간은 직선거리 추정치입니다.' : '') + '</p></div>';
    html += timeline(m);
    if (!m.ranked.length) html += '<div class="card"><p><b>조건을 모두 갖춘 병원이 이 지역에 없습니다.</b> 인접 지역을 조회하거나 119 구급상황관리센터에 병원 선정을 요청하세요.</p></div>';
    m.ranked.slice(0, 4).forEach(function (r, i) { html += hospitalCard(r, i === 0, p, grade); });
    html += compareTable(m, needs);
    if (m.excluded.length) html += '<details class="card excl"><summary>제외된 병원 ' + m.excluded.length + '곳</summary><ul>' + m.excluded.map(function (r) { return '<li><b>' + esc(r.h.name) + '</b>' + (r.eta != null ? ' · ' + r.eta + '분' + (r.etaSrc === 'route' ? '' : '(추정)') : '') + ' — ' + esc(r.missing.map(function (c) { return c.label; }).join(', ')) + ' 불가' + (callSt(r.h.hpid) ? ' <button class="linkbtn" data-call="' + r.h.hpid + '" data-st="' + callSt(r.h.hpid).st + '">기록 취소</button>' : '') + '</li>'; }).join('') + '</ul></details>';
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
    if (now) html += call119Card(s);
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
  function crowdOf(h) { var er = h.beds && h.beds.er || {}; return er.avail == null ? 'unk' : er.avail <= 0 ? 'full' : (er.total && er.avail / er.total < 0.2) || er.avail <= 2 ? 'busy' : 'ok'; }
  function renderBoard() {
    var now = Date.now(), q = ($('#board-q') && $('#board-q').value || '').replace(/\s/g, ''), sort = $('#board-sort') ? $('#board-sort').value : 'beds';
    var rows = S.hospitals.filter(function (h) { return !q || String(h.name).replace(/\s/g, '').indexOf(q) >= 0; });
    var key = { beds: function (h) { return -(h.beds.er && h.beds.er.avail != null ? h.beds.er.avail : -99); }, near: function (h) { return S.origin && h.lat != null ? L.haversine(S.origin, h) : 1e9; }, fresh: function (h) { var t = L.parseTime(h.updated); return t ? -t : 0; } }[sort];
    rows.sort(function (a, b) { return key(a) - key(b); });
    var head = '<thead><tr><th>병원</th><th>응급실</th><th>소아</th><th>음압격리</th><th>수술실</th><th>중환자</th><th>CT</th><th>MRI</th><th>혈관촬영</th><th>심근경색</th><th>뇌경색</th><th>복부수술</th><th>영유아 장중첩</th><th>메시지</th><th>갱신</th></tr></thead>';
    var body = rows.map(function (h) {
      var t = L.parseTime(h.updated), age = t ? Math.round((now - t) / 60000) : null, f = h.severe.flags || {};
      return '<tr><td><b><i class="dot ' + crowdOf(h) + '"></i>' + esc(h.name) + '</b><small>' + esc(h.type || '') + (h.trauma ? ' · 외상센터' : '') + '</small></td><td>' + bedTxt(h.beds.er) + '</td><td>' + bedTxt(h.beds.peds) + '</td><td>' + bedTxt(h.beds.isoNeg) + '</td><td>' + bedTxt(h.beds.or) + '</td><td>' + bedTxt(h.beds.icuGeneral) + '</td>' +
        '<td>' + yn(h.equip.ct) + '</td><td>' + yn(h.equip.mri) + '</td><td>' + yn(h.equip.angio) + '</td><td>' + yn(f[1]) + '</td><td>' + yn(f[2]) + '</td><td>' + yn(f[9]) + '</td><td>' + yn(f[10]) + '</td>' +
        '<td class="m">' + h.messages.map(function (m) { return esc(m.text); }).join('<br>') + '</td><td class="' + (age == null || age > 30 ? 'stale' : '') + '">' + (age == null ? '-' : age + '분 전') + '</td></tr>';
    }).join('');
    $('#board').innerHTML = head + '<tbody>' + body + '</tbody>';
    $('#board-note').textContent = '병원 ' + rows.length + '곳 · 점 색: 초록 여유 · 주황 혼잡 · 빨강 포화 · 회색 정보 없음. ● 가능 · – 불가 · ? 정보 없음. 병상은 가용/기준. 30분 넘게 갱신되지 않은 곳은 갱신 칸 강조.';
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
    // 연락 결과 · 자원 조정 · 알림 닫기 (일반인 · 119 공통)
    function rerender() { renderPublic(); renderEms(); }
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-call]');
      if (b) { var cur = callSt(b.dataset.call); if (cur && cur.st === b.dataset.st) delete S.calls[b.dataset.call]; else S.calls[b.dataset.call] = { st: b.dataset.st, at: Date.now() }; return rerender(); }
      b = e.target.closest('[data-need]');
      if (b) { var nx = { must: 'pref', pref: 'off', off: 'must' }[b.dataset.lv]; (S.needOv[b.dataset.ov] = S.needOv[b.dataset.ov] || {})[b.dataset.need] = nx; return rerender(); }
      b = e.target.closest('[data-ovreset]'); if (b) { delete S.needOv[b.dataset.ovreset]; return rerender(); }
      b = e.target.closest('[data-dismiss]'); if (b) { delete S.notice[b.dataset.dismiss]; return rerender(); }
    });
    document.addEventListener('change', function (e) {
      var sel = e.target.closest('.need-add'); if (!sel || !sel.value) return;
      (S.needOv[sel.dataset.ov] = S.needOv[sel.dataset.ov] || {})[sel.value] = 'must'; rerender();
    });
    if ($('#board-q')) { $('#board-q').addEventListener('input', renderBoard); $('#board-sort').addEventListener('change', renderBoard); }
    autoRefresh();
    document.addEventListener('click', function (e) { var c = e.target.closest('.copy'); if (!c) return; navigator.clipboard && navigator.clipboard.writeText(c.dataset.copy).then(function () { c.textContent = '복사됨'; }); });
    $('#btn-region').addEventListener('click', function () { S.origin = null; load(regionReq()); });
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
    geo(true);
  }
  function geo(initial) {
    if (!navigator.geolocation) return load(regionReq());
    navigator.geolocation.getCurrentPosition(function (pos) {
      S.origin = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      load({ kind: 'nearby', lat: S.origin.lat, lon: S.origin.lon }, '현재 위치 기준 (정확도 약 ' + Math.round(pos.coords.accuracy) + 'm)');
    }, function () {
      load(regionReq(), initial === true ? '' : '위치 권한이 없어 지역으로 조회합니다.');
    }, { timeout: 8000, maximumAge: 60000 });
  }
  window.MPApp = { reload: function () { return S.origin ? load({ kind: 'nearby', lat: S.origin.lat, lon: S.origin.lon }) : load(regionReq()); }, geo: geo };
  init();
})();
