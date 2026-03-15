/**
 * Carvinguard - Page résultats (animation de réassurance + redirection auto)
 * Affiche les infos de vérification (330M, 1000 sources, 45 pays) sans fausses données véhicule
 */

(function() {
  function animateVerifBlock() {
    var block = document.getElementById('resultatsVerifBlock');
    var iconCar = document.getElementById('resultatsIconCar');
    var immatBadge = document.getElementById('resultatsImmatBadge');
    var verifTitle = document.getElementById('resultatsVerifTitle');
    var items = document.querySelectorAll('.resultats-verif-item');
    if (!block) return;

    var delays = [0, 1100, 2000, 3000, 4100, 5300, 6600];
    block.classList.add('resultats-verif-visible');
    if (iconCar) {
      setTimeout(function() {
        iconCar.setAttribute('aria-hidden', 'false');
        iconCar.classList.add('resultats-icon-visible');
      }, delays[0]);
    }
    if (immatBadge) {
      setTimeout(function() {
        immatBadge.classList.add('resultats-immat-visible');
      }, delays[1]);
    }
    if (verifTitle) {
      setTimeout(function() {
        verifTitle.classList.add('resultats-verif-title-visible');
      }, delays[2]);
    }
    items.forEach(function(item, i) {
      setTimeout(function() {
        item.classList.add('resultats-verif-item-visible');
      }, delays[3 + i] || 1500 + i * 200);
    });

    return Math.max.apply(null, delays) + (items.length * 550) + 900;
  }

  function switchTitle() {
    var loading = document.getElementById('resultatsTitleLoading');
    var done = document.getElementById('resultatsTitleDone');
    if (loading) loading.classList.add('resultats-title-fade-out');
    if (done) {
      done.setAttribute('aria-hidden', 'false');
      done.classList.add('resultats-title-fade-in');
    }
  }

  function showRedirectMsg() {
    var msg = document.getElementById('resultatsRedirectMsg');
    if (msg) {
      msg.setAttribute('aria-hidden', 'false');
      msg.classList.add('resultats-redirect-visible');
    }
  }

  function redirectToRecap() {
    window.location.href = 'verification.html';
  }

  document.addEventListener('DOMContentLoaded', function() {
    var card = document.getElementById('resultats-card');
    var immatEl = document.getElementById('resultatsImmatValue');

    if (!card) return;

    var commande = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
    if (!commande) {
      window.location.href = 'index.html';
      return;
    }

    if (immatEl && commande.immatriculation) {
      immatEl.textContent = commande.immatriculation;
    }

    card.classList.add('resultats-card-visible');

    setTimeout(switchTitle, 600);

    var animDuration = animateVerifBlock();

    setTimeout(showRedirectMsg, animDuration - 1000);

    setTimeout(redirectToRecap, animDuration + 1800);
  });
})();
