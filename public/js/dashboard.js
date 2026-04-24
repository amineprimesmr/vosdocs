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
  /** true si le serveur a CARAPI_TOKEN : recherche = rapport complet (tous les endpoints). */
  var carApiEnabled = false;

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
        carApiEnabled = !!(r.ok && r.data && r.data.carApiEnabled);
        applyRegistrationRestrictedUi();
        refreshSearchModeDesc();
      })
      .catch(function () {
        registrationOpen = false;
        carApiEnabled = false;
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
          carApiEnabled = !!r.data.carApiEnabled;
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
    d.textContent = carApiEnabled
      ? ' crédit(s) — 1 crédit = rapport complet (CarAPI : fiche, contrôle, vol, km, cote, annonces, photos, financement).'
      : ' crédit(s) — 1 crédit par fiche VIN (source API configurée côté serveur).';
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
        ? ' <span class="badge-full" title="Rapport complet CarAPI">Complet</span>'
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
        renderFullVinResult(v, bundle);
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

    var searchPath = carApiEnabled
      ? '/api/vin-full-report/' + encodeURIComponent(vin)
      : '/api/vin-decode/' + encodeURIComponent(vin);
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

      if (r.data && r.data.data && r.data.data.decode) {
        renderFullVinResult(vin, r.data.data);
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

  /**
   * N’affiche que les blocs utiles (sources OK + données non vides) — on masque l’indisponible côté UI.
   */
  function shouldDisplayReportBlock(key, block) {
    if (block == null) return false;
    if (block.skipped) return false;
    if (block.error) return false;
    if (block.ok === false) return false;
    if (block.ok !== true) return false;
    var d = block.data;
    if (d == null || typeof d !== 'object' || Array.isArray(d)) {
      if (key === 'stolenCheck') return true;
      return false;
    }
    if (key === 'inspection') {
      var ins = d.inspection && typeof d.inspection === 'object' ? d.inspection : {};
      return !!(ins.stkValidTo || ins.ekValidTo);
    }
    if (key === 'stolenCheck') {
      return true;
    }
    if (key === 'mileageHistory') {
      var list = d.mileageHistory;
      return Array.isArray(list) && list.length > 0;
    }
    if (key === 'photos') {
      var ph = d.photos;
      if (!Array.isArray(ph) || ph.length === 0) return false;
      return ph.some(function (u) {
        return u && typeof u === 'string' && u.trim() !== '';
      });
    }
    if (key === 'payments') {
      var pay = d.payments;
      if (Array.isArray(pay) && pay.length > 0) return true;
      if (d.monthlyPayment != null && isFinite(Number(d.monthlyPayment)) && Number(d.monthlyPayment) > 0) return true;
      if (d.loanAmount != null && isFinite(Number(d.loanAmount)) && Number(d.loanAmount) > 0) return true;
      if (d.totalPaid != null && isFinite(Number(d.totalPaid)) && Number(d.totalPaid) > 0) return true;
      if (d.totalInterest != null && isFinite(Number(d.totalInterest)) && Number(d.totalInterest) > 0) return true;
      return false;
    }
    if (key === 'vehicleValuation') {
      if (d.valuationPrice == null) return false;
      var n = Number(d.valuationPrice);
      return isFinite(n) && n > 0;
    }
    if (key === 'listings') {
      return Array.isArray(d.listings) && d.listings.length > 0;
    }
    return true;
  }

  function renderInspectionData(data) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var ins = d.inspection && typeof d.inspection === 'object' ? d.inspection : {};
    var ctry = d.country;
    var stk = ins.stkValidTo;
    var ek = ins.ekValidTo;
    var hint =
      '<p class="report-lead">Contrôle périodique (STK) et contrôle des émissions (EK) tels qu’exposés par l’API pour le pays indiqué. ' +
      'L’exhaustivité des pays dépend de CarAPI — pour la plupart des VIN, seuls certains jeux de données (ex. Slovaquie) sont proposés.</p>';
    var countryLine =
      '<div class="report-kv report-kv--hero">' +
      '<div class="report-kv-item"><span class="report-kv-label">Pays de référence (API)</span>' +
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
      '<p class="report-mini-card__hint">Contrôle des émissions (EK) lorsqu’il est enregistré côté source.</p></div></div>';
    return hint + countryLine + two;
  }

  function renderStolenData(data) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var stolen = d.stolen === true;
    var badge =
      stolen
        ? '<div class="report-hero report-hero--alert"><div class="report-hero__icon" aria-hidden="true">!</div><div>' +
          '<div class="report-hero__title">Signalement de vol</div>' +
          '<p class="report-hero__text">D’après la base interrogee par l’API, ce VIN remonte comme signalé. Vérifiez auprès des autorités compétentes.</p></div></div>'
        : '<div class="report-hero report-hero--ok"><div class="report-hero__icon" aria-hidden="true">✓</div><div>' +
          '<div class="report-hero__title">Aucun signalement de vol</div>' +
          '<p class="report-hero__text">Aucun vol signalé sur les sources consultées par CarAPI pour ce VIN, selon le jeu de pays retourné.</p></div></div>';
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
      grid += '</div><p class="report-footnote">Les bases et pays couverts dépendent du fournisseur. Ne remplacez pas un contrôle auprès de la gendarmerie / police en cas de doute sur un achat.</p>';
    }
    return badge + grid;
  }

  function renderMileageData(data) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var list = d.mileageHistory;
    var n = d.totalRecords != null ? Number(d.totalRecords) : (Array.isArray(list) ? list.length : 0);
    if (!Array.isArray(list) || list.length === 0) {
      return (
        '<p class="report-lead">Aucun enregistrement d’historique de kilométrage n’a été retourné pour ce VIN. Cela n’exclut pas d’autres historiques (carnet, factures, outils d’entretien).</p>'
      );
    }
    var maxKm = 0;
    list.forEach(function (row) {
      var km = Number(row.mileage) || 0;
      if (km > maxKm) maxKm = km;
    });
    var html =
      '<p class="report-lead">' + n + ' relevé(s) reçu(s) — chaque point correspond à un kilométrage connu côté source à une date donnée. Surveillez d’éventuelles <strong>baisses anormales</strong> d’un relevé à l’autre (risque d’inversion ou d’imprécision).</p>';
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
        '<p class="report-lead">Aucune photo n’a été associée à ce VIN dans le jeu de retours actuel. Les visuels peuvent provenir d’annonces classées, et varier dans le temps.</p>'
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

  function renderPaymentsData(data) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var cur = d.currency || 'EUR';
    var pay = Array.isArray(d.payments) ? d.payments : [];
    var top =
      '<div class="report-finance-hero"><div class="report-finance-kpis">' +
      '<div class="report-finance-kpi"><span class="report-finance-kpi__l">Mensualité (estim.)</span>' +
      '<span class="report-finance-kpi__v">' + esc(formatMoney(d.monthlyPayment, cur)) + '</span></div>' +
      '<div class="report-finance-kpi"><span class="report-finance-kpi__l">Montant emprunté (après apport)</span>' +
      '<span class="report-finance-kpi__v">' + esc(formatMoney(d.loanAmount, cur)) + '</span></div>' +
      '<div class="report-finance-kpi"><span class="report-finance-kpi__l">Coût total (capital + intérêts sur la durée)</span>' +
      '<span class="report-finance-kpi__v">' + esc(formatMoney(d.totalPaid, cur)) + '</span></div>' +
      '<div class="report-finance-kpi"><span class="report-finance-kpi__l">Intérêts totaux (estim.)</span>' +
      '<span class="report-finance-kpi__v">' + esc(formatMoney(d.totalInterest, cur)) + '</span></div></div></div>' +
      '<p class="report-footnote">Simulation indicative fournie par l’API (paramètres côté serveur : montant, apport, durée, taux). Comparez chez un établissement de crédit habilité pour une offre réelle (TAEG, assurances, frais de dossier).</p>';
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

  function renderValuationData(data) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var cur = d.currency || 'EUR';
    return (
      '<div class="report-valuation">' +
      '<div class="report-valuation__price"><span class="report-valuation__n">' + esc(formatMoney(d.valuationPrice, cur)) + '</span>' +
      '<span class="report-valuation__hint">Cote / valeur estimative sur le marché indiqué</span></div>' +
      '<div class="report-kv">' +
      '<div class="report-kv-item"><span class="report-kv-label">Marque (API)</span><span class="report-kv-value">' + esc(d.make != null ? String(d.make) : '—') + '</span></div>' +
      '<div class="report-kv-item"><span class="report-kv-label">Modèle (API)</span><span class="report-kv-value">' + esc(d.model != null ? String(d.model) : '—') + '</span></div>' +
      '<div class="report-kv-item"><span class="report-kv-label">Millésime (année)</span><span class="report-kv-value">' + esc(d.year != null ? String(d.year) : '—') + '</span></div>' +
      '<div class="report-kv-item"><span class="report-kv-label">Marché de référence</span><span class="report-kv-value">' + esc(frCountryCode(d.country)) + '</span></div></div></div>' +
      '<p class="report-footnote">Valeur indicative fournie par CarAPI, selon le millésime et le pays — à rapprocher de l’état, du kilométrage réel, des équipements et de l’offre locale (annonces, mandataire, reprise).</p>'
    );
  }

  function renderListingsData(data) {
    var d = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var L = d.listings;
    var pag = d.pagination;
    if (!Array.isArray(L) || L.length === 0) {
      return (
        '<p class="report-lead">Aucune annonce similaire n’a été retournée (pagination ou indisponibilité des données). Les jeux d’annonces varient par marché et par moment.</p>' +
        (pag
          ? '<p class="report-subhead">Pagination : ' + esc(String(pag.offset || 0)) + ' – ' + esc(String((pag.offset || 0) + (pag.limit || 0))) + ' (limite ' + esc(String(pag.limit != null ? pag.limit : '—')) + ')</p>'
          : '')
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
      '<p class="report-lead">' + L.length + ' annonce(s) « proches » (même famille modèle / millésime selon l’algorithme CarAPI) — repères de marché, pas d’exhaustivité.</p>' +
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
          '<strong>Pourquoi c’est indisponible :</strong> l’API CarAPI documente aujourd’hui le <strong>contrôle technique périodique (STK) et l’EK</strong> principalement pour la <strong>Slovaquie</strong>. ' +
          'Pour de nombreux VIN d’immatriculation étrangère, vous ne verrez donc <strong>pas de dates françaises (CT) ou allemandes (TÜV)</strong> ici. Le code HTTP 400/404 sur ce point est fréquent — ce n’est pas un bug de votre fiche.</div>';
      }
    }
    if (blockKey === 'photos' && (block.status === 404 || (block.data && /no photos|not found/i.test(String((block.data.error || block.data.message || '')))))) {
      insHint =
        '<div class="report-callout report-callout--info">Aucune image indexée pour ce VIN aujourd’hui — c’est souvent le cas.</div>';
    }
    var st = block.status != null ? String(block.status) : '?';
    return (
      insHint +
      '<div class="report-fail"><p class="report-fail__title">La source n’a pas renvoyé de données exploitables (HTTP ' + esc(st) + ').</p>' +
      '<p class="report-fail__sub">Cela peut indiquer une absence côté base, un pays non pris en charge, ou un format de VIN connu de la fiche d’identité mais non couvert par l’option demandée.</p></div>'
    );
  }

  function renderCarApiBlockHtml(key, block) {
    if (block == null) {
      return '<p class="full-report-err">Bloc absent</p>';
    }
    if (block.skipped) {
      var r = String(block.reason || '—');
      var fr =
        r === 'make_model_year_unavailable'
          ? 'Cette section n’a pas été appelée : la marque, le modèle ou l’année n’ont pas été reconnus au format requis par CarAPI pour la cote et les annonces (liste de marques normalisée en anglais, modèle en « slug »).'
          : 'Non requis : ' + esc(r);
      return (
        '<div class="report-skipped"><p class="report-skipped__text">' + fr + '</p>' +
        '<p class="report-footnote">Quand l’identité complète (marque / modèle / année) est reconnue, le même rapport inclura valorisation de marché et annonces similaires.</p></div>'
      );
    }
    if (block.error) {
      return '<p class="full-report-err">' + esc(String(block.error)) + '</p>';
    }
    if (block.ok === false) {
      return renderBlockFailureHtml(key, block);
    }
    var data = block.data;
    if (key === 'inspection') return renderInspectionData(data);
    if (key === 'stolenCheck') return renderStolenData(data);
    if (key === 'mileageHistory') return renderMileageData(data);
    if (key === 'photos') return renderPhotosData(data);
    if (key === 'payments') return renderPaymentsData(data);
    if (key === 'vehicleValuation') return renderValuationData(data);
    if (key === 'listings') return renderListingsData(data);
    return (
      '<p class="report-lead">Données reçues pour cette section ; le format n’est pas pris en charge par l’affichage actuel. Relancez plus tard ou contactez le support si le problème persiste.</p>'
    );
  }

  function renderFullVinResult(vin, bundle) {
    var resultEl = document.getElementById('vinResult');
    var fr = document.getElementById('fullReportExtra');
    var dec = bundle && bundle.decode;
    var id = dec && dec.identity;
    var raw = (dec && dec.data) || {};
    var d =
      (id && typeof id === 'object' ? id : null) ||
      (raw.data && typeof raw.data === 'object' ? raw.data : null) ||
      {};
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
        drivetrain: d.drive_type || d.drivetrain
      }
    };
    renderVinResult(vin, out, true, bundle);
    if (fr) {
      var panels = [
        ['inspection', 'Contrôle technique & inspection (MOT, TÜV, EK, etc.)'],
        ['stolenCheck', 'Recherche de vol (véhicule signalé)'],
        ['mileageHistory', 'Historique du kilométrage'],
        ['photos', 'Photos / visuels'],
        ['payments', 'Simulation de financement (mensualité)'],
        ['vehicleValuation', 'Cote / valorisation (marché)'],
        ['listings', 'Annonces de véhicules similaires']
      ];
      var html = panels
        .filter(function (p) {
          return shouldDisplayReportBlock(p[0], bundle[p[0]]);
        })
        .map(function (p) {
          var key = p[0];
          var label = p[1];
          var block = bundle[key];
          return (
            '<details class="full-report-panel" open>' +
            '<summary class="full-report-panel-summary"><span class="full-report-panel-title">' + esc(label) + '</span></summary>' +
            '<div class="full-report-panel-body">' +
            renderCarApiBlockHtml(key, block) +
            '</div></details>'
          );
        })
        .join('');
      fr.innerHTML = html;
      fr.style.display = html ? 'flex' : 'none';
    }
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
        '<div class="vin-decode-block"><h3 class="vin-decode-h">Compléments fiche constructeur / API</h3><div class="report-kv report-kv--compact">' +
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
          '<div class="vin-decode-block"><h3 class="vin-decode-h">Équipements (texte source)</h3><p class="vin-decode-plain">' +
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
