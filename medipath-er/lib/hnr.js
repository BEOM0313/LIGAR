'use strict';
// '지금 여기 응급실'(here-now-er-mcp) MCP 클라이언트
// 응급실까지 갈 상황이 아닐 때 문 연 병·의원, 약국, 의약품 정보를 그 서버의 도구로 받아온다.
// 저쪽 서버는 stateless Streamable HTTP이므로 initialize 없이 tools/call을 바로 보낸다.

var TOOLS = { hospitals: 'find_open_hospitals', pharmacies: 'find_open_pharmacies', drug: 'get_drug_info', pill: 'identify_pill', er: 'find_emergency_rooms' };

function Client(opts) {
  this.url = opts.url;
  this.fetch = opts.fetch || fetch;
  this.timeout = opts.timeout || 10000;
  this.seq = 0;
}

// SSE로 올 수도 있으므로 두 형식 모두 해석
function parseBody(ct, body) {
  if (/text\/event-stream/.test(ct || '')) {
    var last = null;
    body.split(/\r?\n/).forEach(function (line) { if (line.indexOf('data:') === 0) { try { last = JSON.parse(line.slice(5).trim()); } catch (e) { /* 다음 줄 */ } } });
    return last;
  }
  return JSON.parse(body);
}

Client.prototype.rpc = async function (method, params) {
  var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, this.timeout);
  try {
    var res = await this.fetch(this.url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.seq, method: method, params: params || {} })
    });
    var body = await res.text();
    if (!res.ok && !body) throw new Error('HTTP ' + res.status);
    var msg = parseBody(res.headers.get('content-type'), body);
    if (!msg) throw new Error('빈 응답');
    if (msg.error) throw new Error(msg.error.message || 'MCP 오류');
    return msg.result;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '지금 여기 응급실 서버 응답 시간 초과' : e.message);
  } finally { clearTimeout(t); }
};

Client.prototype.listTools = function () { return this.rpc('tools/list').then(function (r) { return r.tools || []; }); };

// kind: hospitals | pharmacies | drug | pill | er → { ok, text }
Client.prototype.call = async function (kind, args) {
  var name = TOOLS[kind]; if (!name) throw new Error('unknown kind ' + kind);
  var r = await this.rpc('tools/call', { name: name, arguments: args || {} });
  var text = (r.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('\n');
  return { ok: !r.isError, tool: name, text: text };
};

module.exports = { Client: Client, TOOLS: TOOLS };
