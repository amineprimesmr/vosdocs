/**
 * Carvinguard - Récapitulatif et formulaire manuel
 */

(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var data = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;

    function maskVin(vin) {
      if (!vin || vin.length !== 17) return vin || '—';
      return vin.slice(0, 4) + ' ········· ·' + vin.slice(14);
    }

    // Afficher les infos de l'étape 1 (VIN)
    var set = function(id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val || '—';
    };
    set('recap-demarche', data && data.demarche);
    var vinDisplay =
      data && data.vin
        ? data.reportUnlocked === true
          ? data.vin
          : maskVin(data.vin)
        : null;
    set('recap-vin', vinDisplay);

    // Format date JJ/MM/AAAA : uniquement chiffres, ajout automatique des /
    function formatDateValue(val) {
      var digits = (val || '').replace(/\D/g, '');
      if (digits.length > 8) digits = digits.slice(0, 8);
      if (digits.length <= 2) return digits;
      if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
      return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
    }
    function initDateInput(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function() {
        var pos = this.selectionStart;
        var oldLen = this.value.length;
        this.value = formatDateValue(this.value);
        var newLen = this.value.length;
        var newPos = Math.max(0, pos + (newLen - oldLen));
        if (this.value[newPos] === '/') newPos++;
        this.setSelectionRange(newPos, newPos);
      });
      el.addEventListener('keypress', function(e) {
        if (e.key !== 'Backspace' && e.key !== 'Delete' && e.key.length === 1 && !/\d/.test(e.key)) {
          e.preventDefault();
        }
      });
    }
    initDateInput('recap-date-immat');
    initDateInput('recap-date-cert');

    // Pré-remplir la date case (I) avec aujourd'hui (JJ/MM/AAAA)
    var todayEl = document.getElementById('recap-date-cert');
    if (todayEl && !todayEl.value) {
      var d = new Date();
      var jj = ('0' + d.getDate()).slice(-2);
      var mm = ('0' + (d.getMonth() + 1)).slice(-2);
      var aaaa = d.getFullYear();
      todayEl.value = jj + '/' + mm + '/' + aaaa;
    }

    // Gestion du formulaire manuel
    var form = document.getElementById('recapForm');
    var formError = document.getElementById('recapFormError');
    if (form && typeof VehicleService !== 'undefined') {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        var miseCirculation = (form.miseCirculation && form.miseCirculation.value || '').trim();
        var dateCertificat = (form.dateCertificat && form.dateCertificat.value || '').trim();
        var titulaire = (form.titulaire && form.titulaire.value || '').trim();
        var email = (form.email && form.email.value || '').trim();
        var digitsOnly = function(s) { return (s || '').replace(/\D/g, ''); };
        if (digitsOnly(miseCirculation).length < 8 || digitsOnly(dateCertificat).length < 8 || !titulaire || !email) {
          if (formError) {
            formError.textContent = 'Veuillez remplir tous les champs (dates au format JJ/MM/AAAA, titulaire, email).';
            formError.style.display = 'block';
          }
          return;
        }
        var toFormattedDate = function(s) {
          var d = digitsOnly(s);
          return d.length >= 8 ? d.slice(0,2) + '/' + d.slice(2,4) + '/' + d.slice(4,8) : s;
        };
        miseCirculation = toFormattedDate(miseCirculation);
        dateCertificat = toFormattedDate(dateCertificat);
        if (formError) formError.style.display = 'none';
        var typeRadio = form.querySelector('input[name="typePersonne"]:checked');
        var formData = {
          miseCirculation: miseCirculation,
          dateCertificat: dateCertificat,
          typePersonne: typeRadio ? typeRadio.value : 'particulier',
          titulaire: titulaire,
          email: email
        };
        var current = VehicleService.getCommandeData() || {};
        VehicleService.saveCommandeData(Object.assign({}, current, formData));
        window.location.href = 'checkout.html';
      });
    }
  });
})();
