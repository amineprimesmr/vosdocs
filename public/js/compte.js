/**
 * Espace compte : inscription, connexion, solde crédits, achat Stripe
 */
(function () {
  var api = function (path, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    opts.headers = opts.headers || {};
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(window.location.origin + path, opts).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  };

  function eur(cents) {
    return (cents / 100).toFixed(2).replace('.', ',') + ' €';
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-compte-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-compte-tab');
        document.querySelectorAll('.compte-panel').forEach(function (p) {
          p.style.display = p.getAttribute('data-panel') === tab ? 'block' : 'none';
        });
        document.querySelectorAll('[data-compte-tab]').forEach(function (b) {
          b.classList.toggle('is-active', b.getAttribute('data-compte-tab') === tab);
        });
      });
    });

    var elGuest = document.getElementById('compteGuest');
    var elUser = document.getElementById('compteUser');
    var elErrorRegister = document.getElementById('registerError');
    var elErrorLogin = document.getElementById('loginError');
    var elCreditsMsg = document.getElementById('creditsMessage');
    var elBalance = document.getElementById('creditBalance');
    var elEmail = document.getElementById('userEmailDisplay');
    var packsContainer = document.getElementById('creditPacks');
    var paySection = document.getElementById('creditPaySection');
    var payContainer = document.getElementById('creditPaymentContainer');
    var payError = document.getElementById('creditPayError');
    var payBtn = document.getElementById('creditPaySubmit');
    var selectedPackId = null;

    var stripe = null;
    var elements = null;
    var clientSecret = null;

    function show(el, on) {
      if (el) el.style.display = on ? '' : 'none';
    }

    function renderUser(user) {
      show(elGuest, false);
      show(elUser, true);
      if (elBalance) elBalance.textContent = String(user.credits);
      if (elEmail) elEmail.textContent = user.email;
    }

    function renderGuest() {
      show(elGuest, true);
      show(elUser, false);
    }

    api('/api/saas-config').then(function (r) {
      var cfg = r.data || {};
      if (!cfg.authAvailable && elGuest) {
        var warn = document.getElementById('saasUnavailable');
        if (warn) {
          warn.style.display = 'block';
          warn.textContent =
            'Les comptes ne sont pas configurés sur ce serveur (DATABASE_URL + JWT_SECRET).';
        }
      }
      if (packsContainer && cfg.creditPacks) {
        packsContainer.innerHTML = '';
        cfg.creditPacks.forEach(function (p) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-primary credit-pack-btn';
          btn.dataset.packId = p.id;
          btn.innerHTML =
            '<strong>' +
            p.label +
            '</strong><br><span class="pack-price">' +
            eur(p.priceCents) +
            '</span>';
          btn.addEventListener('click', function () {
            selectedPackId = p.id;
            document.querySelectorAll('.credit-pack-btn').forEach(function (b) {
              b.classList.remove('is-selected');
            });
            btn.classList.add('is-selected');
            show(paySection, true);
            if (payError) payError.style.display = 'none';
          });
          packsContainer.appendChild(btn);
        });
      }
    });

    api('/api/auth/me').then(function (r) {
      if (r.ok && r.data.authenticated && r.data.user) {
        renderUser(r.data.user);
      } else {
        renderGuest();
      }
    });

    var formReg = document.getElementById('formRegister');
    if (formReg) {
      formReg.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (elErrorRegister) elErrorRegister.style.display = 'none';
        var fd = new FormData(formReg);
        api('/api/auth/register', {
          method: 'POST',
          body: { email: fd.get('email'), password: fd.get('password') }
        }).then(function (r) {
          if (r.ok && r.data.user) {
            renderUser(r.data.user);
          } else {
            if (elErrorRegister) {
              elErrorRegister.textContent = r.data.error || 'Erreur';
              elErrorRegister.style.display = 'block';
            }
          }
        });
      });
    }

    var formLogin = document.getElementById('formLogin');
    if (formLogin) {
      formLogin.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (elErrorLogin) elErrorLogin.style.display = 'none';
        var fd = new FormData(formLogin);
        api('/api/auth/login', {
          method: 'POST',
          body: { email: fd.get('email'), password: fd.get('password') }
        }).then(function (r) {
          if (r.ok && r.data.user) {
            renderUser(r.data.user);
          } else {
            if (elErrorLogin) {
              elErrorLogin.textContent = r.data.error || 'Erreur';
              elErrorLogin.style.display = 'block';
            }
          }
        });
      });
    }

    var btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
      btnLogout.addEventListener('click', function () {
        api('/api/auth/logout', { method: 'POST' }).then(function () {
          renderGuest();
        });
      });
    }

    function refreshBalance() {
      api('/api/auth/me').then(function (r) {
        if (r.ok && r.data.user && elBalance) {
          elBalance.textContent = String(r.data.user.credits);
        }
      });
    }

    if (/credits=ok|paiement=credits_ok/i.test(window.location.search)) {
      if (elCreditsMsg) {
        elCreditsMsg.style.display = 'block';
        elCreditsMsg.textContent =
          'Paiement reçu. Vos crédits sont mis à jour sous quelques instants (rafraîchissez si besoin).';
      }
      var t0 = Date.now();
      var poll = setInterval(function () {
        refreshBalance();
        if (Date.now() - t0 > 60000) clearInterval(poll);
      }, 2500);
    }

    function initStripePayment() {
      if (!selectedPackId) {
        if (payError) {
          payError.textContent = 'Choisissez un forfait.';
          payError.style.display = 'block';
        }
        return;
      }
      if (payError) payError.style.display = 'none';
      if (payBtn) payBtn.disabled = true;
      api('/api/config')
        .then(function (r) {
          if (!r.data.stripePublishableKey) throw new Error('Stripe non configuré');
          if (typeof Stripe === 'undefined') throw new Error('Stripe.js non chargé');
          stripe = Stripe(r.data.stripePublishableKey);
          return api('/api/create-credit-purchase-intent', {
            method: 'POST',
            body: { packId: selectedPackId }
          });
        })
        .then(function (r) {
          if (!r.ok) throw new Error(r.data.error || 'Erreur création paiement');
          clientSecret = r.data.clientSecret;
          if (payContainer) payContainer.innerHTML = '';
          elements = stripe.elements({
            clientSecret: clientSecret,
            appearance: { theme: 'stripe', variables: { colorPrimary: '#0d9488' } }
          });
          elements.create('payment').mount(payContainer);
          if (payBtn) payBtn.disabled = false;
        })
        .catch(function (err) {
          if (payError) {
            payError.textContent = err.message || 'Erreur';
            payError.style.display = 'block';
          }
          if (payBtn) payBtn.disabled = false;
        });
    }

    var btnPreparePay = document.getElementById('btnPrepareCreditPay');
    if (btnPreparePay) {
      btnPreparePay.addEventListener('click', initStripePayment);
    }

    var formPay = document.getElementById('formCreditPay');
    if (formPay) {
      formPay.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (!stripe || !elements || !clientSecret) {
          if (payError) {
            payError.textContent = 'Cliquez d’abord sur « Préparer le paiement ».';
            payError.style.display = 'block';
          }
          return;
        }
        if (payBtn) payBtn.disabled = true;
        stripe
          .confirmPayment({
            elements: elements,
            confirmParams: {
              return_url: window.location.origin + '/compte.html?credits=ok'
            }
          })
          .then(function (result) {
            if (payBtn) payBtn.disabled = false;
            if (result.error && payError) {
              payError.textContent = result.error.message || 'Paiement échoué';
              payError.style.display = 'block';
            }
          });
      });
    }
  });
})();
