/**
 * VosDocs - Gestion du formulaire de recherche véhicule
 */

(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var form = document.getElementById('heroForm');
    var depSelect = document.getElementById('departementSelect');
    var plaqueInput = document.getElementById('plaqueInput');
    var submitBtn = document.getElementById('submitBtn');
    var formError = document.getElementById('formError');

    if (!form) return;

    // Charger les départements
    if (typeof VehicleService !== 'undefined') {
      VehicleService.getDepartements().then(function(deps) {
        if (!depSelect || !deps || !deps.length) return;
        var currentVal = depSelect.value;
        depSelect.innerHTML = deps.map(function(d) {
          var label = d.code + ' - ' + d.nom;
          return '<option value="' + d.code + '"' + (d.code === currentVal ? ' selected' : '') + '>' + label + '</option>';
        }).join('');
      });
    }

    // Formatage plaque en temps réel (optionnel)
    if (plaqueInput) {
      plaqueInput.addEventListener('input', function() {
        var v = this.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (v.length > 7) v = v.slice(0, 7);
        this.value = v;
      });
    }

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var plaque = plaqueInput ? plaqueInput.value.trim() : '';
      var depCode = depSelect ? depSelect.value : '35';
      var depLabel = depSelect && depSelect.options[depSelect.selectedIndex] ? depSelect.options[depSelect.selectedIndex].text : depCode;
      if (!plaque || plaque.length < 5) {
        if (formError) {
          formError.textContent = 'Veuillez saisir une plaque d\'immatriculation valide (ex: AB123CD)';
          formError.style.display = 'block';
        }
        return;
      }
      if (formError) formError.style.display = 'none';
      var immat = plaque.replace(/[\s\-\.]/g, '').toUpperCase();
      var immatFormate = immat.length >= 7 ? immat.slice(0,2) + '-' + immat.slice(2,5) + '-' + immat.slice(5,7) : immat;
      if (typeof VehicleService !== 'undefined') {
        VehicleService.saveCommandeData({
          demarche: 'Certificat de situation administrative détaillée (NON GAGE)',
          departement: depLabel,
          departementCode: depCode,
          immatriculation: immatFormate,
          prix: 19.90
        });
      }
      window.location.href = 'recapitulatif.html';
    });
  });
})();
