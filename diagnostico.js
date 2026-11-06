/* Diagnóstico de sincronização (v1.84) — SOMENTE LEITURA.
   Não altera dados, não muda o salvamento. Apenas observa o tempo das chamadas ao Google Drive
   e mostra o estado. Abre tocando na etiqueta de status (ex.: "Sincronizado (Google Drive)"). */
(function () {
  'use strict';
  var LOG = [];            // últimas chamadas ao Apps Script
  var MAX = 40;
  function url() { try { return (window.TDB_CONFIG && window.TDB_CONFIG.appsScriptUrl) || ''; } catch (e) { return ''; } }
  function nomeDe(u, init) {
    try {
      var q = String(u).split('?')[1] || '';
      var m = /(?:^|&)(acao|key|chave)=([^&]*)/.exec(q);
      var base = m ? decodeURIComponent(m[2]) : '';
      if (init && typeof init.body === 'string') {
        try { var o = JSON.parse(init.body); base = (o.acao || '') + ' ' + (o.chave || o.key || ''); } catch (e) {}
      }
      return (base || '').trim().slice(0, 60) || '(sem nome)';
    } catch (e) { return '?'; }
  }
  /* Observa fetch sem mudar o resultado: devolve exatamente a mesma promessa/resposta/erro. */
  try {
    var orig = window.fetch;
    if (typeof orig === 'function' && !orig.__tdbDiag) {
      var novo = function (input, init) {
        var u = '';
        try { u = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}
        var alvo = url();
        if (!alvo || String(u).indexOf(alvo.split('/exec')[0]) !== 0) return orig.apply(this, arguments);
        var t0 = Date.now(), metodo = (init && init.method) || 'GET';
        var tam = (init && typeof init.body === 'string') ? init.body.length : 0;
        var nome = nomeDe(u, init);
        var reg = { em: t0, metodo: metodo, nome: nome, bytes: tam, ms: null, res: 'aguardando' };
        LOG.push(reg); if (LOG.length > MAX) LOG.shift();
        var p = orig.apply(this, arguments);
        p.then(function (r) { reg.ms = Date.now() - t0; reg.res = (r && r.type === 'opaque') ? 'enviado (sem leitura)' : ('HTTP ' + (r && r.status)); },
               function (e) { reg.ms = Date.now() - t0; reg.res = 'ERRO: ' + String((e && e.message) || e).slice(0, 80); });
        return p;
      };
      novo.__tdbDiag = true;
      window.fetch = novo;
    }
  } catch (e) {}

  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(1) + ' KB'; }
  function seg(ms) { return ms == null ? '—' : (ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms + ' ms'); }
  function ler(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function hora(t) { try { return new Date(t).toLocaleTimeString('pt-BR'); } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function tamanhos() {
    var l = [], total = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i), v = localStorage.getItem(k) || '';
        var n = (k.length + v.length) * 2; total += n; l.push({ k: k, n: n });
      }
    } catch (e) {}
    l.sort(function (a, b) { return b.n - a.n; });
    return { total: total, top: l.slice(0, 8) };
  }

  function coletar() {
    var w = window, pend = ler('__pendencias_sync_v2') || [], pa = ler('__pendencias_anexos_v1') || [];
    var conf = []; try { conf = (w.__listarConflitosOffline && w.__listarConflitosOffline()) || []; } catch (e) {}
    var t = tamanhos();
    return {
      build: (w.TDB_CONFIG && w.TDB_CONFIG.build) || '?',
      online: navigator.onLine,
      driveDisponivel: w.__driveDisponivel,
      statusPlanilha: w.__statusPlanilha,
      versaoBackend: w.__versaoBackend,
      emAndamento: Number(w.__syncEmAndamento || 0),
      pendencias: Array.isArray(pend) ? pend : [],
      pendAnexos: Array.isArray(pa) ? pa.length : 0,
      conflitos: conf.filter(function (c) { return c && !c.resolvido; }),
      ultimoErro: w.__ultimoErroSync || '',
      ultimaSync: w.__ultimaSincronizacaoDrive || w.__ultimoSalvamentoDrive || '',
      bootMs: w.__ultimaDuracaoBootstrapMs, servMs: w.__ultimaDuracaoServidorMs, confMs: w.__ultimaDuracaoConfirmacaoMs,
      corsFalhas: w.__tdbPostCorsFalhas || 0, corsOff: !!w.__tdbPostCorsDesligado,
      tamTotal: t.total, tamTop: t.top, log: LOG.slice()
    };
  }

  function relatorioTexto(d) {
    var L = [];
    L.push('DIAGNÓSTICO DE SINCRONIZAÇÃO — ' + new Date().toLocaleString('pt-BR'));
    L.push('Versão: ' + d.build + ' | Backend: ' + (d.versaoBackend || '?') + ' | Online: ' + d.online);
    L.push('Drive disponível: ' + d.driveDisponivel + ' | Status planilha: ' + d.statusPlanilha);
    L.push('Gravando agora: ' + d.emAndamento + ' | Pendentes: ' + d.pendencias.length + ' [' + d.pendencias.join(', ') + '] | Anexos pendentes: ' + d.pendAnexos);
    L.push('Conflitos não resolvidos: ' + d.conflitos.length);
    L.push('Último erro: ' + (d.ultimoErro || 'nenhum'));
    L.push('Última sincronização: ' + (d.ultimaSync || '—'));
    L.push('Tempos: abertura ' + seg(d.bootMs) + ' | servidor ' + seg(d.servMs) + ' | confirmação ' + seg(d.confMs));
    L.push('Falhas de leitura direta (CORS): ' + d.corsFalhas + (d.corsOff ? ' (modo sem leitura LIGADO)' : ''));
    L.push('Dados neste navegador: ' + kb(d.tamTotal) + ' — maiores: ' + d.tamTop.map(function (x) { return x.k + ' ' + kb(x.n); }).join('; '));
    L.push('Últimas chamadas ao Drive:');
    d.log.slice().reverse().forEach(function (r) { L.push('  ' + hora(r.em) + ' ' + r.metodo + ' ' + r.nome + ' | ' + kb(r.bytes) + ' | ' + seg(r.ms) + ' | ' + r.res); });
    return L.join('\n');
  }

  function linha(a, b, cor) { return '<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid rgba(128,128,128,.18);font-size:12.5px"><span style="opacity:.75">' + a + '</span><b style="text-align:right;overflow-wrap:anywhere;' + (cor ? 'color:' + cor : '') + '">' + b + '</b></div>'; }

  function abrir() {
    var velho = document.getElementById('tdb-diag'); if (velho) velho.remove();
    var el = document.createElement('div'); el.id = 'tdb-diag';
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(10,20,40,.45);display:flex;align-items:center;justify-content:center;padding:12px;font-family:Inter,system-ui,sans-serif';
    el.innerHTML = '<div style="background:'+(document.body.classList.contains('dark-mode')?'#1b2433':'#ffffff')+';color:'+(document.body.classList.contains('dark-mode')?'#eef2f8':'#16202e')+';border-radius:18px;width:min(640px,100%);max-height:92vh;overflow:auto;padding:16px 16px 14px;box-shadow:0 20px 60px rgba(0,0,0,.35)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:16px">🩺 Diagnóstico de sincronização</b><button id="tdb-diag-x" style="border:0;background:none;font-size:20px;cursor:pointer;color:inherit">✕</button></div>' +
      '<div style="font-size:11.5px;opacity:.7;margin:2px 0 8px">Somente leitura: não altera nenhum dado.</div><div id="tdb-diag-c"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button id="tdb-diag-t" style="flex:1;min-height:40px;border-radius:10px;border:1px solid var(--c-line,#ccd);background:none;color:inherit;font-weight:800;cursor:pointer">Testar conexão agora</button>' +
      '<button id="tdb-diag-a" style="flex:1;min-height:40px;border-radius:10px;border:1px solid var(--c-line,#ccd);background:none;color:inherit;font-weight:800;cursor:pointer">Atualizar</button>' +
      '<button id="tdb-diag-cp" style="flex:1;min-height:40px;border-radius:10px;border:0;background:#2b63d9;color:#fff;font-weight:800;cursor:pointer">Copiar relatório</button></div>' +
      '<div id="tdb-diag-m" style="font-size:12px;margin-top:8px;min-height:16px"></div></div>';
    document.body.appendChild(el);
    function msg(t) { var m = el.querySelector('#tdb-diag-m'); if (m) m.textContent = t; }
    function desenhar() {
      var d = coletar(), h = '';
      var ruim = '#c0392b', bom = '#1e8e3e', aten = '#b7791f';
      h += linha('Internet', d.online ? 'ligada' : 'SEM INTERNET', d.online ? bom : ruim);
      h += linha('Google Drive', d.driveDisponivel === false ? 'indisponível' : (d.driveDisponivel ? 'conectado' : '—'), d.driveDisponivel === false ? ruim : bom);
      h += linha('Versão do backend', esc(d.versaoBackend || '—'));
      h += linha('Gravando agora', d.emAndamento || 'nada', d.emAndamento ? aten : '');
      h += linha('Alterações aguardando o Drive', d.pendencias.length ? d.pendencias.length + ' — ' + esc(d.pendencias.join(', ')) : 'nenhuma', d.pendencias.length ? aten : bom);
      h += linha('Anexos pendentes', d.pendAnexos);
      h += linha('Conflitos não resolvidos', d.conflitos.length, d.conflitos.length ? ruim : bom);
      h += linha('Último erro', esc(d.ultimoErro || 'nenhum'), d.ultimoErro ? ruim : bom);
      h += linha('Tempo de abertura / servidor / confirmação', seg(d.bootMs) + ' / ' + seg(d.servMs) + ' / ' + seg(d.confMs));
      h += linha('Falhas de leitura direta (CORS)', d.corsFalhas + (d.corsOff ? ' · modo sem leitura' : ''), d.corsOff ? aten : '');
      h += linha('Dados guardados neste navegador', kb(d.tamTotal));
      h += '<div style="font-size:12px;margin:10px 0 4px;font-weight:800">Maiores dados guardados aqui</div>';
      d.tamTop.forEach(function (x) { h += linha(esc(x.k), kb(x.n), x.n > 1500000 ? aten : ''); });
      h += '<div style="font-size:12px;margin:10px 0 4px;font-weight:800">Últimas chamadas ao Drive (mais nova primeiro)</div>';
      if (!d.log.length) h += '<div style="font-size:12px;opacity:.7">Nenhuma chamada registrada desde que a página abriu.</div>';
      d.log.slice().reverse().slice(0, 15).forEach(function (r) {
        var lento = r.ms != null && r.ms > 8000, falha = /ERRO/.test(r.res);
        h += linha(hora(r.em) + ' ' + r.metodo + ' ' + esc(r.nome) + (r.bytes ? ' · ' + kb(r.bytes) : ''), seg(r.ms) + ' · ' + esc(r.res), falha ? ruim : (lento ? aten : ''));
      });
      el.querySelector('#tdb-diag-c').innerHTML = h;
    }
    desenhar();
    el.addEventListener('click', function (e) { if (e.target === el) el.remove(); });
    el.querySelector('#tdb-diag-x').onclick = function () { el.remove(); };
    el.querySelector('#tdb-diag-a').onclick = function () { desenhar(); msg('Atualizado.'); };
    el.querySelector('#tdb-diag-cp').onclick = function () {
      var tx = relatorioTexto(coletar());
      try { navigator.clipboard.writeText(tx).then(function () { msg('Relatório copiado. Cole na conversa.'); }, function () { prompt('Copie o relatório:', tx); }); }
      catch (e) { msg('Não consegui copiar.'); }
    };
    el.querySelector('#tdb-diag-t').onclick = function () {
      msg('Testando…'); var t0 = Date.now();
      var u = url(); if (!u) { msg('Apps Script não configurado.'); return; }
      fetch(u + '?acao=statusAbertura&_=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        msg('Drive respondeu em ' + seg(Date.now() - t0) + (j && j.versaoBackend ? ' · backend ' + j.versaoBackend : '') + '. ' + (Date.now() - t0 > 8000 ? 'Está LENTO.' : 'Velocidade normal.'));
        desenhar();
      }, function (e) { msg('FALHOU em ' + seg(Date.now() - t0) + ': ' + String((e && e.message) || e)); desenhar(); });
    };
  }
  window.tdbDiagnostico = abrir;

  /* Abre ao tocar na etiqueta de status de sincronização. */
  document.addEventListener('click', function (e) {
    try {
      var n = e.target, i = 0;
      while (n && n !== document.body && i++ < 4) {
        var tx = (n.textContent || '');
        if (tx.length < 110 && /Sincronizado \(Google Drive\)|Modo local|aguardando confirma|Salvo neste aparelho|Google Drive conectado|Drive indispon/i.test(tx) && !/Salvar|Atualizar/.test(tx.replace(/Salvo neste aparelho/, ''))) { abrir(); return; }
        n = n.parentElement;
      }
    } catch (x) {}
  }, false);
})();
