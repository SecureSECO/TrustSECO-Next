const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sshKey, sign } = require('./client.cjs');

function validate(identity) {
  if (!identity || !/^[a-z0-9][a-z0-9-]{0,38}$/.test(identity.id) || ['governor', 'constructor', 'prototype'].includes(identity.id)) throw Error('Invalid contributor identity');
  const privateKey = crypto.createPrivateKey(identity.privateKey);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw Error('Ed25519 identity required');
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  if (publicKey !== identity.publicKey) throw Error('Identity keys do not match');
  return { id: identity.id, publicKey, privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}
function passwordKey(password, salt) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw Error('Use a recovery password of at least 12 characters');
  return crypto.scryptSync(password, salt, 32);
}
class LocalIdentity {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
    this.file = path.join(directory, 'identity.json');
    this.settingsFile = path.join(directory, 'settings.json');
  }
  read() { return fs.existsSync(this.file) ? validate(JSON.parse(fs.readFileSync(this.file, 'utf8'))) : null; }
  save(identity) { const checked = validate(identity); fs.writeFileSync(this.file, JSON.stringify(checked), { flag: 'wx', mode: 0o600 }); return this.public(); }
  create(login) {
    if (this.read()) throw Error('This node already has an identity');
    const keys = crypto.generateKeyPairSync('ed25519');
    return this.save({ id: login, publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  }
  public() {
    const identity = this.read(); if (!identity) return null;
    const key = sshKey(identity.publicKey);
    return { login: identity.id, publicKey: identity.publicKey, sshKey: key, fingerprint: 'SHA256:' + crypto.createHash('sha256').update(Buffer.from(key.split(' ')[1], 'base64')).digest('base64').replace(/=+$/, '') };
  }
  join(network) {
    const identity = this.read(); if (!identity) throw Error('Create an identity first');
    const payload = JSON.stringify({ network, login: identity.id, publicKey: identity.publicKey, expiresAt: Math.floor(Date.now() / 1000) + 43200, nonce: crypto.randomUUID() });
    return { payload, signature: sign(payload, identity.privateKey, 'TrustSECO-join-v1') };
  }
  backup(password) {
    const identity = this.read(); if (!identity) throw Error('Create an identity first');
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', passwordKey(password, salt), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(identity), 'utf8'), cipher.final()]);
    return { format: 'trustseco-identity-v1', salt: salt.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('hex') };
  }
  restore(backup, password) {
    if (this.read()) throw Error('Refusing to replace this node’s existing identity');
    if (backup?.format !== 'trustseco-identity-v1' || !/^[a-f0-9]{32}$/.test(backup.salt) || !/^[a-f0-9]{24}$/.test(backup.iv) || !/^[a-f0-9]{32}$/.test(backup.tag) || !/^(?:[a-f0-9]{2}){1,8000}$/.test(backup.ciphertext)) throw Error('Invalid encrypted recovery file');
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', passwordKey(password, Buffer.from(backup.salt, 'hex')), Buffer.from(backup.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(backup.tag, 'hex'));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(backup.ciphertext, 'hex')), decipher.final()]);
      return this.save(JSON.parse(plaintext.toString('utf8')));
    } catch { throw Error('Recovery failed: incorrect password or damaged identity file'); }
  }
  settings() { return fs.existsSync(this.settingsFile) ? JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')) : { mining: false }; }
  setMining(mining) {
    fs.writeFileSync(this.settingsFile + '.tmp', JSON.stringify({ mining }), { mode: 0o600 });
    fs.renameSync(this.settingsFile + '.tmp', this.settingsFile);
  }
}
function localRequestAllowed(configuredOrigin, host, origin, fetchSite, header) {
  const expected = new URL(configuredOrigin);
  return ['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname) && expected.protocol === 'http:' && host === expected.host && (!origin || origin === expected.origin) && fetchSite !== 'cross-site' && header === '1';
}
module.exports = { LocalIdentity, localRequestAllowed };
