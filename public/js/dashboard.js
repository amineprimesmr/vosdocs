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

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', function () {
    var params = new URLSearchParams(window.location.search);
    inviteToken = params.get('invite');

    // Invite flow → show invite overlay
    if (inviteToken) {
      showInviteOverlay();
      return;
    }

    // Check auth
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
    var overlay = document.getElementById('authOverlay');
    var shell = document.getElementById('appShell');
    if (overlay) overlay.classList.remove('hidden');
    if (shell) shell.style.display = 'none';
  };

  window.switchTab = function (tab) {
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
  function showInviteOverlay() {
    var overlay = document.getElementById('authOverlay');
    var invite = document.getElementById('inviteOverlay');
    var shell = document.getElementById('appShell');
    if (overlay) overlay.classList.add('hidden');
    if (invite) invite.classList.remove('hidden');
    if (shell) shell.style.display = 'none';
  }

  window.doAcceptInvite = function () {
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
    var banner = document.getElementById('postPayBanner');
    var text = document.getElementById('postPayText');
    if (!banner) return;
    banner.classList.remove('hidden');
    var isSub = params.get('sub') === '1';
    if (isSub && text) {
      text.textContent = 'Abonnement activé — vos crédits mensuels apparaîtront sous quelques instants.';
    }
    // Clean URL
    try {
      var u = new URL(window.location.href);
      u.searchParams.delete('paid');
      u.searchParams.delete('credits');
      u.searchParams.delete('sub');
      u.searchParams.delete('session_id');
      window.history.replaceState({}, '', u.pathname + (u.search || ''));
    } catch (e) {}
    // Poll credits for 60s
    var t0 = Date.now();
    var poll = setInterval(function () {
      api('/api/auth/me').then(function (r) {
        if (r.ok && r.data && r.data.user) {
          updateCreditsDisplay(r.data.user.credits);
          currentUser.credits = r.data.user.credits;
        }
      });
      if (Date.now() - t0 > 60000) clearInterval(poll);
    }, 3000);
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
      return '<tr>' +
        '<td class="cell-vin">' + esc(s.vin || '—') + '</td>' +
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
        var vehicle = [s.make, s.model, s.year].filter(Boolean).join(' ') || '—';
        return '<tr>' +
          '<td class="cell-vin">' + esc(s.vin || '—') + '</td>' +
          '<td class="cell-vehicle">' + esc(vehicle) + '</td>' +
          '<td>' + esc(s.fuel_type || '—') + '</td>' +
          '<td>' + esc(s.engine || '—') + '</td>' +
          '<td class="cell-date">' + formatDate(s.createdAt) + '</td>' +
          '</tr>';
      }).join('');
      el.innerHTML = '<table class="data-table">' +
        '<thead><tr><th>VIN</th><th>Véhicule</th><th>Carburant</th><th>Moteur</th><th>Date</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
    }).catch(function () {
      el.innerHTML = '<div class="empty-state">Erreur de chargement. Réessayez.</div>';
    });
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

    api('/api/vin-decode/' + encodeURIComponent(vin)).then(function (r) {
      setLoading('searchBtn', 'searchBtnText', 'searchSpinner', false);

      if (!r.ok || !r.data || r.data.status !== 'success') {
        var msg = (r.data && r.data.message) || 'VIN introuvable ou invalide.';
        if (r.status === 402) {
          msg = 'Crédits insuffisants. <button class="auth-link" onclick="goSection(\'credits\')">Recharger →</button>';
        } else if (r.status === 401) {
          msg = 'Session expirée. Rechargez la page.';
        }
        if (errorEl) { errorEl.innerHTML = msg; errorEl.style.display = 'block'; }
        return;
      }

      // Debit credit locally
      if (currentUser && currentUser.credits > 0) {
        currentUser.credits -= 1;
        updateCreditsDisplay(currentUser.credits);
      }

      // Mark history as stale
      historyLoaded = false;
      // Update stats
      api('/api/auth/me').then(function (mr) {
        if (mr.ok && mr.data && mr.data.user) {
          currentUser.credits = mr.data.user.credits;
          updateCreditsDisplay(mr.data.user.credits);
        }
      });

      renderVinResult(vin, r.data);
    }).catch(function () {
      setLoading('searchBtn', 'searchBtnText', 'searchSpinner', false);
      if (errorEl) { errorEl.textContent = 'Erreur réseau. Réessayez.'; errorEl.style.display = 'block'; }
    });
  };

  function renderVinResult(vin, data) {
    var d = data.data || {};
    var resultEl = document.getElementById('vinResult');
    var vehicleEl = document.getElementById('resultVehicle');
    var vinCodeEl = document.getElementById('resultVinCode');
    var gridEl = document.getElementById('resultGrid');

    if (!resultEl) return;

    var make = d.make || '';
    var model = d.model || '';
    var year = d.year || '';
    var vehicleLabel = [make, model, year].filter(Boolean).join(' ') || 'Véhicule identifié';

    if (vehicleEl) vehicleEl.textContent = vehicleLabel;
    if (vinCodeEl) vinCodeEl.textContent = vin;

    var fields = [
      { label: 'Marque',       value: make },
      { label: 'Modèle',       value: model },
      { label: 'Année',        value: year },
      { label: 'Carrosserie',  value: d.trim },
      { label: 'Moteur',       value: d.engine },
      { label: 'Transmission', value: d.transmission },
      { label: 'Carburant',    value: d.fuel_type },
      { label: 'Transmission', value: d.drivetrain },
    ].filter(function (f) { return f.value; });

    if (gridEl) {
      gridEl.innerHTML = fields.map(function (f) {
        return '<div class="result-field">' +
          '<div class="result-field-label">' + esc(f.label) + '</div>' +
          '<div class="result-field-value">' + esc(f.value) + '</div>' +
          '</div>';
      }).join('');
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
