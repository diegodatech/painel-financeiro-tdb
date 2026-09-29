const BUILD='tdb-04';
const CACHE='tdb-financeiro-github-'+BUILD;
const LOCAL=[
  './','./index.html','./mobile.html','./desktop.html','./config.js','./version.json','./manifest.webmanifest',
  './icons/icon-192.png','./icons/icon-512.png','./assets/termo-consentimento.pdf'
];
const REMOTE=[
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/prop-types@15.8.1/prop-types.min.js',
  'https://unpkg.com/recharts@2.12.7/umd/Recharts.js',
  'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.min.js',
  'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js'
];
self.addEventListener('install',event=>{event.waitUntil((async()=>{
  const c=await caches.open(CACHE);
  await c.addAll(LOCAL);
  await Promise.allSettled(REMOTE.map(async u=>{try{const r=await fetch(u,{mode:'cors',cache:'reload'});if(r&&r.ok)await c.put(u,r.clone());}catch(e){try{const r=await fetch(u,{mode:'no-cors',cache:'reload'});if(r)await c.put(u,r.clone());}catch(_){}}}));
  self.skipWaiting();
})());});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{
  const ks=await caches.keys();
  await Promise.all(ks.filter(k=>k.startsWith('tdb-financeiro-')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})());});
async function cacheFallback(req,fallback){
  const c=await caches.open(CACHE);
  return (await c.match(req)) || (fallback ? await c.match(fallback) : null);
}
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.hostname.includes('script.google.com')||url.hostname.includes('script.googleusercontent.com')){
    event.respondWith(fetch(req));return;
  }
  if(url.origin===self.location.origin){
    const isPanel=/\/(mobile|desktop)\.html$/.test(url.pathname);
    const isVersion=url.pathname.endsWith('/version.json');
    const isLauncher=url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');
    if(isLauncher){
      event.respondWith((async()=>{
        const c=await caches.open(CACHE);
        try{const n=await fetch(req,{cache:'no-store'});if(n&&n.ok)await c.put(req,n.clone());return n;}
        catch(e){return (await c.match(req))||(await c.match('./index.html'));}
      })());return;
    }
    if(isVersion){ event.respondWith(fetch(req).catch(()=>cacheFallback(req,'./version.json'))); return; }
    if(isPanel){
      event.respondWith((async()=>{
        const c=await caches.open(CACHE);
        try{const n=await fetch(req,{cache:'no-store'});if(n&&n.ok)await c.put(req,n.clone());return n;}
        catch(e){return (await c.match(req))||(await c.match(url.pathname.endsWith('mobile.html')?'./mobile.html':'./desktop.html'));}
      })());return;
    }
    event.respondWith((async()=>{
      const c=await caches.open(CACHE);const hit=await c.match(req);
      if(hit){fetch(req).then(r=>{if(r&&r.ok)c.put(req,r.clone());}).catch(()=>{});return hit;}
      try{const n=await fetch(req);if(n&&n.ok)c.put(req,n.clone());return n;}catch(e){return Response.error();}
    })());return;
  }
  event.respondWith((async()=>{
    const c=await caches.open(CACHE);const hit=await c.match(req)||await c.match(req.url);if(hit)return hit;
    try{const n=await fetch(req);if(url.hostname==='unpkg.com'||url.hostname.includes('fonts.googleapis.com')||url.hostname.includes('fonts.gstatic.com'))c.put(req,n.clone());return n;}catch(e){return hit||Response.error();}
  })());
});