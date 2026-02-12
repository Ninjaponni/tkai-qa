const Filter = require('bad-words');

const filter = new Filter();

// Norske stygge ord
const norskeOrd = [
  'faen', 'helvete', 'jævla', 'jævel', 'dritt', 'drittunge',
  'hore', 'hora', 'fitte', 'pikk', 'kuk', 'kukk',
  'rævhull', 'rævhøl', 'ræva', 'tull', 'idiot',
  'dust', 'tosk', 'fæansen', 'satan', 'satansen',
  'hestkuk', 'føkkings', 'soper',
];

filter.addWords(...norskeOrd);

function isProfane(text) {
  return filter.isProfane(text);
}

function clean(text) {
  return filter.clean(text);
}

module.exports = { isProfane, clean };
