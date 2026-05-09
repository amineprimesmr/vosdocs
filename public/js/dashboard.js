/**
 * CarvinGuard — Dashboard SaaS
 * Gestion de l'auth, navigation, recherche VIN, historique, crédits, profil.
 */
(function () {
  'use strict';

  /* ============================================================
     API HELPER
     ============================================================ */
  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    opts.headers = opts.headers || {};
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(window.location.origin + path, opts).then(function (r) {
      if (r.status === 204) return { ok: true, status: 204, data: {} };
      return r.json().then(function (d) {
        return { ok: r.ok, status: r.status, data: d };
      }).catch(function () {
        return { ok: r.ok, status: r.status, data: {} };
      });
    });
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ============================================================
     STATE
     ============================================================ */
  var currentUser = null;
  var currentSection = 'dashboard';
  var historyLoaded = false;
  var statsLoaded = false;
  var inviteToken = null;
  /** Session Stripe après retour paiement (relance get-invite au clic si le token n’est pas encore là). */
  var postPaymentSessionId = null;
  /** Annule les requêtes get-invite si /auth/me dit déjà connecté (même navigateur). */
  var guestActivationCancelled = false;
  /** false = inscription directe désactivée (compte après paiement Stripe). */
  var registrationOpen = false;
  /** Fournisseur VIN réel (`carapi` \| `vehicledatabases`), renvoyé par /api/saas-config. */
  var vinDecodeProvider = null;
  /** Indicateurs dérivés (exclusifs) : quel rapport « complet » est disponible côté client. */
  var carApiEnabled = false;
  /** true si VEHICLEDATABASES_API_KEY pilote les rapports (`vinDecodeProvider`). */
  var vdEnabled = false;

  function removeTempLoginHideStyle() {
    var st = document.getElementById('cg-hide-login-temp');
    if (st) st.remove();
  }

  function setInviteOverlaySteps(showWaiting) {
    var w = document.getElementById('inviteStepWaiting');
    var f = document.getElementById('inviteStepForm');
    if (w) w.style.display = showWaiting ? 'block' : 'none';
    if (f) f.style.display = showWaiting ? 'none' : 'block';
  }

  function setInviteFormDisabled(disabled) {
    ['invitePassword', 'inviteConfirm', 'inviteBtn'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = !!disabled;
    });
  }

  /** Retour Stripe : création mot de passe tout de suite — saisie possible pendant la finalisation serveur. */
  function showPostPayCreateAccountUi() {
    removeTempLoginHideStyle();
    var fail = document.getElementById('activationFailOverlay');
    if (fail) fail.classList.add('hidden');
    var authOverlay = document.getElementById('authOverlay');
    var inviteOverlay = document.getElementById('inviteOverlay');
    var shell = document.getElementById('appShell');
    if (authOverlay) authOverlay.classList.add('hidden');
    if (inviteOverlay) inviteOverlay.classList.remove('hidden');
    if (shell) shell.style.display = 'none';
    setInviteOverlaySteps(false);
    var ht = document.getElementById('inviteFormTitle');
    var st = document.getElementById('inviteFormSubtitle');
    if (ht) ht.textContent = 'Créez votre mot de passe';
    if (st) {
      st.textContent =
        'Vous pouvez déjà choisir votre mot de passe pendant que nous finalisons la session (ce n’est pas une connexion — compte créé après paiement).';
    }
    var ed = document.getElementById('inviteEmailDisplay');
    if (ed) {
      ed.textContent = 'Finalisation de la session en cours…';
      ed.style.display = 'block';
    }
    setInviteFormDisabled(false);
    var iErr = document.getElementById('inviteError');
    if (iErr) {
      iErr.style.display = 'none';
      iErr.textContent = '';
    }
  }

  function showActivationFailure(msg) {
    guestActivationCancelled = true;
    removeTempLoginHideStyle();
    var inv = document.getElementById('inviteOverlay');
    var auth = document.getElementById('authOverlay');
    if (inv) inv.classList.add('hidden');
    if (auth) auth.classList.add('hidden');
    var shell = document.getElementById('appShell');
    if (shell) shell.style.display = 'none';
    var fo = document.getElementById('activationFailOverlay');
    var tx = document.getElementById('activationFailText');
    if (tx) tx.textContent = msg || 'Une erreur est survenue.';
    if (fo) fo.classList.remove('hidden');
  }

  /** Formulaire mot de passe (lien ?invite= ou après validation session Stripe). */
  function showInviteFormOverlay(email) {
    removeTempLoginHideStyle();
    var fail = document.getElementById('activationFailOverlay');
    if (fail) fail.classList.add('hidden');
    var authOverlay = document.getElementById('authOverlay');
    var inviteOverlay = document.getElementById('inviteOverlay');
    var shell = document.getElementById('appShell');
    if (authOverlay) authOverlay.classList.add('hidden');
    if (inviteOverlay) inviteOverlay.classList.remove('hidden');
    if (shell) shell.style.display = 'none';
    setInviteOverlaySteps(false);
    var emailDisplay = document.getElementById('inviteEmailDisplay');
    if (emailDisplay) {
      if (email) {
        emailDisplay.textContent = email;
        emailDisplay.style.display = 'block';
      } else {
        emailDisplay.style.display = 'none';
      }
    }
    setInviteFormDisabled(false);
  }

  function applyRegistrationRestrictedUi() {
    var tabSignup = document.getElementById('tabSignup');
    var panelSignup = document.getElementById('panelSignup');
    var tabLogin = document.getElementById('tabLogin');
    var panelLogin = document.getElementById('panelLogin');
    var foot = document.querySelector('#panelLogin .auth-footer');
    if (registrationOpen) {
      if (tabSignup) tabSignup.style.display = '';
      if (panelSignup) panelSignup.style.display = '';
      if (foot) {
        foot.innerHTML =
          'Pas encore de compte ? <button type="button" class="auth-link" onclick="switchTab(\'signup\')">Créer un compte</button>';
      }
      return;
    }
    if (tabSignup) tabSignup.style.display = 'none';
    if (panelSignup) {
      panelSignup.classList.remove('active');
      panelSignup.style.display = 'none';
    }
    if (tabLogin) tabLogin.classList.add('active');
    if (panelLogin) panelLogin.classList.add('active');
    if (foot) {
      foot.innerHTML =
        'Nouveau client ? Choisissez un forfait sur la page <a href="/checkout.html" class="auth-link">Tarifs</a> : le compte est créé après le paiement sécurisé.';
    }
  }

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', function () {
    var params = new URLSearchParams(window.location.search);
    inviteToken = params.get('invite');

    registrationOpen = false;
    applyRegistrationRestrictedUi();
    api('/api/saas-config')
      .then(function (r) {
        registrationOpen = !!(r.ok && r.data && r.data.registrationOpen);
        vinDecodeProvider = (r.ok && r.data && r.data.vinDecodeProvider) || null;
        carApiEnabled = !!(r.ok && r.data && r.data.carApiEnabled);
        vdEnabled = !!(r.ok && r.data && r.data.vdEnabled);
        applyRegistrationRestrictedUi();
        refreshSearchModeDesc();
      })
      .catch(function () {
        registrationOpen = false;
        vinDecodeProvider = null;
        carApiEnabled = false;
        vdEnabled = false;
        applyRegistrationRestrictedUi();
        refreshSearchModeDesc();
      });

    // Lien email ?invite= — création mot de passe directe
    if (inviteToken) {
      showInviteFormOverlay();
      return;
    }

    var sessionId = params.get('session_id');
    var isPaid = params.get('paid') === '1' || params.get('credits') === 'ok';

    /** Retour Stripe : finalisation immédiate — ne pas attendre /api/auth/me */
    if (isPaid && sessionId) {
      guestActivationCancelled = false;
      postPaymentSessionId = sessionId;
      showPostPayCreateAccountUi();
      handleGuestPostPayment(sessionId);
      api('/api/auth/me').then(function (r) {
        if (r.ok && r.data && r.data.authenticated && r.data.user) {
          guestActivationCancelled = true;
          var inv = document.getElementById('inviteOverlay');
          if (inv) inv.classList.add('hidden');
          onAuthSuccess(r.data.user);
        }
      });
      return;
    }

    api('/api/auth/me').then(function (r) {
      if (r.ok && r.data && r.data.authenticated && r.data.user) {
        onAuthSuccess(r.data.user);
      } else {
        showAuthOverlay();
      }
    }).catch(function () {
      showAuthOverlay();
    });
  });

  /* ============================================================
     AUTH OVERLAY
     ============================================================ */
  window.showAuthOverlay = function () {
    removeTempLoginHideStyle();
    var invite = document.getElementById('inviteOverlay');
    if (invite) {
      invite.classList.add('hidden');
      setInviteOverlaySteps(false);
    }
    var overlay = document.getElementById('authOverlay');
    var shell = document.getElementById('appShell');
    if (overlay) overlay.classList.remove('hidden');
    if (shell) shell.style.display = 'none';
  };

  window.switchTab = function (tab) {
    if (tab === 'signup' && !registrationOpen) {
      tab = 'login';
    }
    var tabs = ['login', 'signup'];
    tabs.forEach(function (t) {
      var btn = document.getElementById('tab' + capitalize(t));
      var panel = document.getElementById('panel' + capitalize(t));
      if (btn) btn.classList.toggle('active', t === tab);
      if (panel) panel.classList.toggle('active', t === tab);
    });
    hideAuthErrors();
  };

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function hideAuthErrors() {
    ['loginError', 'signupError'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function showError(elId, msg) {
    var el = document.getElementById(elId);
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  function setLoading(btnId, textId, spinnerId, loading) {
    var btn = document.getElementById(btnId);
    var text = document.getElementById(textId);
    var spinner = document.getElementById(spinnerId);
    if (btn) btn.disabled = loading;
    if (text) text.style.visibility = loading ? 'hidden' : 'visible';
    if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
  }

  /* LOGIN */
  window.doLogin = function () {
    var email = val('loginEmail');
    var password = val('loginPassword');
    if (!email || !password) { showError('loginError', 'Remplissez tous les champs.'); return; }
    setLoading('loginBtn', 'loginBtnText', 'loginSpinner', true);
    api('/api/auth/login', { method: 'POST', body: { email: email, password: password } })
      .then(function (r) {
        setLoading('loginBtn', 'loginBtnText', 'loginSpinner', false);
        if (r.ok && r.data && r.data.user) {
          onAuthSuccess(r.data.user);
        } else {
          showError('loginError', (r.data && r.data.error) || 'Email ou mot de passe incorrect.');
        }
      }).catch(function () {
        setLoading('loginBtn', 'loginBtnText', 'loginSpinner', false);
        showError('loginError', 'Erreur réseau. Réessayez.');
      });
  };

  /* SIGNUP */
  window.doSignup = function () {
    if (!registrationOpen) {
      showError('signupError', 'Créez un compte en passant d’abord par un paiement sur la page Tarifs.');
      return;
    }
    var email = val('signupEmail');
    var password = val('signupPassword');
    var confirm = val('signupConfirm');
    if (!email || !password || !confirm) { showError('signupError', 'Remplissez tous les champs.'); return; }
    if (password.length < 8) { showError('signupError', 'Mot de passe trop court (8 caractères minimum).'); return; }
    if (password !== confirm) { showError('signupError', 'Les mots de passe ne correspondent pas.'); return; }
    setLoading('signupBtn', 'signupBtnText', 'signupSpinner', true);
    api('/api/auth/register', { method: 'POST', body: { email: email, password: password } })
      .then(function (r) {
        setLoading('signupBtn', 'signupBtnText', 'signupSpinner', false);
        if (r.ok && r.data && r.data.user) {
          onAuthSuccess(r.data.user);
        } else {
          showError('signupError', (r.data && r.data.error) || 'Erreur lors de l\'inscription.');
        }
      }).catch(function () {
        setLoading('signupBtn', 'signupBtnText', 'signupSpinner', false);
        showError('signupError', 'Erreur réseau. Réessayez.');
      });
  };

  /* LOGOUT */
  window.doLogout = function () {
    api('/api/auth/logout', { method: 'POST' }).then(function () {
      currentUser = null;
      historyLoaded = false;
      statsLoaded = false;
      document.getElementById('appShell').style.display = 'none';
      switchTab('login');
      showAuthOverlay();
    });
  };

  /* ============================================================
     INVITE OVERLAY
     ============================================================ */
  function showInviteOverlay(email) {
    showInviteFormOverlay(email);
  }

  /**
   * Invité revenant de Stripe : récupère l'email + token d'invitation depuis session_id.
   * Polling sans limite (webhook ou réconciliation get-invite peut être en retard).
   */
  function handleGuestPostPayment(sessionId) {
    var attempts = 0;
    var transientStrikes = 0;
    var MAX_TRANSIENT_BEFORE_EMAIL_HINT = 90;

    function nextDelay() {
      if (attempts < 25) return 80;
      if (attempts < 80) return 300;
      return Math.min(2500, 400 + Math.floor((attempts - 80) / 20) * 200);
    }

    function tryFetch() {
      if (guestActivationCancelled) return;
      attempts++;
      fetch(
        window.location.origin +
          '/api/billing/get-invite?session_id=' +
          encodeURIComponent(sessionId) +
          '&_=' +
          Date.now(),
        { credentials: 'include', cache: 'no-store' }
      )
        .then(function (r) {
          return r.json().then(function (data) {
            return { ok: r.ok, status: r.status, data: data || {} };
          });
        })
        .then(function (result) {
          if (guestActivationCancelled) return;
          var data = result.data;
          var status = result.status;
          var ok = result.ok;

          if (data.ready && data.inviteToken) {
            transientStrikes = 0;
            inviteToken = data.inviteToken;
            showInviteFormOverlay(data.email);
            return;
          }

          if (data.reason === 'no_email') {
            showActivationFailure(
              'Impossible de lire l’email de cette session. Utilisez le lien envoyé par email après l’achat.'
            );
            return;
          }

          if (data.reason === 'no_db') {
            showActivationFailure(
              'Le service est momentanément indisponible. Si vous avez payé, un email avec un lien pour créer votre mot de passe vous a été envoyé — vérifiez aussi les courriers indésirables.'
            );
            return;
          }

          var retryPending = data.reason === 'pending';
          var retryTransient =
            data.reason === 'temporary' || (!ok && status >= 500);

          if (retryPending) {
            transientStrikes = 0;
            setTimeout(tryFetch, nextDelay());
            return;
          }

          if (retryTransient) {
            transientStrikes++;
            if (transientStrikes >= MAX_TRANSIENT_BEFORE_EMAIL_HINT) {
              showActivationFailure(
                'Nous n’arrivons pas à joindre le serveur pour finaliser l’activation. Vous devriez avoir reçu un email avec un lien pour créer votre mot de passe — vérifiez aussi les courriers indésirables. Vous pouvez aussi recharger cette page plus tard.'
              );
              return;
            }
            setTimeout(tryFetch, nextDelay());
            return;
          }

          if (data.error && !data.ready) {
            showActivationFailure(
              typeof data.error === 'string'
                ? data.error
                : 'Une erreur est survenue. Utilisez le lien reçu par email ou contactez le support.'
            );
            return;
          }

          transientStrikes = 0;
          setTimeout(tryFetch, nextDelay());
        })
        .catch(function () {
          if (guestActivationCancelled) return;
          transientStrikes++;
          if (transientStrikes >= MAX_TRANSIENT_BEFORE_EMAIL_HINT) {
            showActivationFailure(
              'Problème de connexion au serveur. Si vous avez payé, vérifiez l’email avec le lien d’activation (y compris les indésirables), ou réessayez plus tard.'
            );
            return;
          }
          setTimeout(tryFetch, nextDelay());
        });
    }

    tryFetch();
  }

  window.doAcceptInvite = function () {
    if (!inviteToken) {
      if (postPaymentSessionId) {
        setLoading('inviteBtn', 'inviteBtnText', 'inviteSpinner', true);
        fetch(
          window.location.origin +
            '/api/billing/get-invite?session_id=' +
            encodeURIComponent(postPaymentSessionId) +
            '&_=' +
            Date.now(),
          { credentials: 'include', cache: 'no-store' }
        )
          .then(function (r) {
            return r.json().then(function (data) {
              return { ok: r.ok, data: data || {} };
            });
          })
          .then(function (res) {
            setLoading('inviteBtn', 'inviteBtnText', 'inviteSpinner', false);
            var data = res.data;
            if (data.ready && data.inviteToken) {
              inviteToken = data.inviteToken;
              showInviteFormOverlay(data.email);
              window.doAcceptInvite();
              return;
            }
            showError(
              'inviteError',
              'Le serveur n’a pas encore enregistré votre paiement (ou la connexion à la base a échoué). Rechargez la page dans une minute, ou utilisez le lien « créer votre mot de passe » reçu par email (vérifiez les indésirables).'
            );
          })
          .catch(function () {
            setLoading('inviteBtn', 'inviteBtnText', 'inviteSpinner', false);
            showError('inviteError', 'Erreur réseau. Réessayez ou ouvrez le lien reçu par email.');
          });
        return;
      }
      showError(
        'inviteError',
        'Lien d’activation incomplet. Ouvrez le lien reçu par email ou repassez par la page Tarifs après paiement.'
      );
      return;
    }
    var pw = val('invitePassword');
    var confirm = val('inviteConfirm');
    if (!pw || pw.length < 8) { showError('inviteError', 'Mot de passe trop court (8 caractères minimum).'); return; }
    if (pw !== confirm) { showError('inviteError', 'Les mots de passe ne correspondent pas.'); return; }
    setLoading('inviteBtn', 'inviteBtnText', 'inviteSpinner', true);
    api('/api/auth/accept-invite', { method: 'POST', body: { token: inviteToken, password: pw } })
      .then(function (r) {
        setLoading('inviteBtn', 'inviteBtnText', 'inviteSpinner', false);
        if (r.ok && r.data && r.data.user) {
          var invite = document.getElementById('inviteOverlay');
          if (invite) invite.classList.add('hidden');
          onAuthSuccess(r.data.user, true);
        } else {
          showError('inviteError', (r.data && r.data.error) || 'Lien invalide ou expiré.');
        }
      }).catch(function () {
        setLoading('inviteBtn', 'inviteBtnText', 'inviteSpinner', false);
        showError('inviteError', 'Erreur réseau. Réessayez.');
      });
  };

  /* ============================================================
     AUTH SUCCESS → SHOW APP
     ============================================================ */
  function onAuthSuccess(user, fromInvite) {
    currentUser = user;
    postPaymentSessionId = null;
    api('/api/saas-config')
      .then(function (r) {
        if (r.ok && r.data) {
          vinDecodeProvider = r.data.vinDecodeProvider || null;
          carApiEnabled = !!r.data.carApiEnabled;
          vdEnabled = !!r.data.vdEnabled;
          registrationOpen = !!r.data.registrationOpen;
          applyRegistrationRestrictedUi();
        }
      })
      .catch(function () {})
      .then(function () {
        refreshSearchModeDesc();
      });

    removeTempLoginHideStyle();
    var actFail = document.getElementById('activationFailOverlay');
    if (actFail) actFail.classList.add('hidden');
    // Hide overlays, show shell
    var authOverlay = document.getElementById('authOverlay');
    var inviteOverlay = document.getElementById('inviteOverlay');
    var shell = document.getElementById('appShell');
    if (authOverlay) authOverlay.classList.add('hidden');
    if (inviteOverlay) inviteOverlay.classList.add('hidden');
    if (shell) shell.style.display = 'flex';

    // Update sidebar
    updateSidebar(user);

    // Check post-payment
    var params = new URLSearchParams(window.location.search);
    var isPaid = params.get('paid') === '1' || params.get('credits') === 'ok';

    if (isPaid) {
      handlePostPayment(params);
    }

    // Check ?next= for billing resume
    var next = params.get('next');
    if (next) {
      var path = decodeURIComponent(next);
      if (path.startsWith('/api/billing/')) {
        window.location.replace(window.location.origin + path);
        return;
      }
    }

    // Load initial data
    loadDashboard();
  }

  function handlePostPayment(params) {
    var sessionId = params.get('session_id') || '';
    var banner = document.getElementById('postPayBanner');
    var text = document.getElementById('postPayText');
    if (!banner) return;
    banner.classList.remove('hidden');
    banner.classList.remove('post-pay--warning');
    var isSub = params.get('sub') === '1';

    if (text) {
      if (currentUser && currentUser.credits > 0) {
        text.textContent = isSub
          ? 'Abonnement actif — ' + currentUser.credits + ' crédit(s) sur le compte.'
          : 'Paiement confirmé — ' + currentUser.credits + ' crédit(s) disponible(s).';
      } else if (isSub) {
        text.textContent =
          'Paiement reçu. Finalisation de l’abonnement côté serveur — vos crédits s’affichent en quelques secondes…';
      } else {
        text.textContent =
          sessionId.indexOf('cs_') === 0
            ? 'Rattachement du paiement Stripe à votre compte en cours…'
            : 'Paiement reçu. Vérification du solde…';
      }
    }

    var gotCredits = !!(currentUser && currentUser.credits > 0);

    function doUrlClean() {
      try {
        var u = new URL(window.location.href);
        u.searchParams.delete('paid');
        u.searchParams.delete('credits');
        u.searchParams.delete('sub');
        u.searchParams.delete('session_id');
        window.history.replaceState({}, '', u.pathname + (u.search || ''));
      } catch (e) {}
    }

    function startPollIfNeeded() {
      if (gotCredits) return;
      var t0 = Date.now();
      var maxMs = 120000;
      var iv = setInterval(function () {
        if (Date.now() - t0 > maxMs) {
          clearInterval(iv);
          if (text && (!currentUser || currentUser.credits < 1)) {
            text.innerHTML =
              'Paiement enregistré côté Stripe, mais le solde est encore à 0. ' +
              'Rechargez la page, vérifiez l’email de confirmation, ou contactez le support ' +
              'si la carte a été débitée. ' +
              '<span style="display:block;margin-top:8px;font-size:0.875rem;opacity:0.95">' +
              'Vérifiez aussi que l’e-mail du compte Carvinguard est le même que sur Stripe.</span>';
            banner.classList.add('post-pay--warning');
          }
          return;
        }
        api('/api/auth/me').then(function (r) {
          if (!r.ok || !r.data || !r.data.user) return;
          var c = r.data.user.credits;
          currentUser.credits = c;
          updateCreditsDisplay(c);
          if (c > 0) {
            clearInterval(iv);
            if (text) {
              text.textContent = isSub
                ? 'Abonnement actif — ' + c + ' crédit(s) disponible(s).'
                : 'Paiement confirmé — ' + c + ' crédit(s) ajouté(s) à votre compte.';
            }
            banner.classList.remove('post-pay--warning');
          }
        });
      }, 2000);
    }

    if (sessionId.indexOf('cs_') === 0) {
      api('/api/billing/reconcile-checkout', { method: 'POST', body: { session_id: sessionId } })
        .then(function (r) {
          if (r.ok && r.data && r.data.credits != null) {
            currentUser.credits = r.data.credits;
            updateCreditsDisplay(r.data.credits);
            if (r.data.credits > 0) {
              gotCredits = true;
              if (text) {
                text.textContent = isSub
                  ? 'Abonnement actif — ' + r.data.credits + ' crédit(s) disponible(s).'
                  : 'Paiement confirmé — ' + r.data.credits + ' crédit(s) sur votre compte.';
              }
              banner.classList.remove('post-pay--warning');
            }
          } else if (r.data && r.data.error) {
            if (text) {
              text.textContent = r.data.error;
              banner.classList.add('post-pay--warning');
            }
          }
        })
        .catch(function () {})
        .then(function () {
          doUrlClean();
          startPollIfNeeded();
        });
    } else {
      doUrlClean();
      startPollIfNeeded();
    }
  }

  /* ============================================================
     SIDEBAR
     ============================================================ */
  function updateSidebar(user) {
    var emailEl = document.getElementById('sidebarEmail');
    var avatarEl = document.getElementById('sidebarAvatar');
    if (emailEl) emailEl.textContent = user.email || '—';
    if (avatarEl) avatarEl.textContent = (user.email || '?').charAt(0).toUpperCase();
    updateCreditsDisplay(user.credits);
  }

  function refreshSearchModeDesc() {
    var d = document.getElementById('searchModeDesc');
    if (!d) return;
    if (vinDecodeProvider === 'vehicledatabases') {
      d.textContent =
        ' crédit(s) — 1 crédit = rapport Vehicle Databases (fiche complète Europe/US, vol international, valeur, rappels, photos…) — adapté aux VIN européens (ex. Renault VF1…).';
    } else if (vinDecodeProvider === 'carapi') {
      d.textContent =
        ' crédit(s) — 1 crédit = rapport CarAPI (mode rare : SKIP_VEHICLE_DATABASES=1 sur le serveur). Plutôt US/Canada. Par défaut, l’app utilise Vehicle Databases (clé incluse) pour les VIN européens.';
    } else if (carApiEnabled) {
      d.textContent =
        ' crédit(s) — 1 crédit couvre un rapport détaillé : identité du véhicule, vol, contrôle technique, kilométrage, annonces, cote estimative, photos et simulation de financement.';
    } else if (vdEnabled) {
      d.textContent =
        ' crédit(s) — 1 crédit couvre un rapport complet : identification, historique EU, vol, cote de marché, rappels, enchères, entretien, garantie et photos.';
    } else {
      d.textContent = ' crédit(s) — 1 crédit par fiche véhicule.';
    }
  }

  function updateCreditsDisplay(credits) {
    var badge = document.getElementById('sidebarCredits');
    if (badge) {
      if (credits > 0) {
        badge.textContent = credits;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
    // Update stats
    var sc = document.getElementById('statCredits');
    if (sc) sc.textContent = credits;
    var cc = document.getElementById('searchCreditsCount');
    if (cc) cc.textContent = credits;
    var pc = document.getElementById('profileCredits');
    if (pc) pc.textContent = credits;
    // Show no-credits hint
    var hint = document.getElementById('noCreditsHint');
    if (hint) hint.classList.toggle('hidden', credits > 0);
  }

  /* ============================================================
     NAVIGATION
     ============================================================ */
  window.goSection = function (section) {
    currentSection = section;

    // Toggle nav items
    document.querySelectorAll('.nav-item').forEach(function (el) {
      el.classList.toggle('active', el.dataset.section === section);
    });

    // Toggle sections
    document.querySelectorAll('.app-section').forEach(function (el) {
      el.classList.toggle('active', el.id === 'section-' + section);
    });

    // Lazy load
    if (section === 'history' && !historyLoaded) loadHistory();
    if (section === 'dashboard' && !statsLoaded) loadDashboard();

    closeSidebar();
  };

  window.openSidebar = function () {
    var s = document.getElementById('sidebar');
    var o = document.getElementById('sidebarOverlay');
    if (s) s.classList.add('open');
    if (o) o.classList.add('visible');
  };

  window.closeSidebar = function () {
    var s = document.getElementById('sidebar');
    var o = document.getElementById('sidebarOverlay');
    if (s) s.classList.remove('open');
    if (o) o.classList.remove('visible');
  };

  /* ============================================================
     DASHBOARD LOAD
     ============================================================ */
  function loadDashboard() {
    statsLoaded = true;
    if (!currentUser) return;
    updateCreditsDisplay(currentUser.credits);

    // Load stats + recent searches (no limit for accurate stats)
    api('/api/vin/history').then(function (r) {
      var searches = (r.ok && Array.isArray(r.data)) ? r.data : [];
      // Stats
      var statMonth = document.getElementById('statMonth');
      var statTotal = document.getElementById('statTotal');
      var now = new Date();
      var thisMonth = searches.filter(function (s) {
        var d = new Date(s.createdAt);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length;
      if (statMonth) statMonth.textContent = thisMonth;
      if (statTotal) statTotal.textContent = searches.length;
      // Recent (last 4)
      renderRecentSearches(searches.slice(0, 4));
    }).catch(function () {
      var el = document.getElementById('recentSearches');
      if (el) el.innerHTML = '<div class="empty-state">Impossible de charger les données.</div>';
      var statMonth = document.getElementById('statMonth');
      var statTotal = document.getElementById('statTotal');
      if (statMonth) statMonth.textContent = '—';
      if (statTotal) statTotal.textContent = '—';
    });

    // Also update credits from server (in case changed)
    api('/api/auth/me').then(function (r) {
      if (r.ok && r.data && r.data.user) {
        currentUser.credits = r.data.user.credits;
        updateCreditsDisplay(r.data.user.credits);
        var pe = document.getElementById('profileEmail');
        var pc = document.getElementById('profileCredits');
        var pca = document.getElementById('profileCreatedAt');
        if (pe) pe.textContent = r.data.user.email || '—';
        if (pc) pc.textContent = r.data.user.credits;
        if (pca && r.data.user.createdAt) {
          pca.textContent = new Date(r.data.user.createdAt).toLocaleDateString('fr-FR', {
            day: 'numeric', month: 'long', year: 'numeric'
          });
        }
      }
    });
  }

  function renderRecentSearches(searches) {
    var el = document.getElementById('recentSearches');
    if (!el) return;
    if (!searches || searches.length === 0) {
      el.innerHTML = '<div class="empty-state">' +
        '<svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">' +
        '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>' +
        '<div>Aucune recherche pour le moment.</div>' +
        '<div style="font-size:.8125rem;margin-top:4px;">Lancez votre première recherche VIN ci-dessus.</div>' +
        '</div>';
      return;
    }
    var rows = searches.map(function (s) {
      var vehicle = [s.make, s.model, s.year].filter(Boolean).join(' ') || 'Véhicule inconnu';
      var typeBadge = s.reportKind === 'full'
        ? ' <span class="badge-full" title="Rapport détaillé">Complet</span>'
        : '';
      return '<tr>' +
        '<td class="cell-vin">' + esc(s.vin || '—') + typeBadge + '</td>' +
        '<td class="cell-vehicle">' + esc(vehicle) + '</td>' +
        '<td class="cell-date">' + formatDate(s.createdAt) + '</td>' +
        '</tr>';
    }).join('');
    el.innerHTML = '<table class="data-table">' +
      '<thead><tr><th>VIN</th><th>Véhicule</th><th>Date</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>';
  }

  /* ============================================================
     HISTORY LOAD
     ============================================================ */
  function loadHistory() {
    historyLoaded = true;
    var el = document.getElementById('historyContent');
    if (!el) return;
    el.innerHTML = '<div class="loading-state"><span class="spinner spinner--accent"></span><span>Chargement…</span></div>';

    api('/api/vin/history').then(function (r) {
      var searches = (r.ok && Array.isArray(r.data)) ? r.data : [];
      if (searches.length === 0) {
        el.innerHTML = '<div class="empty-state">' +
          '<svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">' +
          '<path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>' +
          '<div style="margin-top:12px;">Aucune recherche pour le moment.</div>' +
          '<div style="font-size:.8125rem;margin-top:4px;color:var(--text-muted);">Vos rapports VIN apparaîtront ici après chaque recherche.</div>' +
          '</div>';
        return;
      }
      var rows = searches.map(function (s) {
        var vehicle = [s.make, s.model, s.year].filter(Boolean).join(' ').trim();
        if (!vehicle) {
          vehicle = s.hasSnapshot
            ? '(détail enregistré — utiliser le bouton)'
            : '(résumé non rempli — relancer l’analyse)';
        }
        var typeBadge = s.reportKind === 'full'
          ? ' <span class="badge-full">Complet</span>'
          : '';
        var actionHtml = '';
        if (s.id && s.reportKind === 'full' && s.hasSnapshot) {
          actionHtml =
            '<button type="button" class="btn-history-detail" data-txid="' +
            esc(s.id) +
            '" data-vin="' +
            esc(s.vin || '') +
            '">Voir le détail</button>';
        } else if (s.vin && s.vin.length === 17) {
          actionHtml =
            '<button type="button" class="btn-history-prefill" data-vin="' +
            esc(s.vin) +
            '">Rouvrir l’analyse</button>';
        } else {
          actionHtml = '—';
        }
        return (
          '<tr>' +
          '<td class="cell-vin">' +
          esc(s.vin || '—') +
          typeBadge +
          '</td>' +
          '<td class="cell-vehicle">' +
          esc(vehicle) +
          '</td>' +
          '<td>' +
          esc(s.fuel_type || '—') +
          '</td>' +
          '<td>' +
          esc(s.engine || '—') +
          '</td>' +
          '<td class="cell-date">' +
          formatDate(s.createdAt) +
          '</td>' +
          '<td class="cell-actions history-actions">' +
          actionHtml +
          '</td>' +
          '</tr>'
        );
      }).join('');
      el.innerHTML =
        '<table class="data-table data-table--history">' +
        '<thead><tr><th>VIN</th><th>Véhicule</th><th>Carburant</th><th>Moteur</th><th>Date</th><th>Accès</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
      el.querySelectorAll('.btn-history-detail').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var tid = btn.getAttribute('data-txid');
          var v = (btn.getAttribute('data-vin') || '').trim();
          if (tid) openStoredFullReport(tid, v);
        });
      });
      el.querySelectorAll('.btn-history-prefill').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var v = (btn.getAttribute('data-vin') || '').trim();
          if (v) prefillVinSearch(v, true);
        });
      });
    }).catch(function () {
      el.innerHTML = '<div class="empty-state">Erreur de chargement. Réessayez.</div>';
    });
  }

  /** Rapport complet déjà enregistré côté serveur — ouvre l’onglet recherche + panneaux. */
  function openStoredFullReport(txId, vinHint) {
    var errEl = document.getElementById('searchError');
    api('/api/vin/report/' + encodeURIComponent(txId)).then(function (r) {
      if (!r.ok || !r.data || r.data.status !== 'success' || !r.data.data) {
        var m =
          (r.data && r.data.message) || 'Rapport indisponible. Relancez l’analyse depuis l’onglet Nouvelle recherche (1 crédit).';
        if (errEl) {
          goSection('search');
          errEl.textContent = m;
          errEl.style.display = 'block';
        } else {
          goSection('search');
        }
        return;
      }
      var bundle = r.data.data;
      var v = (bundle && bundle.vin) || vinHint || '';
      v = String(v)
        .replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '')
        .toUpperCase();
      goSection('search');
      setTimeout(function () {
        var input = document.getElementById('vinInput');
        if (input) input.value = v;
        if (errEl) {
          errEl.style.display = 'none';
        }
        renderFullVinResult(v, bundle, txId);
      }, 50);
    });
  }

  function prefillVinSearch(vin, showHint) {
    goSection('search');
    setTimeout(function () {
      var input = document.getElementById('vinInput');
      if (input) input.value = vin;
      if (showHint) {
        var h = document.getElementById('searchError');
        if (h) {
          h.textContent =
            'Saisie préremplie : lancez la recherche pour 1 crédit afin d’afficher de nouveau le rapport complet.';
          h.style.display = 'block';
          h.classList.remove('search-error--hard');
        }
      }
    }, 50);
  }

  /* ============================================================
     VIN SEARCH
     ============================================================ */
  window.doVinSearch = function () {
    var input = document.getElementById('vinInput');
    var vin = (input && input.value || '').replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '').toUpperCase();
    var errorEl = document.getElementById('searchError');
    var resultEl = document.getElementById('vinResult');

    if (errorEl) errorEl.style.display = 'none';
    if (resultEl) resultEl.style.display = 'none';

    if (vin.length !== 17) {
      if (errorEl) { errorEl.textContent = 'Le VIN doit comporter exactement 17 caractères.'; errorEl.style.display = 'block'; }
      return;
    }

    if (!currentUser || currentUser.credits < 1) {
      if (errorEl) {
        errorEl.innerHTML = 'Crédits insuffisants. <button class="auth-link" onclick="goSection(\'credits\')">Recharger →</button>';
        errorEl.style.display = 'block';
      }
      return;
    }

    setLoading('searchBtn', 'searchBtnText', 'searchSpinner', true);

    var searchPath;
    if (vinDecodeProvider === 'vehicledatabases') {
      searchPath = '/api/vd/full-report/' + encodeURIComponent(vin);
    } else if (vinDecodeProvider === 'carapi') {
      searchPath = '/api/vin-full-report/' + encodeURIComponent(vin);
    } else if (vdEnabled) {
      searchPath = '/api/vd/full-report/' + encodeURIComponent(vin);
    } else if (carApiEnabled) {
      searchPath = '/api/vin-full-report/' + encodeURIComponent(vin);
    } else {
      searchPath = '/api/vin-decode/' + encodeURIComponent(vin);
    }
    api(searchPath).then(function (r) {
      setLoading('searchBtn', 'searchBtnText', 'searchSpinner', false);

      if (!r.ok || !r.data || r.data.status !== 'success') {
        var msg = (r.data && r.data.message) || 'VIN introuvable ou invalide.';
        if (r.status === 502 && r.data && r.data.message) {
          msg = r.data.message;
        }
        if (r.status === 503 && r.data && r.data.message) {
          msg = r.data.message;
        }
        if (r.status === 402) {
          msg = 'Crédits insuffisants. <button class="auth-link" onclick="goSection(\'credits\')">Recharger →</button>';
        } else if (r.status === 401) {
          msg = 'Session expirée. Rechargez la page.';
        }
        if (errorEl) { errorEl.innerHTML = msg; errorEl.style.display = 'block'; }
        return;
      }

      if (currentUser && currentUser.credits > 0) {
        currentUser.credits -= 1;
        updateCreditsDisplay(currentUser.credits);
      }

      historyLoaded = false;
      api('/api/auth/me').then(function (mr) {
        if (mr.ok && mr.data && mr.data.user) {
          currentUser.credits = mr.data.user.credits;
          updateCreditsDisplay(mr.data.user.credits);
        }
      });

      if (r.data && r.data.data && r.data.data.vinDecode) {
        renderVdResult(vin, r.data.data, r.data.transactionId);
      } else if (r.data && r.data.data && r.data.data.decode) {
        renderFullVinResult(vin, r.data.data, r.data.transactionId);
      } else {
        renderVinResult(vin, r.data);
      }
    }).catch(function () {
      setLoading('searchBtn', 'searchBtnText', 'searchSpinner', false);
      if (errorEl) { errorEl.textContent = 'Erreur réseau. Réessayez.'; errorEl.style.display = 'block'; }
    });
  };

  var REPORT_COUNTRY_FR = {
    ad: 'Andorre', al: 'Albanie', at: 'Autriche', ba: 'Bosnie-Herzégovine', be: 'Belgique', bg: 'Bulgarie',
    by: 'Biélorussie', ch: 'Suisse', cy: 'Chypre', cz: 'République tchèque', de: 'Allemagne', dk: 'Danemark',
    ee: 'Estonie', es: 'Espagne', fi: 'Finlande', fr: 'France', gb: 'Royaume-Uni', gr: 'Grèce', hr: 'Croatie',
    hu: 'Hongrie', ie: 'Irlande', is: 'Islande', it: 'Italie', li: 'Liechtenstein', lt: 'Lituanie', lu: 'Luxembourg',
    lv: 'Lettonie', md: 'Moldavie', me: 'Monténégro', mk: 'Macédoine du Nord', mt: 'Malte', nl: 'Pays-Bas', 'no': 'Norvège',
    pl: 'Pologne', pt: 'Portugal', ro: 'Roumanie', rs: 'Serbie', se: 'Suède', si: 'Slovénie', sk: 'Slovaquie', sm: 'Saint-Marin',
    ua: 'Ukraine', va: 'Vatican', skt: 'Slovaquie'
  };

  function frCountryCode(code) {
    if (code == null || code === '') return '—';
    var c = String(code).toLowerCase();
    return REPORT_COUNTRY_FR[c] || c.toUpperCase();
  }

  function frFuel(v) {
    if (v == null) return 'Non renseigné';
    var s = String(v).toLowerCase().trim();
    if (s === '' || s === 'none' || s === 'n/a' || s === 'null') return 'Non renseigné';
    var m = {
      petrol: 'Essence', gasoline: 'Essence', diesel: 'Diesel', electric: 'Électrique', hybrid: 'Hybride',
      'plug-in hybrid': 'Hybride rechargeable', lpg: 'GPL / GLP', cng: 'Gaz naturel (GNC)', hydrogen: 'Hydrogène',
      'flexible fuel': 'Bi-carburant (E85, etc.)', other: 'Autre', unknown: 'Non renseigné'
    };
    return m[s] || String(v);
  }

  function frTransmission(v) {
    if (v == null) return 'Non renseigné';
    var s = String(v).toLowerCase().trim();
    if (s === '' || s === 'none') return 'Non renseigné';
    var m = { manual: 'Manuelle', automatic: 'Automatique', cvt: 'CVT (variateur)', 'dual-clutch': 'Double embrayage', dct: 'Double embrayage' };
    return m[s] || String(v);
  }

  function frDrivetrain(v) {
    if (v == null) return 'Non renseigné';
    var s = String(v).toLowerCase().trim();
    if (s === '' || s === 'none') return 'Non renseigné';
    var m = { fwd: 'Avant (traction)', rwd: 'Propulsion arrière', awd: '4 roues motrices (AWD/4x4)', '4x4': '4x4' };
    return m[s] || String(v);
  }

  function frPayFrequency(f) {
    if (f === 'monthly') return 'Mensuel';
    if (f === 'one-time' || f === 'onetime' || f === 'one time') return 'Ponctuel';
    return f ? String(f) : '—';
  }

  function frPayType(t) {
    if (t === 'loan') return 'Mensualité de prêt';
    if (t === 'down-payment' || t === 'down payment') return 'Apport / acompte';
    return t ? String(t) : '—';
  }

  function formatMoney(n, currency) {
    if (n == null || n === '' || (typeof n === 'number' && !isFinite(n))) return '—';
    var c = (currency && String(currency)) || 'EUR';
    try {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(n));
    } catch (e) {
      return String(n) + ' ' + c;
    }
  }

  function formatKm(n) {
    if (n == null || n === '' || (typeof n === 'number' && !isFinite(n))) return '—';
    try {
      return new Intl.NumberFormat('fr-FR').format(Math.round(Number(n))) + ' km';
    } catch (e) {
      return String(n) + ' km';
    }
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('fr-FR', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return String(iso); }
  }

  function reportPillClass(kind) {
    if (kind === 'ok') return 'report-pill report-pill--ok';
    if (kind === 'warn') return 'report-pill report-pill--warn';
    if (kind === 'err') return 'report-pill report-pill--err';
    if (kind === 'neutral') return 'report-pill report-pill--neutral';
    return 'report-pill';
  }

  function firstDefined(obj, keys) {
    if (!obj) return null;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = obj[k];
      if (v != null && v !== '' && String(v).toLowerCase() !== 'none' && String(v) !== 'n/a') {
        return v;
      }
    }
    return null;
  }

  function reportBlockStatusPill(block) {
    if (block == null) {
      return '<span class="' + reportPillClass('err') + '">Absente</span>';
    }
    if (block._infoOnly) {
      return '<span class="' + reportPillClass('neutral') + '">Info</span>';
    }
    if (block.skipped) {
      return '<span class="' + reportPillClass('neutral') + '">Non requise</span>';
    }
    if (block.error) {
      return '<span class="' + reportPillClass('err') + '">Erreur</span>';
    }
    if (block.ok === false) {
      if (block.status === 400 || block.status === 404) {
        return '<span class="' + reportPillClass('warn') + '">Indisponible</span>';
      }
      return '<span class="' + reportPillClass('err') + '">Échec</span>';
    }
    return '<span class="' + reportPillClass('ok') + '">Reçu</span>';
  }

  function renderDecodeBlock(block, bundle) {
    if (block == null) {
      return '<p class="full-report-err">Décodage absent</p>';
    }
    if (block.error) {
      return '<p class="full-report-err">' + esc(String(block.error)) + '</p>';
    }
    if (block.ok === false) {
      return (
        '<div class="report-decode report-decode--fail"><p class="report-fail__title">Le décodage de ce numéro de châssis n’a pas pu être complété.</p></div>'
      );
    }
    var b = block.data && typeof block.data === 'object' && !Array.isArray(block.data) ? block.data : {};
    var inner = b.data && typeof b.data === 'object' && !Array.isArray(b.data) ? b.data : {};
    var spec = b.specifications && typeof b.specifications === 'object' && !Array.isArray(b.specifications) ? b.specifications : null;
    var id = block.identity && typeof block.identity === 'object' ? block.identity : null;
    var make = (id && id.make) || b.make;
    var model = (id && id.model) || b.model;
    var y = (id && id.year != null) ? id.year : b.year;
    var vinSh = b.vin != null && b.vin !== '' ? b.vin : (bundle && bundle.vin) ? String(bundle.vin) : '—';
    var intro =
      '<p class="report-lead">Fiche d’identification liée à ce numéro de châssis (VIN) : caractéristiques déclarées par le constructeur et informations techniques lorsqu’elles sont disponibles.</p>';
    var grid =
      '<div class="report-kv report-kv--hero">' +
      '<div class="report-kv-item"><span class="report-kv-label">VIN</span><span class="report-kv-value report-kv-mono">' + esc(String(vinSh || b.vin || '—')) + '</span></div>' +
      '<div class="report-kv-item"><span class="report-kv-label">Marque</span><span class="report-kv-value">' + esc(make != null ? String(make) : '—') + '</span></div>' +
      '<div class="report-kv-item"><span class="report-kv-label">Modèle</span><span class="report-kv-value">' + esc(model != null ? String(model) : '—') + '</span></div>' +
      '<div class="report-kv-item"><span class="report-kv-label">Année modèle (si indiquée)</span><span class="report-kv-value">' + esc(y != null && y !== '' ? String(y) : '—') + '</span></div>' +
      '</div>';
    var more = [];
    var pick = function (o, keys, label) {
      var v = firstDefined(o, keys);
      if (v != null) more.push({ l: label, v: v });
    };
    if (Object.keys(inner).length) {
      pick(inner, ['vehicleType', 'vehicle_type', 'type'], 'Type');
      pick(inner, ['bodyClass', 'body_class'], 'Carrosserie');
      pick(inner, ['driveType', 'drive_type', 'drivetrain'], 'Motricité');
    }
    if (spec) {
      pick(spec, ['fuel', 'fuelType', 'engine'], 'Moteur / carburant (spec.)');
    }
    var moreHtml = '';
    if (more.length) {
      moreHtml = '<p class="report-subhead">Détails complémentaires</p><div class="report-kv report-kv--compact">';
      more.forEach(function (m) {
        moreHtml +=
          '<div class="report-kv-item"><span class="report-kv-label">' + esc(m.l) + '</span><span class="report-kv-value">' + esc(String(m.v)) + '</span></div>';
      });
      moreHtml += '</div>';
    }
    return (
      intro +
      grid +
      moreHtml +
      '<p class="report-footnote">Ces éléments proviennent du décodage du numéro de châssis et des bases de référence accessibles — ils peuvent ne pas lister toutes les options du véhicule.</p>'
    );
  }

  function renderPlateToVinInfoBlock() {
    return (
      '<div class="report-plate2vin-info report-callout report-callout--info">' +
      '<h4 class="report-plate2vin-title">Recherche par plaque d’immatriculation</h4>' +
      '<p class="report-lead" style="margin:0 0 8px">Ce rapport a été généré à partir du <strong>numéro VIN (châssis)</strong> que vous avez saisi. Il est aussi possible, lorsque le service l’ouvre, de retrouver un VIN en indiquant la <strong>plaque d’immatriculation</strong> et le <strong>pays d’immatriculation</strong>.</p>' +
      '<p class="report-footnote" style="margin:0">Le passage de la plaque au VIN n’a pas été utilisé pour l’analyse de cette page.</p></div>'
    );
  }

  function renderInspectionData(data, enrichment) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var ins = d.inspection && typeof d.inspection === 'object' ? d.inspection : {};
    var ctry = d.country;
    var stk = ins.stkValidTo;
    var ek = ins.ekValidTo;
    var enrLine = '';
    if (enrichment && enrichment.inspectionQueryCountry) {
      enrLine =
        '<p class="report-context-note">Rappel : les dates de contrôle affichées ici s’entendent pour la <strong>zone de couverture</strong> des bases disponibles (référence : ' +
        esc(frCountryCode(enrichment.inspectionQueryCountry)) + '). Elles ne remplacent pas le contrôle technique français ou d’un autre pays d’immatriculation.</p>';
    }
    var hint =
      enrLine +
      '<p class="report-lead">Contrôles périodiques et contrôle des émissions : dates lorsqu’elles figurent dans les sources consultées, pour le territoire de référence indiqué. ' +
      'Tous les pays ne disposent pas de données équivalentes — l’absence d’indication ne signifie pas qu’il n’y a pas eu de contrôle.</p>';
    var countryLine =
      '<div class="report-kv report-kv--hero">' +
      '<div class="report-kv-item"><span class="report-kv-label">Pays de référence (données affichées)</span>' +
      '<span class="report-kv-value">' + esc(frCountryCode(ctry)) + '</span></div>' +
      '<div class="report-kv-item"><span class="report-kv-label">VIN</span>' +
      '<span class="report-kv-value report-kv-mono">' + esc(d.vin || '—') + '</span></div></div>';
    var two =
      '<div class="report-card-grid report-card-grid--2">' +
      '<div class="report-mini-card">' +
      '<div class="report-mini-card__label">STK (contrôle périodique)</div>' +
      '<div class="report-mini-card__val">' + (stk ? esc(formatDate(stk)) : '<span class="empty-val">Aucune date / non applicable</span>') + '</div>' +
      '<p class="report-mini-card__hint">Validité du contrôle technique périodique (équivalent MOT / périodicité selon le pays).</p></div>' +
      '<div class="report-mini-card">' +
      '<div class="report-mini-card__label">EK (émissions / pollution)</div>' +
      '<div class="report-mini-card__val">' + (ek ? esc(formatDate(ek)) : '<span class="empty-val">Aucune date / non applicable</span>') + '</div>' +
      '<p class="report-mini-card__hint">Contrôle des émissions (EK) lorsqu’une date est disponible pour le territoire indiqué.</p></div></div>';
    return hint + countryLine + two;
  }

  function renderStolenData(data) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var stolen = d.stolen === true;
    var badge =
      stolen
        ? '<div class="report-hero report-hero--alert"><div class="report-hero__icon" aria-hidden="true">!</div><div>' +
          '<div class="report-hero__title">Signalement de vol</div>' +
          '<p class="report-hero__text">D’après les bases de données accessibles, ce véhicule apparaît comme signalé. En cas d’achat, vérifiez auprès des autorités compétentes (police, gendarmerie, préfecture).</p></div></div>'
        : '<div class="report-hero report-hero--ok"><div class="report-hero__icon" aria-hidden="true">✓</div><div>' +
          '<div class="report-hero__title">Aucun signalement de vol</div>' +
          '<p class="report-hero__text">Aucun vol n’a été signalé pour ce VIN sur les recherches couvertes par ce rapport. Ce résultat ne remplace pas une vérification auprès des autorités en cas de doute.</p></div></div>';
    var map = d.countries && typeof d.countries === 'object' && !Array.isArray(d.countries) ? d.countries : null;
    var grid = '';
    if (map) {
      var keys = Object.keys(map).sort();
      grid =
        '<p class="report-subhead">Détail par pays (recherche multi-bases)</p><div class="report-country-grid">';
      keys.forEach(function (k) {
        var on = map[k] === true;
        grid +=
          '<div class="report-country-cell ' + (on ? 'is-alert' : 'is-clear') + '">' +
          '<span class="report-country-name">' + esc(frCountryCode(k)) + '</span>' +
          '<span class="report-pill ' + (on ? 'report-pill--err' : 'report-pill--ok') + '">' +
          (on ? 'Signalé' : 'Rien de signalé') + '</span></div>';
      });
      grid += '</div><p class="report-footnote">Les pays couverts par cette recherche peuvent varier. En cas de doute sur un achat, rapprochez-vous des autorités (gendarmerie, police).</p>';
    }
    return badge + grid;
  }

  function renderMileageData(data) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var list = d.mileageHistory;
    var n = d.totalRecords != null ? Number(d.totalRecords) : (Array.isArray(list) ? list.length : 0);
    if (!Array.isArray(list) || list.length === 0) {
      return (
        '<p class="report-lead">Aucun historique de kilométrage n’est disponible dans ce rapport. D’autres preuves peuvent exister (carnet, factures, contrôles) sans figurer ici.</p>'
      );
    }
    var maxKm = 0;
    list.forEach(function (row) {
      var km = Number(row.mileage) || 0;
      if (km > maxKm) maxKm = km;
    });
    var html =
      '<p class="report-lead">' + n + ' relevé(s) de kilométrage — chaque date correspond à une information connue pour ce véhicule. Méfiez-vous des <strong>écarts incohérents</strong> d’un relevé à l’autre (risque d’erreur ou de fraude).</p>';
    if (maxKm > 0) {
      var bars = list
        .slice()
        .sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); })
        .map(function (row) {
          var km = Number(row.mileage) || 0;
          var p = maxKm > 0 ? Math.round((km / maxKm) * 100) : 0;
          return (
            '<div class="report-mile-bar"><div class="report-mile-bar__track"><div class="report-mile-bar__fill" style="width:' + p + '%"></div></div>' +
            '<div class="report-mile-bar__meta"><span>' + esc(formatKm(km)) + '</span><span class="report-mile-date">' + esc(formatDateTime(row.createdAt)) + '</span></div></div>'
          );
        });
      html += '<div class="report-mile-stack">' + bars.join('') + '</div>';
    }
    html += '<div class="report-table-wrap"><table class="report-table" role="grid"><thead><tr><th>Date d’enregistrement</th><th>Kilométrage</th></tr></thead><tbody>';
    list.slice().forEach(function (row) {
      html +=
        '<tr><td>' + esc(formatDateTime(row.createdAt)) + '</td><td class="num">' + esc(formatKm(row.mileage)) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function renderPhotosData(data) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var photos = d.photos;
    if (!Array.isArray(photos) || photos.length === 0) {
      return (
        '<p class="report-lead">Aucune photo n’est associée à ce véhicule dans notre analyse pour l’instant. Des visuels correspondants peuvent exister ailleurs (annonces, mandataire).</p>'
      );
    }
    var items = photos
      .map(function (u) {
        if (!u || typeof u !== 'string') return '';
        return (
          '<a class="report-photo" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' +
          '<img src="' + esc(u) + '" alt="Photo associée au VIN" loading="lazy" decoding="async" />' +
          '<span class="report-photo__cap">Agrandir</span></a>'
        );
      })
      .filter(Boolean);
    return (
      '<p class="report-lead">' + items.length + ' visuel(s) — cliquez pour ouvrir l’image en grand (nouvel onglet).</p>' +
      '<div class="report-photo-grid">' + items.join('') + '</div>'
    );
  }

  function renderPaymentsData(data, enrichment) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var cur = d.currency || 'EUR';
    var pay = Array.isArray(d.payments) ? d.payments : [];
    var paramBlock = '';
    if (enrichment && enrichment.payment && typeof enrichment.payment === 'object') {
      var p = enrichment.payment;
      var ir = p.interestRate != null && isFinite(Number(p.interestRate)) ? String(p.interestRate) : '—';
      var lt = p.loanTerm != null ? String(p.loanTerm) : '—';
      paramBlock =
        '<div class="report-sim-params"><p class="report-subhead">Hypothèses de la simulation</p><div class="report-kv report-kv--compact">' +
        '<div class="report-kv-item"><span class="report-kv-label">Prix du véhicule</span><span class="report-kv-value">' + esc(formatMoney(p.price, 'EUR')) + '</span></div>' +
        '<div class="report-kv-item"><span class="report-kv-label">Apport (acompte)</span><span class="report-kv-value">' + esc(formatMoney(p.downPayment, 'EUR')) + '</span></div>' +
        '<div class="report-kv-item"><span class="report-kv-label">Durée du prêt</span><span class="report-kv-value">' + esc(lt) + ' mois</span></div>' +
        '<div class="report-kv-item"><span class="report-kv-label">Taux d’intérêt</span><span class="report-kv-value">' + esc(ir) + ' %</span></div></div></div>';
    }
    var top = paramBlock +
      '<div class="report-finance-hero"><div class="report-finance-kpis">' +
      '<div class="report-finance-kpi"><span class="report-finance-kpi__l">Mensualité (estim.)</span>' +
      '<span class="report-finance-kpi__v">' + esc(formatMoney(d.monthlyPayment, cur)) + '</span></div>' +
      '<div class="report-finance-kpi"><span class="report-finance-kpi__l">Montant emprunté (après apport)</span>' +
      '<span class="report-finance-kpi__v">' + esc(formatMoney(d.loanAmount, cur)) + '</span></div>' +
      '<div class="report-finance-kpi"><span class="report-finance-kpi__l">Coût total (capital + intérêts sur la durée)</span>' +
      '<span class="report-finance-kpi__v">' + esc(formatMoney(d.totalPaid, cur)) + '</span></div>' +
      '<div class="report-finance-kpi"><span class="report-finance-kpi__l">Intérêts totaux (estim.)</span>' +
      '<span class="report-finance-kpi__v">' + esc(formatMoney(d.totalInterest, cur)) + '</span></div></div></div>' +
      '<p class="report-footnote">Simulation d’exemple : elle est calculée à partir d’un prix, d’un apport, d’une durée et d’un taux. Pour un prêt réel, demandez un devis à un organisme de crédit (TAEG, assurances, frais de dossier possibles).</p>';
    if (pay.length === 0) {
      return top;
    }
    var rows = pay
      .map(function (p) {
        return (
          '<tr><td>' + esc(formatDate(p.dueDate)) + '</td><td>' + esc(formatMoney(p.amount, p.currency || cur)) + '</td>' +
          '<td>' + esc(frPayFrequency(p.frequency)) + '</td><td>' + esc(frPayType(p.type)) + '</td><td>' + esc(p.description || '—') + '</td></tr>'
        );
      })
      .join('');
    var table =
      '<div class="report-table-wrap"><table class="report-table" role="grid"><thead><tr><th>Échéance</th><th>Montant</th><th>Fréquence</th><th>Type</th><th>Description</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>';
    return top + table;
  }

  function renderValuationData(data, enrichment) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var cur = d.currency || 'EUR';
    var mctx = '';
    if (enrichment && enrichment.marketCountry) {
      mctx = '<p class="report-context-note">Estimation calculée pour le marché <strong>' + esc(frCountryCode(String(enrichment.marketCountry))) + '</strong>.</p>';
    }
    return (
      mctx +
      '<div class="report-valuation">' +
      '<div class="report-valuation__price"><span class="report-valuation__n">' + esc(formatMoney(d.valuationPrice, cur)) + '</span>' +
      '<span class="report-valuation__hint">Fourchette indicative sur le marché considéré</span></div>' +
      '<div class="report-kv">' +
      '<div class="report-kv-item"><span class="report-kv-label">Marque</span><span class="report-kv-value">' + esc(d.make != null ? String(d.make) : '—') + '</span></div>' +
      '<div class="report-kv-item"><span class="report-kv-label">Modèle</span><span class="report-kv-value">' + esc(d.model != null ? String(d.model) : '—') + '</span></div>' +
      '<div class="report-kv-item"><span class="report-kv-label">Année (millésime)</span><span class="report-kv-value">' + esc(d.year != null ? String(d.year) : '—') + '</span></div>' +
      '<div class="report-kv-item"><span class="report-kv-label">Marché de référence</span><span class="report-kv-value">' + esc(frCountryCode(d.country)) + '</span></div></div></div>' +
      '<p class="report-footnote">Valeur donnée à titre d’indication : elle dépend de l’état, du kilométrage, de l’équipement et des prix en vigueur au moment de la consultation.</p>'
    );
  }

  function renderListingsData(data, enrichment) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var L = d.listings;
    var pag = d.pagination;
    var listCtx = '';
    if (enrichment) {
      var mktL = frCountryCode(String(enrichment.marketCountry || ''));
      var limL = enrichment.listingLimit != null ? String(enrichment.listingLimit) : '10';
      listCtx =
        '<p class="report-context-note">Sélection d’annonces de véhicules comparables' +
        (mktL && mktL !== '—' ? ' sur le marché <strong>' + esc(mktL) + '</strong>' : '') +
        (limL ? ', jusqu’à ' + esc(limL) + ' proposition(s) présentée(s) dans le rapport' : '') +
        '.</p>';
    }
    if (!Array.isArray(L) || L.length === 0) {
      return (
        listCtx +
        '<p class="report-lead">Aucune annonce comparable n’a été trouvée pour l’instant. L’offre d’occasion évolue souvent : vous pouvez relancer une analyse plus tard.</p>'
      );
    }
    var cards = L.map(function (it) {
      var spec = it.specifications && typeof it.specifications === 'object' ? it.specifications : {};
      var av = it.availability && typeof it.availability === 'object' ? it.availability : {};
      return (
        '<div class="report-listing-card">' +
        '<div class="report-listing-card__head">Annonce liée (VIN : ' + esc((it.vin && String(it.vin)) || '—') + ')</div>' +
        '<div class="report-listing-specs">' +
        '<div><span class="lbl">Marque / modèle</span><span>' + esc((spec.make || '—') + ' · ' + (spec.model || '—')) + '</span></div>' +
        '<div><span class="lbl">Carburant</span><span>' + esc(frFuel(spec.fuel)) + '</span></div>' +
        '<div><span class="lbl">Boîte</span><span>' + esc(frTransmission(spec.transmission)) + '</span></div>' +
        '<div><span class="lbl">1ère immatriculation (si dispo)</span><span>' + esc(formatDate(spec.registrationDate)) + '</span></div>' +
        '</div>' +
        '<div class="report-listing-avail">' +
        '<span class="tag">Photos (réf.) ' + esc(String(av.imagesCount != null ? av.imagesCount : '0')) + '</span>' +
        '<span class="tag">Immat. ' + esc(String(av.plateNumbersCount != null ? av.plateNumbersCount : '0')) + '</span>' +
        '<span class="tag">Entrées d’hist. ' + esc(String(av.historyItemsCount != null ? av.historyItemsCount : '0')) + '</span>' +
        '</div></div>'
      );
    });
    return (
      listCtx +
      '<p class="report-lead">' + L.length + ' annonce(s) d’exemple, proches de votre modèle (indications de marché, liste non exhaustive).</p>' +
      '<div class="report-listing-stack">' + cards.join('') + '</div>'
    );
  }

  function renderBlockFailureHtml(blockKey, block) {
    var insHint = '';
    if (block.data && typeof block.data === 'object' && block.data.error) {
      var es = String(block.data.error);
      if (/Slovakia|Only Slovakia|sk/i.test(es) && blockKey === 'inspection') {
        insHint =
          '<div class="report-callout report-callout--info">' +
          '<strong>Information :</strong> les dates de contrôle technique périodique (STK) et de contrôle des émissions (EK) ne sont pas toujours disponibles selon le pays. ' +
          'Un véhicule immatriculé en France ou ailleurs peut donc n’avoir ici <strong>aucune date de contrôle affichée</strong>, ce qui n’indique pas qu’il n’y a pas eu d’examen périodique sur place.</div>';
      }
    }
    if (blockKey === 'photos' && (block.status === 404 || (block.data && /no photos|not found/i.test(String((block.data.error || block.data.message || '')))))) {
      insHint =
        '<div class="report-callout report-callout--info">Aucune photo n’est disponible pour ce véhicule dans cette analyse — c’est fréquent.</div>';
    }
    return (
      insHint +
      '<div class="report-fail"><p class="report-fail__title">Données indisponibles</p>' +
      '<p class="report-fail__sub">Cette section n’a pas pu être affichée : l’information recherchée ne figure pas dans les bases accessibles, ou ne s’applique pas à ce véhicule.</p></div>'
    );
  }

  function renderCarApiBlockHtml(key, block, bundle) {
    if (key === '_plateToVin') {
      return renderPlateToVinInfoBlock();
    }
    if (key === 'decode') {
      return renderDecodeBlock(block, bundle);
    }
    if (block == null) {
      return '<p class="full-report-err">Bloc absent</p>';
    }
    if (block.skipped) {
      var r = String(block.reason || '—');
      var fr =
        r === 'make_model_year_unavailable'
          ? 'La cote de marché et les annonces comparables nécessitent d’avoir clairement identifié la marque, le modèle et l’année. Ces éléments n’ont pas pu être reconnus automatiquement pour ce VIN, cette partie du rapport n’a donc pas été générée.'
          : 'Cette rubrique n’a pas pu être générée. ' + esc(r);
      return (
        '<div class="report-skipped"><p class="report-skipped__text">' + fr + '</p>' +
        '<p class="report-footnote">Dès que la marque, le modèle et l’année sont reconnus sans ambiguïté, le rapport complet peut inclure la cote et des annonces comparables.</p></div>'
      );
    }
    if (block.error) {
      return '<p class="full-report-err">' + esc(String(block.error)) + '</p>';
    }
    if (block.ok === false) {
      return renderBlockFailureHtml(key, block);
    }
    var data = block.data;
    var enr = bundle && bundle.enrichment;
    if (key === 'inspection') return renderInspectionData(data, enr);
    if (key === 'stolenCheck') return renderStolenData(data);
    if (key === 'mileageHistory') return renderMileageData(data);
    if (key === 'photos') return renderPhotosData(data);
    if (key === 'payments') return renderPaymentsData(data, enr);
    if (key === 'vehicleValuation') return renderValuationData(data, enr);
    if (key === 'listings') return renderListingsData(data, enr);
    return (
      '<p class="report-lead">Cette section n’a pas pu être affichée correctement. Rechargez la page ou reprenez la recherche ; si le problème continue, contactez le support CarvinGuard.</p>'
    );
  }

  function updateVinPdfButton(transactionId) {
    var row = document.getElementById('vinResultPdfRow');
    var link = document.getElementById('vinResultPdfLink');
    if (!row || !link) return;
    if (transactionId && String(transactionId).length > 0) {
      link.href =
        window.location.origin + '/api/vin/report/' + encodeURIComponent(String(transactionId)) + '/pdf';
      link.setAttribute('download', 'rapport-vin-carvinguard.pdf');
      row.style.display = 'flex';
    } else {
      row.style.display = 'none';
      link.removeAttribute('href');
    }
  }

  /* ============================================================
     VEHICLEDATABASES RENDERING
     ============================================================ */

  function getVdSpec(specs, name) {
    if (!Array.isArray(specs)) return null;
    for (var _i = 0; _i < specs.length; _i++) {
      if (specs[_i] && specs[_i][name] != null) return specs[_i][name];
    }
    return null;
  }

  function vdVal(v) {
    if (v == null) return '';
    var s = String(v).trim();
    return (s === 'None' || s === 'N/A' || s === 'n/a' || s === 'null') ? '' : s;
  }

  function vdKv(label, value) {
    var v = vdVal(value);
    if (!v) return '';
    return (
      '<div class="report-kv-item"><span class="report-kv-label">' + esc(label) + '</span>' +
      '<span class="report-kv-value">' + esc(v) + '</span></div>'
    );
  }

  function renderVdIdentificationPanel(bundle) {
    var vd = bundle.vinDecode;
    if (!vd || !vd.ok || !vd.data) return '<p class="full-report-err">Données VIN indisponibles</p>';
    var body = vd.data;
    var d = (body.data && typeof body.data === 'object') ? body.data : body;
    var specs = Array.isArray(d.specifications) ? d.specifications : [];
    var eng = getVdSpec(specs, 'engine') || {};
    var fuelSpec = getVdSpec(specs, 'fuel') || {};
    var trans = (d.transmission && typeof d.transmission === 'object') ? d.transmission : {};
    var engParts = [
      vdVal(eng.type),
      eng.cylinders_configuration ? eng.cylinders_configuration + ' cyl.' : '',
      (eng.displacement && eng.displacement > 100) ? (eng.displacement / 1000).toFixed(1) + 'L' : (eng.displacement ? eng.displacement + 'L' : '')
    ].filter(Boolean);
    var engineStr = vdVal(d.engine) || engParts.join(' ');
    var transStr = (typeof d.transmission === 'string') ? d.transmission : (vdVal(trans.type) || vdVal(trans.description));
    var fuelStr = vdVal(d.fuel_type) || vdVal(fuelSpec.type);
    var driveStr = vdVal(d.drivetrain) || vdVal(d.drive_type);
    var html = '<div class="report-kv report-kv--compact">';
    html += vdKv('Marque', d.make);
    html += vdKv('Modèle', d.model);
    html += vdKv('Année', d.year);
    html += vdKv('Finition', d.trim || d.trim_and_style || d.style);
    html += vdKv('Type carrosserie', d.body_type);
    html += vdKv('Moteur', engineStr);
    html += vdKv('Transmission', transStr ? (frTransmission(transStr) !== 'Non renseigné' ? frTransmission(transStr) : transStr) : '');
    html += vdKv('Carburant', fuelStr ? (frFuel(fuelStr) !== 'Non renseigné' ? frFuel(fuelStr) : fuelStr) : '');
    html += vdKv('Motricité', driveStr ? (frDrivetrain(driveStr) !== 'Non renseigné' ? frDrivetrain(driveStr) : driveStr) : '');
    html += vdKv('Nombre de portes', d.doors);
    html += vdKv('Pays d\'assemblage', d.plant_country || d.country_of_manufacture);
    html += '</div>';
    var exterior = getVdSpec(specs, 'exterior') || {};
    var interior = getVdSpec(specs, 'interior') || {};
    var features = [];
    Object.keys(exterior).forEach(function (k) {
      var v = vdVal(exterior[k]);
      if (v) features.push(String(k).replace(/_/g, ' ') + ': ' + v);
    });
    Object.keys(interior).forEach(function (k) {
      var v = vdVal(interior[k]);
      if (v) features.push(String(k).replace(/_/g, ' ') + ': ' + v);
    });
    if (features.length) {
      html += '<div class="vin-decode-block"><h3 class="vin-decode-h">Équipements & options</h3><div class="report-chip-row">';
      html += features.slice(0, 32).map(function (f) { return '<span class="report-chip">' + esc(f) + '</span>'; }).join('');
      if (features.length > 32) html += '<span class="report-chip report-chip--more">+' + (features.length - 32) + ' autres</span>';
      html += '</div></div>';
    }
    return html;
  }

  function renderVdEuropePanel(section) {
    if (!section || !section.ok || !section.data) return '<p class="report-none">Données historiques Europe non disponibles pour ce VIN.</p>';
    var body = section.data;
    var d = (body.data && typeof body.data === 'object') ? body.data : body;
    if (!d || typeof d !== 'object') return '<p class="report-none">Données Europe non disponibles.</p>';
    var html = '<div class="report-kv report-kv--compact">';
    html += vdKv('Marque', d.make);
    html += vdKv('Modèle', d.model);
    html += vdKv('Année modèle', d.year || d.model_year);
    html += vdKv('Type carrosserie', d.body_type);
    html += vdKv('Carburant', d.fuel_type || d.fuel);
    html += vdKv('Cylindrée', d.engine_displacement || d.displacement);
    html += vdKv('Puissance', d.engine_power || d.power);
    html += vdKv('Transmission', d.transmission);
    html += vdKv('Pays de fabrication', d.country_of_manufacture || d.plant_country);
    html += vdKv('Normes Euro', d.emission_standard || d.euro_standard);
    html += '</div>';
    return html;
  }

  function renderVdStolenPanel(section) {
    if (!section || !section.ok || !section.data) return '<p class="full-report-err">Vérification vol non disponible</p>';
    var body = section.data;
    var d = (body.data && typeof body.data === 'object') ? body.data : body;
    var stolen = d.stolen;
    var statusHtml = '';
    if (stolen === false || stolen === 'false' || String(stolen || '').toLowerCase() === 'no' || String(stolen || '').toLowerCase() === 'not stolen') {
      statusHtml = '<div class="stolen-status stolen-status--ok"><strong>Non signalé volé</strong> — Aucun signalement dans les bases consultées.</div>';
    } else if (stolen === true || stolen === 'true' || String(stolen || '').toLowerCase() === 'yes' || String(stolen || '').toLowerCase() === 'stolen') {
      statusHtml = '<div class="stolen-status stolen-status--alert"><strong>SIGNALÉ VOLÉ</strong> — Ce véhicule figure dans une base de véhicules volés.</div>';
    } else {
      statusHtml = '<div class="stolen-status">Statut vol : ' + esc(String(stolen != null ? stolen : 'Non déterminé')) + '</div>';
    }
    var html = statusHtml + '<div class="report-kv report-kv--compact">';
    html += vdKv('Pays vérifiés', d.countries_checked);
    html += vdKv('Source', d.source);
    html += vdKv('Date de vérification', d.check_date);
    html += '</div>';
    return html;
  }

  function renderVdMarketValuePanel(section) {
    if (!section || !section.ok || !section.data) return '<p class="full-report-err">Cote marché non disponible</p>';
    var body = section.data;
    var raw = (body.data && typeof body.data === 'object') ? body.data : body;
    var rows = raw.market_value_data || raw.marketValueData || [];
    if (!Array.isArray(rows) || !rows.length) {
      var html2 = '<div class="report-kv report-kv--compact">';
      html2 += vdKv('Reprise', raw.trade_in || raw.tradeIn);
      html2 += vdKv('Entre particuliers', raw.private_party || raw.privateParty);
      html2 += vdKv('Concessionnaire', raw.dealer_retail || raw.dealerRetail);
      html2 += '</div>';
      return html2;
    }
    var html = '';
    rows.forEach(function (row) {
      var trim = row.trim || '';
      var mvArr = row['market value'] || row.market_value || [];
      html += '<div class="mv-trim-block">';
      if (trim) html += '<h4 class="mv-trim-title">' + esc(trim) + '</h4>';
      if (Array.isArray(mvArr) && mvArr.length) {
        html += '<table class="report-table"><thead><tr><th>Condition</th><th>Reprise</th><th>Particulier</th><th>Concessionnaire</th></tr></thead><tbody>';
        mvArr.forEach(function (item) {
          html += '<tr>';
          html += '<td>' + esc(String(item['Condition'] || item.condition || '—')) + '</td>';
          html += '<td>' + esc(String(item['Trade-In'] || item.trade_in || '—')) + '</td>';
          html += '<td>' + esc(String(item['Private Party'] || item.private_party || '—')) + '</td>';
          html += '<td>' + esc(String(item['Dealer Retail'] || item.dealer_retail || '—')) + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';
    });
    return html || '<p class="report-none">Données de cote non disponibles pour ce véhicule.</p>';
  }

  function renderVdRecallsPanel(section) {
    if (!section || !section.ok || !section.data) return '<p class="full-report-err">Rappels non disponibles</p>';
    var body = section.data;
    var d = (body.data && typeof body.data === 'object') ? body.data : body;
    var items = d.recalls || d.recall_list || (Array.isArray(d) ? d : []);
    if (!Array.isArray(items) || !items.length) {
      return '<p class="report-none">Aucun rappel constructeur enregistré pour ce véhicule.</p>';
    }
    var html = '<div class="recalls-list">';
    items.forEach(function (item) {
      html += '<div class="recall-item">';
      html += '<div class="recall-title">' + esc(item.recall_number || item.nhtsa_campaign_id || item.id || '—') + '</div>';
      if (item.consequence || item.description || item.defect_summary) {
        html += '<div class="recall-desc">' + esc(item.consequence || item.description || item.defect_summary || '') + '</div>';
      }
      if (item.remedy) html += '<div class="recall-remedy"><strong>Remède :</strong> ' + esc(item.remedy) + '</div>';
      if (item.report_received_date || item.date) html += '<div class="recall-date">Date : ' + esc(item.report_received_date || item.date) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderVdSalesHistoryPanel(section) {
    if (!section || !section.ok || !section.data) return '<p class="full-report-err">Historique ventes non disponible</p>';
    var body = section.data;
    var d = (body.data && typeof body.data === 'object') ? body.data : body;
    var sales = d.sales || d.history || (Array.isArray(d) ? d : []);
    if (!Array.isArray(sales) || !sales.length) {
      return '<p class="report-none">Aucun historique de vente disponible pour ce VIN.</p>';
    }
    var html = '<table class="report-table"><thead><tr><th>Date</th><th>Prix</th><th>Km</th><th>Localisation</th></tr></thead><tbody>';
    sales.forEach(function (s) {
      html += '<tr>';
      html += '<td>' + esc(s.date || s.sold_date || '—') + '</td>';
      html += '<td>' + esc(s.price != null ? String(s.price) : '—') + '</td>';
      html += '<td>' + esc((s.mileage || s.odometer) != null ? String(s.mileage || s.odometer) : '—') + '</td>';
      var loc = s.location || (s.city ? ((s.city || '') + (s.state ? ', ' + s.state : '')).trim() : '—');
      html += '<td>' + esc(loc) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function renderVdAuctionPanel(section) {
    if (!section || !section.ok || !section.data) return '<p class="full-report-err">Données enchères non disponibles</p>';
    var body = section.data;
    var d = (body.data && typeof body.data === 'object') ? body.data : body;
    var auctions = d.auctions || d.auction_list || d.results || (Array.isArray(d) ? d : []);
    if (!Array.isArray(auctions) || !auctions.length) {
      return '<p class="report-none">Aucune enchère enregistrée pour ce VIN.</p>';
    }
    var html = '<table class="report-table"><thead><tr><th>Date</th><th>Mise à prix</th><th>Prix final</th><th>Km</th></tr></thead><tbody>';
    auctions.forEach(function (a) {
      html += '<tr>';
      html += '<td>' + esc(a.date || a.sale_date || '—') + '</td>';
      html += '<td>' + esc((a.bid_start || a.starting_bid) != null ? String(a.bid_start || a.starting_bid) : '—') + '</td>';
      html += '<td>' + esc((a.sale_price || a.final_price) != null ? String(a.sale_price || a.final_price) : '—') + '</td>';
      html += '<td>' + esc((a.odometer || a.mileage) != null ? String(a.odometer || a.mileage) : '—') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function renderVdMediaPanel(section) {
    if (!section || !section.ok || !section.data) return '<p class="full-report-err">Photos non disponibles</p>';
    var body = section.data;
    var d = (body.data && typeof body.data === 'object') ? body.data : body;
    var colors = d.exterior_colors || d.colors || [];
    var html = '';
    if (Array.isArray(colors) && colors.length) {
      html += '<div class="vin-decode-block"><h3 class="vin-decode-h">Couleurs disponibles</h3><div class="report-chip-row">';
      colors.forEach(function (c) {
        var label = (c && (c.name || c.color_name)) ? String(c.name || c.color_name) : String(c);
        html += '<span class="report-chip">' + esc(label) + '</span>';
      });
      html += '</div></div>';
    }
    var photoUrls = [];
    ['photos', 'images', 'media', 'exterior', 'interior'].forEach(function (cat) {
      var arr = d[cat];
      if (Array.isArray(arr)) {
        arr.forEach(function (p) {
          var url = typeof p === 'string' ? p : (p && (p.url || p.src || p.image_url || p.photo_url) || '');
          if (url && url.startsWith('http')) photoUrls.push(url);
        });
      }
    });
    if (photoUrls.length) {
      html += '<div class="photos-grid">';
      photoUrls.slice(0, 12).forEach(function (url) {
        html += '<div class="photo-thumb"><img src="' + esc(url) + '" loading="lazy" alt="Photo du véhicule" style="max-width:100%;border-radius:6px;" /></div>';
      });
      html += '</div>';
    } else if (!colors.length) {
      html += '<p class="report-none">Aucun média disponible pour ce véhicule.</p>';
    }
    return html;
  }

  function renderVdMaintenancePanel(section) {
    if (!section || !section.ok || !section.data) return '<p class="full-report-err">Carnet entretien non disponible</p>';
    var body = section.data;
    var d = (body.data && typeof body.data === 'object') ? body.data : body;
    var intervals = d.maintenance_intervals || d.intervals || d.schedule || (Array.isArray(d) ? d : []);
    if (!Array.isArray(intervals) || !intervals.length) {
      return '<p class="report-none">Aucune donnée d\'entretien disponible pour ce véhicule.</p>';
    }
    var html = '<table class="report-table"><thead><tr><th>Opération</th><th>Intervalle km</th><th>Mois</th></tr></thead><tbody>';
    intervals.forEach(function (item) {
      html += '<tr>';
      html += '<td>' + esc(item.action || item.service || item.description || item.task || '—') + '</td>';
      html += '<td>' + esc((item.mileage_interval || item.km_interval || item.miles) != null ? String(item.mileage_interval || item.km_interval || item.miles) : '—') + '</td>';
      html += '<td>' + esc((item.month_interval || item.months) != null ? String(item.month_interval || item.months) : '—') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function renderVdWarrantyPanel(section) {
    if (!section) return '<p class="full-report-err">Garantie non disponible</p>';
    if (section.skipped) return '<p class="report-none">Données garantie non disponibles (véhicule non identifié).</p>';
    if (!section.ok || !section.data) return '<p class="full-report-err">Garantie non disponible</p>';
    var body = section.data;
    var d = (body.data && typeof body.data === 'object') ? body.data : body;
    var warranties = d.warranties || d.warranty_data || (Array.isArray(d) ? d : []);
    if (Array.isArray(warranties) && warranties.length) {
      var html = '<div class="report-kv report-kv--compact">';
      warranties.forEach(function (w) {
        var name = w.type || w.name || w.warranty_type || 'Garantie';
        var parts = [w.months ? w.months + ' mois' : '', w.miles ? w.miles + ' mi' : '', w.km ? w.km + ' km' : ''].filter(Boolean);
        html += vdKv(name, parts.join(' / ') || 'Non renseigné');
      });
      html += '</div>';
      return html;
    }
    var html2 = '<div class="report-kv report-kv--compact">';
    html2 += vdKv('Garantie constructeur', d.basic_warranty || d.basic);
    html2 += vdKv('Anti-perforation', d.corrosion_warranty || d.corrosion);
    html2 += vdKv('Groupe motopropulseur', d.powertrain_warranty || d.powertrain);
    html2 += vdKv('Assistance routière', d.roadside_warranty || d.roadside);
    html2 += '</div>';
    return html2;
  }

  function renderVdPanelHtml(key, bundle) {
    var section = bundle[key];
    if (key === 'vinDecode') return renderVdIdentificationPanel(bundle);
    if (key === 'europeVin') return renderVdEuropePanel(section);
    if (key === 'stolenCheck') return renderVdStolenPanel(section);
    if (key === 'marketValue') return renderVdMarketValuePanel(section);
    if (key === 'recalls') return renderVdRecallsPanel(section);
    if (key === 'salesHistory') return renderVdSalesHistoryPanel(section);
    if (key === 'auction') return renderVdAuctionPanel(section);
    if (key === 'media') return renderVdMediaPanel(section);
    if (key === 'maintenance') return renderVdMaintenancePanel(section);
    if (key === 'warranty') return renderVdWarrantyPanel(section);
    return '<p class="full-report-err">Section inconnue</p>';
  }

  function vdSectionStatusPill(section) {
    if (!section) return '<span class="status-pill status-pill--na">N/D</span>';
    if (section.skipped) return '<span class="status-pill status-pill--skip">N/A</span>';
    if (section.ok) return '<span class="status-pill status-pill--ok">OK</span>';
    return '<span class="status-pill status-pill--err">Erreur</span>';
  }

  function saneModelYear(raw) {
    if (raw == null || raw === '') return '';
    var s = String(raw).trim();
    if (/^\d{4}$/.test(s)) return s;
    var n = parseInt(s, 10);
    return n >= 1980 && n <= 2035 ? String(n) : '';
  }

  /** Données portail VD Europe (clés avec espaces possibles). */
  function readEuropeVinFlat(bundle) {
    var eu = bundle && bundle.europeVin;
    if (!eu || !eu.ok || !eu.data) return {};
    var body = eu.data;
    var d = body.data != null && typeof body.data === 'object' ? body.data : body;
    if (!d || typeof d !== 'object') return {};
    var gen =
      (d.general_information != null ? d.general_information : d['General Information']) || {};
    var spec =
      (d.vehicle_specification != null ? d.vehicle_specification : d['Vehicle Specification']) || {};
    return { gen: gen, spec: spec };
  }

  function renderVdResult(vin, bundle, transactionId) {
    var resultEl = document.getElementById('vinResult');
    var fr = document.getElementById('fullReportExtra');
    var id = bundle.identity || {};
    var vd = bundle.vinDecode;
    var vdBody = vd && vd.ok && vd.data ? vd.data : {};
    var vdData = vdBody.data && typeof vdBody.data === 'object' ? vdBody.data : vdBody;
    var specs = Array.isArray(vdData.specifications) ? vdData.specifications : [];
    var eng = getVdSpec(specs, 'engine') || {};
    var fuel2 = getVdSpec(specs, 'fuel') || {};
    var trans2 = vdData.transmission && typeof vdData.transmission === 'object' ? vdData.transmission : {};
    var engParts = [
      vdVal(eng.type),
      eng.cylinders_configuration ? eng.cylinders_configuration + ' cyl.' : '',
      eng.displacement && eng.displacement > 100 ? (eng.displacement / 1000).toFixed(1) + 'L' : eng.displacement ? eng.displacement + 'L' : ''
    ].filter(Boolean);
    var eu = readEuropeVinFlat(bundle || {});
    var g = eu.gen || {};
    var sp = eu.spec || {};
    var euYear =
      saneModelYear(g.year) ||
      saneModelYear(g.ModelYear || g.Years) ||
      '';
    var euEngine = String(g.engine_type || g['Engine type'] || '').trim();
    if (!euEngine) {
      var cylEu = sp['Engine cylinders'];
      var dnEu = sp['Displacement nominal'];
      if (cylEu || dnEu) {
        euEngine =
          [cylEu ? String(cylEu).trim() + ' cyl.' : '', dnEu ? String(dnEu).trim() + ' L (nom.)' : '']
            .filter(Boolean)
            .join(' · ');
      }
    }
    var euFuel = String(g.fuel_type || g['Fuel type'] || '').trim();
    var euTrans = String(
      (typeof vdData.transmission === 'string' && vdData.transmission) ||
      g.transmission ||
      g['Transmission'] ||
      ''
    ).trim();
    var euTrim = String(g.trim_level || g['Trim level'] || '').trim();
    var euDrive = String(sp.Driveline || sp['Driveline'] || '').trim();

    var out = {
      status: 'success',
      data: {
        make: vdVal(vdData.make) || id.make || vdVal(g.make) || '',
        model: vdVal(vdData.model) || id.model || vdVal(g.model) || '',
        year: saneModelYear(vdData.year) ? saneModelYear(vdData.year) : euYear || saneModelYear(id.year) || '',
        trim:
          vdVal(vdData.trim) ||
          vdVal(vdData.trim_and_style) ||
          vdVal(vdData.style) ||
          euTrim ||
          String(g.body_style || g['Body style'] || '').trim() ||
          '',
        engine: (vdVal(vdData.engine) || engParts.join(' ') || '').trim() || euEngine,
        transmission:
          (typeof vdData.transmission === 'string' ? vdData.transmission : vdVal(trans2.type) || vdVal(trans2.description) || '').trim() || euTrans,
        fuel_type: vdVal(vdData.fuel_type) || vdVal(fuel2.type) || euFuel,
        drivetrain: vdVal(vdData.drivetrain) || vdVal(vdData.drive_type) || euDrive
      }
    };
    renderVinResult(vin, out, true, null);
    if (fr) {
      var panels = [
        ['vinDecode', 'Identification & fiche technique'],
        ['europeVin', 'Données historiques Europe'],
        ['stolenCheck', 'Vérification vol (base internationale)'],
        ['marketValue', 'Cote de marché'],
        ['recalls', 'Rappels constructeur'],
        ['salesHistory', 'Historique des ventes'],
        ['auction', 'Enchères (historique)'],
        ['media', 'Photos & couleurs'],
        ['maintenance', 'Carnet d\'entretien planifié'],
        ['warranty', 'Garantie constructeur']
      ];
      var html = panels.map(function (p) {
        var key = p[0];
        var label = p[1];
        var section = bundle[key];
        return (
          '<details class="full-report-panel" open>' +
          '<summary class="full-report-panel-summary">' +
          '<span class="full-report-panel-title">' + esc(label) + '</span>' +
          vdSectionStatusPill(section) +
          '</summary>' +
          '<div class="full-report-panel-body">' +
          renderVdPanelHtml(key, bundle) +
          '</div></details>'
        );
      }).join('');
      fr.innerHTML = html;
      fr.style.display = 'flex';
    }
    updateVinPdfButton(transactionId);
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function renderFullVinResult(vin, bundle, transactionId) {
    var resultEl = document.getElementById('vinResult');
    var fr = document.getElementById('fullReportExtra');
    var dec = bundle && bundle.decode;
    var id = dec && dec.identity;
    var raw = (dec && dec.data) || {};
    var d =
      (id && typeof id === 'object' ? id : null) ||
      (raw.data && typeof raw.data === 'object' ? raw.data : null) ||
      {};
    var inner = raw && raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : {};
    var out = {
      status: 'success',
      data: {
        make: d.make,
        model: d.model,
        year: d.year,
        trim: d.trim || d.body_type,
        engine: d.engine,
        transmission: d.transmission,
        fuel_type: d.fuel_type,
        drivetrain: d.drive_type || d.drivetrain,
        series: firstDefined(inner, ['series', 'Series', 'submodel', 'subModel']),
        body_class: firstDefined(inner, ['body_class', 'bodyClass', 'body_class_sae', 'bodyClassPrimary']),
        vehicle_type: firstDefined(inner, ['vehicle_type', 'vehicleType', 'type', 'vehicleClass']),
        doors: firstDefined(inner, ['doors', 'number_of_doors', 'numDoors', 'NumberOfDoors']),
        engine_cylinders: firstDefined(inner, ['engine_cylinders', 'cylinders', 'cylinder', 'Cylinders']),
        engine_displacement: firstDefined(inner, [
          'displacementL', 'displacement_l', 'displacementLitre', 'displacement', 'engine_size', 'engineSize',
          'displacementCC', 'displacement_litre'
        ]),
        plant_info: firstDefined(inner, [
          'plantCountry', 'plant_country', 'plant', 'manufacturer', 'manufacturerName', 'Plant'
        ])
      }
    };
    renderVinResult(vin, out, true, bundle);
    if (fr) {
      var panels = [
        ['decode', 'Décodage du VIN (fiche technique)'],
        ['stolenCheck', 'Vérification des véhicules volés'],
        ['inspection', 'Inspection du véhicule (CT / STK, EK)'],
        ['mileageHistory', 'Historique du kilométrage'],
        ['listings', 'Annonces de véhicules'],
        ['vehicleValuation', 'Évaluation (cote marché)'],
        ['photos', 'Photos du véhicule'],
        ['payments', 'Calculateur de financement (simulation)'],
        ['_plateToVin', 'Plaque d’immatriculation → VIN']
      ];
      var html = panels
        .map(function (p) {
          var key = p[0];
          var label = p[1];
          var block = key === '_plateToVin' ? { _infoOnly: true } : bundle[key];
          return (
            '<details class="full-report-panel" open>' +
            '<summary class="full-report-panel-summary"><span class="full-report-panel-title">' + esc(label) + '</span>' +
            reportBlockStatusPill(block) + '</summary>' +
            '<div class="full-report-panel-body">' +
            renderCarApiBlockHtml(key, block, bundle) +
            '</div></details>'
          );
        })
        .join('');
      fr.innerHTML = html;
      fr.style.display = 'flex';
    }
    updateVinPdfButton(transactionId);
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function buildDecodeMetaHtml(bundle) {
    if (!bundle || !bundle.decode || !bundle.decode.data) return '';
    var body = bundle.decode.data;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return '';
    var specs = body.specifications && typeof body.specifications === 'object' && !Array.isArray(body.specifications)
      ? body.specifications
      : null;
    var dataInner = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : null;
    var extra = [];
    if (specs) {
      if (specs.bodyClass) extra.push({ k: 'Classe de carrosserie', v: String(specs.bodyClass) });
      if (specs.vehicleType) extra.push({ k: 'Type de véhicule', v: String(specs.vehicleType) });
    }
    if (dataInner) {
      if (dataInner.body_type && !specs) extra.push({ k: 'Type de carrosserie', v: String(dataInner.body_type) });
    }
    var parts = [];
    if (extra.length) {
      parts.push(
        '<div class="vin-decode-block"><h3 class="vin-decode-h">Compléments fiche constructeur</h3><div class="report-kv report-kv--compact">' +
        extra
          .map(function (x) {
            return (
              '<div class="report-kv-item"><span class="report-kv-label">' + esc(x.k) + '</span><span class="report-kv-value">' + esc(x.v) + '</span></div>'
            );
          })
          .join('') +
        '</div></div>'
      );
    }
    var rawFeat = (specs && specs.features) != null ? specs.features : body.features;
    if (Array.isArray(rawFeat) && rawFeat.length) {
      parts.push(
        '<div class="vin-decode-block"><h3 class="vin-decode-h">Équipements & options (extrait fiche)</h3><div class="report-chip-row">' +
        rawFeat
          .slice(0, 32)
          .map(function (x) {
            return '<span class="report-chip">' + esc(String(x)) + '</span>';
          })
          .join('') +
        (rawFeat.length > 32 ? '<span class="report-chip report-chip--more">+' + (rawFeat.length - 32) + ' autres</span>' : '') +
        '</div></div>'
      );
    } else if (typeof rawFeat === 'string' && rawFeat.trim()) {
      try {
        var arr = JSON.parse(rawFeat);
        if (Array.isArray(arr) && arr.length) {
          parts.push(
            '<div class="vin-decode-block"><h3 class="vin-decode-h">Équipements & options (extrait fiche)</h3><div class="report-chip-row">' +
            arr
              .slice(0, 32)
              .map(function (x) {
                return '<span class="report-chip">' + esc(String(x)) + '</span>';
              })
              .join('') +
            (arr.length > 32 ? '<span class="report-chip report-chip--more">+' + (arr.length - 32) + ' autres</span>' : '') +
            '</div></div>'
          );
        }
      } catch (e) {
        parts.push(
          '<div class="vin-decode-block"><h3 class="vin-decode-h">Équipements (liste fournie)</h3><p class="vin-decode-plain">' +
          esc(rawFeat.slice(0, 2000)) + (rawFeat.length > 2000 ? '…' : '') + '</p></div>'
        );
      }
    }
    return parts.join('');
  }

  function renderVinResult(vin, data, keepFullPanel, bundle) {
    var d = data.data || {};
    var resultEl = document.getElementById('vinResult');
    var vehicleEl = document.getElementById('resultVehicle');
    var vinCodeEl = document.getElementById('resultVinCode');
    var gridEl = document.getElementById('resultGrid');
    var metaEl = document.getElementById('resultDecodeMeta');
    var fr = document.getElementById('fullReportExtra');
    if (!keepFullPanel) {
      updateVinPdfButton(null);
    }
    if (fr && !keepFullPanel) {
      fr.innerHTML = '';
      fr.style.display = 'none';
    }
    if (metaEl && !keepFullPanel) {
      metaEl.innerHTML = '';
      metaEl.style.display = 'none';
    }

    if (!resultEl) return;

    var make = d.make || '';
    var model = d.model || '';
    var year = d.year != null && d.year !== '' ? String(d.year) : '';
    var vehicleLabel = [make, model, year].filter(Boolean).join(' ') || 'Véhicule identifié';

    if (vehicleEl) vehicleEl.textContent = vehicleLabel;
    if (vinCodeEl) vinCodeEl.textContent = vin;

    function cell(label, value, displayFn) {
      var rawV = value != null && value !== '' ? String(value) : '';
      if (rawV === '' || rawV.toLowerCase() === 'none' || rawV === 'n/a') {
        return { label: label, html: '<div class="result-field-value empty">Non renseigné</div>' };
      }
      var shown = displayFn ? displayFn(rawV) : rawV;
      return { label: label, html: '<div class="result-field-value">' + esc(shown) + '</div>' };
    }

    var fieldRows = [
      cell('Marque', make, null),
      cell('Modèle', model, null),
      cell('Année', year, null),
      cell('Finition / carrosserie', d.trim, null),
      cell('Moteur', d.engine, null),
      cell('Transmission', d.transmission, function (s) { return frTransmission(s); }),
      cell('Carburant', d.fuel_type, function (s) { return frFuel(s); }),
      cell('Motricité / 4x4', d.drivetrain, function (s) { return frDrivetrain(s); })
    ];
    var extraOrder = [
      { k: 'series', l: 'Série / variante' },
      { k: 'body_class', l: 'Classe (carrosserie)' },
      { k: 'vehicle_type', l: 'Catégorie de véhicule' },
      { k: 'doors', l: 'Portes' },
      { k: 'engine_cylinders', l: 'Cylindres' },
      { k: 'engine_displacement', l: 'Cylindrée' },
      { k: 'plant_info', l: 'Lieu d’assemblage (indic.)' }
    ];
    extraOrder.forEach(function (x) {
      if (d[x.k] != null && d[x.k] !== '') {
        fieldRows.push(cell(x.l, d[x.k], null));
      }
    });

    if (gridEl) {
      gridEl.innerHTML = fieldRows
        .map(function (f) {
          return (
            '<div class="result-field result-field--always">' +
            '<div class="result-field-label">' + esc(f.label) + '</div>' + f.html + '</div>'
          );
        })
        .join('');
    }

    if (metaEl) {
      var meta = bundle ? buildDecodeMetaHtml(bundle) : '';
      if (meta) {
        metaEl.innerHTML = meta;
        metaEl.style.display = 'block';
      } else {
        metaEl.innerHTML = '';
        metaEl.style.display = 'none';
      }
    }

    resultEl.style.display = 'block';
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ============================================================
     PROFILE — CHANGE PASSWORD
     ============================================================ */
  window.doChangePassword = function () {
    var current = val('pwdCurrent');
    var newPwd = val('pwdNew');
    var confirm = val('pwdConfirm');
    var errEl = document.getElementById('pwdError');
    var okEl = document.getElementById('pwdSuccess');
    if (errEl) errEl.style.display = 'none';
    if (okEl) okEl.style.display = 'none';

    if (!current || !newPwd || !confirm) {
      if (errEl) { errEl.textContent = 'Remplissez tous les champs.'; errEl.style.display = 'block'; }
      return;
    }
    if (newPwd.length < 8) {
      if (errEl) { errEl.textContent = 'Nouveau mot de passe trop court (8 caractères minimum).'; errEl.style.display = 'block'; }
      return;
    }
    if (newPwd !== confirm) {
      if (errEl) { errEl.textContent = 'Les mots de passe ne correspondent pas.'; errEl.style.display = 'block'; }
      return;
    }

    api('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword: current, newPassword: newPwd }
    }).then(function (r) {
      if (r.ok) {
        if (okEl) { okEl.textContent = 'Mot de passe modifié avec succès.'; okEl.style.display = 'block'; }
        document.getElementById('pwdCurrent').value = '';
        document.getElementById('pwdNew').value = '';
        document.getElementById('pwdConfirm').value = '';
      } else {
        if (errEl) { errEl.textContent = (r.data && r.data.error) || 'Erreur lors du changement de mot de passe.'; errEl.style.display = 'block'; }
      }
    }).catch(function () {
      if (errEl) { errEl.textContent = 'Erreur réseau. Réessayez.'; errEl.style.display = 'block'; }
    });
  };

  /* ============================================================
     HELPERS
     ============================================================ */
  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
    } catch (e) { return dateStr; }
  }

  /* Keyboard: Enter on auth inputs */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = document.activeElement;
    if (!t) return;
    if (t.closest && t.closest('#panelLogin')) doLogin();
    else if (t.closest && t.closest('#panelSignup')) doSignup();
    else if (t.closest && t.closest('#inviteOverlay')) doAcceptInvite();
  });
})();
