const YAML = require('yaml');

function parseReleaseWorkflow(source) {
  return YAML.parse(source);
}

module.exports = { parseReleaseWorkflow };
