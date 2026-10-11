'use strict';
// Node용 클라이언트: core.Client에 fetch와 파일 기반 가상 데이터를 연결한다
var fs = require('fs'), path = require('path');
var core = require('./core');

function Client(opts) {
  var dir = opts.fixtures || path.join(__dirname, '..', 'fixtures');
  core.Client.call(this, Object.assign({
    limit: process.env.DAILY_LIMIT || 950,
    fetchText: async function (url) {
      var res = await fetch(url, { headers: { Accept: 'application/xml' }, signal: AbortSignal.timeout(8000) });
      return res.text();
    },
    loadFixture: function (op) { var f = path.join(dir, op + '.xml'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; }
  }, opts));
}
Client.prototype = Object.create(core.Client.prototype);
Client.prototype.constructor = Client;
module.exports = { Client: Client, OPS: core.OPS };
