/* =======================================================================
   app/vue-utilisateurs.js — Vue « Comptes » (administrateur)
   Contenu    : liste, création, rôle, périmètre filiale, activation, réinitialisation, code de récupération
   Dépend de  : lib/api.js
   ======================================================================= */
/* ---------- utilisateurs (ADMIN) ---------- */
let USERS=[];
async function chargerUsers(){
  if(!droits().manage)return;
  try{const r=await api('/utilisateurs');USERS=r.utilisateurs;RECUP=r.recuperation;renderUsers()}catch(e){}
}
let RECUP=null;
function filialesConnues(){
  return [...new Set([...DB.rows.map(r=>r.filiale),...USERS.map(u=>u.filiale)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
}
function renderUsers(){
  if(!droits().manage)return;
  const fils=filialesConnues();
  document.getElementById('nuFilList').innerHTML=fils.map(f=>`<option value="${esc(f)}">`).join('');
  document.getElementById('recupEtat').innerHTML=RECUP
    ?`Code actif depuis le <b>${esc(String(RECUP.date).slice(0,10))}</b> (émis pour ${esc(RECUP.par||'—')}). Générer un nouveau code invalide l'ancien.`
    :'<b style="color:var(--alert)">Aucun code sur ce poste.</b> Générez-en un : sans lui, un administrateur qui oublie son mot de passe ne peut être débloqué que par un autre administrateur.';
  document.getElementById('usersBody').innerHTML=USERS.map(u=>{
    const moi=MOI&&u.login===MOI.login;
    return `<tr>
      <td style="text-align:left">${esc(u.nom)}${moi?' <span style="color:#9A9A9A">(vous)</span>':''}</td>
      <td style="text-align:left">${esc(u.login)}</td>
      <td style="text-align:left"><select class="role-sel" data-uid="${u.id}" ${moi?'disabled':''}>
        ${['CONTRIBUTEUR','BPO','DFC','DIRECTION','ADMIN'].map(x=>`<option value="${x}" ${x===u.role?'selected':''}>${ROLES_UI[x]}</option>`).join('')}</select></td>
      <td style="text-align:left">${u.role==='ADMIN'?'<span class="perim">Groupe</span>'
        :`<select class="role-sel perim-sel" data-uid="${u.id}">${['',...new Set([...fils,u.filiale].filter(Boolean))].map(f=>`<option value="${esc(f)}" ${f===(u.filiale||'')?'selected':''}>${f?esc(f):'Groupe'}</option>`).join('')}</select>`}</td>
      <td>${u.actif?'<span class="valid-b">actif</span>':'<span class="todo">désactivé</span>'}${u.provisoire?' <span class="todo">mdp provisoire</span>':''}</td>
      <td>${esc(String(u.date_creation||'—').slice(0,10))}</td>
      <td>${u.derniere_connexion?esc(String(u.derniere_connexion).slice(0,10)):'—'}</td>
      <td style="text-align:left">
        <button class="linkbtn" data-act="reinit" data-id="${u.id}">réinitialiser mdp</button>
        ${moi?'':`<button class="linkbtn ${u.actif?'danger':''}" data-act="actif" data-id="${u.id}">${u.actif?'désactiver':'réactiver'}</button>`}
      </td></tr>`}).join('');
  document.getElementById('usersNote').textContent=USERS.length+' compte'+(USERS.length>1?'s':'')+' — les comptes sont désactivés, jamais supprimés';
}
async function creerCompte(){
  const err=document.getElementById('nuErr');err.textContent='';
  const rap=document.getElementById('nuReport');
  try{
    const r=await api('/utilisateurs',{methode:'POST',corps:{
      nom:document.getElementById('nuNom').value,
      login:document.getElementById('nuLogin').value,
      role:document.getElementById('nuRole').value,
      filiale:document.getElementById('nuFiliale').value}});
    rap.innerHTML=`Compte <b>${esc(r.login)}</b> créé. Mot de passe provisoire : <code style="font-size:13px;padding:2px 7px">${esc(r.mot_de_passe_provisoire)}</code><br>Notez-le maintenant — il ne sera plus jamais affiché. L'utilisateur devra le remplacer à sa première connexion.`;
    document.getElementById('nuNom').value='';document.getElementById('nuLogin').value='';document.getElementById('nuFiliale').value='';
    chargerUsers();
  }catch(e){err.textContent=e.message}
}
document.getElementById('usersBody').addEventListener('click',async e=>{
  const b=e.target.closest('button[data-act]');if(!b||!droits().manage)return;
  const u=USERS.find(x=>String(x.id)===b.dataset.id);if(!u)return;
  try{
    if(b.dataset.act==='reinit'){
      if(!confirm('Réinitialiser le mot de passe de « '+u.login+' » ?\nSes sessions en cours seront coupées.'))return;
      const r=await api('/utilisateurs/'+u.id+'/reinitialiser',{methode:'POST'});
      document.getElementById('nuReport').innerHTML=`Mot de passe provisoire de <b>${esc(r.login)}</b> : <code style="font-size:13px;padding:2px 7px">${esc(r.mot_de_passe_provisoire)}</code><br>Notez-le maintenant — il ne sera plus jamais affiché.`;
    }else{
      if(u.actif&&!confirm('Désactiver « '+u.login+' » ?\nSes sessions seront coupées immédiatement.'))return;
      await api('/utilisateurs/'+u.id,{methode:'PATCH',corps:{actif:!u.actif}});
    }
    chargerUsers();
  }catch(err){bandeau(err.message,true)}
});
document.getElementById('usersBody').addEventListener('change',async e=>{
  const s=e.target.closest('select.role-sel');if(!s||!droits().manage)return;
  const estPerim=s.classList.contains('perim-sel');
  try{await api('/utilisateurs/'+s.dataset.uid,{methode:'PATCH',corps:estPerim?{filiale:s.value}:{role:s.value}});
    bandeau((estPerim?'Périmètre':'Rôle')+' mis à jour — effectif à la prochaine requête de l\'utilisateur.')}
  catch(err){bandeau(err.message,true)}
  chargerUsers();
});

const ROLES_UI={CONTRIBUTEUR:'Contributeur',BPO:'BPO',DFC:'DFC',DIRECTION:'Direction',ADMIN:'Administrateur'};
document.getElementById('btnNouveauCode').onclick=async()=>{
  if(!confirm('Générer un nouveau code de récupération ?\nL\'ancien code ne fonctionnera plus.'))return;
  try{const r=await api('/administration/code-recuperation',{methode:'POST'});await afficherCodeRecup(r.code_recuperation);chargerUsers()}
  catch(e){bandeau(e.message,true)}
};
document.getElementById('nuRole').addEventListener('change',e=>{
  const f=document.getElementById('nuFiliale');const adm=e.target.value==='ADMIN';
  f.disabled=adm;if(adm)f.value='';f.placeholder=adm?'Groupe (obligatoire pour un administrateur)':'Groupe — toutes les filiales';
});
