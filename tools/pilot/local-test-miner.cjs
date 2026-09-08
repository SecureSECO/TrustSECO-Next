// Explicit local fixtures only: separate signing identities share this Mac and API credentials.
const fs = require('node:fs');
const {mineOnce} = require('./client.cjs');
const [url, identityFile, credentialsFile] = process.argv.slice(2);
if (url !== 'http://localhost:3000') throw Error('Local fixture endpoint required');
const identity = JSON.parse(fs.readFileSync(identityFile));
if (!/^test-[a-f]$/.test(identity.id)) throw Error('Explicit local fixture identity required');
(async () => {
  for (;;) {
    try {
      const response = await fetch(url + '/api/pilot/snapshot');
      if (!response.ok) throw Error('Local ledger unavailable');
      const state = await response.json();
      if (state.testNetwork !== true) throw Error('Local test network required');
      const credentials = fs.existsSync(credentialsFile) ? JSON.parse(fs.readFileSync(credentialsFile)) : {};
      if (await mineOnce(url, identityFile, credentials)) console.log(identity.id + ': signed event recorded');
    } catch (error) { console.error(error.message); }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
})().catch(error => { console.error(error.message); process.exit(1); });
