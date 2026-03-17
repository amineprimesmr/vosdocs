/**
 * Carvinguard - Gestion du formulaire de recherche véhicule (VIN uniquement)
 */

(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var form = document.getElementById('heroForm');
    var vinInput = document.getElementById('vinInput');
    var submitBtn = document.getElementById('submitBtn');
    var formError = document.getElementById('formError');

    if (!form) return;

    // Formatage VIN en temps réel : 17 caractères alphanumériques (sans I, O, Q)
    if (vinInput) {
      vinInput.addEventListener('input', function() {
        var v = this.value.replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '').toUpperCase();
        if (v.length > 17) v = v.slice(0, 17);
        this.value = v;
      });
    }

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var vin = vinInput ? vinInput.value.trim() : '';
      if (!vin || vin.length !== 17) {
        if (formError) {
          formError.textContent = 'Veuillez saisir un numéro VIN valide (17 caractères, ex: WBADT43452G123456)';
          formError.style.display = 'block';
        }
        return;
      }
      if (formError) formError.style.display = 'none';
      if (typeof VehicleService !== 'undefined') {
        VehicleService.saveCommandeData({
          demarche: 'Certificat de situation administrative détaillée (NON GAGE)',
          vin: vin.toUpperCase(),
          prix: 19.90
        });
      }
      window.location.href = 'resultats.html';
    });
  });
})();
