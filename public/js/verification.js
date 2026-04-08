/**
 * Carvinguard — Page vérification : progression + liste (délais courts, bouton passer).
 * Respecte prefers-reduced-motion pour limiter les animations.
 */

(function() {
  var timeouts = [];
  var skipped = false;
  var reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function timings() {
    if (reduceMotion) {
      return {
        initialDelay: 0,
        itemInterval: 0,
        redirectDelay: 250,
        progressDuration: 350
      };
    }
    return {
      initialDelay: 140,
      itemInterval: 480,
      redirectDelay: 420,
      progressDuration: 0
    };
  }

  function clearAllTimeouts() {
    timeouts.forEach(function(id) {
      clearTimeout(id);
    });
    timeouts.length = 0;
  }

  function schedule(fn, delay) {
    var id = setTimeout(function() {
      if (skipped) return;
      fn();
    }, delay);
    timeouts.push(id);
    return id;
  }

  function goToReport(isDemo) {
    skipped = true;
    clearAllTimeouts();
    if (isDemo && typeof VehicleService !== 'undefined') {
      VehicleService.saveCommandeData({
        demarche: 'Rapport historique véhicule (VIN)',
        vin: 'WBADT43452G123456',
        prix: 19.9
      });
    }
    window.location.href = 'rapport.html';
  }

  function initPage() {
    var card = document.getElementById('verification-card');
    var vinEl = document.getElementById('verificationVin');
    var progressFill = document.getElementById('verificationProgressFill');
    var progressPct = document.getElementById('verificationProgressPct');
    var listEl = document.getElementById('verificationSearchList');
    var redirectEl = document.getElementById('verificationRedirect');
    var skipBtn = document.getElementById('verificationSkipBtn');

    if (!card || !listEl) return;

    var commande = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
    var isDemo = window.location.search.indexOf('demo=1') !== -1;
    if (!commande && !isDemo) {
      window.location.href = 'index.html';
      return;
    }

    var t = timings();
    var items = listEl.querySelectorAll('.verification-search-item');
    var n = items.length;
    var lastItemAt = t.initialDelay + Math.max(0, n - 1) * t.itemInterval;
    var progressDuration =
      t.progressDuration > 0 ? t.progressDuration : lastItemAt + 320;
    var redirectShowAt = lastItemAt + 90;
    var totalTime = lastItemAt + t.redirectDelay + 320;

    var vin = commande && commande.vin ? commande.vin : 'WBADT43452G123456';
    if (vinEl) vinEl.textContent = vin;

    var descEl = document.getElementById('verificationVehicleDesc');
    var unlocked = commande && commande.reportUnlocked === true;
    if (descEl && commande && commande.vehicleData) {
      var vd = commande.vehicleData;
      if (unlocked) {
        var desc =
          vd.vehicleDesc ||
          vd.description ||
          vd.summary ||
          [vd.year, vd.make, vd.model].filter(Boolean).join(' ');
        if (desc) {
          descEl.textContent = desc;
          descEl.hidden = false;
        }
      } else {
        descEl.textContent = 'Véhicule identifié — détails complets après paiement sécurisé.';
        descEl.hidden = false;
        descEl.classList.add('verification-vehicle-desc--locked');
      }
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', function() {
        goToReport(isDemo);
      });
    }

    card.classList.add('verification-card-visible');

    if (reduceMotion) {
      for (var r = 0; r < items.length; r++) {
        items[r].classList.add('verification-search-item-done');
      }
      if (progressFill) progressFill.style.width = '100%';
      if (progressPct) progressPct.textContent = '100 %';
      schedule(function() {
        if (redirectEl) {
          redirectEl.setAttribute('aria-hidden', 'false');
          redirectEl.classList.add('verification-redirect-visible');
        }
      }, 120);
      schedule(function() {
        goToReport(isDemo);
      }, t.redirectDelay + 120);
      return;
    }

    runProgressBar(progressFill, progressPct, progressDuration);
    runItemsAnimation(listEl, t.initialDelay, t.itemInterval);
    showRedirectAndGo(redirectEl, isDemo, redirectShowAt, totalTime);
  }

  function runProgressBar(fillEl, pctEl, durationMs) {
    if (!fillEl || durationMs <= 0) return;
    var start = Date.now();
    function tick() {
      if (skipped) return;
      var elapsed = Date.now() - start;
      var pct = Math.min(100, (elapsed / durationMs) * 100);
      fillEl.style.width = pct + '%';
      if (pctEl) pctEl.textContent = Math.round(pct) + ' %';
      if (pct < 100) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function runItemsAnimation(listEl, initialDelay, itemInterval) {
    var items = listEl ? listEl.querySelectorAll('.verification-search-item') : [];
    items.forEach(function(item, i) {
      schedule(function() {
        item.classList.add('verification-search-item-done');
      }, initialDelay + i * itemInterval);
    });
  }

  function showRedirectAndGo(redirectEl, isDemo, redirectShowAt, totalTime) {
    schedule(function() {
      if (redirectEl) {
        redirectEl.setAttribute('aria-hidden', 'false');
        redirectEl.classList.add('verification-redirect-visible');
      }
    }, redirectShowAt);
    schedule(function() {
      goToReport(isDemo);
    }, totalTime);
  }

  document.addEventListener('DOMContentLoaded', initPage);
})();
