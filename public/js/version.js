const APP_VERSION = '1.0';
document.addEventListener('DOMContentLoaded', () => {
  const el = document.querySelector('.site-footer');
  if (el) el.innerHTML = `Q&A v.${APP_VERSION} utviklet av <a href="https://www.superponni.no" target="_blank" rel="noopener">Superponni.no</a>`;
});
