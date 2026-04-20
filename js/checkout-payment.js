/**
 * Carvinguard — Paiement Stripe + formules (14,99 € / 29,99 € / 69,99 €)
 * Miroir de public/js/checkout-payment.js
 */

(function () {
  var PLANS = {
    essentiel: {
      price: 14.99,
      label: 'Rapport VIN unique',
      packSize: 1,
      packLabel: '1 rapport VIN'
    },
    confort: {
      price: 29.99,
      label: 'Meilleur rapport qualité-prix',
      packSize: 3,
      packLabel: '3 rapports VIN'
    },
    premium: {
      price: 69.99,
      label: 'Pack Pro',
      packSize: 10,
      packLabel: '10 rapports VIN'
    }
  };

  var stripe = null;
  var elements = null;
  var paymentElement = null;
  var clientSecret = null;
  var paymentIntentId = null;
  var selectedPlan = 'confort';

  function fmtEur(n) {
    return n.toFixed(2).replace('.', ',') + ' €';
  }

  function getInitialPlan() {
    var q = new URLSearchParams(window.location.search).get('plan');
    if (q && PLANS[q]) return q;
    var d = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
    if (d && d.planId && PLANS[d.planId]) return d.planId;
    return 'confort';
  }

  function selectPlan(planId, skipPayment, scrollToForm) {
    if (!PLANS[planId]) planId = 'confort';
    selectedPlan = planId;
    document.querySelectorAll('.cg-tier-card').forEach(function (btn) {
      btn.classList.toggle('is-selected', btn.getAttribute('data-plan') === planId);
    });
    var p = PLANS[planId];
    if (typeof VehicleService !== 'undefined') {
      var d = VehicleService.getCommandeData() || {};
      VehicleService.saveCommandeData(
        Object.assign({}, d, {
          prix: p.price,
          planId: planId,
          planLabel: p.label,
          packSize: p.packSize,
          packLabel: p.packLabel
        })
      );
    }
    var elName = document.getElementById('checkout-plan-name');
    var elLine = document.getElementById('checkout-line-price');
    var elTotal = document.getElementById('checkout-total');
    var submitBtn = document.getElementById('submitPaymentBtn');
    var elPack = document.getElementById('checkout-pack-size');
    if (elName) elName.textContent = p.label;
    if (elPack) elPack.textContent = p.packLabel;
    if (elLine) elLine.textContent = fmtEur(p.price);
    if (elTotal) elTotal.textContent = fmtEur(p.price);
    if (submitBtn) submitBtn.textContent = 'Payer ' + fmtEur(p.price);
    if (!skipPayment) recreatePaymentIntent();
    if (scrollToForm) {
      var target = document.getElementById('paiement');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function recreatePaymentIntent() {
    if (!stripe) return;
    var container = document.getElementById('payment-element-container');
    if (paymentElement) {
      try {
        paymentElement.unmount();
      } catch (e) {}
      paymentElement = null;
    }
    if (container) container.innerHTML = '';

    var data = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
    var amount = data && data.prix !== undefined ? data.prix : PLANS[selectedPlan].price;

    fetch(window.location.origin + '/api/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amount })
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (result) {
        var formError = document.getElementById('paymentFormError');
        if (result.error) {
          if (formError) {
            formError.textContent = result.error || 'Erreur création paiement';
            formError.style.display = 'block';
          }
          return;
        }
        if (formError) formError.style.display = 'none';
        clientSecret = result.clientSecret;
        paymentIntentId = result.paymentIntentId;
        var appearance = {
          theme: 'stripe',
          variables: { colorPrimary: '#10b981', borderRadius: '12px' }
        };
        elements = stripe.elements({ clientSecret: clientSecret, appearance: appearance });
        paymentElement = elements.create('payment');
        if (container) paymentElement.mount(container);
      })
      .catch(function () {
        var formError = document.getElementById('paymentFormError');
        if (formError) {
          formError.textContent = 'Erreur serveur.';
          formError.style.display = 'block';
        }
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('checkoutPaymentForm');
    var submitBtn = document.getElementById('submitPaymentBtn');
    var formError = document.getElementById('paymentFormError');

    if (!form || !submitBtn) return;

    selectedPlan = getInitialPlan();
    selectPlan(selectedPlan, true, false);

    document.querySelectorAll('.cg-tier-card').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pid = btn.getAttribute('data-plan');
        if (pid) selectPlan(pid, false, true);
      });
    });

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
      var data = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
      var amt = data && data.prix !== undefined ? data.prix : PLANS[selectedPlan].price;
      submitBtn.disabled = loading;
      submitBtn.textContent = loading ? 'Traitement...' : 'Payer ' + fmtEur(amt);
    }

    fetch(window.location.origin + '/api/config')
      .then(function (res) {
        return res.json();
      })
      .then(function (config) {
        if (!config.stripePublishableKey) {
          showError('Paiement non configuré.');
          return;
        }
        stripe = window.Stripe(config.stripePublishableKey);
        recreatePaymentIntent();
      })
      .catch(function () {
        showError('Erreur de connexion. Démarrez le serveur (npm start).');
      });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!stripe || !elements || !clientSecret) return;

      var miseCirculation = (form.miseCirculation && form.miseCirculation.value) || '';
      miseCirculation = miseCirculation.trim();
      var dateCertificat = (form.dateCertificat && form.dateCertificat.value) || '';
      dateCertificat = dateCertificat.trim();
      var titulaire = (form.titulaire && form.titulaire.value) || '';
      titulaire = titulaire.trim();
      var nom = (form.nom && form.nom.value) || '';
      nom = nom.trim();
      var prenom = (form.prenom && form.prenom.value) || '';
      prenom = prenom.trim();
      var phone = (form.phone && form.phone.value) || '';
      phone = phone.trim();
      var email = (form.email && form.email.value) || '';
      email = email.trim();

      var digitsOnly = function (s) {
        return (s || '').replace(/\D/g, '');
      };
      if (digitsOnly(miseCirculation).length < 8 || digitsOnly(dateCertificat).length < 8 || !titulaire) {
        showError(
          'Veuillez remplir la date de 1ère immatriculation, la date (case I) sur la carte grise et le titulaire.'
        );
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

      var toFormattedDate = function (s) {
        var d = digitsOnly(s);
        return d.length >= 8 ? d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4, 8) : s;
      };
      miseCirculation = toFormattedDate(miseCirculation);
      dateCertificat = toFormattedDate(dateCertificat);

      var typeRadio = form.querySelector('input[name="typePersonne"]:checked');
      var data = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : {};
      var plan = PLANS[selectedPlan];
      if (typeof VehicleService !== 'undefined') {
        VehicleService.saveCommandeData(
          Object.assign({}, data, {
            miseCirculation: miseCirculation,
            dateCertificat: dateCertificat,
            titulaire: titulaire,
            typePersonne: typeRadio ? typeRadio.value : 'particulier',
            email: email,
            planId: selectedPlan,
            planLabel: plan.label,
            prix: plan.price,
            packSize: plan.packSize,
            packLabel: plan.packLabel
          })
        );
      }

      var metadata = {
        purpose: 'vin_report',
        nom: nom,
        prenom: prenom,
        phone: phone,
        email: email,
        vin: data.vin || '',
        titulaire: titulaire,
        typePersonne: typeRadio ? typeRadio.value : 'particulier',
        miseCirculation: miseCirculation,
        dateCertificat: dateCertificat,
        planId: selectedPlan,
        planLabel: plan.label,
        packSize: String(plan.packSize),
        packLabel: plan.packLabel
      };

      hideError();
      setLoading(true);

      fetch(window.location.origin + '/api/update-payment-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentIntentId: paymentIntentId, metadata: metadata })
      })
        .then(function (res) {
          return res.json();
        })
        .then(function () {
          return stripe.confirmPayment({
            elements: elements,
            confirmParams: {
              return_url: window.location.origin + '/confirmation.html',
              receipt_email: email
            }
          });
        })
        .then(function (result) {
          setLoading(false);
          if (result.error) {
            showError(result.error.message || 'Paiement échoué');
          }
        })
        .catch(function () {
          setLoading(false);
          showError('Erreur lors du paiement.');
        });
    });

    (function () {
      var data = typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
      if (!form) return;
      if (data) {
        var emailInput = form.querySelector('input[name="email"]');
        if (emailInput && data.email) emailInput.value = data.email;
        if (form.miseCirculation && data.miseCirculation) form.miseCirculation.value = data.miseCirculation;
        if (form.titulaire && data.titulaire) form.titulaire.value = data.titulaire;
        var typeRadio = form.querySelector(
          'input[name="typePersonne"][value="' + (data.typePersonne || 'particulier') + '"]'
        );
        if (typeRadio) typeRadio.checked = true;
      }
      var dateCert = form.dateCertificat;
      if (dateCert && !dateCert.value) {
        var d = new Date();
        dateCert.value =
          ('0' + d.getDate()).slice(-2) +
          '/' +
          ('0' + (d.getMonth() + 1)).slice(-2) +
          '/' +
          d.getFullYear();
      }
      function formatDateValue(val) {
        var digits = (val || '').replace(/\D/g, '');
        if (digits.length > 8) digits = digits.slice(0, 8);
        if (digits.length <= 2) return digits;
        if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
        return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
      }
      ['miseCirculation', 'dateCertificat'].forEach(function (name) {
        var el = form[name];
        if (!el) return;
        el.addEventListener('input', function () {
          var pos = this.selectionStart;
          var oldLen = this.value.length;
          this.value = formatDateValue(this.value);
          var newLen = this.value.length;
          var newPos = Math.max(0, pos + (newLen - oldLen));
          if (this.value[newPos] === '/') newPos++;
          this.setSelectionRange(newPos, newPos);
        });
      });
    })();
  });
})();
