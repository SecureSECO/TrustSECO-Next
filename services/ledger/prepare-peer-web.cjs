// Klayr has no public hook for custom peer RPCs. Keep this narrow SDK adapter
// idempotent and fail the build if an SDK upgrade changes its integration point.
const fs = require('fs'), path = require('path');
const file = require.resolve('klayr-framework/dist-node/engine/network/network');
const marker = '// TrustSECO optional peer web interface';
let source = fs.readFileSync(file, 'utf8');
if (!source.includes(marker)) {
  const anchor = 'this._endpoint.init({ p2p: this._p2p });';
  if (source.split(anchor).length !== 2) throw Error('Review peer-web adapter for this SDK version');
  source = source.replace(anchor, anchor + '\n        ' + marker + '\n        require("./trustseco-peer-web.cjs").install(this);');
  fs.writeFileSync(file, source);
}
fs.copyFileSync(path.join(__dirname, 'peer-web.cjs'), path.join(path.dirname(file), 'trustseco-peer-web.cjs'));
