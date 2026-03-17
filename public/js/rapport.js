/**
 * Carvinguard - Page rapport (capture email style ClarityCheck)
 * Après avoir saisi l'email, redirige vers checkout.html (page de paiement)
 */

(function() {
  function formatDate() {
    var d = new Date();
    var mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    return d.getDate() + ' ' + mois[d.getMonth()] + ' ' + d.getFullYear();
  }

  document.addEventListener('DOMContentLoaded', function() {
    var vinEl = document.getElementById('rapportVin');
    var dateEl = document.getElementById('rapportDate');
    var form = document.getElementById('rapportForm');
    var emailInput = document.getElementById('rapportEmail');

    var commande = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
    if (!commande) {
      window.location.href = 'index.html';
      return;
    }

    if (vinEl) vinEl.textContent = commande.vin || '—';
    if (dateEl) dateEl.textContent = formatDate();
    if (commande.email && emailInput) emailInput.value = commande.email;

    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        var email = emailInput ? emailInput.value.trim() : '';
        if (!email) {
          emailInput.style.borderColor = '#c62828';
          return;
        }
        var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!re.test(email)) {
          emailInput.style.borderColor = '#c62828';
          return;
        }
        emailInput.style.borderColor = '';

        if (typeof VehicleService !== 'undefined') {
          var data = Object.assign({}, commande, { email: email });
          VehicleService.saveCommandeData(data);
        }
        window.location.href = 'checkout.html';
      });
    }
  });
})();
