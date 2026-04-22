const EasyshipSource = require('./sources/easyship');
const MockSource = require('./sources/mock');

function createSource(config) {
  const name = (config.DATA_SOURCE || 'mock').toLowerCase();
  switch (name) {
    case 'easyship':
      return new EasyshipSource(config);
    case 'mock':
      return new MockSource(config);
    case 'navlungo':
    case 'shipentegra':
    case 'email':
      throw new Error(`Source "${name}" not yet implemented — will be added when credentials are available`);
    default:
      throw new Error(`Unknown DATA_SOURCE: ${name}`);
  }
}

module.exports = { createSource };
