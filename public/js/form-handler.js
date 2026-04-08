/**
 * Carvinguard - Gestion du formulaire de recherche véhicule (VIN uniquement)
 * Décodage VIN via /api/vin-decode (proxy serveur : CarAPI.dev ou Vehicle Databases)
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
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Recherche...'; }

      var apiBase = window.location.origin;
      // preview=1 : décodage API réel sans débit de crédit (déblocage complet du rapport après paiement)
      fetch(
        apiBase + '/api/vin-decode/' + encodeURIComponent(vin.toUpperCase()) + '?preview=1',
        { credentials: 'include' }
      )
        .then(function(res) { return res.json().then(function(data) { return { res: res, data: data }; }); })
        .then(function(out) {
          var result = out.data;
          var status = out.res.status;
          if (result.status === 'success' && result.data) {
            var d = result.data;
            var vehicleData = {
              make: d.make || '',
              model: d.model || '',
              year: d.year || '',
              trim: d.trim || '',
              summary: d.summary || ''
            };
            vehicleData.vehicleDesc = [vehicleData.year, vehicleData.make, vehicleData.model]
              .filter(Boolean)
              .join(' · ');
            if (typeof VehicleService !== 'undefined') {
              VehicleService.saveCommandeData({
                demarche: 'Rapport historique véhicule (VIN)',
                vin: vin.toUpperCase(),
                vehicleData: vehicleData,
                prix: 19.90,
                reportUnlocked: false
              });
            }
            window.location.href = 'verification.html';
          } else if (result.degraded) {
            if (typeof VehicleService !== 'undefined') {
              VehicleService.saveCommandeData({
                demarche: 'Rapport historique véhicule (VIN)',
                vin: vin.toUpperCase(),
                prix: 19.90,
                reportUnlocked: false
              });
            }
            window.location.href = 'verification.html';
          } else {
            if (formError) {
              formError.textContent = result.message || result.error || 'Ce VIN n\'a pas été reconnu. Vérifiez le numéro (17 caractères sur la carte grise ou le véhicule).';
              formError.style.display = 'block';
            }
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Rechercher'; }
          }
        })
        .catch(function() {
          if (formError) {
            formError.textContent = 'Erreur de connexion. Vérifiez votre connexion ou réessayez dans un instant.';
            formError.style.display = 'block';
          }
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Rechercher'; }
        });
    });
  });
})();
