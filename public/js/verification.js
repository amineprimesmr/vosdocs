/**
 * Carvinguard - Page de vérification longue (style image : barre de progression + liste découverte)
 * Animation : progress bar, spinners → checkmarks, puis redirection vers rapport.html
 */

(function() {
  var PROGRESS_DURATION = 20000;
  var ITEM_INTERVAL = 3200;
  var REDIRECT_DELAY = 2800;

  function initPage() {
    var card = document.getElementById('verification-card');
    var vinEl = document.getElementById('verificationVin');
    var progressFill = document.getElementById('verificationProgressFill');
    var progressPct = document.getElementById('verificationProgressPct');
    var listEl = document.getElementById('verificationSearchList');
    var redirectEl = document.getElementById('verificationRedirect');

    if (!card || !listEl) return;

    var commande = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
    var isDemo = window.location.search.indexOf('demo=1') !== -1;
    if (!commande && !isDemo) {
      window.location.href = 'index.html';
      return;
    }

    var vin = (commande && commande.vin) ? commande.vin : 'WBADT43452G123456';
    if (vinEl) vinEl.textContent = vin;
    var descEl = document.getElementById('verificationVehicleDesc');
    if (descEl && commande && commande.vehicleData) {
      var vd = commande.vehicleData;
      var desc =
        vd.description ||
        vd.summary ||
        [vd.year, vd.make, vd.model].filter(Boolean).join(' ');
      if (desc) descEl.textContent = desc;
    }

    card.classList.add('verification-card-visible');

    runProgressBar(progressFill, progressPct);
    runItemsAnimation(listEl);
    showRedirectAndGo(redirectEl, isDemo);
  }

  function runProgressBar(fillEl, pctEl) {
    if (!fillEl) return;
    var start = Date.now();
    function tick() {
      var elapsed = Date.now() - start;
      var pct = Math.min(100, (elapsed / PROGRESS_DURATION) * 100);
      fillEl.style.width = pct + '%';
      if (pctEl) pctEl.textContent = Math.round(pct) + ' %';
      if (pct < 100) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function runItemsAnimation(listEl) {
    var items = listEl ? listEl.querySelectorAll('.verification-search-item') : [];
    items.forEach(function(item, i) {
      setTimeout(function() {
        item.classList.add('verification-search-item-done');
      }, 600 + i * ITEM_INTERVAL);
    });
  }

  function showRedirectAndGo(redirectEl, isDemo) {
    var totalTime = 600 + 5 * ITEM_INTERVAL + REDIRECT_DELAY;
    setTimeout(function() {
      if (redirectEl) {
        redirectEl.setAttribute('aria-hidden', 'false');
        redirectEl.classList.add('verification-redirect-visible');
      }
    }, totalTime - 1800);
    setTimeout(function() {
      if (isDemo && typeof VehicleService !== 'undefined') {
        VehicleService.saveCommandeData({
          demarche: 'Rapport historique véhicule (VIN)',
          vin: 'WBADT43452G123456',
          prix: 19.90
        });
      }
      window.location.href = 'rapport.html';
    }, totalTime);
  }

  document.addEventListener('DOMContentLoaded', initPage);
})();
