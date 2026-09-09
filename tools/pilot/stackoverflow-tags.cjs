// Reviewed identity mappings; never guess from a repository basename or broad topic tag.
const mappings = require('./stackoverflow-tags.json');
function stackOverflowTag(p) {
  if (p.stackOverflowTag) return p.stackOverflowTag;
  if (String(p.platform).toLowerCase() !== 'pypi') return undefined;
  return mappings.find(m => m.repository === p.repository.toLowerCase() && m.packageName === p.name)?.tag;
}
module.exports = {stackOverflowTag};
