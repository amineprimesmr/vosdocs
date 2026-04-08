/**
 * Rapport — présentation type « vehicle history » (données API branchées plus tard)
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

  function buildHeroTitle(vd) {
    var y = vd.year && String(vd.year).trim() && vd.year !== '—' ? String(vd.year) : '';
    var mk = vd.make && vd.make !== '—' ? String(vd.make) : '';
    var mo = vd.model && vd.model !== '—' ? String(vd.model) : '';
    var tr = vd.trim ? String(vd.trim) : '';
    var parts = [y, mk, mo, tr].filter(function (p) {
      return p && p.length > 0;
    });
    if (parts.length) return parts.join(' ').toUpperCase();
    return 'RAPPORT HISTORIQUE VÉHICULE';
  }

  function fillOdoDemo(tbody) {
    if (!tbody) return;
    tbody.innerHTML =
      '<tr><td>12/03/2022</td><td>38&nbsp;200 km</td></tr>' +
      '<tr><td>08/11/2023</td><td>41&nbsp;050 km</td></tr>' +
      '<tr><td>—</td><td>—</td></tr>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var commande = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
    if (!commande) {
      window.location.href = 'index.html';
      return;
    }

    var vd = commande.vehicleData || {};
    var vin = commande.vin || '';
    var reportUnlocked = commande.reportUnlocked === true;

    var vinEl = document.getElementById('previewVinDisplay');
    if (vinEl) vinEl.textContent = maskVin(vin);

    var heroTitle = document.getElementById('rptHeroTitle');
    var identityEl = document.getElementById('rpt-identity');
    if (identityEl) identityEl.classList.toggle('rpt-identity--locked', !reportUnlocked);

    if (heroTitle) {
      heroTitle.textContent = reportUnlocked ? buildHeroTitle(vd) : 'RAPPORT HISTORIQUE VÉHICULE';
    }

    var make = vd.make || '—';
    var model = vd.model || '—';
    var year = vd.year || '—';
    var trim = vd.trim || '';

    var elMake = document.getElementById('previewMake');
    var elModel = document.getElementById('previewModel');
    var elYear = document.getElementById('previewYear');
    if (elMake) elMake.textContent = reportUnlocked ? make : '••••••';
    if (elModel) elModel.textContent = reportUnlocked ? model : '••••••';
    if (elYear) elYear.textContent = reportUnlocked ? year : '••••';

    if (trim) {
      var trimRow = document.getElementById('previewTrimRow');
      var trimEl = document.getElementById('previewTrim');
      if (trimRow) trimRow.style.display = '';
      if (trimEl) trimEl.textContent = reportUnlocked ? trim : '••••••';
    }

    var eng = vd.engine || vd.engineDescription || '';
    var trans = vd.transmission || vd.drivetrain || '';
    var odo = vd.odometer || vd.odometerMiles || vd.mileage || '';
    var elE = document.getElementById('rptEngine');
    var elT = document.getElementById('rptTransmission');
    var elO = document.getElementById('rptOdometer');
    if (elE) elE.textContent = reportUnlocked ? (eng || '—') : '••••••';
    if (elT) elT.textContent = reportUnlocked ? (trans || '—') : '••••••';
    if (elO) elO.textContent = reportUnlocked ? (odo || '—') : '••••••';

    var summaryText = vd.summary || vd.description || '';
    var sumBlock = document.getElementById('previewSummaryBlock');
    if (sumBlock) {
      sumBlock.style.display = '';
      if (reportUnlocked) {
        if (summaryText) {
          sumBlock.textContent = summaryText.length > 280 ? summaryText.slice(0, 277) + '…' : summaryText;
        } else {
          sumBlock.textContent =
            'Les données constructeur détaillées (motorisation, finitions, équipements) sont disponibles dans le rapport complet après déblocage.';
        }
      } else {
        sumBlock.textContent =
          'Les données constructeur détaillées (motorisation, finitions, équipements) sont disponibles dans le rapport complet après paiement.';
        sumBlock.classList.add('rpt-summary-locked');
      }
    }

    var dateEl = document.getElementById('previewDocDate');
    if (dateEl) dateEl.textContent = formatFrDate();

    var valEl = document.getElementById('rptValueDisplay');
    if (valEl) {
      if (!reportUnlocked) {
        valEl.textContent = '••••••';
      } else if (!vd.estimatedValue || vd.estimatedValue === '—') {
        valEl.textContent = '—';
      } else {
        valEl.textContent = vd.estimatedValue;
      }
    }

    fillOdoDemo(document.getElementById('rptOdoTableBody'));

    document.querySelectorAll('.rpt-section[data-reveal]').forEach(function (el) {
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

    var ctaBar = document.getElementById('previewCtaBar');
    if (ctaBar) ctaBar.style.display = reportUnlocked ? 'none' : '';

    var btn = document.getElementById('btnUnlockFull');
    if (btn && !reportUnlocked) {
      btn.addEventListener('click', function () {
        window.location.href = 'checkout.html?plan=confort';
      });
    }
  });
})();
