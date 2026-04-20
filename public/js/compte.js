/**
 * Espace compte : connexion, solde crédits, achat Stripe (mêmes paliers que checkout.html)
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

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildTierCard(p) {
    var isSub = p.type === 'subscription_initial' || p.subscription;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.packId = p.id;
    btn.setAttribute('role', 'listitem');
    var cls = 'cg-tier-card compte-tier-btn';
    if (p.popular) cls += ' cg-tier-card--popular';
    if (isSub) cls += ' cg-tier-card--subscription';
    btn.className = cls;

    if (isSub) {
      var monthlyEur = p.monthlyPriceCents
        ? (p.monthlyPriceCents / 100).toFixed(2).replace('.', ',')
        : '49,99';
      btn.innerHTML =
        '<span class="cg-tier-badge cg-tier-badge--deal">Le best deal</span>' +
        '<span class="cg-tier-name">' +
        escapeHtml(p.label) +
        '</span>' +
        '<span class="cg-tier-sub">' +
        escapeHtml(p.sub || '') +
        '</span>' +
        '<div class="cg-tier-price-row">' +
        '<span class="cg-tier-price cg-tier-price--sub">1&nbsp;€</span>' +
        '<span class="cg-tier-price-hint">/ 1 rapport</span>' +
        '</div>' +
        '<p class="cg-tier-unit cg-tier-unit--sub">puis <strong>' +
        monthlyEur +
        '&nbsp;€</strong>/mois · résiliable à tout moment en <a class="cg-tier-inline-link" href="resiliation-abonnement.html">cliquant ici</a>.</p>' +
        '<span class="cg-tier-cta cg-tier-cta--sub">Choisir <span aria-hidden="true">→</span></span>';
    } else {
      btn.innerHTML =
        (p.popular ? '<span class="cg-tier-badge">Le plus populaire</span>' : '') +
        '<span class="cg-tier-name">' +
        escapeHtml(p.label) +
        '</span>' +
        '<span class="cg-tier-sub">' +
        escapeHtml(p.sub || '') +
        '</span>' +
        '<span class="cg-tier-price">' +
        eur(p.priceCents) +
        '</span>' +
        '<span class="cg-tier-unit">' +
        escapeHtml(p.unit || '') +
        '</span>' +
        '<span class="cg-tier-cta ' +
        (p.popular ? 'cg-tier-cta--primary' : 'cg-tier-cta--muted') +
        '">Choisir <span aria-hidden="true">→</span></span>';
    }
    return btn;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var elGuest = document.getElementById('compteGuest');
    var elUser = document.getElementById('compteUser');
    var elErrorLogin = document.getElementById('loginError');
    var elCreditsMsg = document.getElementById('creditsMessage');
    var elBalance = document.getElementById('creditBalance');
    var elEmail = document.getElementById('userEmailDisplay');
    var packsContainer = document.getElementById('creditPacks');
    var paySection = document.getElementById('creditPaySection');
    var payContainer = document.getElementById('creditPaymentContainer');
    var payError = document.getElementById('creditPayError');
    var payBtn = document.getElementById('creditPaySubmit');
    var payForm = document.getElementById('formCreditPay');
    var payLoading = document.getElementById('payStripeLoading');
    var compteMain = document.getElementById('compteMain');
    var compteHeroLead = document.getElementById('compteHeroLead');
    var selectedPackId = null;
    var paymentSeq = 0;

    var stripe = null;
    var elements = null;
    var clientSecret = null;

    function show(el, on) {
      if (el) el.style.display = on ? 'block' : 'none';
    }

    function setPayLoading(on) {
      if (payLoading) {
        payLoading.classList.toggle('is-visible', on);
        payLoading.setAttribute('aria-hidden', on ? 'false' : 'true');
      }
    }

    function setPayFormVisible(on) {
      if (payForm) payForm.classList.toggle('is-hidden', !on);
    }

    function renderUser(user) {
      show(elGuest, false);
      show(elUser, true);
      if (elBalance) elBalance.textContent = String(user.credits);
      if (elEmail) elEmail.textContent = user.email;
      if (compteMain) compteMain.classList.add('compte-wrap--logged');
      if (compteHeroLead) {
        compteHeroLead.textContent =
          'Gérez vos crédits et votre abonnement — tarifs alignés sur la page publique.';
      }
    }

    function renderGuest() {
      show(elGuest, true);
      show(elUser, false);
      if (compteMain) compteMain.classList.remove('compte-wrap--logged');
      if (compteHeroLead) {
        compteHeroLead.textContent =
          'Connexion réservée aux clients disposant déjà d’un accès. Les tarifs et le paiement (y compris premier achat invité) passent par la page Tarifs.';
      }
    }

    function startPaymentIntent() {
      if (!selectedPackId) {
        if (payError) {
          payError.textContent = 'Choisissez un forfait.';
          payError.style.display = 'block';
        }
        return;
      }
      paymentSeq += 1;
      var seq = paymentSeq;

      if (payError) {
        payError.textContent = '';
        payError.style.display = 'none';
      }
      setPayLoading(true);
      setPayFormVisible(false);
      if (payBtn) payBtn.disabled = true;
      if (payContainer) payContainer.innerHTML = '';
      elements = null;
      clientSecret = null;

      api('/api/config')
        .then(function (r) {
          if (seq !== paymentSeq) return null;
          if (!r.data.stripePublishableKey) throw new Error('Stripe non configuré');
          if (typeof Stripe === 'undefined') throw new Error('Stripe.js non chargé');
          stripe = Stripe(r.data.stripePublishableKey);
          return api('/api/create-credit-purchase-intent', {
            method: 'POST',
            body: { packId: selectedPackId }
          });
        })
        .then(function (r) {
          if (r === null) return;
          if (seq !== paymentSeq) return;
          if (!r.ok) throw new Error((r.data && r.data.error) || 'Erreur création paiement');
          clientSecret = r.data.clientSecret;
          if (payContainer) payContainer.innerHTML = '';
          elements = stripe.elements({
            clientSecret: clientSecret,
            appearance: {
              theme: 'stripe',
              variables: {
                colorPrimary: '#16a34a',
                colorBackground: '#ffffff',
                colorText: '#1f2937',
                borderRadius: '8px',
                fontFamily: 'Source Sans 3, -apple-system, BlinkMacSystemFont, sans-serif'
              }
            }
          });
          elements.create('payment').mount(payContainer);
          setPayLoading(false);
          setPayFormVisible(true);
          if (payBtn) payBtn.disabled = false;
        })
        .catch(function (err) {
          if (seq !== paymentSeq) return;
          setPayLoading(false);
          setPayFormVisible(false);
          if (payError) {
            payError.textContent = err.message || 'Erreur';
            payError.style.display = 'block';
          }
          if (payBtn) payBtn.disabled = false;
        });
    }

    function selectPack(p, btn) {
      selectedPackId = p.id;
      document.querySelectorAll('#creditPacks .compte-tier-btn').forEach(function (b) {
        b.classList.remove('is-selected');
      });
      if (btn) btn.classList.add('is-selected');
      show(paySection, true);
      if (payError) {
        payError.textContent = '';
        payError.style.display = 'none';
      }
      startPaymentIntent();

      var creditsSection = document.getElementById('creditsSection');
      if (creditsSection && window.matchMedia('(max-width: 639px)').matches) {
        setTimeout(function () {
          paySection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
      }
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
          var btn = buildTierCard(p);
          btn.addEventListener('click', function () {
            selectPack(p, btn);
          });
          packsContainer.appendChild(btn);
        });
        if (/offre=abonnement/i.test(window.location.search) && packsContainer) {
          setTimeout(function () {
            var subBtn = packsContainer.querySelector('button[data-pack-id="sub_monthly_7"]');
            if (subBtn) {
              subBtn.click();
              var creditsSection = document.getElementById('creditsSection');
              if (creditsSection) {
                creditsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }
          }, 180);
        }
      }
    });

    api('/api/auth/me').then(function (r) {
      if (r.ok && r.data.authenticated && r.data.user) {
        renderUser(r.data.user);
      } else {
        renderGuest();
      }
    });

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
              elErrorLogin.textContent = (r.data && r.data.error) || 'Erreur';
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
          show(paySection, false);
          selectedPackId = null;
          if (packsContainer) {
            packsContainer.querySelectorAll('.compte-tier-btn').forEach(function (b) {
              b.classList.remove('is-selected');
            });
          }
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

    if (payForm) {
      payForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (!stripe || !elements || !clientSecret) {
          if (payError) {
            payError.textContent =
              'Le formulaire de paiement n’est pas prêt. Attendez la fin du chargement ou choisissez à nouveau un forfait.';
            payError.style.display = 'block';
          }
          return;
        }
        if (payError) payError.style.display = 'none';
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
