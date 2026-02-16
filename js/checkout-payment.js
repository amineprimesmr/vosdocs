/**
 * VosDocs - Paiement Stripe (checkout unique)
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

      var nom = (form.nom && form.nom.value || '').trim();
      var prenom = (form.prenom && form.prenom.value || '').trim();
      var phone = (form.phone && form.phone.value || '').trim();
      var email = (form.email && form.email.value || '').trim();
      var cp = (form.cp && form.cp.value || '').trim();
      var ville = (form.ville && form.ville.value || '').trim();

      if (!nom || !prenom || !phone || !email) {
        showError('Veuillez remplir nom, prénom, téléphone et email.');
        return;
      }
      if (!form.cgv || !form.cgv.checked) {
        showError('Veuillez accepter les CGV.');
        return;
      }

      var data = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : {};
      var metadata = {
        nom: nom,
        prenom: prenom,
        phone: phone,
        email: email,
        cp: cp,
        ville: ville,
        immatriculation: data.immatriculation || '',
        departement: data.departement || '',
        titulaire: data.titulaire || '',
        miseCirculation: data.miseCirculation || '',
        dateCertificat: data.dateCertificat || ''
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

    // Pré-remplir email depuis la commande
    (function() {
      var data = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
      if (!data || !form) return;
      var emailInput = form.querySelector('input[name="email"]');
      if (emailInput && data.email) emailInput.value = data.email;
    })();
  });
})();
