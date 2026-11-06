/* TDB 02i — aviso "Há novidades no Drive".
   Só LÊ: pergunta ao servidor (statusAbertura) se a revisão mudou por causa de outro aparelho.
   Não grava nada e não altera a sincronização. O botão "Atualizar" fica dentro do painel (React). */
(function () {
  'use strict';
  // TDB 02i — diz em que tipo de aparelho o painel está rodando, para as mensagens falarem do aparelho certo.
  window.__tdbTipoAparelho = function () {
    try {
      var ua = navigator.userAgent || '';
      var grosso = !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
      var lado = Math.min(window.screen.width || 0, window.screen.height || 0);
      if (/iPhone|iPod/.test(ua)) return 'celular';
      if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
      if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'celular' : 'tablet';
      // Tablets Android no modo "site para computador" se identificam como desktop: o toque com o dedo os entrega.
      if (grosso) return lado < 600 ? 'celular' : 'tablet';
    } catch (e) {}
    return 'computador';
  };
  var INTERVALO_MS = 30000;        // confere a cada 30 s enquanto a tela está visível e em uso
  var ATIVIDADE_MS = 10 * 60 * 1000;
  var MOSTRAR_MS = 10000;          // o aviso some sozinho depois de 10 s (o pontinho no botão continua)
  var atividade = Date.now(), ultimoCheque = 0, emVoo = false;
  var positivos = 0, ultimaRevAvisada = null, timerEsconder = null, pilula = null;

  function criarPilula() {
    if (pilula) return pilula;
    var el = document.createElement('div');
    el.id = 'tdb-aviso-novidades';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('data-export-ignore', 'true');
    el.style.cssText = [
      'position:fixed', 'z-index:2147483500', 'top:calc(env(safe-area-inset-top, 0px) + 12px)', 'left:50%',
      'transform:translateX(-50%) translateY(-10px)', 'max-width:calc(100vw - 28px)', 'box-sizing:border-box',
      'padding:10px 16px', 'border-radius:18px', 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
      'font-size:13px', 'line-height:1.25', 'font-weight:700', 'text-align:center', 'color:#1f2937', 'cursor:pointer',
      'background:rgba(255,255,255,.95)', 'border:1px solid rgba(100,100,120,.18)',
      'box-shadow:0 10px 30px rgba(40,35,55,.18)', 'backdrop-filter:blur(20px) saturate(150%)',
      '-webkit-backdrop-filter:blur(20px) saturate(150%)', 'opacity:0', 'pointer-events:none',
      'transition:opacity .22s ease, transform .22s ease'
    ].join(';');
    el.innerHTML = '🔔 Há novidades no Drive — <span style="text-decoration:underline">toque para atualizar</span>';
    var acionar = function () { esconder(); atualizarAgora(); };
    el.addEventListener('click', acionar);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); acionar(); } });
    document.body.appendChild(el);
    pilula = el;
    return el;
  }

  function mostrar() {
    if (!document.body) return;
    var el = criarPilula();
    el.style.pointerEvents = 'auto';
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(timerEsconder);
    timerEsconder = setTimeout(esconder, MOSTRAR_MS);
  }

  function esconder() {
    clearTimeout(timerEsconder);
    if (!pilula) return;
    pilula.style.opacity = '0';
    pilula.style.pointerEvents = 'none';
    pilula.style.transform = 'translateX(-50%) translateY(-10px)';
  }

  function marcarPonto(ligado) {
    try {
      if (ligado) document.documentElement.setAttribute('data-tdb-novidades', '1');
      else document.documentElement.removeAttribute('data-tdb-novidades');
    } catch (e) {}
  }

  function limpar() { positivos = 0; ultimaRevAvisada = null; marcarPonto(false); esconder(); }
  window.__tdbLimparNovidades = limpar;

  function atualizarAgora() {
    try {
      if (typeof window.__tdbAtualizarAgora === 'function') return window.__tdbAtualizarAgora();
      if (window.storage && window.storage.atualizarDoDrive) return window.storage.atualizarDoDrive();
    } catch (e) {}
  }

  function verificar(motivo, ignorarLimite) {
    if (emVoo) return;
    if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
    if (!window.storage || typeof window.storage.verificarNovidades !== 'function') return;
    if (window.__aberturaConcluida !== true) return;
    if (window.__atualizandoAgoraFlag || window.__salvandoAgoraFlag) return;
    var agora = Date.now();
    if (!ignorarLimite && agora - ultimoCheque < (motivo === 'visivel' ? 4000 : 20000)) return;
    ultimoCheque = agora;
    emVoo = true;
    window.storage.verificarNovidades().then(function (r) {
      emVoo = false;
      if (!r || !r.ok) return;
      if (r.ocupado) return;
      if (!r.novidades) { positivos = 0; ultimaRevAvisada = null; marcarPonto(false); esconder(); return; }
      positivos++;
      // Precisa aparecer em duas conferências seguidas: evita falso alarme logo depois de uma gravação sua.
      if (positivos < 2) {
        if (motivo === 'visivel') setTimeout(function () { verificar('visivel-2', true); }, 2500);
        return;
      }
      marcarPonto(true);
      if (r.revisaoServidor !== ultimaRevAvisada) { ultimaRevAvisada = r.revisaoServidor; mostrar(); }
    }).catch(function () { emVoo = false; });
  }

  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function () { atividade = Date.now(); }, { passive: true, capture: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { atividade = Date.now(); positivos = 0; setTimeout(function () { verificar('visivel'); }, 800); }
  });
  window.addEventListener('focus', function () { setTimeout(function () { verificar('visivel'); }, 800); });
  window.addEventListener('online', function () { setTimeout(function () { verificar('visivel'); }, 800); });
  window.addEventListener('painel:drive-atualizado', limpar);
  setInterval(function () { if (Date.now() - atividade < ATIVIDADE_MS) verificar('tempo'); }, INTERVALO_MS);
})();

/* TDB v1.77 — aviso "Nova versão disponível" (faixa grande de vidro, Opção A).
   Só LÊ o version.json (rede, sem cache) e compara com a versão em uso (TDB_CONFIG.build). Não grava dados, não mexe na sincronização.
   Fica na tela até tocar em "Atualizar agora" ou no ×. O × só dispensa até reabrir o app. Reconfere ao voltar para o app e a cada ~2 min. */
(function () {
  'use strict';
  var PRIMEIRA_MS = 4000, MIN_ENTRE_MS = 60 * 1000, RECHECA_MS = 2 * 60 * 1000;
  var ultimo = 0, emVoo = false, faixa = null, aplicando = false, dispensada = '', novaBuild = '', novaLabel = '';
  // Versão em que ESTA PÁGINA está: vem do próprio HTML (o ?build= do sync.js/config.js escritos nele). O config.js em si pode vir NOVO do cache do
  // service worker (ignoreSearch) mesmo com a página velha — foi isso que escondia o aviso quando a página abria de cópia antiga.
  function meuBuild() {
    try {
      var ss = document.querySelectorAll('script[src*="sync.js"],script[src*="config.js"]');
      for (var i = 0; i < ss.length; i++) { var m = /[?&]build=([^&#]+)/.exec(ss[i].getAttribute('src') || ''); if (m) return decodeURIComponent(m[1]); }
    } catch (e) {}
    return (window.TDB_CONFIG || {}).build || '';
  }
  function rotuloDe(b) { var m = /v(\d+)-(\d+)$/.exec(String(b || '')); return m ? 'v' + m[1] + '.' + m[2] : ''; }
  function limpaLabel(t) { return String(t || '').replace(/ /g, ' '); }
  function el(tag, css, txt) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; }
  function css() {
    if (document.getElementById('tdb-aviso-versao-css')) return;
    var st = document.createElement('style');
    st.id = 'tdb-aviso-versao-css';
    st.textContent = '#tdb-aviso-versao{position:fixed;z-index:2147483500;left:50%;top:calc(env(safe-area-inset-top,0px) + 10px);width:min(760px,calc(100vw - 24px));box-sizing:border-box;display:flex;align-items:center;gap:14px;padding:13px 16px;border-radius:22px;background:rgba(255,255,255,.94);border:1.5px solid #cfd9ee;box-shadow:0 14px 36px rgba(40,60,110,.24);backdrop-filter:blur(20px) saturate(150%);-webkit-backdrop-filter:blur(20px) saturate(150%);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:#1c2230;opacity:0;pointer-events:none;transform:translateX(-50%) translateY(-14px);transition:opacity .25s ease,transform .25s ease}' +
      '#tdb-aviso-versao.on{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0)}' +
      '#tdb-aviso-versao .ic{width:46px;height:46px;border-radius:15px;background:linear-gradient(135deg,#3b6fe0,#8f6bd8);display:flex;align-items:center;justify-content:center;color:#fff;font-size:25px;font-weight:800;flex:none}' +
      '#tdb-aviso-versao .tx{flex:1 1 auto;min-width:0}#tdb-aviso-versao .tx b{display:block;font-size:16px;line-height:1.2}#tdb-aviso-versao .tx small{display:block;font-size:12.5px;color:#5b6577;margin-top:2px;line-height:1.3}' +
      '#tdb-aviso-versao .bt{border:0;cursor:pointer;background:#3b6fe0;color:#fff;border-radius:13px;padding:11px 18px;font-weight:800;font-size:14px;white-space:nowrap;font-family:inherit}' +
      '#tdb-aviso-versao .x{border:0;cursor:pointer;width:30px;height:30px;border-radius:50%;background:#eef2f8;color:#5b6577;font-weight:800;font-size:16px;line-height:1;flex:none;font-family:inherit}' +
      '@media (max-width:560px){#tdb-aviso-versao{flex-wrap:wrap;gap:10px;padding:12px 14px}#tdb-aviso-versao .tx{flex:1 1 150px}#tdb-aviso-versao .bt{flex:1 1 100%;order:5;text-align:center;padding:12px 18px}}';
    document.head.appendChild(st);
  }
  function criar() {
    if (faixa) return faixa;
    css();
    var f = el('div'); f.id = 'tdb-aviso-versao';
    f.setAttribute('role', 'alert'); f.setAttribute('aria-live', 'polite'); f.setAttribute('data-export-ignore', 'true');
    f.appendChild(el('div', '', '⟳')).className = 'ic';
    var tx = el('div'); tx.className = 'tx';
    tx.appendChild(el('b', '', 'Nova versão disponível'));
    tx.appendChild(el('small', '', ''));
    f.appendChild(tx);
    var bt = el('button', '', 'Atualizar agora'); bt.type = 'button'; bt.className = 'bt'; bt.addEventListener('click', aplicar);
    var x = el('button', '', '×'); x.type = 'button'; x.className = 'x'; x.setAttribute('aria-label', 'Dispensar'); x.addEventListener('click', function () { dispensada = novaBuild; esconder(); });
    f.appendChild(bt); f.appendChild(x);
    document.body.appendChild(f);
    faixa = f;
    return f;
  }
  function sub(t) { var s = criar().querySelector('small'); if (s) s.textContent = t; }
  function titulo(t) { var b = criar().querySelector('b'); if (b) b.textContent = t; }
  // Empurra o app para baixo enquanto a faixa está na tela, para ela não cobrir o cabeçalho (logo, Salvar, Atualizar...).
  function reservar(ligado) {
    try {
      var h = ligado && faixa ? Math.ceil(faixa.getBoundingClientRect().height) + 18 : 0, ds = document.documentElement.style;
      ds.transition = 'padding-top .25s ease';
      ds.paddingTop = h ? h + 'px' : '';
    } catch (e) {}
  }
  function exibir() { criar().className = (faixa.className || '').replace(/\bon\b/, '') + ' on'; reservar(true); setTimeout(function () { reservar(true); }, 60); }
  function esconder() { if (faixa) faixa.className = (faixa.className || '').replace(/\bon\b/g, '').trim(); reservar(false); }
  window.addEventListener('resize', function () { if (faixa && /\bon\b/.test(faixa.className)) reservar(true); });
  function mostrar() {
    var cfg = window.TDB_CONFIG || {};
    titulo('Nova versão disponível');
    var meu = rotuloDe(meuBuild());
    sub(novaLabel + (meu ? ' · você está na ' + meu : '') + ' · leva uns segundos');
    var bt = criar().querySelector('.bt'); if (bt) bt.style.display = '';
    exibir();
  }
  function falha(msg) { aplicando = false; titulo('Não consegui atualizar agora'); sub(msg); var bt = criar().querySelector('.bt'); if (bt) bt.style.display = ''; exibir(); }
  // Se a página voltou velha depois de um "Atualizar agora" (service worker que não trocou, cópia presa), a 2ª tentativa limpa tudo e baixa de novo.
  function tentativaForte() {
    try {
      var o = JSON.parse(sessionStorage.getItem('tdbUpdTent') || '{}'), agora = Date.now();
      if (o.build === novaBuild && agora - (o.em || 0) < 6 * 60 * 1000) o.n = (o.n || 0) + 1; else o = { build: novaBuild, em: agora, n: 1 };
      sessionStorage.setItem('tdbUpdTent', JSON.stringify(o));
      return o.n >= 2;
    } catch (e) { return false; }
  }
  function limparTudoERecarregar() {
    var url = location.pathname + '?_upd=' + Date.now() + (location.hash || '');
    var ir = function () { try { location.replace(url); } catch (e) { location.reload(); } };
    var tarefas = [];
    try { if (window.caches) tarefas.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (e) {}
    try { if (navigator.serviceWorker) tarefas.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })); } catch (e) {}
    Promise.all(tarefas).then(ir, ir);
    setTimeout(ir, 6000);
  }
  function seguir() {
    var feito = false;
    if (tentativaForte()) { limparTudoERecarregar(); return; }
    function recarregar() { if (feito) return; feito = true; try { location.reload(); } catch (e) { location.href = location.href; } }
    if (!('serviceWorker' in navigator)) { recarregar(); return; }
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) { recarregar(); return; }
      navigator.serviceWorker.addEventListener('controllerchange', function () { setTimeout(recarregar, 300); });
      setTimeout(function () { if (!feito) falha('Tente pelo ⚙️ › Versão do app.'); }, 25000);
      return reg.update().then(function () { if (!reg.installing && !reg.waiting) setTimeout(recarregar, 600); });
    }).catch(function () { falha('Tente pelo ⚙️ › Versão do app.'); });
  }
  function aplicar() {
    if (aplicando) return;
    if (window.__salvandoAgoraFlag || window.__atualizandoAgoraFlag) { falha('Aguarde terminar de salvar e toque de novo.'); return; }
    aplicando = true;
    titulo('Salvando e atualizando…'); sub('O app vai reiniciar sozinho.');
    var bt = criar().querySelector('.bt'); if (bt) bt.style.display = 'none';
    exibir();
    var t0 = Date.now();
    (function esperar() {
      var ocupado = window.__salvandoAgoraFlag || window.__atualizandoAgoraFlag;
      var pend = Number(window.__pendenciasSync || 0) > 0;
      if (Date.now() - t0 > 8000) { if (ocupado) falha('Aguarde terminar de salvar e toque de novo.'); else seguir(); return; }
      if (!ocupado && !pend) { seguir(); return; }
      setTimeout(esperar, 400);
    })();
  }
  function conferir(forcar) {
    if (emVoo || aplicando) return;
    if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
    var cfg = { build: meuBuild() };
    if (!cfg.build) return;
    var agora = Date.now();
    if (!forcar && agora - ultimo < MIN_ENTRE_MS) return;
    ultimo = agora;
    emVoo = true;
    fetch('./version.json?v=' + agora + '_' + Math.random().toString(36).slice(2, 7), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http');
      return r.json();
    }).then(function (j) {
      emVoo = false;
      if (!j || !j.build) return;
      // Resposta igual à versão em uso NÃO apaga o aviso já mostrado (pode ser uma cópia velha vinda do cache): ele só sai com o toque do usuário.
      if (j.build === cfg.build) return;
      novaBuild = j.build; novaLabel = limpaLabel(j.label || j.build);
      if (!forcar && dispensada === j.build) return;
      mostrar();
    }).catch(function () { emVoo = false; });
  }
  window.__tdbConferirVersao = conferir;
  setTimeout(function () { conferir(false); }, PRIMEIRA_MS);
  setInterval(function () { conferir(false); }, RECHECA_MS);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') setTimeout(function () { conferir(false); }, 1200); });
  window.addEventListener('focus', function () { setTimeout(function () { conferir(false); }, 1200); });
  window.addEventListener('online', function () { setTimeout(function () { conferir(false); }, 1500); });
})();
