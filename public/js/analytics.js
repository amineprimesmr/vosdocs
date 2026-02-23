/**
 * Google Analytics 4 - VosDocs
 * Remplace G-XXXXXXXXXX par ton ID de mesure GA4 (ex. G-A1B2C3D4E5)
 * dans ce fichier uniquement, puis déploie le site.
 */
(function () {
  var GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';
  if (!GA_MEASUREMENT_ID || GA_MEASUREMENT_ID === 'G-XXXXXXXXXX') return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID, { send_page_view: true });

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
  document.head.appendChild(s);
})();
