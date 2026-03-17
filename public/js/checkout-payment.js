/**
 * Carvinguard - Paiement Stripe (checkout unique)
 */

(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var form = document.getElementById('checkoutPaymentForm');
    var paymentContainer = document.getElementById('payment-element-container');
    var submitBtn = document.getElementById('submitPaymentBtn');
    var formError = document.getElementById('paymentFormError');

    if (!form || !paymentContainer || !submitBtn) return;

    var stripe = null;
    var elements = null;
    var clientSecret = null;
    var paymentIntentId = null;

    function showError(msg) {
      if (formError) {
        formError.textContent = msg;
        formError.style.display = 'block';
      }
    }

    function hideError() {
      if (formError) formError.style.display = 'none';
    }

    function setLoading(loading) {
      submitBtn.disabled = loading;
      submitBtn.textContent = loading ? 'Traitement...' : 'Payer 19,90 €';
    }

    fetch(window.location.origin + '/api/config')
      .then(function(res) { return res.json(); })
      .then(function(config) {
        if (!config.stripePublishableKey) {
          showError('Paiement non configuré.');
          return;
        }
        stripe = Stripe(config.stripePublishableKey);
        createPaymentIntent();
      })
      .catch(function() {
        showError('Erreur de connexion. Démarrez le serveur (npm start).');
      });

    function createPaymentIntent() {
      var data = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
      var amount = (data && data.prix !== undefined) ? data.prix : 19.90;

      fetch(window.location.origin + '/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amount })
      })
        .then(function(res) { return res.json(); })
        .then(function(result) {
          if (result.error) {
            showError(result.error || 'Erreur création paiement');
            return;
          }
          clientSecret = result.clientSecret;
          paymentIntentId = result.paymentIntentId;
          initPaymentElement(result.clientSecret);
        })
        .catch(function() {
          showError('Erreur serveur.');
        });
    }

    function initPaymentElement(secret) {
      var appearance = { theme: 'stripe', variables: { colorPrimary: '#0d9488' } };
      elements = stripe.elements({ clientSecret: secret, appearance: appearance });
      elements.create('payment').mount(paymentContainer);
    }

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      if (!stripe || !elements) return;

      var miseCirculation = (form.miseCirculation && form.miseCirculation.value || '').trim();
      var dateCertificat = (form.dateCertificat && form.dateCertificat.value || '').trim();
      var titulaire = (form.titulaire && form.titulaire.value || '').trim();
      var nom = (form.nom && form.nom.value || '').trim();
      var prenom = (form.prenom && form.prenom.value || '').trim();
      var phone = (form.phone && form.phone.value || '').trim();
      var email = (form.email && form.email.value || '').trim();

      var digitsOnly = function(s) { return (s || '').replace(/\D/g, ''); };
      if (digitsOnly(miseCirculation).length < 8 || digitsOnly(dateCertificat).length < 8 || !titulaire) {
        showError('Veuillez remplir la date de 1ère immatriculation, la date du certificat et le titulaire.');
        return;
      }
      if (!nom || !prenom || !phone || !email) {
        showError('Veuillez remplir nom, prénom, téléphone et email.');
        return;
      }
      if (!form.cgv || !form.cgv.checked) {
        showError('Veuillez accepter les CGV.');
        return;
      }

      var toFormattedDate = function(s) {
        var d = digitsOnly(s);
        return d.length >= 8 ? d.slice(0,2) + '/' + d.slice(2,4) + '/' + d.slice(4,8) : s;
      };
      miseCirculation = toFormattedDate(miseCirculation);
      dateCertificat = toFormattedDate(dateCertificat);

      var typeRadio = form.querySelector('input[name="typePersonne"]:checked');
      var data = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : {};
      if (typeof VehicleService !== 'undefined') {
        VehicleService.saveCommandeData(Object.assign({}, data, {
          miseCirculation: miseCirculation,
          dateCertificat: dateCertificat,
          titulaire: titulaire,
          typePersonne: typeRadio ? typeRadio.value : 'particulier',
          email: email
        }));
      }

      var metadata = {
        nom: nom,
        prenom: prenom,
        phone: phone,
        email: email,
        vin: data.vin || '',
        titulaire: titulaire,
        typePersonne: typeRadio ? typeRadio.value : 'particulier',
        miseCirculation: miseCirculation,
        dateCertificat: dateCertificat
      };

      hideError();
      setLoading(true);

      fetch(window.location.origin + '/api/update-payment-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentIntentId: paymentIntentId, metadata: metadata })
      })
        .then(function(res) { return res.json(); })
        .then(function() {
          return stripe.confirmPayment({
            elements: elements,
            confirmParams: {
              return_url: window.location.origin + '/confirmation.html',
              receipt_email: email
            }
          });
        })
        .then(function(result) {
          setLoading(false);
          if (result.error) {
            showError(result.error.message || 'Paiement échoué');
          }
        })
        .catch(function() {
          setLoading(false);
          showError('Erreur lors du paiement.');
        });
    });

    // Pré-remplir depuis la commande + format dates JJ/MM/AAAA
    (function() {
      var data = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
      if (!form) return;
      if (data) {
        var emailInput = form.querySelector('input[name="email"]');
        if (emailInput && data.email) emailInput.value = data.email;
        if (form.miseCirculation && data.miseCirculation) form.miseCirculation.value = data.miseCirculation;
        if (form.titulaire && data.titulaire) form.titulaire.value = data.titulaire;
        var typeRadio = form.querySelector('input[name="typePersonne"][value="' + (data.typePersonne || 'particulier') + '"]');
        if (typeRadio) typeRadio.checked = true;
      }
      var dateCert = form.dateCertificat;
      if (dateCert && !dateCert.value) {
        var d = new Date();
        dateCert.value = ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
      }
      function formatDateValue(val) {
        var digits = (val || '').replace(/\D/g, '');
        if (digits.length > 8) digits = digits.slice(0, 8);
        if (digits.length <= 2) return digits;
        if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
        return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
      }
      ['miseCirculation', 'dateCertificat'].forEach(function(name) {
        var el = form[name];
        if (!el) return;
        el.addEventListener('input', function() {
          var pos = this.selectionStart, oldLen = this.value.length;
          this.value = formatDateValue(this.value);
          var newLen = this.value.length, newPos = Math.max(0, pos + (newLen - oldLen));
          if (this.value[newPos] === '/') newPos++;
          this.setSelectionRange(newPos, newPos);
        });
      });
    })();
  });
})();
