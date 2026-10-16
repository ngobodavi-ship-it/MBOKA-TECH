/* =======================================================================
   app/authentification.js — Connexion, installation, récupération, mot de passe
   Contenu    : showAuth(), submitAuth(), enterApp(), logout(), changement de mot de passe
   Dépend de  : lib/api.js, navigation.js
   ======================================================================= */
/* ---------- connexion / installation / mot de passe ---------- */
let authMode='login';
function renderUserbar(){
  const zone=document.getElementById('userArea');
  if(!MOI){zone.innerHTML='';return}
  zone.innerHTML=`
    <span class="avatar" aria-hidden="true">${esc(String(MOI.nom||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase())}</span>
    <div class="who"><span class="n">${esc(MOI.nom)}</span><span class="r">${esc(MOI.roleLabel)} · ${esc(MOI.filiale||'Groupe')}</span></div>
    <div class="ub-acts"><button class="btn-top" id="btnPwd">Mot de passe</button>
    <button class="btn-top" id="btnLogout">Déconnexion</button></div>`;
  document.getElementById('btnPwd').onclick=()=>openPwdModal(false);
  document.getElementById('btnLogout').onclick=logout;
}
function showAuth(mode,message){
  MOI=null;authMode=mode||'login';
  renderUserbar();
  document.getElementById('authScreen').hidden=false;
  document.getElementById('authSetup').hidden=authMode!=='setup';
  document.getElementById('authLogin').hidden=authMode!=='login';
  document.getElementById('authRecover').hidden=authMode!=='recover';
  document.getElementById('authSub').textContent={setup:'Premier lancement — créez le compte administrateur',
    login:'Connexion',recover:'Récupération du compte administrateur'}[authMode];
  document.getElementById('authBtn').textContent={setup:'Créer le compte et entrer',login:'Se connecter',
    recover:'Redéfinir le mot de passe'}[authMode];
  document.getElementById('authErr').textContent=message||'';
  document.getElementById('authReset').hidden=authMode!=='login';
  document.getElementById('authRetour').hidden=authMode!=='recover';
  document.getElementById('authHint').textContent={
    setup:'Ce compte gérera ensuite les autres accès (DFC, Direction, BPO, contributeurs des filiales). Un code de récupération vous sera remis juste après : notez-le.',
    login:'Les comptes sont créés par un administrateur.'+((window.PILOTAGE_CONFIG||{}).mode==='autonome'
      ?' Version autonome : comptes et données vivent dans le navigateur de ce poste.':''),
    recover:'Saisissez le code de récupération remis à l\'installation. Les données et les autres comptes ne sont pas modifiés.'}[authMode];
  setTimeout(()=>{const f=document.getElementById({setup:'suNom',login:'liLogin',recover:'rcCode'}[authMode]);if(f)f.focus()},60);
}
function afficherCodeRecup(code){
  return new Promise(res=>{
    const m=document.getElementById('codeModal');
    document.getElementById('codeValeur').textContent=code;
    m.hidden=false;
    const ok=document.getElementById('codeOk');ok.focus();
    document.getElementById('codeCopier').onclick=()=>{
      try{navigator.clipboard.writeText(code).then(()=>bandeau('Code copié — collez-le dans un endroit sûr.'),()=>{})}catch(e){}};
    ok.onclick=()=>{m.hidden=true;document.getElementById('codeValeur').textContent='';res()};
  });
}
async function submitAuth(){
  const err=document.getElementById('authErr');err.textContent='';
  const btn=document.getElementById('authBtn');btn.disabled=true;
  try{
    let rep;
    if(authMode==='setup'){
      const p=document.getElementById('suPwd').value;
      if(p!==document.getElementById('suPwd2').value){err.textContent='Les deux mots de passe ne correspondent pas.';btn.disabled=false;return}
      rep=await api('/installation',{methode:'POST',corps:{
        nom:document.getElementById('suNom').value,
        login:document.getElementById('suLogin').value,mot_de_passe:p}});
    }else if(authMode==='recover'){
      const p=document.getElementById('rcPwd').value;
      if(p!==document.getElementById('rcPwd2').value){err.textContent='Les deux mots de passe ne correspondent pas.';btn.disabled=false;return}
      const r=await api('/recuperation',{methode:'POST',corps:{code:document.getElementById('rcCode').value,
        login:document.getElementById('rcLogin').value,nouveau:p}});
      ['rcCode','rcPwd','rcPwd2'].forEach(id=>document.getElementById(id).value='');
      const login=document.getElementById('rcLogin').value;document.getElementById('rcLogin').value='';
      await afficherCodeRecup(r.code_recuperation);
      showAuth('login','');
      document.getElementById('liLogin').value=login;
      document.getElementById('authHint').textContent='Mot de passe redéfini. Connectez-vous avec le nouveau mot de passe.';
      btn.disabled=false;return;
    }else{
      rep=await api('/connexion',{methode:'POST',corps:{
        login:document.getElementById('liLogin').value,
        mot_de_passe:document.getElementById('liPwd').value}});
    }
    ['suNom','suLogin','suPwd','suPwd2','liLogin','liPwd'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=''});
    if(rep.code_recuperation)await afficherCodeRecup(rep.code_recuperation);
    await enterApp(rep.connecte);
  }catch(e){err.textContent=e.message}
  btn.disabled=false;
}
document.getElementById('authReset').onclick=()=>showAuth('recover','');
document.getElementById('authRetour').onclick=()=>showAuth('login','');
async function enterApp(profil){
  MOI=profil;
  if(MOI.role==='ADMIN'){try{const e=await api('/etat');if(!e.recuperation)setTimeout(()=>bandeau('Aucun code de récupération sur ce poste — générez-en un dans Utilisateurs.',true),900)}catch(e){}}
  document.getElementById('authScreen').hidden=true;
  renderUserbar();
  await rafraichirProduction();
  chargerConnecteurs();chargerJournal();chargerCorbeille();
  if(MOI.provisoire)openPwdModal(true);
}
function onSessionPerdue(){
  if(!MOI)return;
  showAuth('login','Session expirée — reconnectez-vous.');
}
async function logout(){
  try{await api('/deconnexion',{methode:'POST'})}catch(e){}
  switchView('dash');showAuth('login');
}
let pwdForce=false;
function openPwdModal(force){
  pwdForce=!!force;
  document.getElementById('pwdModal').hidden=false;
  document.getElementById('pwdSub').textContent=force
    ?'Votre mot de passe provisoire doit être remplacé avant de continuer.'
    :'Choisissez un nouveau mot de passe (8 caractères minimum).';
  document.getElementById('pwdErr').textContent='';
  ['pwdOld','pwdNew','pwdNew2'].forEach(i=>document.getElementById(i).value='');
  document.getElementById('pwdCancel').style.display=force?'none':'';
  setTimeout(()=>document.getElementById('pwdOld').focus(),60);
}
async function savePwd(){
  const err=document.getElementById('pwdErr');err.textContent='';
  const nv=document.getElementById('pwdNew').value;
  if(nv!==document.getElementById('pwdNew2').value){err.textContent='Les deux mots de passe ne correspondent pas.';return}
  try{
    await api('/mot-de-passe',{methode:'POST',corps:{actuel:document.getElementById('pwdOld').value,nouveau:nv}});
    MOI.provisoire=false;pwdForce=false;
    document.getElementById('pwdModal').hidden=true;
    bandeau('Mot de passe mis à jour.');
  }catch(e){err.textContent=e.message}
}
