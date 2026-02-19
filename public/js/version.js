const APP_VERSION = '1.2';
document.addEventListener('DOMContentLoaded', () => {
  const el = document.querySelector('.site-footer');
  if (!el) return;

  el.innerHTML = `Q&A v.${APP_VERSION} utviklet av <a href="https://www.superponni.no" target="_blank" rel="noopener">Superponni.no</a>`;

  // Hent antall foredrag som er opprettet totalt og vis under versjonslinja
  fetch('/api/stats')
    .then(r => r.json())
    .then(data => {
      const stat = document.createElement('span');
      stat.className = 'site-footer-stat';
      stat.textContent = `${data.totalSessions} foredrag har åpnet gulvet for spørsmål`;
      el.appendChild(stat);
    })
    .catch(() => {}); // ikke vis noe ved feil
});
