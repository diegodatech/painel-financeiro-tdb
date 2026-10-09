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

/* TDB v1.4 — aviso "Nova versão disponível".
   Só LÊ o version.json (rede, sem cache) e compara com a versão em uso (TDB_CONFIG.build). Não grava dados, não mexe na sincronização.
   Aparece uma vez por abertura do app (por versão nova), na mesma caixa branca dos outros avisos do topo. Tocar = mesmo "Atualizar agora" do ⚙️. */
(function () {
  'use strict';
  var PRIMEIRA_MS = 9000, MIN_ENTRE_MS = 5 * 60 * 1000, MOSTRAR_MS = 12000;
  var ultimo = 0, emVoo = false, pilula = null, timerEsc = null, aplicando = false, avisadas = {};
  try { avisadas = JSON.parse(sessionStorage.getItem('tdb_ver_avisada') || '{}') || {}; } catch (e) { avisadas = {}; }
  function marcar(b) { avisadas[b] = 1; try { sessionStorage.setItem('tdb_ver_avisada', JSON.stringify(avisadas)); } catch (e) {} }

  function topo() {
    var extra = 0, d = document.getElementById('tdb-aviso-novidades'), t = document.getElementById('tdb-startup-source-toast');
    if ((d && d.style.opacity === '1') || (t && t.style.opacity === '1')) extra = 54;
    return 'calc(env(safe-area-inset-top, 0px) + ' + (12 + extra) + 'px)';
  }
  function criar() {
    if (pilula) return pilula;
    var el = document.createElement('div');
    el.id = 'tdb-aviso-versao';
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
    el.addEventListener('click', aplicar);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aplicar(); } });
    document.body.appendChild(el);
    pilula = el;
    return el;
  }
  function exibir() {
    var el = criar();
    el.style.top = topo();
    el.style.pointerEvents = 'auto';
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  }
  function esconder() {
    clearTimeout(timerEsc);
    if (!pilula) return;
    pilula.style.opacity = '0';
    pilula.style.pointerEvents = 'none';
    pilula.style.transform = 'translateX(-50%) translateY(-10px)';
  }
  function textoSimples(t) { criar().textContent = t; }
  function mostrar(label) {
    var el = criar();
    el.textContent = '';
    el.appendChild(document.createTextNode('🔄 Nova versão disponível: ' + label + ' — '));
    var u = document.createElement('span');
    u.style.textDecoration = 'underline';
    u.textContent = 'toque para atualizar';
    el.appendChild(u);
    exibir();
    clearTimeout(timerEsc);
    timerEsc = setTimeout(esconder, MOSTRAR_MS);
  }
  function falha(msg) {
    aplicando = false;
    textoSimples(msg);
    exibir();
    clearTimeout(timerEsc);
    timerEsc = setTimeout(esconder, 7000);
  }
  function seguir() {
    var feito = false;
    function recarregar() { if (feito) return; feito = true; try { location.reload(); } catch (e) { location.href = location.href; } }
    if (!('serviceWorker' in navigator)) { recarregar(); return; }
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) { recarregar(); return; }
      navigator.serviceWorker.addEventListener('controllerchange', function () { setTimeout(recarregar, 300); });
      setTimeout(function () { if (!feito) falha('Não consegui atualizar agora. Tente pelo ⚙️ › Versão do app.'); }, 25000);
      return reg.update().then(function () { if (!reg.installing && !reg.waiting) setTimeout(recarregar, 600); });
    }).catch(function () { falha('Não consegui atualizar agora. Tente pelo ⚙️ › Versão do app.'); });
  }
  function aplicar() {
    if (aplicando) return;
    if (window.__salvandoAgoraFlag || window.__atualizandoAgoraFlag) { falha('Aguarde terminar de salvar e toque de novo.'); return; }
    aplicando = true;
    clearTimeout(timerEsc);
    textoSimples('Salvando e atualizando… o app vai reiniciar.');
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
    var cfg = window.TDB_CONFIG || {};
    if (!cfg.build) return;
    var agora = Date.now();
    if (!forcar && agora - ultimo < MIN_ENTRE_MS) return;
    ultimo = agora;
    emVoo = true;
    fetch('./version.json?v=' + agora, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http');
      return r.json();
    }).then(function (j) {
      emVoo = false;
      if (!j || !j.build || j.build === cfg.build) return;
      if (!forcar && avisadas[j.build]) return;
      marcar(j.build);
      mostrar(String(j.label || j.build).replace(/ /g, ' '));
    }).catch(function () { emVoo = false; });
  }
  window.__tdbConferirVersao = conferir;
  setTimeout(function () { conferir(false); }, PRIMEIRA_MS);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') setTimeout(function () { conferir(false); }, 1500); });
  window.addEventListener('online', function () { setTimeout(function () { conferir(false); }, 1500); });
})();
