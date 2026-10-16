/* =======================================================================
   app/vue-audit.js — Vue « Journal d'audit » (administrateur)
   Contenu    : chargerAudit() (GET /audit)
   Dépend de  : lib/api.js
   ======================================================================= */
/* ---------- audit (ADMIN) ---------- */
async function chargerAudit(){
  if(!droits().aud)return;
  try{const r=await api('/audit?limite=300');
    const tronq=v=>{if(v==null)return '—';v=String(v);return esc(v.length>90?v.slice(0,87)+'…':v)};
    document.getElementById('auditBody').innerHTML=r.evenements.map(ev=>`<tr>
      <td style="text-align:left">${esc(String(ev.date).slice(0,19).replace('T',' '))}</td>
      <td style="text-align:left">${esc(ev.utilisateur)}</td>
      <td style="text-align:left">${esc(ev.action)}</td>
      <td style="text-align:left">${tronq(ev.objet)}</td>
      <td style="text-align:left">${tronq(ev.ancienne_valeur)}</td>
      <td style="text-align:left">${tronq(ev.nouvelle_valeur)}</td></tr>`).join('');
    document.getElementById('auditNote').textContent=r.evenements.length+' événement(s) — du plus récent au plus ancien';
  }catch(e){}
}
