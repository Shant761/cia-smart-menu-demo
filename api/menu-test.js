const menu = require('./menu');

module.exports = async function handler(req, res) {
  return menu(req, res);
};
