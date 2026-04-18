/**
 * Charge la commande depuis le jeton sécurisé (API) puis affiche le rapport.
 */
(function () {
  var root = document.getElementById('mrRoot');

  function showError(msg) {
    if (root) {
      root.innerHTML =
        '<p class="mr-error">' +
        (msg || 'Lien invalide ou expiré.') +
        '</p><p><a href="index.html">Retour à l’accueil</a> · <a href="contact.html">Contact</a></p>';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var q = new URLSearchParams(window.location.search).get('token');
    if (!q || q.length < 16) {
      showError('Lien incomplet.');
      return;
    }

    fetch(window.location.origin + '/api/rapport/session/' + encodeURIComponent(q), {
      credentials: 'include'
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (out) {
        if (!out.res.ok || !out.data.ok || !out.data.commande) {
          showError(out.data.error || 'Impossible de charger le rapport.');
          return;
        }
        if (typeof VehicleService !== 'undefined') {
          VehicleService.saveCommandeData(out.data.commande);
        }
        try {
          sessionStorage.setItem('carvinguard_report_token', q);
        } catch (e) {}
        window.location.replace('rapport.html');
      })
      .catch(function () {
        showError('Erreur réseau.');
      });
  });
})();
