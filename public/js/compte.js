/**
 * Espace compte : connexion puis redirection vers les Payment Links Stripe (buy.stripe.com)
 * — même flux que la page Tarifs, avec client_reference_id=cguser:<id> pour créditer le bon compte.
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

  function appendAccountRef(url, userId) {
    if (!url || !userId) return url;
    try {
      var u = new URL(url);
      u.searchParams.set('client_reference_id', ('cguser:' + userId).slice(0, 80));
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var elGuest = document.getElementById('compteGuest');
    var elUser = document.getElementById('compteUser');
    var elErrorLogin = document.getElementById('loginError');
    var elCreditsMsg = document.getElementById('creditsMessage');
    var elBalance = document.getElementById('creditBalance');
    var elEmail = document.getElementById('userEmailDisplay');
    var packsContainer = document.getElementById('creditPacks');
    var compteMain = document.getElementById('compteMain');
    var compteHeroLead = document.getElementById('compteHeroLead');
    var compteH1 = document.getElementById('compteH1');
    var compteHeroKicker = document.getElementById('compteHeroKicker');
    var postPayWelcome = document.getElementById('postPayWelcome');
    var postPayWelcomeText = document.getElementById('postPayWelcomeText');
    var postPayGuestHint = document.getElementById('postPayGuestHint');

    function show(el, on) {
      if (el) el.style.display = on ? 'block' : 'none';
    }

    function isPostPaymentQuery() {
      var p = new URLSearchParams(window.location.search);
      if (p.get('paid') === '1') return true;
      if (p.get('credits') === 'ok') return true;
      if (/credits=ok|paiement=credits_ok/i.test(window.location.search)) return true;
      return false;
    }

    function cleanPostPaymentUrl() {
      try {
        var u = new URL(window.location.href);
        if (!isPostPaymentQuery()) return;
        u.searchParams.delete('session_id');
        u.searchParams.delete('paid');
        u.searchParams.delete('sub');
        if (!u.searchParams.has('credits')) u.searchParams.set('credits', 'ok');
        window.history.replaceState({}, '', u.pathname + u.search);
      } catch (e) {}
    }

    var postPayPollStarted = false;

    function applyPostPaymentUi(isGuestView) {
      var p = new URLSearchParams(window.location.search);
      var sub = p.get('sub') === '1';
      var sid = p.get('session_id');

      if (postPayGuestHint) postPayGuestHint.style.display = 'none';
      if (postPayWelcome) postPayWelcome.style.display = 'none';

      if (!isPostPaymentQuery()) return;

      if (isGuestView) {
        if (postPayGuestHint) postPayGuestHint.style.display = 'block';
        return;
      }

      if (postPayWelcome) {
        postPayWelcome.style.display = 'block';
        if (postPayWelcomeText) {
          postPayWelcomeText.textContent = sub
            ? 'Abonnement pris en compte. Vos crédits apparaissent ci-dessous sous quelques instants.'
            : 'Paiement enregistré. Vos crédits sont crédités sur ce compte sous peu.';
        }
        if (sid) {
          fetch(
            window.location.origin +
              '/api/checkout-session-kind?session_id=' +
              encodeURIComponent(sid)
          )
            .then(function (r) {
              return r.json();
            })
            .then(function (k) {
              if (k && k.kind === 'subscription_initial' && postPayWelcomeText) {
                postPayWelcomeText.textContent =
                  'Abonnement activé. Les crédits du cycle seront visibles ici dans un instant.';
              }
            })
            .catch(function () {});
        }
        cleanPostPaymentUrl();
      }

      if (elCreditsMsg) {
        elCreditsMsg.style.display = 'block';
        elCreditsMsg.textContent =
          'Mise à jour du solde en direct (webhook Stripe). Patientez quelques secondes si besoin.';
      }
      if (!postPayPollStarted) {
        postPayPollStarted = true;
        var t0 = Date.now();
        var poll = setInterval(function () {
          refreshBalance();
          if (Date.now() - t0 > 90000) clearInterval(poll);
        }, 2500);
      }
    }

    function renderUser(user) {
      show(elGuest, false);
      show(elUser, true);
      if (elBalance) elBalance.textContent = String(user.credits);
      if (elEmail) elEmail.textContent = user.email;
      if (compteMain) compteMain.classList.add('compte-wrap--logged');
      if (compteH1) compteH1.textContent = 'Espace client';
      if (compteHeroKicker) compteHeroKicker.style.display = 'block';
      if (compteHeroLead) {
        compteHeroLead.textContent =
          'Vos crédits servent aux recherches VIN (décodage + rapport). Rechargez ou souscrivez à l’abonnement ci-dessous — paiement sécurisé Stripe.';
      }
      loadStripeTierLinks(user.id);
      applyPostPaymentUi(false);
    }

    function renderGuest() {
      show(elGuest, true);
      show(elUser, false);
      if (compteMain) compteMain.classList.remove('compte-wrap--logged');
      if (compteH1) compteH1.textContent = 'Mon compte';
      if (compteHeroKicker) compteHeroKicker.style.display = 'block';
      if (compteHeroLead) {
        compteHeroLead.textContent =
          'Connexion réservée aux clients disposant déjà d’un accès. Les tarifs et le paiement (y compris premier achat invité) passent par la page Tarifs — même expérience Stripe hébergée.';
      }
      applyPostPaymentUi(true);
    }

    function loadStripeTierLinks(userId) {
      if (!packsContainer) return;
      packsContainer.innerHTML =
        '<p class="compte-links-loading">Chargement des liens de paiement…</p>';
      fetch(window.location.origin + '/api/payment-links')
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          packsContainer.innerHTML = '';
          var tiers = [
            {
              key: 'essentiel',
              popular: false,
              sub: 'Un rapport complet pour un véhicule.',
              unitHtml: '1 rapport',
              price: '14,99&nbsp;€'
            },
            {
              key: 'confort',
              popular: true,
              sub: 'Pour comparer plusieurs véhicules ou anticiper vos démarches.',
              unitHtml: '3 rapports · <strong>9,99&nbsp;€</strong>/rapport',
              price: '29,99&nbsp;€'
            },
            {
              key: 'premium',
              popular: false,
              sub: 'Pour professionnels et volumes réguliers.',
              unitHtml: '10 rapports · <strong>6,99&nbsp;€</strong>/rapport',
              price: '69,99&nbsp;€'
            }
          ];

          tiers.forEach(function (t) {
            var raw = (data && data[t.key]) || '';
            var a = document.createElement('a');
            a.className =
              'cg-tier-card compte-tier-link' +
              (t.popular ? ' cg-tier-card--popular' : '');
            a.rel = 'noopener noreferrer';
            a.target = '_self';
            if (raw && /^https?:\/\//i.test(raw)) {
              a.href = appendAccountRef(raw, userId);
            } else {
              a.href = '#';
              a.setAttribute('aria-disabled', 'true');
            }
            var names = {
              essentiel: 'Rapport VIN unique',
              confort: 'Meilleur rapport qualité-prix',
              premium: 'Pack Pro'
            };
            a.innerHTML =
              (t.popular ? '<span class="cg-tier-badge">Le plus populaire</span>' : '') +
              '<span class="cg-tier-name">' +
              escapeHtml(names[t.key]) +
              '</span>' +
              '<span class="cg-tier-sub">' +
              escapeHtml(t.sub) +
              '</span>' +
              '<span class="cg-tier-price">' +
              t.price +
              '</span>' +
              '<span class="cg-tier-unit">' +
              t.unitHtml +
              '</span>' +
              '<span class="cg-tier-cta ' +
              (t.popular ? 'cg-tier-cta--primary' : 'cg-tier-cta--muted') +
              '">Payer sur Stripe <span aria-hidden="true">→</span></span>';
            packsContainer.appendChild(a);
          });

          var subWrap = document.createElement('div');
          subWrap.className = 'cg-tier-card cg-tier-card--subscription';
          var subCta = document.createElement('a');
          subCta.className = 'cg-tier-cta cg-tier-cta--sub';
          subCta.rel = 'noopener noreferrer';
          subCta.href = window.location.origin + '/api/billing/subscribe-checkout';
          subCta.innerHTML = 'Payer sur Stripe <span aria-hidden="true">→</span>';
          subWrap.innerHTML =
            '<span class="cg-tier-badge cg-tier-badge--deal">Le best deal</span>' +
            '<span class="cg-tier-name">Pack mensuel</span>' +
            '<span class="cg-tier-sub">7 rapports VIN par mois, renouvelés chaque cycle (1 recherche = 1 rapport).</span>' +
            '<div class="cg-tier-price-row">' +
            '<span class="cg-tier-price cg-tier-price--sub">1&nbsp;€</span>' +
            '<span class="cg-tier-price-hint">/ 1 rapport</span>' +
            '</div>' +
            '<p class="cg-tier-unit cg-tier-unit--sub">puis <strong>49,99&nbsp;€</strong>/mois · résiliable à tout moment en <a class="cg-tier-inline-link" href="resiliation-abonnement.html">cliquant ici</a>.</p>';
          subWrap.appendChild(subCta);
          packsContainer.appendChild(subWrap);
        })
        .catch(function () {
          if (packsContainer) {
            packsContainer.innerHTML =
              '<p class="form-error-inline">Impossible de charger les liens de paiement.</p>';
          }
        });
    }

    api('/api/saas-config').then(function (r) {
      var cfg = r.data || {};
      if (!cfg.authAvailable && document.getElementById('compteGuest')) {
        var warn = document.getElementById('saasUnavailable');
        if (warn) {
          warn.style.display = 'block';
          warn.textContent =
            'Les comptes ne sont pas configurés sur ce serveur (DATABASE_URL + JWT_SECRET).';
        }
      }
    });

    function maybeResumeSubscribe() {
      var next = new URLSearchParams(window.location.search).get('next');
      if (next && /^\/api\/billing\/subscribe-checkout$/.test(next)) {
        window.location.replace(window.location.origin + next);
      }
    }

    api('/api/auth/me').then(function (r) {
      if (r.ok && r.data.authenticated && r.data.user) {
        renderUser(r.data.user);
        maybeResumeSubscribe();
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
            maybeResumeSubscribe();
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
          if (packsContainer) packsContainer.innerHTML = '';
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

    var pc = document.getElementById('creditPacks');
    if (pc) {
      pc.addEventListener('click', function (ev) {
        var a = ev.target.closest('a.cg-tier-card');
        if (a && a.getAttribute('aria-disabled') === 'true') {
          ev.preventDefault();
        }
      });
    }
  });
})();
