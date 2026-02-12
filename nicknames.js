const adjektiv = [
  'Glad', 'Snill', 'Modig', 'Koselig', 'Liten', 'Fin', 'Søt', 'Rolig',
  'Kvikk', 'Lur', 'Rask', 'Klok', 'Varm', 'Stille', 'Lystig', 'Nett',
  'Kjekk', 'Mild', 'Frisk', 'Sprek', 'Smart', 'Hyggelig', 'Munter',
  'Flink', 'Tapper', 'Livlig', 'Blid', 'Snarrådig', 'Trygg', 'Mjuk',
];

const dyr = [
  'Pingvin', 'Kanin', 'Ugle', 'Koala', 'Panda', 'Ekorn', 'Sel', 'Otter',
  'Flamingo', 'Vaskebjørn', 'Elg', 'Rev', 'Hare', 'Mus', 'Gås', 'Svane',
  'Isbjørn', 'Rådyr', 'Lam', 'Katt', 'Hamster', 'Skilpadde', 'Delfin',
  'Sommerfugl', 'Marihøne', 'Papegøye', 'Sjiraff', 'Frosken', 'Pegasus',
  'Enhjørning',
];

function generateNickname() {
  const adj = adjektiv[Math.floor(Math.random() * adjektiv.length)];
  const animal = dyr[Math.floor(Math.random() * dyr.length)];
  return `${adj} ${animal}`;
}

module.exports = { generateNickname };
