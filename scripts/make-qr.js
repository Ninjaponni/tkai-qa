// Lager fast QR-kode til https://qa.tkai.no/live for film, rollup og skjermer.
// Kjør: npm run qr  → public/qr-live.svg og public/qr-live.png (2400 px)
const path = require('path');
const QRCode = require('qrcode');

const URL = 'https://qa.tkai.no/live';
const out = name => path.join(__dirname, '..', 'public', name);
// Høy feilkorrigering (Q) tåler projektor, bevegelse og delvis tildekking bedre
const opts = { errorCorrectionLevel: 'Q', margin: 4, color: { dark: '#000000', light: '#ffffff' } };

(async () => {
  await QRCode.toFile(out('qr-live.svg'), URL, { ...opts, type: 'svg' });
  await QRCode.toFile(out('qr-live.png'), URL, { ...opts, type: 'png', width: 2400 });
  console.log(`QR-kode til ${URL} lagret i public/qr-live.svg og public/qr-live.png`);
})();
