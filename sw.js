// TDB 02n — Service Worker
// Objetivos: abrir o painel na hora (mesmo com internet ruim), nunca falhar a instalação por causa de UM arquivo,
// e nunca interceptar as chamadas ao Google (Apps Script) — elas vão direto do navegador ao servidor.
const BUILD='tdbn-20261008-tempo1-v51';
const CACHE='tdb-financeiro-github-'+BUILD;
const CRITICOS=[
  './','./index.html','./desktop.html','./mobile.html','./config.js','./sync.js','./atualizar.js','./version.json','./manifest.webmanifest',
  './icon-192.png','./icon-512.png','./icon-180.png','./icon-maskable-512.png','./favicon-64.png',
  './react.production.min.js','./react-dom.production.min.js','./prop-types.min.js','./Recharts.js'
];
const ESSENCIAIS=['./index.html','./desktop.html','./mobile.html','./config.js','./sync.js',
  './react.production.min.js','./react-dom.production.min.js','./prop-types.min.js','./Recharts.js'];
async function guardar(c,u){
  const controle=new AbortController();
  const timer=setTimeout(()=>controle.abort(),20000);
  try{const r=await fetch(u,{cache:'reload',signal:controle.signal});if(r&&r.ok){await c.put(u,r.clone());return true;}}catch(e){}
  finally{clearTimeout(timer);}
  return false;
}
self.addEventListener('install',event=>{event.waitUntil((async()=>{
  const c=await caches.open(CACHE);
  const resultados=await Promise.all(CRITICOS.map(u=>guardar(c,u)));
  if(ESSENCIAIS.some(u=>!resultados[CRITICOS.indexOf(u)])) throw new Error('Atualização incompleta: preservando a versão anterior.');
  await self.skipWaiting();
  // Bibliotecas de PDF só são baixadas quando usadas; não disputam a abertura.
})());});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{
  const ks=await caches.keys();
  await Promise.all(ks.filter(k=>k.startsWith('tdb-financeiro-')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})());});

// abre do cache na hora e atualiza em segundo plano ("stale-while-revalidate"); ignora ?build=
async function cacheEDepoisRede(event,req,extra){
  const c=await caches.open(CACHE);
  const hit=await c.match(req,{ignoreSearch:true});
  const rede=fetch(req,{cache:'no-store'}).then(r=>{if(r&&r.ok&&r.type!=='opaqueredirect'){c.put(req.url.split('?')[0],r.clone()).catch(()=>{});}return r;});
  if(hit){event.waitUntil(rede.catch(()=>{}));return hit;}
  try{const r=await rede;if(r&&r.ok)return r;}catch(e){}
  return (extra&&(await c.match(extra)))||Response.error();
}
// rede primeiro, com prazo curto, senão cache (para version.json)
async function redeComPrazo(req,ms){
  const c=await caches.open(CACHE);
  try{
    const r=await Promise.race([fetch(req,{cache:'no-store'}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('t')),ms))]);
    if(r&&r.ok){c.put(req.url.split('?')[0],r.clone()).catch(()=>{});return r;}
  }catch(e){}
  return (await c.match(req,{ignoreSearch:true}))||Response.error();
}
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  // Google Apps Script/Drive: passa direto, sem service worker no caminho.
  if(/(^|\.)google\.com$|googleusercontent\.com$/.test(url.hostname)&&!/fonts\./.test(url.hostname))return;
  if(url.origin===self.location.origin){
    const p=url.pathname;
    // só arquivos estáticos do painel (nunca chamadas de API): o resto passa direto
    if(!(p.endsWith('/')||/\.(html|js|json|png|jpg|jpeg|svg|ico|pdf|webmanifest|css|woff2?)$/i.test(p)))return;
    if(p.endsWith('/version.json')){event.respondWith(redeComPrazo(req,2500));return;}
    if(/\/(mobile|desktop)\.html$/.test(p)){event.respondWith(cacheEDepoisRede(event,req,p.endsWith('mobile.html')?'./mobile.html':'./desktop.html'));return;}
    if(p.endsWith('/index.html')||p.endsWith('/')){event.respondWith(cacheEDepoisRede(event,req,'./index.html'));return;}
    event.respondWith(cacheEDepoisRede(event,req,null));return;
  }
  // fontes e bibliotecas de reserva: cache primeiro
  if(/fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com/.test(url.hostname)){
    event.respondWith((async()=>{
      const c=await caches.open(CACHE);const hit=await c.match(req);if(hit)return hit;
      try{const n=await fetch(req);if(n&&(n.ok||n.type==='opaque'))c.put(req,n.clone()).catch(()=>{});return n;}catch(e){return Response.error();}
    })());
  }
});
