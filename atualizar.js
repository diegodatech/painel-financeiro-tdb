/* TDB 02c — aviso "Há novidades no Drive".
   Só LÊ: pergunta ao servidor (statusAbertura) se a revisão mudou por causa de outro aparelho.
   Não grava nada e não altera a sincronização. O botão "Atualizar" fica dentro do painel (React). */
(function () {
  'use strict';
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
