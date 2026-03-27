/**
 * Rapport — aperçu partiel (données VIN visibles, reste flouté) → checkout
 */

(function () {
  function formatFrDate() {
    var d = new Date();
    var mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    return d.getDate() + ' ' + mois[d.getMonth()] + ' ' + d.getFullYear();
  }

  function maskVin(vin) {
    if (!vin || vin.length !== 17) return vin || '—';
    return vin.slice(0, 4) + ' ········· ·' + vin.slice(14);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var commande = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
    if (!commande) {
      window.location.href = 'index.html';
      return;
    }

    var vd = commande.vehicleData || {};
    var vin = commande.vin || '';

    var vinEl = document.getElementById('previewVinDisplay');
    if (vinEl) vinEl.textContent = maskVin(vin);

    var make = vd.make || '—';
    var model = vd.model || '—';
    var year = vd.year || '—';
    var trim = vd.trim || '';

    var elMake = document.getElementById('previewMake');
    var elModel = document.getElementById('previewModel');
    var elYear = document.getElementById('previewYear');
    if (elMake) elMake.textContent = make;
    if (elModel) elModel.textContent = model;
    if (elYear) elYear.textContent = year;

    if (trim) {
      var trimRow = document.getElementById('previewTrimRow');
      var trimEl = document.getElementById('previewTrim');
      if (trimRow) trimRow.style.display = '';
      if (trimEl) trimEl.textContent = trim;
    }

    var summaryText = vd.summary || vd.description || '';
    var sumBlock = document.getElementById('previewSummaryBlock');
    if (sumBlock) {
      sumBlock.style.display = '';
      if (summaryText) {
        sumBlock.textContent = summaryText.length > 280 ? summaryText.slice(0, 277) + '…' : summaryText;
      } else {
        sumBlock.textContent =
          'Les données constructeur détaillées (motorisation, finitions, équipements) sont disponibles dans le rapport complet après déblocage.';
      }
    }

    var dateEl = document.getElementById('previewDocDate');
    if (dateEl) dateEl.textContent = formatFrDate();

    document.querySelectorAll('.preview-section[data-reveal]').forEach(function (el) {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              e.target.classList.add('is-visible');
            }
          });
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
      );
      io.observe(el);
    });

    var btn = document.getElementById('btnUnlockFull');
    if (btn) {
      btn.addEventListener('click', function () {
        window.location.href = 'checkout.html?plan=confort';
      });
    }
  });
})();
