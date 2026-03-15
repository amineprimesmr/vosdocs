/**
 * Carvinguard - Service commande
 * Stockage des données de la démarche (sessionStorage)
 */

var VehicleService = (function() {
  var API_BASE = window.location.origin;

  var DEPARTEMENTS_FALLBACK = [
    { code: '01', nom: 'Ain' }, { code: '35', nom: 'Ille-et-Vilaine' }, { code: '75', nom: 'Paris' },
    { code: '69', nom: 'Rhône' }, { code: '13', nom: 'Bouches-du-Rhône' }, { code: '59', nom: 'Nord' },
    { code: '44', nom: 'Loire-Atlantique' }, { code: '31', nom: 'Haute-Garonne' }, { code: '33', nom: 'Gironde' },
    { code: '34', nom: 'Hérault' }, { code: '06', nom: 'Alpes-Maritimes' }, { code: '83', nom: 'Var' },
  ];

  function getDepartements() {
    return fetch(API_BASE + '/api/departements')
      .then(function(res) { return res.ok ? res.json() : Promise.reject('Erreur'); })
      .catch(function() {
        return fetch(API_BASE + '/data/departements.json')
          .then(function(res) { return res.ok ? res.json() : Promise.reject('Erreur'); })
          .catch(function() { return DEPARTEMENTS_FALLBACK; });
      });
  }

  function saveCommandeData(data) {
    var payload = Object.assign({}, data, { timestamp: Date.now() });
    sessionStorage.setItem('carvinguard_commande', JSON.stringify(payload));
  }

  function getCommandeData() {
    try {
      var raw = sessionStorage.getItem('carvinguard_commande');
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) {
        sessionStorage.removeItem('carvinguard_commande');
        return null;
      }
      return data;
    } catch (_) { return null; }
  }

  function clearCommandeData() {
    sessionStorage.removeItem('carvinguard_commande');
  }

  return {
    getDepartements: getDepartements,
    saveCommandeData: saveCommandeData,
    getCommandeData: getCommandeData,
    clearCommandeData: clearCommandeData
  };
})();
