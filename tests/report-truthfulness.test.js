'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {computeVdSynthesis}=require('../lib/report-pdf');
test('missing title and theft indicators never become a clean PDF conclusion',()=>{
 const points=computeVdSynthesis({titleCheck:{ok:true,data:{}},stolenCheck:{ok:true,data:{}}});
 for(const key of ['title','stolen']){const point=points.find(p=>p.key===key);assert.equal(point.level,'warn');assert.equal(point.status,'Indéterminé');}
});
test('public preview has no hardcoded clean history or invented accident finding',()=>{
 const html=fs.readFileSync(require.resolve('../public/rapport.html'),'utf8');
 for(const claim of ['Aucun antécédent de vol recensé','Titre non sali','Rappels constructeur : rien','Élément à vérifier : sinistre'])assert.ok(!html.includes(claim));
 assert.ok(html.includes('non vérifiés dans cet aperçu'));
});
