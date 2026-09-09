// @pandatix/js-cvss 0.4.4 ships ES modules without an ESM package declaration.
// Compile its pinned distribution to CommonJS at build time; do not change scoring logic.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const directory = path.dirname(require.resolve('@pandatix/js-cvss'));
for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.js'))) {
  const target = path.join(directory, file);
  const source = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018},
  }).outputText);
}
