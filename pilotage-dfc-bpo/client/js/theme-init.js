/* theme-init.js — Applique le thème clair / sombre avant le premier rendu. */
/* thème : choix mémorisé sur ce poste, sinon réglage du système */
(function(){var t=null;try{t=localStorage.getItem('pilotage-theme')}catch(e){}
  if(t!=='dark'&&t!=='light')t=(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';
  document.documentElement.setAttribute('data-theme',t)})();
