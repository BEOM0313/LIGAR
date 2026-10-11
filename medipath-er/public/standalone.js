/* 단일 HTML 전용: 데이터 연결 설정 (가상 데이터 / 공공데이터포털 직접 연결 / 메디패스 서버 경유) */
(function () {
  'use strict';
  var core = require('./core'), Service = require('./service').Service;
  var FIX = window.MP_FIXTURES || {}, CFG = 'medipath.conn', CALLS = 'medipath.calls', CACHE = 'medipath.cache.';
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var cfg = lsGet(CFG) || { mode: 'demo' };
  var key = cfg.key || ''; // 기억하지 않으면 이 탭이 열려 있는 동안만 메모리에 둔다
  var client = null;

  var CORS = '브라우저가 공공데이터포털 직접 연결을 막았습니다 (CORS 또는 네트워크 차단). ‘메디패스 서버 경유’로 바꾸거나, 이 파일을 웹서버(http://)에서 열어 다시 시도하세요.';
  function friendly(d) {
    var all = [d.message].concat(d.errors || []).filter(Boolean).join(' ');
    if (!(d.hospitals || []).length && /Failed to fetch|NetworkError|Load failed|연결할 수 없습니다/.test(all)) d.message = CORS;
    if (/SERVICE_KEY|SERVICE KEY|등록되지 않은/.test(all)) d.message = '인증키가 등록되지 않았거나 승인 대기 중입니다. 공공데이터포털 마이페이지에서 활용신청 상태와 키를 확인하세요. (발급 직후에는 1시간가량 걸릴 수 있습니다)';
    if (/LIMIT|한도/.test(all) && !(d.hospitals || []).length) d.message = '오늘 호출 한도에 도달했습니다. 내일 다시 시도하거나 가상 데이터로 체험하세요.';
    return d;
  }

  function makeSource() {
    if (cfg.mode === 'proxy') {
      var base = String(cfg.proxy || '').replace(/\/+$/, '');
      var get = function (path) {
        return fetch(base + path).then(function (r) { return r.json(); }).catch(function () { return { ok: false, message: '메디패스 서버(' + base + ')에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.' }; });
      };
      return {
        region: function (s, g) { return get('/api/region?sido=' + encodeURIComponent(s) + '&sigungu=' + encodeURIComponent(g)); },
        nearby: function (lat, lon) { return get('/api/nearby?lat=' + lat + '&lon=' + lon); },
        hnr: function (q) { return get('/api/hnr?' + Object.keys(q).filter(function (k) { return q[k] != null && q[k] !== ''; }).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&')); }
      };
    }
    client = new core.Client({
      key: cfg.mode === 'direct' ? key : '', demo: cfg.mode !== 'direct', limit: 950,
      fetchText: function (url) {
        var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = ctl && setTimeout(function () { ctl.abort(); }, 10000);
        return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) { clearTimeout(t); return r.text(); });
      },
      loadFixture: function (op) { return FIX[op] || null; },
      store: { load: function () { return lsGet(CALLS); }, save: function (v) { lsSet(CALLS, v); } },
      persist: { get: function (k) { var v = lsGet(CACHE + k); return v && Date.now() - v.at < 864e5 ? v : null; }, set: function (k, v) { lsSet(CACHE + k, v); } }
    });
    var svc = new Service(client, { basicPerRegion: 40 });
    return {
      region: function (s, g) { return svc.region(s, g).then(friendly); },
      nearby: function (lat, lon) { return svc.nearby(lat, lon, 3).then(friendly); }
    };
  }

  function usageText() {
    if (cfg.mode !== 'direct' || !client) return '';
    var u = client.usage(), max = 0; Object.keys(u.calls).forEach(function (k) { max = Math.max(max, u.calls[k]); });
    return '오늘 이 브라우저의 호출: 기능별 최대 ' + max + ' / ' + u.limit + '건';
  }

  function render() {
    var el = document.getElementById('conn'); el.hidden = false;
    var label = { demo: '가상 데이터로 체험 중', direct: '공공데이터포털 실시간 연결', proxy: '메디패스 서버 경유' }[cfg.mode];
    el.innerHTML =
      '<details' + (cfg.mode === 'demo' ? ' open' : '') + '><summary><span class="cap">데이터 연결</span> <span class="pill ' + (cfg.mode === 'demo' ? 'alt' : 'ok') + '">' + label + '</span> <span class="caption" id="conn-usage">' + esc(usageText()) + '</span></summary>' +
      '<div class="conn-modes">' +
      '<label class="chk"><input type="radio" name="cmode" value="demo"' + (cfg.mode === 'demo' ? ' checked' : '') + '> 가상 데이터 <small>실존하지 않는 병원 6곳</small></label>' +
      '<label class="chk"><input type="radio" name="cmode" value="direct"' + (cfg.mode === 'direct' ? ' checked' : '') + '> 공공데이터포털 직접 연결 <small>인증키 필요</small></label>' +
      '<label class="chk"><input type="radio" name="cmode" value="proxy"' + (cfg.mode === 'proxy' ? ' checked' : '') + '> 메디패스 서버 경유 <small>npm start로 띄운 서버</small></label>' +
      '</div>' +
      '<div class="conn-row" data-show="direct"><label>공공데이터포털 일반 인증키 (Encoding 또는 Decoding)<input type="password" id="conn-key" autocomplete="off" spellcheck="false" value="' + esc(key) + '" placeholder="data.go.kr 마이페이지 → 인증키"></label>' +
      '<label class="chk"><input type="checkbox" id="conn-remember"' + (cfg.remember ? ' checked' : '') + '> 이 브라우저에 기억</label></div>' +
      '<div class="conn-row" data-show="proxy"><label>서버 주소<input id="conn-proxy" value="' + esc(cfg.proxy || 'http://localhost:8080') + '"></label></div>' +
      '<div class="conn-row"><button class="cta" id="conn-go">연결하고 조회</button>' + (cfg.remember ? '<button class="ghost" id="conn-forget">저장된 키 지우기</button>' : '') + '</div>' +
      '<p class="caption">인증키는 파일에 들어 있지 않으며, 이 브라우저에서 공공데이터포털(apis.data.go.kr)로만 전송됩니다. 공용 PC에서는 ‘기억’을 켜지 마세요. 여러 사람이 쓰는 서비스로 공개할 때는 키가 노출되지 않도록 ‘서버 경유’ 방식을 쓰세요.</p>' +
      '</details>';
    function sync() { var m = (el.querySelector('[name=cmode]:checked') || {}).value; [].forEach.call(el.querySelectorAll('[data-show]'), function (r) { r.hidden = r.dataset.show !== m; }); }
    el.addEventListener('change', sync); sync();
    el.querySelector('#conn-go').addEventListener('click', function () {
      var m = el.querySelector('[name=cmode]:checked').value, k = el.querySelector('#conn-key').value.trim(), rem = el.querySelector('#conn-remember').checked;
      if (m === 'direct' && !k) { el.querySelector('#conn-key').focus(); return; }
      key = k; cfg = { mode: m, remember: rem, proxy: el.querySelector('#conn-proxy').value.trim() };
      if (m === 'direct' && rem) cfg.key = k;
      lsSet(CFG, cfg);
      window.MPSource = makeSource(); render(); window.MPApp.reload().then(function () {
        var u = document.getElementById('conn-usage'); if (u) u.textContent = usageText();
        if (document.querySelector('#status .pill.no')) document.querySelector('#conn details').open = true; // 실패하면 설정을 다시 펼친다
      });
    });
    var f = el.querySelector('#conn-forget');
    if (f) f.addEventListener('click', function () { key = ''; cfg = { mode: 'demo' }; lsDel(CFG); Object.keys(localStorage).forEach(function (k) { if (k.indexOf(CACHE) === 0) lsDel(k); }); window.MPSource = makeSource(); render(); window.MPApp.reload(); });
  }

  if (cfg.mode === 'direct' && !key) cfg.mode = 'demo';
  window.MPSource = makeSource();
  document.addEventListener('DOMContentLoaded', render);
  if (document.readyState !== 'loading') render();
})();
