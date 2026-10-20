'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'public/ma');
fs.mkdirSync(path.join(out, 'js'), {recursive:true});
const pages = ['index','verification','rapport','checkout','compte','confirmation','contact','aide','resiliation-abonnement','mentions-legales','conditions-generales-vente','conditions-generales-utilisation','politique-confidentialite'];
const coverage = '<aside class="ma-context" aria-label="Couverture Maroc"><strong>Carvinguard Maroc · Service en français</strong><span> Données selon le véhicule et les sources. <a href="/ma/aide.html">Voir la couverture au Maroc →</a></span></aside>';
const style = '<style>.ma-context{padding:14px 24px;background:#edf6f2;color:#234b40;font:14px/1.6 system-ui;border-bottom:1px solid #cfdfd7}.ma-context span{display:block}.ma-payment-note{margin:20px auto;padding:16px;max-width:960px;background:#edf6f2;color:#234b40;border-radius:12px;font:14px/1.6 system-ui}</style>';
function localize(s) {
 s=s.replace(/(["'`])\/api\//g,'$1/api/ma/');
 for(const page of pages) s=s.replaceAll('/'+page+'.html','/ma/'+page+'.html');
 s=s.replace(/(["'])\/?js\//g,'$1/ma/js/');
 s=s.replace(/(["'])css\//g,'$1/css/');
 s=s.replace(/(["'])images\//g,'$1/images/');
 s=s.replaceAll('carvinguard_commande','carvinguard_ma_commande');
 s=s.replaceAll('zone E de la carte grise','sur le véhicule ou son certificat d’immatriculation').replaceAll('carte grise, zone E','numéro de châssis / VIN');
 s=s.replaceAll('Support en France','Assistance en français').replaceAll('Copyright © Carvinguard.fr','Copyright © Carvinguard Maroc');
 s=s.replaceAll('contrôle technique français','contrôle technique marocain');
 return s;
}
for(const file of fs.readdirSync(path.join(root,'public/js')).filter(f=>f.endsWith('.js'))) {
 let s=localize(fs.readFileSync(path.join(root,'public/js',file),'utf8'));
 // No decorative verification stage: display the identity already returned by the API.
 if(file==='form-handler.js') s=s.replaceAll("'verification.html'","'rapport.html'");
 fs.writeFileSync(path.join(out,'js',file),s);
}
for(const page of pages) {
 const custom=path.join(root,'content/morocco',page+'.html');
 let s=fs.readFileSync(fs.existsSync(custom)?custom:path.join(root,'public',page+'.html'),'utf8');
 s=localize(s).replace(/<html lang="fr">/,'<html lang="fr-MA">');
 s=s.replace(/<script[^>]*src="[^"]*(?:analytics\.js|googletagmanager)[^"]*"[^>]*><\/script>/g,'');
 s=s.replace(/<script>\s*window\.dataLayer[\s\S]*?<\/script>/g,'');
 s=s.replace(/<link rel="canonical"[^>]*>/g,'').replace(/<meta property="og:url"[^>]*>/g,'');
 s=s.replace('</head>',`<meta name="robots" content="noindex, follow"><link rel="canonical" href="https://www.carvinguard.fr/ma/${page==='index'?'':page+'.html'}">${style}</head>`);
 if(page!=='index') s=s.replace(/(<body[^>]*>)/,'$1'+coverage);
 if(page==='checkout') {
   s=s.replace('<!-- PRICING CARDS -->','<div class="ma-payment-note"><strong>Paiement en euros (EUR).</strong> Conversion en dirhams et frais éventuels selon votre banque. Les rapports ne garantissent pas un historique marocain. <a href="/ma/aide.html">Comprendre la couverture</a>.</div><!-- PRICING CARDS -->');
   s=s.replace('<span class="header-logo-name">CarvinGuard</span>','<span class="header-logo-name">Maroc</span>');
 }

 fs.writeFileSync(path.join(out,page+'.html'),s);
}
console.log('Version Maroc générée : '+pages.length+' pages, scripts isolés.');
fs.copyFileSync(path.join(root,'content/morocco/morocco.css'),path.join(out,'morocco.css'));
