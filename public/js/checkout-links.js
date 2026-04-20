/**
 * Page tarifs — injection des liens Stripe (Payment Links) + option VIN en client_reference_id
 */
(function () {
  function appendRef(url, vin) {
    if (!url || !vin) return url;
    try {
      var u = new URL(url);
      u.searchParams.set('client_reference_id', vin.slice(0, 80));
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('a.cg-tier-card').forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (a.getAttribute('aria-disabled') === 'true') e.preventDefault();
      });
    });

    var cards = {
      essentiel: document.getElementById('pay-link-essentiel'),
      confort: document.getElementById('pay-link-confort'),
      premium: document.getElementById('pay-link-premium')
    };
    var subEl = document.getElementById('pay-link-abonnement');
    var banner = document.getElementById('paymentLinksMissing');

    fetch(window.location.origin + '/api/payment-links')
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var commande =
          typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
        var vin = commande && commande.vin ? commande.vin : '';

        var any = false;
        ['essentiel', 'confort', 'premium'].forEach(function (plan) {
          var el = cards[plan];
          var raw = (data && data[plan]) || '';
          if (el && raw && /^https?:\/\//i.test(raw)) {
            el.href = appendRef(raw, vin);
            el.removeAttribute('aria-disabled');
            any = true;
          } else if (el) {
            el.href = '#';
            el.setAttribute('aria-disabled', 'true');
          }
        });

        var rawSub = (data && data.abonnement) || '';
        if (subEl && rawSub && /^https?:\/\//i.test(rawSub)) {
          subEl.href = appendRef(rawSub, vin);
          subEl.removeAttribute('aria-disabled');
          any = true;
        } else if (subEl) {
          subEl.href = 'contact.html';
          subEl.removeAttribute('aria-disabled');
        }

        if (!any && banner) {
          banner.hidden = false;
        }

        var plan = new URLSearchParams(window.location.search).get('plan');
        var scrollEl = plan && document.getElementById('pay-link-' + plan);
        if (scrollEl) {
          setTimeout(function () {
            scrollEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 400);
        }
      })
      .catch(function () {
        if (banner) banner.hidden = false;
      });
  });
})();
