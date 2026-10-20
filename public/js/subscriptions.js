(async function () {
  const container=document.getElementById('subscriptionsList');
  if(!container)return;
  try {
    const response=await fetch('/api/billing/subscriptions',{credentials:'same-origin'});
    if(response.status===401){container.textContent='Connectez-vous à votre compte pour gérer vos abonnements.';return;}
    if(!response.ok)throw new Error('Impossible de charger vos abonnements. Réessayez plus tard.');
    const data=await response.json();
    container.textContent='';
    const active=data.subscriptions.filter(s=>!['canceled','incomplete_expired'].includes(s.status));
    if(!active.length){container.textContent='Aucun abonnement actif sur ce compte.';return;}
    for(const sub of active){
      const card=document.createElement('div');card.className='resil-card';
      const text=document.createElement('p');
      const date=sub.periodEnd?new Date(sub.periodEnd*1000).toLocaleDateString('fr-FR'):'';
      text.textContent=sub.cancelAtPeriodEnd?'Résiliation enregistrée'+(date?' — fin de période le '+date:'')+'.':'Abonnement mensuel'+(date?' — prochaine échéance le '+date:'')+'.';
      card.appendChild(text);
      if(!sub.cancelAtPeriodEnd){
        const button=document.createElement('button');button.className='btn btn-primary';button.textContent='Résilier à la fin de la période';
        let confirmed=false;
        button.addEventListener('click',async()=>{
          if(!confirmed){confirmed=true;button.textContent='Confirmer la résiliation';return;}
          button.disabled=true;
          try{
            const result=await fetch('/api/billing/cancel-subscription',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscriptionId:sub.id})});
            const body=await result.json();if(!result.ok)throw new Error(body.error||'Résiliation indisponible.');
            text.textContent='Votre résiliation est enregistrée. Aucun renouvellement ne sera effectué après la période en cours.';
            button.remove();
          }catch(e){text.textContent=e.message;button.disabled=false;}
        });card.appendChild(button);
      }
      container.appendChild(card);
    }
  }catch(e){container.textContent=e.message;}
})();
