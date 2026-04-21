/**
 * Page tarifs — comme Fidelity / MyFidpass :
 * - connecté : session Checkout créée par l’API (/api/billing/credit-checkout) → crédits garantis sur le bon compte ;
 * - invité : Payment Links (STRIPE_PAYMENT_LINK_*) ; VIN en client_reference_id seulement si attachVinToStripeLink.
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

  function applyGuestLinks(data, vin) {
    var cards = {
      essentiel: document.getElementById('pay-link-essentiel'),
      confort: document.getElementById('pay-link-confort'),
      premium: document.getElementById('pay-link-premium')
    };
    var banner = document.getElementById('paymentLinksMissing');
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
    if (!any && banner) {
      banner.hidden = false;
    }
  }

  function applyLoggedInLinks(origin) {
    ['essentiel', 'confort', 'premium'].forEach(function (plan) {
      var el = document.getElementById('pay-link-' + plan);
      if (el) {
        el.href =
          origin + '/api/billing/credit-checkout?plan=' + encodeURIComponent(plan);
        el.removeAttribute('aria-disabled');
      }
    });
    var banner = document.getElementById('paymentLinksMissing');
    if (banner) banner.hidden = true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('a.cg-tier-card').forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (a.getAttribute('aria-disabled') === 'true') e.preventDefault();
      });
    });

    var commande =
      typeof VehicleService !== 'undefined' ? VehicleService.getCommandeData() : null;
    var attachVin =
      commande &&
      commande.attachVinToStripeLink === true &&
      commande.vin &&
      commande.vin.length === 17;
    var vin = attachVin ? commande.vin : '';

    var origin = window.location.origin;

    fetch(origin + '/api/auth/me', { credentials: 'same-origin' })
      .then(function (r) {
        return r.json();
      })
      .then(function (me) {
        if (me && me.authenticated && me.user) {
          applyLoggedInLinks(origin);
        } else {
          return fetch(origin + '/api/payment-links')
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              applyGuestLinks(data, vin);
            });
        }
      })
      .catch(function () {
        fetch(origin + '/api/payment-links')
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            applyGuestLinks(data, vin);
          })
          .catch(function () {
            var banner = document.getElementById('paymentLinksMissing');
            if (banner) banner.hidden = false;
          });
      })
      .finally(function () {
        var plan = new URLSearchParams(window.location.search).get('plan');
        var scrollEl = plan && document.getElementById('pay-link-' + plan);
        if (scrollEl) {
          setTimeout(function () {
            scrollEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 400);
        }
      });
  });
})();
