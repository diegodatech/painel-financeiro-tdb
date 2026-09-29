    // ====================================================================
    // SINCRONIZAÇÃO CENTRAL — Google Drive / Apps Script v4
    //
    // IMPORTANTE: mantenha aqui a URL /exec da implantação ATIVA.
    // Ao atualizar o Apps Script, edite a implantação existente para uma
    // NOVA VERSÃO. A URL continua a mesma.
    // ====================================================================
    const APPS_SCRIPT_URL = (window.TDB_CONFIG && window.TDB_CONFIG.appsScriptUrl) || "https://script.google.com/macros/s/AKfycbw0CRh3ZyFfQkjRz4vRhymlBd489xDWvswt4NlZt4nc_Lf6ZoDlTQh11OfTctiJaxnnTA/exec";
    window.APPS_SCRIPT_URL_CONFIGURADA = !!APPS_SCRIPT_URL;

    // Este bloco substitui o armazenamento antigo. A ideia é simples:
    // 1) sempre guarda primeiro no aparelho;
    // 2) cada chave ganha uma versão local monotônica;
    // 3) gravações são enfileiradas, nunca disputam o mesmo arquivo ao mesmo tempo;
    // 4) o servidor usa LockService + metadados para impedir sobrescrita concorrente;
    // 5) uma alteração só sai de "pendente" depois de o Apps Script confirmar;
    // 6) falha de leitura NUNCA vira cache vazio — isso evita o falso "Tudo salvo".
    if (!window.storage) {
      let cachePlanilha = null;
      let carregamentoEmAndamento = null;
      let filaEscrita = Promise.resolve();
      let validacaoAbertura_ = null;
      let salvamentoManual_ = null;
      let contadorVersao = 0;
      let cacheCarregadoComSucesso = false;
      let ultimaFalhaLeituraEm = 0;
      window.__transacoesProntas = false;
      let usandoPlanilha = !!APPS_SCRIPT_URL;

      const CHAVE_PENDENCIAS = '__pendencias_sync_v2';
      const CHAVE_VERSOES = '__versoes_sync_v2';
      const CHAVE_BASE_VERSOES = '__base_versoes_sync_v1';
      const CHAVE_CLIENTE = '__cliente_sync_v2';
      const CHAVE_PENDENCIAS_ANEXOS = '__pendencias_anexos_v1';
      const CHAVE_REVISAO_CONFIRMADA = '__drive_revisao_confirmada_v1';
      const CHAVE_CONFLITOS_OFFLINE = '__conflitos_offline_v37';
      const CHAVE_BASE_VALORES = '__base_valores_sync_v37';

      // ====================================================================
      // TDB 10.2 — proteção contra leitura antiga sobrescrevendo edição nova.
      // Cada edição/confirmação local ganha um número de sequência. Uma leitura
      // (bootstrap) que começou ANTES dessa edição nunca pode desfazê-la.
      // ====================================================================
      let seqEscritaLocal_ = 0;
      const seqPorChave_ = new Map();
      function marcarEscritaLocal_(key) { seqPorChave_.set(String(key), ++seqEscritaLocal_); }
      function gerarOpId_(versao) {
        // A mesma versão local conserva a identidade inclusive depois de reabrir.
        return clienteId() + ':' + (Number(versao) || 0);
      }
      function lerBaseValores_() {
        try { const x = JSON.parse(localStorage.getItem(CHAVE_BASE_VALORES) || '{}'); return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; } catch (e) { return {}; }
      }
      function registrarBaseValor_(key) {
        try {
          const bases = lerBaseValores_();
          if (Object.prototype.hasOwnProperty.call(bases, key)) return;
          const atual = localStorage.getItem(key);
          bases[key] = atual === null ? { ausente: true } : { ausente: false, valor: atual };
          localStorage.setItem(CHAVE_BASE_VALORES, JSON.stringify(bases));
        } catch (e) {}
      }
      function baseValor_(key) {
        try { const bases = lerBaseValores_(); return Object.prototype.hasOwnProperty.call(bases,key) ? bases[key] : null; } catch (e) { return null; }
      }
      function definirBaseValor_(key, valor) {
        try { const bases=lerBaseValores_(); bases[key]=valor===null?{ausente:true}:{ausente:false,valor:String(valor)}; localStorage.setItem(CHAVE_BASE_VALORES,JSON.stringify(bases)); } catch(e) {}
      }
      function limparBaseValor_(key) {
        try { const bases=lerBaseValores_(); if(Object.prototype.hasOwnProperty.call(bases,key)){ delete bases[key]; localStorage.setItem(CHAVE_BASE_VALORES,JSON.stringify(bases)); } } catch(e) {}
      }
      function tdbIgual_(a,b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch(e) { return a === b; } }
      function tdbObjeto_(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
      function tdbArrayId_(arr) { return Array.isArray(arr) && arr.length > 0 && arr.every(function(x){ return tdbObjeto_(x) && x.id !== undefined && x.id !== null; }); }
      function tdbMesclar3_(base, local, servidor, caminho, conflitos, preferirLocal) {
        const AUSENTE = tdbMesclar3_.AUSENTE || (tdbMesclar3_.AUSENTE = {__tdbAusente:true});
        if (tdbIgual_(local, servidor)) return local;
        if (tdbIgual_(local, base)) return servidor;
        if (tdbIgual_(servidor, base)) return local;
        const ehAusente = function(v){ return v === AUSENTE; };
        if (ehAusente(local) || ehAusente(servidor) || ehAusente(base)) {
          conflitos.push(caminho || 'registro');
          return preferirLocal ? local : servidor;
        }
        if (Array.isArray(base) && Array.isArray(local) && Array.isArray(servidor)) {
          if (tdbArrayId_(base) || tdbArrayId_(local) || tdbArrayId_(servidor)) {
            const bm=new Map(base.filter(function(x){return tdbObjeto_(x)&&x.id!=null;}).map(function(x){return [String(x.id),x];}));
            const lm=new Map(local.filter(function(x){return tdbObjeto_(x)&&x.id!=null;}).map(function(x){return [String(x.id),x];}));
            const sm=new Map(servidor.filter(function(x){return tdbObjeto_(x)&&x.id!=null;}).map(function(x){return [String(x.id),x];}));
            const ordem=[]; servidor.forEach(function(x){if(tdbObjeto_(x)&&x.id!=null&&!ordem.includes(String(x.id)))ordem.push(String(x.id));}); local.forEach(function(x){if(tdbObjeto_(x)&&x.id!=null&&!ordem.includes(String(x.id)))ordem.push(String(x.id));});
            const out=[];
            ordem.forEach(function(id){ const v=tdbMesclar3_(bm.has(id)?bm.get(id):AUSENTE,lm.has(id)?lm.get(id):AUSENTE,sm.has(id)?sm.get(id):AUSENTE,(caminho?caminho+'.':'')+'id='+id,conflitos,preferirLocal); if(!ehAusente(v)) out.push(v); });
            return out;
          }
          if (base.length===local.length && base.length===servidor.length) return base.map(function(b,i){return tdbMesclar3_(b,local[i],servidor[i],(caminho||'lista')+'['+i+']',conflitos,preferirLocal);});
          conflitos.push(caminho || 'lista'); return preferirLocal ? local : servidor;
        }
        if (tdbObjeto_(base) && tdbObjeto_(local) && tdbObjeto_(servidor)) {
          const keys=Array.from(new Set(Object.keys(base).concat(Object.keys(local),Object.keys(servidor)))); const out={};
          keys.forEach(function(k){ const b=Object.prototype.hasOwnProperty.call(base,k)?base[k]:AUSENTE; const l=Object.prototype.hasOwnProperty.call(local,k)?local[k]:AUSENTE; const sv=Object.prototype.hasOwnProperty.call(servidor,k)?servidor[k]:AUSENTE; const v=tdbMesclar3_(b,l,sv,(caminho?caminho+'.':'')+k,conflitos,preferirLocal); if(!ehAusente(v)) out[k]=v; });
          return out;
        }
        conflitos.push(caminho || 'valor');
        return preferirLocal ? local : servidor;
      }
      function tentarMesclarTextoJSON_(baseTxt, localTxt, servidorTxt, preferirLocal) {
        try { const b=JSON.parse(baseTxt), l=JSON.parse(localTxt), sv=JSON.parse(servidorTxt); const conflitos=[]; const valor=tdbMesclar3_(b,l,sv,'',conflitos,!!preferirLocal); return {ok:true, valor:JSON.stringify(valor), conflitos:Array.from(new Set(conflitos))}; } catch(e) { return {ok:false, erro:String(e&&e.message||e), conflitos:['conteúdo']}; }
      }
      function registrarConflitoOffline_(key, localValue, serverValue, serverUpdatedAt) {
        try {
          const lista = JSON.parse(localStorage.getItem(CHAVE_CONFLITOS_OFFLINE) || '[]');
          lista.push({ id: 'conf_' + Date.now() + '_' + Math.random().toString(36).slice(2), key: key, localValue: localValue, serverValue: serverValue, serverUpdatedAt: Number(serverUpdatedAt) || 0, clientId: clienteId(), criadoEm: Date.now(), resolvido: false });
          while (lista.length > 50) lista.shift();
          localStorage.setItem(CHAVE_CONFLITOS_OFFLINE, JSON.stringify(lista));
          window.__conflitosSync = lista.filter(function (c) { return c && !c.resolvido; }).length;
          try { window.dispatchEvent(new CustomEvent('painel:conflito-offline', { detail: { key: key, quantidade: window.__conflitosSync } })); } catch (e) {}
        } catch (e) {}
      }
      window.__listarConflitosOffline = function () { try { return JSON.parse(localStorage.getItem(CHAVE_CONFLITOS_OFFLINE) || '[]'); } catch (e) { return []; } };
      window.__aberturaConcluida = false;

      // v4.44 — entrada rápida com revisão embutida na própria resposta HTML.
      // Em vez de reler todos os arquivos do Drive a cada abertura, primeiro fazemos
      // um handshake barato no servidor. Se ninguém gravou desde o último bootstrap
      // confirmado, o cache local é comprovadamente atual e pode abrir imediatamente.

      function lerRevisaoConfirmadaLocal_() {
        try {
          const bruto = localStorage.getItem(CHAVE_REVISAO_CONFIRMADA);
          return { existe: bruto !== null, valor: Number(bruto) || 0 };
        } catch (e) { return { existe: false, valor: 0 }; }
      }

      function salvarRevisaoConfirmadaLocal_(revisao) {
        try { localStorage.setItem(CHAVE_REVISAO_CONFIRMADA, String(Number(revisao) || 0)); } catch (e) {}
      }

      // v8.3 — a própria resposta HTML do Apps Script já traz a revisão global
      // no próprio HTML. Assim, na abertura normal, não precisamos fazer uma
      // segunda chamada ao servidor só para perguntar se o cache local continua atual.
      // Se esse valor não existir (compatibilidade/preview local), usamos o handshake antigo.
      function lerRevisaoInicialHtml_() {
        try {
          const boot = window.__TDB_HTML_BOOT;
          if (boot && Object.prototype.hasOwnProperty.call(boot, 'revisaoGlobal')) {
            const valor = Number(boot.revisaoGlobal);
            if (Number.isFinite(valor) && valor >= 0) return { existe: true, valor };
          }
          // Compatibilidade com uma versão experimental antiga que usava meta tag.
          const meta = document.querySelector('meta[name="tdb-revisao-global"]');
          if (!meta) return { existe: false, valor: 0 };
          const bruto = meta.getAttribute('content');
          if (bruto === null || String(bruto).trim() === '') return { existe: false, valor: 0 };
          const valor = Number(bruto);
          return { existe: Number.isFinite(valor) && valor >= 0, valor: Number.isFinite(valor) ? valor : 0 };
        } catch (e) {
          return { existe: false, valor: 0 };
        }
      }

      function lerVersaoBackendInicialHtml_() {
        try {
          const boot = window.__TDB_HTML_BOOT;
          if (boot && boot.versaoBackend) return String(boot.versaoBackend);
          const meta = document.querySelector('meta[name="tdb-backend"]');
          return meta ? String(meta.getAttribute('content') || '') : '';
        } catch (e) { return ''; }
      }

      async function checarStatusAbertura_() {
        if (!APPS_SCRIPT_URL) return { ok: false, localOnly: true };
        const url = APPS_SCRIPT_URL + '?acao=statusAbertura&_=' + Date.now();
        try {
          const resposta = await lerRespostaJSON(await timeoutFetch(url, { method: 'GET', cache: 'no-store' }, 25000));
          return resposta;
        } catch (e) {
          throw e;
        }
      }

      function lerPendenciasAnexos() {
        try {
          const bruto = localStorage.getItem(CHAVE_PENDENCIAS_ANEXOS);
          const lista = bruto ? JSON.parse(bruto) : [];
          return new Set(Array.isArray(lista) ? lista : []);
        } catch (e) { return new Set(); }
      }

      function salvarPendenciasAnexos(conjunto) {
        try { localStorage.setItem(CHAVE_PENDENCIAS_ANEXOS, JSON.stringify(Array.from(conjunto))); } catch (e) {}
        window.__pendenciasAnexosSync = conjunto.size;
        window.__pendenciasSync = lerPendencias().size + conjunto.size;
      }

      function marcarPendenteAnexo(key) {
        const p = lerPendenciasAnexos();
        p.add(key);
        salvarPendenciasAnexos(p);
      }

      function marcarSincronizadoAnexo(key) {
        const p = lerPendenciasAnexos();
        if (p.has(key)) { p.delete(key); salvarPendenciasAnexos(p); }
      }

      function lerPendencias() {
        try {
          const bruto = localStorage.getItem(CHAVE_PENDENCIAS);
          const lista = bruto ? JSON.parse(bruto) : [];
          return new Set(Array.isArray(lista) ? lista : []);
        } catch (e) { return new Set(); }
      }

      function salvarPendencias(conjunto) {
        localStorage.setItem(CHAVE_PENDENCIAS, JSON.stringify(Array.from(conjunto)));
        window.__pendenciasSync = conjunto.size + lerPendenciasAnexos().size;
      }

      function marcarPendente(key) {
        const p = lerPendencias();
        p.add(key);
        salvarPendencias(p);
      }

      function marcarSincronizado(key, versaoConfirmada) {
        // Só tira da fila se a versão que voltou do servidor ainda for a versão
        // mais nova desta chave. Se o usuário alterou novamente enquanto a rede
        // trabalhava, a nova alteração continua pendente.
        const atual = lerVersoes()[key];
        if (versaoConfirmada && atual && Number(atual) !== Number(versaoConfirmada)) return;
        const p = lerPendencias();
        if (p.has(key)) { p.delete(key); salvarPendencias(p); }
      }

      function lerVersoes() {
        try {
          const bruto = localStorage.getItem(CHAVE_VERSOES);
          const obj = bruto ? JSON.parse(bruto) : {};
          return obj && typeof obj === 'object' ? obj : {};
        } catch (e) { return {}; }
      }

      function lerBaseVersoes() {
        try {
          const bruto = localStorage.getItem(CHAVE_BASE_VERSOES);
          const obj = bruto ? JSON.parse(bruto) : {};
          return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
        } catch (e) { return {}; }
      }

      function registrarBaseVersao_(key) {
        const bases = lerBaseVersoes();
        if (Object.prototype.hasOwnProperty.call(bases, key)) return;
        const versoes = lerVersoes();
        bases[key] = Number(versoes[key]) || 0;
        try { localStorage.setItem(CHAVE_BASE_VERSOES, JSON.stringify(bases)); } catch (e) {}
      }

      function limparBaseVersao_(key) {
        const bases = lerBaseVersoes();
        if (Object.prototype.hasOwnProperty.call(bases, key)) {
          delete bases[key];
          try { localStorage.setItem(CHAVE_BASE_VERSOES, JSON.stringify(bases)); } catch (e) {}
        }
        limparBaseValor_(key);
      }
      function definirBaseVersao_(key, valor) {
        const bases = lerBaseVersoes();
        bases[key] = Number(valor) || 0;
        try { localStorage.setItem(CHAVE_BASE_VERSOES, JSON.stringify(bases)); } catch (e) {}
      }

      function baseVersao_(key) {
        const bases = lerBaseVersoes();
        return Number(bases[key]) || 0;
      }

      function novaVersao(key) {
        const versoes = lerVersoes();
        const anterior = Number(versoes[key]) || 0;
        const agora = Date.now();
        contadorVersao = Math.max(contadorVersao + 1, 1);
        const versao = Math.max(agora, anterior + 1, agora + contadorVersao);
        versoes[key] = versao;
        localStorage.setItem(CHAVE_VERSOES, JSON.stringify(versoes));
        return versao;
      }


      function adotarVersaoServidorSeAtual_(key, versaoEnviada, serverUpdatedAt) {
        const servidor = Number(serverUpdatedAt) || 0;
        if (!servidor) return;
        const versoes = lerVersoes();
        const atual = Number(versoes[key]) || 0;

        // Só substitui se esta ainda for exatamente a edição enviada.
        // Se o usuário editou novamente enquanto a requisição estava no ar,
        // a nova versão local continua soberana e permanece pendente.
        if (atual === Number(versaoEnviada)) {
          versoes[key] = Math.max(atual, servidor);
          try { localStorage.setItem(CHAVE_VERSOES, JSON.stringify(versoes)); } catch (e) {}
        }
      }

      function clienteId() {
        try {
          let id = localStorage.getItem(CHAVE_CLIENTE);
          if (!id) {
            id = 'painel-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            localStorage.setItem(CHAVE_CLIENTE, id);
          }
          return id;
        } catch (e) {
          return 'painel-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        }
      }

      // Migração de pendências da v4.2: antes os anexos entravam na fila genérica.
      // Move essas chaves para a fila própria, sem perder um PDF que já esteja no localStorage.
      (function migrarPendenciasAnexosLegado_() {
        try {
          const antigas = lerPendencias();
          const anexos = lerPendenciasAnexos();
          let mudou = false;
          antigas.forEach(key => {
            if (String(key).indexOf('anexo_') !== -1) {
              anexos.add(key);
              antigas.delete(key);
              mudou = true;
            }
          });
          if (mudou) {
            salvarPendencias(antigas);
            salvarPendenciasAnexos(anexos);
          }
        } catch (e) {}
      })();

      window.__pendenciasAnexosSync = lerPendenciasAnexos().size;
      window.__pendenciasSync = lerPendencias().size + window.__pendenciasAnexosSync;
      window.__statusPlanilha = null;
      window.__ultimoErroSync = null;

      const DB_ANEXOS = 'painel_financeiro_anexos_v1';
      const STORE_ANEXOS = 'arquivos';
      let dbAnexosPromise = null;

      function abrirDBAnexos_() {
        if (dbAnexosPromise) return dbAnexosPromise;
        dbAnexosPromise = new Promise((resolve, reject) => {
          if (!window.indexedDB) { reject(new Error('IndexedDB indisponível neste navegador.')); return; }
          const req = indexedDB.open(DB_ANEXOS, 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_ANEXOS)) db.createObjectStore(STORE_ANEXOS);
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error('Não foi possível abrir o armazenamento local dos anexos.'));
        });
        return dbAnexosPromise;
      }

      async function idbAnexoGet_(key) {
        const db = await abrirDBAnexos_();
        return new Promise((resolve, reject) => {
          const req = db.transaction(STORE_ANEXOS, 'readonly').objectStore(STORE_ANEXOS).get(key);
          req.onsuccess = () => resolve(req.result == null ? null : req.result);
          req.onerror = () => reject(req.error);
        });
      }

      async function idbAnexoSet_(key, value) {
        const db = await abrirDBAnexos_();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_ANEXOS, 'readwrite');
          tx.objectStore(STORE_ANEXOS).put(value, key);
          tx.oncomplete = () => resolve(true);
          tx.onabort = tx.onerror = () => reject(tx.error || new Error('Falha ao guardar o anexo neste aparelho.'));
        });
      }

      async function idbAnexoDelete_(key) {
        try {
          const db = await abrirDBAnexos_();
          return new Promise((resolve, reject) => {
            const req = db.transaction(STORE_ANEXOS, 'readwrite').objectStore(STORE_ANEXOS).delete(key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
          });
        } catch (e) { return false; }
      }

      function timeoutFetch(url, opcoes, ms) {
        const controlador = new AbortController();
        let timer;
        const limite = new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Tempo limite: a resposta completa do Google Drive não chegou. Tente novamente e confira a conexão com a API do Google Drive.'));
            controlador.abort();
          }, ms);
        });
        const leitura = (async () => {
          // HtmlService: comunicação nativa, sem redirecionamento entre domínios.
          if (window.google && window.google.script && window.google.script.run) {
            const endereco = new URL(url);
            const pedido = (opcoes && opcoes.method === 'POST')
              ? { method: 'POST', body: JSON.parse(opcoes.body) }
              : { method: 'GET', parameter: Object.fromEntries(endereco.searchParams) };
            const corpo = await new Promise((resolve, reject) => {
              window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).apiPainel(pedido);
            });
            return { ok: true, status: 200, json: async () => corpo };
          }
          const resp = await fetch(url, { ...(opcoes || {}), signal: controlador.signal });
          if (opcoes && opcoes.mode === 'no-cors' && resp.type === 'opaque') return { ok: true, status: 0, json: async () => null };
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          let corpo;
          try { corpo = await resp.json(); }
          catch (e) { throw new Error('Resposta inválida do Apps Script. Confira a implantação /exec e as permissões de acesso.'); }
          return { ok: resp.ok, status: resp.status, json: async () => corpo };
        })();
        // O prazo inclui cabeçalhos E corpo; abortar sozinho não encerra uma RPC.
        return Promise.race([leitura, limite]).finally(() => clearTimeout(timer));
      }

      async function lerRespostaJSON(resp) {
        let corpo = null;
        try { corpo = await resp.json(); } catch (e) {}
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        if (!corpo || corpo.ok === false) throw new Error((corpo && corpo.erro) || 'O Apps Script não retornou JSON válido. Confira a implantação /exec e a permissão de acesso para o tablet.');
        return corpo;
      }


      // TELEMETRIA LOCAL DE SINCRONIZAÇÃO — usada pelo card "Saúde do sistema".
      // Não envia dados extras: apenas registra neste navegador quando a última leitura
      // e a última gravação no Drive foram confirmadas pelo servidor.
      function registrarSync_(tipo) {
        const agora = Date.now();
        window.__ultimaSincronizacaoDrive = agora;
        try { localStorage.setItem('painel_ultima_sincronizacao_drive', String(agora)); } catch (e) {}
        if (tipo === 'gravacao') {
          // TDB 10 — se o servidor confirmou uma gravação, o Drive está acessível.
          // Isso corrige o estado incoerente "Modo local / nenhuma alteração pendente"
          // que podia permanecer depois de um bootstrap de leitura ter dado timeout.
          window.__driveDisponivel = true;
          window.__ultimoSalvamentoDrive = agora;
          try { localStorage.setItem('painel_ultimo_salvamento_drive', String(agora)); } catch (e) {}
        }
      }
      try {
        window.__ultimaSincronizacaoDrive = Number(localStorage.getItem('painel_ultima_sincronizacao_drive')) || null;
        window.__ultimoSalvamentoDrive = Number(localStorage.getItem('painel_ultimo_salvamento_drive')) || null;
      } catch (e) {
        window.__ultimaSincronizacaoDrive = null;
        window.__ultimoSalvamentoDrive = null;
      }
      window.__APPS_SCRIPT_URL_PAINEL = APPS_SCRIPT_URL;

      // Diagnóstico do backend sob demanda. É chamado pela Visão Geral e pelo botão
      // "Testar conexão"; não altera os dados.
      window.__testarConexaoDrive = async function() {
        if (!APPS_SCRIPT_URL) return { ok: false, erro: 'Apps Script não configurado.' };
        const url = APPS_SCRIPT_URL + '?acao=diagnostico&_=' + Date.now();
        const corpo = await lerRespostaJSON(await timeoutFetch(url, { method: 'GET', cache: 'no-store' }, 45000));
        registrarSync_('leitura');
        return corpo;
      };

      // Backup manual disparado pelo card de Saúde do sistema.
      window.__criarBackupDrive = async function() {
        if (!APPS_SCRIPT_URL) return { ok: false, erro: 'Apps Script não configurado.' };
        const corpo = await lerRespostaJSON(await timeoutFetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ acao: 'backup', clientId: clienteId() }),
        }, 60000));
        registrarSync_('gravacao');
        return corpo;
      };

      // Restaura de dentro do painel o backup completo mais recente que já está salvo
      // no Drive (arquivo backup_dados_*.json criado por "Criar backup agora"). Antes,
      // esse backup não tinha como voltar: era preciso abrir o Drive manualmente e o
      // botão "Importar backup" só aceitava o formato parcial baixado pelo navegador.
      // Regrava cada chave individualmente pela mesma fila de sincronização normal.
      window.__restaurarUltimoBackupDrive = async function(onProgress) {
        const informar = texto => { if (onProgress) onProgress(texto); };
        if (!APPS_SCRIPT_URL) return { ok: false, erro: 'Apps Script não configurado.' };
        informar('Baixando o último backup do Drive (limite de 45 segundos)…');
        const corpo = await lerRespostaJSON(await timeoutFetch(
          APPS_SCRIPT_URL + '?acao=ultimoBackupDados&_=' + Date.now(),
          { method: 'GET', cache: 'no-store' },
          45000
        ));
        const dados = corpo && corpo.dados && typeof corpo.dados === 'object' && !Array.isArray(corpo.dados) ? corpo.dados : null;
        if (!dados || !Object.keys(dados).length) throw new Error('O backup encontrado no Drive não tem dados válidos.');

        const chaves = Object.keys(dados);
        let feitas = 0;
        for (const chave of chaves) {
          const valor = dados[chave];
          if (valor === undefined || valor === null) continue;
          // '@@raw:' evita que a chave passe pelo resolvedor de ano de novo — o nome
          // salvo no backup já é o nome final (com ou sem sufixo de exercício).
          // Na restauração precisamos da confirmação real do Apps Script. O terceiro
          // argumento impede que uma falha de envio seja tratada como sucesso.
          informar('Backup recebido. Restaurando e confirmando item ' + (feitas + 1) + ' de ' + chaves.length + ' no Drive…');
          await window.storage.set('@@raw:' + chave, String(valor), true);
          feitas++;
        }
        informar('Conferindo as pendências após a restauração…');
        const confirmacao = window.storage.resync ? await window.storage.resync() : { ok: true };
        if (!confirmacao.ok || Number(window.__pendenciasSync || 0) > 0) {
          throw new Error('O backup foi carregado neste aparelho, mas ainda existem itens sem confirmação no Google Drive. Clique em Salvar novamente quando a conexão estabilizar.');
        }
        registrarSync_('gravacao');
        return { ok: true, nome: corpo.nome, criadoEm: corpo.criadoEm, chaves: chaves.length };
      };

      async function carregarDaPlanilha(opcoes) {
        if (!APPS_SCRIPT_URL) {
          cachePlanilha = {};
          cacheCarregadoComSucesso = false;
          return cachePlanilha;
        }
        if (carregamentoEmAndamento) return carregamentoEmAndamento;

        carregamentoEmAndamento = (async () => {
          let ultimoErro = null;
          const aberturaRapida = !!(opcoes && opcoes.aberturaRapida);
          const maxTentativas = aberturaRapida ? 1 : 2;
          const limiteLeitura = aberturaRapida ? 7500 : 45000;
          // Na entrada não prendemos a tela em duas tentativas longas. Uma leitura
          // de até 7,5 s é suficiente; se falhar, abrimos o fallback local protegido.
          // Atualizações manuais continuam com o limite mais tolerante de 45 s.
          for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
            try {
              const seqInicioLeitura = seqEscritaLocal_;
              const editouDepoisDaLeitura_ = key => (seqPorChave_.get(String(key)) || 0) > seqInicioLeitura;
              const anoBootstrap = Number(window.__exercicioAtual || 2026);
              const urlBootstrap = APPS_SCRIPT_URL
                + '?acao=bootstrap&ano=' + encodeURIComponent(anoBootstrap)
                + '&_=' + Date.now();

              const corpo = await lerRespostaJSON(await timeoutFetch(
                urlBootstrap,
                { method: 'GET', cache: 'no-store' },
                limiteLeitura
              ));
              window.__ultimaDuracaoBootstrapMs = Number(corpo.duracaoMs) || null;
              if (corpo.bootstrapConsistente === false) throw new Error('O Drive mudou durante a leitura. A cópia local foi preservada; tente atualizar novamente.');

              if (!corpo.dados || typeof corpo.dados !== 'object' || Array.isArray(corpo.dados)) {
                throw new Error('O servidor respondeu sem um banco de dados válido.');
              }

              // TDB 10.2 — chaves editadas/confirmadas localmente DEPOIS que esta leitura começou
              // são mais novas que este retorno: mantém o valor local e não regride a versão.
              const cacheAnterior_ = cachePlanilha;
              cachePlanilha = corpo.dados;
              seqPorChave_.forEach((seq, chaveLocal) => {
                if (seq > seqInicioLeitura) {
                  if (cacheAnterior_ && Object.prototype.hasOwnProperty.call(cacheAnterior_, chaveLocal)) cachePlanilha[chaveLocal] = cacheAnterior_[chaveLocal];
                  else delete cachePlanilha[chaveLocal];
                }
              });

              // v4.44 — o servidor devolve a versão oficial de cada chave.
              // Para chaves sem edição local pendente, esta passa a ser a base
              // para detectar se outro aparelho gravou algo antes da próxima edição.
              if (corpo.versoes && typeof corpo.versoes === 'object') {
                const versoesLocais = lerVersoes();
                const pendentesAgora = lerPendencias();
                Object.keys(corpo.versoes).forEach(key => {
                  if (!pendentesAgora.has(key) && !editouDepoisDaLeitura_(key)) {
                    versoesLocais[key] = Number(corpo.versoes[key]) || 0;
                    limparBaseVersao_(key);
                  }
                });
                try { localStorage.setItem(CHAVE_VERSOES, JSON.stringify(versoesLocais)); } catch (e) {}
              }
              cacheCarregadoComSucesso = true;
              ultimaFalhaLeituraEm = 0;
              window.__versaoBackend = corpo.versaoBackend || 'não informada';
              usandoPlanilha = true;
              window.__statusPlanilha = Number(window.__syncEmAndamento || 0) > 0 ? 'sincronizando' : 'ok';
              window.__driveDisponivel = true;
              if (Number(window.__syncEmAndamento || 0) === 0) window.__ultimoErroSync = null;
              registrarSync_('leitura');
              window.__revisaoGlobalServidor = Number(corpo.revisaoGlobal) || 0;
              if (seqInicioLeitura === seqEscritaLocal_ && corpo.bootstrapConsistente !== false && Object.prototype.hasOwnProperty.call(corpo, 'revisaoGlobal')) {
                salvarRevisaoConfirmadaLocal_(corpo.revisaoGlobal);
              }

              // Reaplica localmente o que ainda não foi confirmado no Drive.
              // Não usamos "cache = {}" em caso de erro: isso é justamente o que
              // fazia o botão Salvar acreditar que não havia nada para enviar.
              const pendentes = lerPendencias();
              pendentes.forEach(key => {
                try {
                  const local = localStorage.getItem(key);
                  if (local !== null) cachePlanilha[key] = local;
                  else delete cachePlanilha[key];
                } catch (e) {}
              });

              // Espelha no armazenamento local tudo que veio confirmado do Drive,
              // exceto chaves com alteração local pendente. Assim a próxima abertura
              // é instantânea mesmo se a internet estiver lenta ou indisponível.
              //
              // O antigo reload incondicional fazia a página reiniciar até no primeiro uso.
              // Agora registramos se havia um valor local REALMENTE diferente e, somente
              // nesse caso, emitimos um evento controlado para reidratar a tela uma vez.
              let dadosConfirmadosAlterados = 0;
              Object.keys(corpo.dados).forEach(key => {
                if (pendentes.has(key) || editouDepoisDaLeitura_(key) || String(key).indexOf('anexo_') !== -1) return;
                try {
                  const valor = corpo.dados[key];
                  if (valor === undefined || valor === null) return;
                  const novoValor = String(valor);
                  const valorAnterior = localStorage.getItem(key);
                  // Só contamos como alteração visível quando já havia uma cópia local
                  // diferente. No primeiro uso, os efeitos que aguardam o bootstrap
                  // recebem o valor diretamente e não precisam recarregar a página.
                  if (valorAnterior !== null && valorAnterior !== novoValor) dadosConfirmadosAlterados++;
                  localStorage.setItem(key, novoValor);
                } catch (e) {}
              });
              (Array.isArray(corpo.removidas) ? corpo.removidas : []).forEach(key => {
                if (pendentes.has(key) || editouDepoisDaLeitura_(key) || String(key).indexOf('anexo_') !== -1) return;
                if (localStorage.getItem(key) !== null) dadosConfirmadosAlterados++;
                localStorage.removeItem(key);
                delete cachePlanilha[key];
              });
              window.__ultimaLeituraMudouDados = dadosConfirmadosAlterados > 0;

              // A versão anterior atualizava apenas cachePlanilha/localStorage. O React
              // já montado continuava exibindo o valor antigo. O evento abaixo permite
              // reidratar a tela somente quando o Drive realmente trouxe algo diferente.
              if (dadosConfirmadosAlterados > 0 && lerPendencias().size === 0 && lerPendenciasAnexos().size === 0) {
                try {
                  window.dispatchEvent(new CustomEvent('painel:drive-atualizado', {
                    detail: { chavesAlteradas: dadosConfirmadosAlterados }
                  }));
                } catch (e) {}
              }

              // v4.44 — NÃO reenviamos pendências dentro do bootstrap.
              // A abertura termina primeiro; reenvioAutomaticoPendencias_ cuida delas
              // logo depois, em segundo plano. Assim um PDF pendente nunca segura a entrada.
              return cachePlanilha;
            } catch (e) {
              ultimoErro = e;
              if (tentativa < maxTentativas) await new Promise(r => setTimeout(r, 900 * tentativa));
            }
          }

          cacheCarregadoComSucesso = false;
          // MUITO IMPORTANTE: null significa "não consegui ler o Drive".
          // Nunca transformar isso em {}.
          cachePlanilha = null;
          ultimaFalhaLeituraEm = Date.now();
          usandoPlanilha = !!APPS_SCRIPT_URL;
          const haPendencias = Number(window.__pendenciasSync || 0) > 0 || Number(window.__pendenciasAnexosSync || 0) > 0;
          const ultimoSalvamentoConfirmado = Number(window.__ultimoSalvamentoDrive || 0);
          const gravacaoConfirmadaRecente = ultimoSalvamentoConfirmado > 0 && (Date.now() - ultimoSalvamentoConfirmado) < 90000;

          // TDB 10 — um timeout do bootstrap não pode desfazer uma confirmação de
          // gravação feita segundos antes. Na versão anterior isso deixava a tela em "Modo local"
          // mesmo depois de o POST + leitura da própria chave terem sido confirmados.
          if (gravacaoConfirmadaRecente) {
            window.__driveDisponivel = true;
            window.__statusPlanilha = haPendencias ? 'pendente' : 'ok';
            if (!haPendencias) window.__ultimoErroSync = null;
          } else {
            window.__driveDisponivel = false;
            // Mesmo sem alterações pendentes, uma falha de LEITURA precisa ficar visível.
            window.__statusPlanilha = haPendencias ? 'pendente' : 'erro';
            window.__ultimoErroSync = ultimoErro && (ultimoErro.name === 'AbortError' || ultimoErro.name === 'TimeoutError')
              ? (haPendencias
                  ? 'O Google Drive demorou para responder. A alteração continua protegida neste aparelho.'
                  : 'O Google Drive demorou para responder e os dados centrais ainda não foram carregados.')
              : String((ultimoErro && ultimoErro.message) || ultimoErro || 'Falha ao carregar o Google Drive.');
          }
          return null;
        })();

        try {
          return await carregamentoEmAndamento;
        } finally {
          carregamentoEmAndamento = null;
        }
      }


      // v52 Git — confirmação robusta de gravação fora do HtmlService.
      // O ContentService do Apps Script responde por redirecionamento. Em navegadores
      // externos (GitHub Pages/PWA), a escrita pode chegar ao servidor e a resposta
      // final não ficar legível pelo fetch. Para não deixar uma alteração presa na fila,
      // o Git envia a gravação e confirma em seguida lendo somente a própria chave.
      async function confirmarValorNoDrive_(key, valorEsperado, baseEsperada, removido) {
        const esperada = valorEsperado == null ? null : String(valorEsperado);
        const pausas = [0];
        let ultimo = null;
        for (let i = 0; i < pausas.length; i++) {
          if (pausas[i]) await new Promise(r => setTimeout(r, pausas[i]));
          try {
            const url = APPS_SCRIPT_URL + '?key=' + encodeURIComponent(key) + '&_=' + Date.now();
            const corpo = await lerRespostaJSON(await timeoutFetch(url, { method: 'GET', cache: 'no-store' }, 12000));
            // TDB 10 — esta leitura curta é a confirmação oficial da própria chave.
            // Se respondeu, há conexão real com o backend/Drive mesmo que um bootstrap
            // completo anterior tenha expirado.
            window.__driveDisponivel = true;
            ultimo = corpo;
            const dados = corpo && corpo.dados ? corpo.dados : {};
            const existe = Object.prototype.hasOwnProperty.call(dados, key);
            const versaoServidor = Number(corpo && corpo.serverUpdatedAt) || 0;
            if (removido) {
              if (!existe && (versaoServidor > 0 || Number(baseEsperada || 0) === 0)) {
                return { ok: true, serverUpdatedAt: versaoServidor };
              }
            } else if (existe && String(dados[key]) === esperada) {
              return { ok: true, serverUpdatedAt: versaoServidor };
            }
            // Se a versão central já avançou para outro valor, trata como conflito real.
            if (versaoServidor > 0 && Number(baseEsperada || 0) > 0 && versaoServidor !== Number(baseEsperada || 0)) {
              return { ok: false, stale: true, serverUpdatedAt: versaoServidor, serverValue: existe ? String(dados[key]) : null };
            }
          } catch (e) {
            ultimo = e;
          }
        }
        return { ok: false, erro: ultimo && ultimo.message ? ultimo.message : 'O Drive ainda não confirmou a alteração.' };
      }

      // TDB 10.2 — confirmação BARATA por opId (acao=statusChave do backend v4.49).
      // Antes, cada gravação era confirmada relendo a chave inteira no Drive (para
      // "transacoes_financas" isso é o dados.json inteiro, vários segundos e até 12 s de
      // timeout por tentativa). Agora consulta só os metadados; a rede ainda pode demorar.
      let suporteStatusChave_ = null; // null = ainda não sabemos
      async function consultarStatusChave_(key, ms) {
        const url = APPS_SCRIPT_URL + '?acao=statusChave&key=' + encodeURIComponent(key) + '&_=' + Date.now();
        const corpo = await lerRespostaJSON(await timeoutFetch(url, { method: 'GET', cache: 'no-store' }, ms || 15000));
        if (!corpo || corpo.statusChave !== true) { suporteStatusChave_ = false; return null; }
        suporteStatusChave_ = true;
        window.__driveDisponivel = true;
        return corpo;
      }

      async function confirmarPorOpId_(key, opId, baseEsperada, transporteOk) {
        // A resposta opaca não confirma a gravação. Apenas o recibo com o mesmo opId confirma.
        const pausas = [0]; // uma consulta; a fila persistente tenta novamente depois
        let ultimo = null;
        for (let i = 0; i < pausas.length; i++) {
          if (pausas[i]) await new Promise(r => setTimeout(r, pausas[i]));
          let st = null;
          try { st = await consultarStatusChave_(key, 25000); }
          catch (e) { ultimo = e; continue; }
          if (st === null) return { semSuporte: true };
          if (st.opId === opId) {
            return { ok: true, accepted: true, serverUpdatedAt: Number(st.serverUpdatedAt) || 0, rev: Number(st.rev) || 0, revAnterior: Number(st.revAnterior) || 0 };
          }
          const base = Number(baseEsperada) || 0;
          const versaoServidor = Number(st.serverUpdatedAt) || 0;
          // Outra operação (de outro aparelho) venceu: conflito real.
          if (versaoServidor > 0 && base > 0 && versaoServidor !== base && transporteOk) {
            return { ok: true, accepted: false, stale: true, serverUpdatedAt: versaoServidor };
          }
        }
        return { ok: false, erro: ultimo && ultimo.message ? ultimo.message : 'O Google Drive ainda não confirmou a alteração.' };
      }

      function avancarRevisaoConfirmadaPorGravacao_(corpo) {
        // Se esta gravação foi feita exatamente sobre a revisão que este aparelho já
        // conhecia, o cache local continua igual ao servidor: não precisa de novo bootstrap.
        try {
          const rev = Number(corpo && corpo.rev) || 0;
          const ant = Number(corpo && corpo.revAnterior) || 0;
          if (!rev) return;
          const local = lerRevisaoConfirmadaLocal_();
          if (local.existe && local.valor === ant) salvarRevisaoConfirmadaLocal_(rev);
        } catch (e) {}
      }

      function aplicarConfirmacao_(key, versaoEnviada, serverUpdatedAt, valorConfirmado) {
        const servidor = Number(serverUpdatedAt) || 0;
        const versoes = lerVersoes();
        const atual = Number(versoes[key]) || 0;
        if (atual === Number(versaoEnviada)) {
          // Versão do servidor EXATA (nada de "o maior entre local e servidor": um relógio
          // adiantado deixava a versão local à frente e a próxima edição era recusada como stale).
          if (servidor) {
            versoes[key] = servidor;
            try { localStorage.setItem(CHAVE_VERSOES, JSON.stringify(versoes)); } catch (e) {}
          }
          limparBaseVersao_(key);
        } else if (servidor) {
          // Editada de novo durante o envio: a próxima gravação parte desta versão confirmada.
          definirBaseVersao_(key, servidor);
          if (valorConfirmado !== undefined && valorConfirmado !== null) definirBaseValor_(key, valorConfirmado);
        }
      }

      async function postarGitEConfirmar_(corpoPost, key, valorEsperado, removido) {
        const inicio = Date.now();
        window.__syncEmAndamento = Number(window.__syncEmAndamento || 0) + 1;
        try { return await postarGitEConfirmarInterno_(corpoPost, key, valorEsperado, removido); }
        finally {
          window.__syncEmAndamento = Math.max(0, Number(window.__syncEmAndamento || 1) - 1);
          window.__ultimaDuracaoConfirmacaoMs = Date.now() - inicio;
        }
      }
      async function postarGitEConfirmarInterno_(corpoPost, key, valorEsperado, removido) {
        const baseUsada = Number(corpoPost.baseUpdatedAt) || 0;
        // Dentro do Apps Script, mantém a RPC nativa antiga e usa sua resposta direta.
        if (window.google && window.google.script && window.google.script.run) {
          const resp = await timeoutFetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(corpoPost),
          }, 45000);
          return await lerRespostaJSON(resp);
        }

        // POST simples sem preflight; usa a confirmação direta quando o navegador
        // consegue ler a resposta. Caso contrário consulta o recibo por opId.
        // Falha de transporte não significa que o servidor deixou de gravar.
        const enviar = async () => {
          if (!window.__tdbPostCorsDesligado) {
            try {
              const resp = await timeoutFetch(APPS_SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                cache: 'no-store',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(corpoPost),
              }, 40000);
              const corpo = await lerRespostaJSON(resp);
              window.__tdbPostCorsFalhas = 0;
              return { transporteOk: true, corpo };
            } catch (e) {
              const msg = String((e && e.message) || e || '');
              // "Failed to fetch"/TypeError = leitura bloqueada ou rede fora; erros do servidor têm outra mensagem.
              if (/failed to fetch|networkerror|load failed|cors/i.test(msg)) {
                window.__tdbPostCorsFalhas = (window.__tdbPostCorsFalhas || 0) + 1;
                if (window.__tdbPostCorsFalhas >= 2) window.__tdbPostCorsDesligado = true;
              }
              // Sem resposta legível, o resultado permanece desconhecido até o recibo.
              return { transporteOk: false, corpo: null, erroCors: msg };
            }
          }
          try {
            await timeoutFetch(APPS_SCRIPT_URL, {
              method: 'POST',
              mode: 'no-cors',
              cache: 'no-store',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify(corpoPost),
            }, 40000);
            return { transporteOk: true, corpo: null };
          } catch (e) {
            // Mesmo quando o navegador acusa erro de transporte, o Apps Script pode já
            // ter recebido o POST. Por isso confirmamos antes de considerar falha.
            return { transporteOk: false, corpo: null };
          }
        };

        let ultimoErro = null;
        for (let envio = 1; envio <= 1; envio++) {
          const env = await enviar();
          if (env.corpo && env.corpo.ok !== false && (env.corpo.accepted === true || env.corpo.stale === true || env.corpo.duplicado === true)) {
            const c = env.corpo;
            if (c.stale) return { ok: true, accepted: false, stale: true, serverUpdatedAt: Number(c.serverUpdatedAt) || 0 };
            return { ok: true, accepted: true, serverUpdatedAt: Number(c.serverUpdatedAt) || 0, rev: c.rev, revAnterior: c.revAnterior, duracaoMs: c.duracaoMs };
          }
          const transporteOk = env.transporteOk;
          let conf = null;
          if (corpoPost.opId && suporteStatusChave_ !== false) {
            conf = await confirmarPorOpId_(key, corpoPost.opId, baseUsada, transporteOk);
            if (conf && conf.semSuporte) conf = null;
          }
          if (!conf) {
            // Backend antigo (sem statusChave): confirma lendo a própria chave, como antes.
            conf = await confirmarValorNoDrive_(key, valorEsperado, baseUsada, !!removido);
          }
          if (conf.stale) return { ok: true, accepted: false, stale: true, serverUpdatedAt: Number(conf.serverUpdatedAt) || 0 };
          if (conf.ok) return { ok: true, accepted: true, serverUpdatedAt: Number(conf.serverUpdatedAt) || 0, rev: conf.rev, revAnterior: conf.revAnterior };
          ultimoErro = conf.erro;
        }
        throw new Error(ultimoErro || 'O Google Drive ainda não confirmou a alteração.');
      }

      async function enviarSet_(key, val, versao, marcarFila) {
        if (!APPS_SCRIPT_URL) return { ok: true, accepted: false, localOnly: true };
        if (marcarFila !== false) marcarPendente(key);

        let ultimoErro = null;
        const opId = gerarOpId_(versao);

        for (let tentativa = 1; tentativa <= 1; tentativa++) {
          try {
            const corpoPost = {
              acao: 'set',
              key,
              value: val,
              updatedAt: Number(versao) || Date.now(),
              baseUpdatedAt: baseVersao_(key),
              clientId: clienteId(),
              opId,
            };
            const corpo = await postarGitEConfirmar_(corpoPost, key, val, false);

            if (corpo.accepted === false && corpo.stale) {
              // Outra máquina gravou uma versão mais nova. Não fingimos sucesso:
              // buscamos o estado real antes de liberar a pendência.
              window.__statusPlanilha = 'erro';
              window.__ultimoErroSync = 'Outra alteração mais recente já foi gravada no Drive. Recarregando para conferir.';
              const resolvido = await resolverConflitoStale_(key, corpo.serverUpdatedAt);
              return { ok: false, stale: true, resolvido };
            }

            window.__statusPlanilha = 'ok';
            window.__ultimoErroSync = null;
            registrarSync_('gravacao');
            marcarEscritaLocal_(key);
            const aindaAtual = Number(lerVersoes()[key]) === Number(versao);
            // Só atualiza a cópia em memória se o usuário não editou a chave de novo enquanto enviava.
            if (cachePlanilha && aindaAtual) cachePlanilha[key] = val;
            marcarSincronizado(key, versao);
            aplicarConfirmacao_(key, versao, corpo.serverUpdatedAt, val);
            avancarRevisaoConfirmadaPorGravacao_(corpo);
            window.__ultimaDuracaoServidorMs = Number(corpo.duracaoMs) || null;
            return { ok: true, accepted: true, serverUpdatedAt: corpo.serverUpdatedAt };
          } catch (e) {
            ultimoErro = e;
            // A próxima tentativa é feita pela fila persistente, sem laços multiplicados.
          }
        }

        window.__statusPlanilha = 'erro';
        const foiTimeout = !!(ultimoErro && (
          ultimoErro.name === 'AbortError' ||
          /aborted|abort|tempo limite/i.test(String(ultimoErro.message || ultimoErro))
        ));
        window.__ultimoErroSync = foiTimeout
          ? 'O Google Drive demorou para responder. A alteração ficou protegida neste aparelho e será reenviada automaticamente.'
          : String((ultimoErro && ultimoErro.message) || ultimoErro || 'Não foi possível sincronizar.');
        marcarPendente(key);
        return { ok: false, erro: window.__ultimoErroSync };
      }

      async function enviarAnexo_(key, val, versao) {
        if (!APPS_SCRIPT_URL) return { ok: true, localOnly: true };
        marcarPendenteAnexo(key);
        const tamanhoKB = (val ? String(val).length : 0) / 1024;
        // Anexos ficam fora do fluxo normal de dados. O limite é maior e a fila
        // continua independente, para um PDF não travar as demais gravações.
        const limite = Math.min(240000, Math.max(30000, 30000 + tamanhoKB * 40));
        let ultimoErro = null;
        const opId = gerarOpId_(versao);
        for (let tentativa = 1; tentativa <= 1; tentativa++) {
          try {
            const corpoPost = {
              acao: 'set',
              key,
              value: val,
              updatedAt: Number(versao) || Date.now(),
              baseUpdatedAt: baseVersao_(key),
              clientId: clienteId(),
              opId,
            };
            let corpo;
            if (suporteStatusChave_ === false || (window.google && window.google.script && window.google.script.run)) {
              // Backend antigo: mantém o envio legível de antes.
              corpo = await lerRespostaJSON(await timeoutFetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(corpoPost),
              }, limite));
            } else {
              // TDB 10.2 — mesmo caminho das demais chaves: POST simples + confirmação por opId.
              // (A leitura da resposta do POST não é garantida fora do Apps Script.)
              corpo = await postarGitEConfirmar_(corpoPost, key, null, false);
            }
            if (corpo.accepted === false && corpo.stale) {
              const resolvido = await resolverConflitoStale_(key, corpo.serverUpdatedAt);
              if (resolvido) marcarSincronizadoAnexo(key);
              return { ok: false, stale: true, resolvido };
            }
            marcarSincronizadoAnexo(key);
            limparBaseVersao_(key);
            window.__ultimoErroSync = null;
            window.__statusPlanilha = 'ok';
            registrarSync_('gravacao');
            avancarRevisaoConfirmadaPorGravacao_(corpo);
            return { ok: true, accepted: true };
          } catch (e) {
            ultimoErro = e;
            // A próxima tentativa é feita pela fila persistente.
          }
        }
        marcarPendenteAnexo(key);
        window.__statusPlanilha = 'erro';
        window.__ultimoErroSync = ultimoErro && ultimoErro.name === 'AbortError'
          ? 'O PDF está salvo neste aparelho, mas o Google Drive demorou para recebê-lo. Ele será reenviado automaticamente.'
          : 'Não consegui enviar o PDF ao Google Drive agora. Ele continua salvo neste aparelho e será reenviado.';
        return { ok: false, erro: window.__ultimoErroSync };
      }

            async function resolverConflitoStale_(key, serverUpdatedAt) {
        // v37 — sincronização multiaparelho: busca a versão central e tenta um merge
        // de três vias (base que este aparelho recebeu, edição local e versão do Drive).
        // Mudanças em registros/campos diferentes são combinadas automaticamente.
        try {
          marcarEscritaLocal_(key);
          const corpo = await lerRespostaJSON(await timeoutFetch(
            APPS_SCRIPT_URL + '?key=' + encodeURIComponent(key),
            { method: 'GET', cache: 'no-store' },
            45000
          ));
          serverUpdatedAt = Number(corpo.serverUpdatedAt) || Number(serverUpdatedAt) || 0;
          const dados = corpo && corpo.dados ? corpo.dados : {};
          const existeServidor = Object.prototype.hasOwnProperty.call(dados, key);
          const valorServidor = existeServidor ? String(dados[key]) : null;
          const valorLocal = key.indexOf('anexo_') !== -1 ? null : localStorage.getItem(key);
          const baseReg = baseValor_(key);
          let valorFinal = valorServidor;
          let deveReenviar = false;

          if (key.indexOf('anexo_') === -1 && baseReg && !baseReg.ausente && valorLocal !== null && valorServidor !== null) {
            const tentativa = tentarMesclarTextoJSON_(String(baseReg.valor), String(valorLocal), String(valorServidor), false);
            if (tentativa.ok) {
              valorFinal = tentativa.valor;
              if (tentativa.conflitos.length > 0) {
                registrarConflitoOffline_(key, valorLocal, valorServidor, serverUpdatedAt);
                let usarLocal = false;
                try {
                  usarLocal = window.confirm('Conflito de sincronização detectado em ' + tentativa.conflitos.slice(0,6).join(', ') + (tentativa.conflitos.length > 6 ? '…' : '') + '.\n\nOK = usar o valor deste aparelho nos campos em conflito.\nCancelar = manter o valor do Google Drive nesses campos.\n\nAlterações em campos diferentes serão combinadas nos dois casos.');
                } catch (e) {}
                if (usarLocal) {
                  const localPref = tentarMesclarTextoJSON_(String(baseReg.valor), String(valorLocal), String(valorServidor), true);
                  if (localPref.ok) valorFinal = localPref.valor;
                }
              }
              deveReenviar = valorFinal !== valorServidor;
            } else {
              registrarConflitoOffline_(key, valorLocal, valorServidor, serverUpdatedAt);
            }
          } else if (key.indexOf('anexo_') === -1 && valorLocal !== valorServidor) {
            registrarConflitoOffline_(key, valorLocal, valorServidor, serverUpdatedAt);
          }

          // Atualiza a base oficial para a revisão que acabou de ser lida.
          const versoes = lerVersoes();
          versoes[key] = Number(serverUpdatedAt) || Date.now();
          try { localStorage.setItem(CHAVE_VERSOES, JSON.stringify(versoes)); } catch (e) {}
          definirBaseVersao_(key, Number(serverUpdatedAt) || 0);
          definirBaseValor_(key, valorServidor);

          if (deveReenviar && valorFinal !== null) {
            // Mantém a versão combinada local e grava por cima da revisão que acabamos de confirmar.
            if (!cachePlanilha) cachePlanilha = {};
            cachePlanilha[key] = valorFinal;
            try { localStorage.setItem(key, valorFinal); } catch (e) {}
            marcarPendente(key);
            const nova = novaVersao(key);
            const r = await enviarSet_(key, valorFinal, nova, false);
            if (r && r.ok) return true;
            return false;
          }

          if (existeServidor) {
            if (!cachePlanilha) cachePlanilha = {};
            cachePlanilha[key] = valorServidor;
            if (key.indexOf('anexo_') !== -1) {
              try { await idbAnexoSet_(key, dados[key]); } catch (e) {}
            } else {
              try { localStorage.setItem(key, valorServidor); } catch (e) {}
            }
          } else {
            if (cachePlanilha) delete cachePlanilha[key];
            if (key.indexOf('anexo_') !== -1) await idbAnexoDelete_(key);
            else try { localStorage.removeItem(key); } catch (e) {}
          }

          // Não há alteração local a reaplicar: esta revisão torna-se a base limpa.
          limparBaseVersao_(key);
          if (key.indexOf('anexo_') !== -1) marcarSincronizadoAnexo(key);
          else { const pendentes = lerPendencias(); pendentes.delete(key); salvarPendencias(pendentes); }
          try { window.dispatchEvent(new CustomEvent('painel:drive-atualizado', { detail: { conflitoResolvido: true, key: key } })); } catch (e) {}
          return true;
        } catch (e) {
          marcarPendente(key);
          return false;
        }
      }

      async function enviarDelete_(key, versao) {
        if (!APPS_SCRIPT_URL) return { ok: true, localOnly: true };
        if (key.indexOf('anexo_') !== -1) marcarPendenteAnexo(key);
        else marcarPendente(key);
        let ultimoErro = null;
        const opId = gerarOpId_(versao);
        for (let tentativa = 1; tentativa <= 1; tentativa++) {
          try {
            const corpoPost = {
              acao: 'delete', key, deletar: true,
              updatedAt: Number(versao) || Date.now(), baseUpdatedAt: baseVersao_(key), clientId: clienteId(), opId,
            };
            const corpo = await postarGitEConfirmar_(corpoPost, key, null, true);
            if (corpo.accepted === false && corpo.stale) {
              window.__statusPlanilha = 'erro';
              window.__ultimoErroSync = 'A exclusão ficou atrás de uma alteração mais nova no Drive. Nada foi apagado à força.';
              const resolvido = await resolverConflitoStale_(key, corpo.serverUpdatedAt);
              return { ok: false, stale: true, resolvido };
            }
            marcarEscritaLocal_(key);
            if (key.indexOf('anexo_') !== -1) marcarSincronizadoAnexo(key);
            marcarSincronizado(key, versao);
            aplicarConfirmacao_(key, versao, corpo.serverUpdatedAt, null);
            avancarRevisaoConfirmadaPorGravacao_(corpo);
            window.__statusPlanilha = 'ok';
            window.__ultimoErroSync = null;
            registrarSync_('gravacao');
            return { ok: true };
          } catch (e) {
            ultimoErro = e;
            // A próxima tentativa é feita pela fila persistente, sem laços multiplicados.
          }
        }
        window.__statusPlanilha = 'erro';
        window.__ultimoErroSync = String((ultimoErro && ultimoErro.message) || ultimoErro || 'Não foi possível apagar no Drive.');
        if (key.indexOf('anexo_') !== -1) marcarPendenteAnexo(key);
        else marcarPendente(key);
        return { ok: false, erro: window.__ultimoErroSync };
      }

            let reenvioPendenciasEmAndamento_ = false;

      async function reenvioAutomaticoPendencias_() {
        if (!APPS_SCRIPT_URL || !window.__aberturaConcluida || reenvioPendenciasEmAndamento_ || navigator.onLine === false) return;
        const comuns = Array.from(lerPendencias());
        const anexos = Array.from(lerPendenciasAnexos());
        if (!comuns.length && !anexos.length) return;

        reenvioPendenciasEmAndamento_ = true;
        try {
          filaEscrita = filaEscrita.then(async () => {
            for (const key of comuns) {
              if (!lerPendencias().has(key)) continue; // já confirmado enquanto esperava na fila
              let valor = null;
              try { valor = localStorage.getItem(key); } catch (e) {}
              const versao = Number(lerVersoes()[key]) || Date.now();

              if (valor === null) await enviarDelete_(key, versao);
              else await enviarSet_(key, valor, versao, false);
            }

            for (const key of anexos) {
              if (!lerPendenciasAnexos().has(key)) continue;
              let valor = null;
              try { valor = await idbAnexoGet_(key); } catch (e) {}
              if (valor === null) continue;
              const versao = Number(lerVersoes()[key]) || Date.now();
              await enviarAnexo_(key, valor, versao);
            }
          }).catch(e => {
            window.__statusPlanilha = 'erro';
            window.__ultimoErroSync = String((e && e.message) || e || 'Falha no reenvio automático.');
          });

          await filaEscrita;
        } finally {
          reenvioPendenciasEmAndamento_ = false;
        }
      }

      setTimeout(() => { reenvioAutomaticoPendencias_().catch(() => {}); }, 3000);
      setInterval(() => { reenvioAutomaticoPendencias_().catch(() => {}); }, 15000);
      window.addEventListener('online', () => { reenvioAutomaticoPendencias_().catch(() => {}); });

      // ================================================================
      // v5.35 — resolução anual restaurada.
      // ================================================================
      if (!window.__exercicioAtual) {
        try { window.__exercicioAtual = Number(localStorage.getItem('painel_exercicio_atual')) || 2026; }
        catch (e) { window.__exercicioAtual = 2026; }
      }

      const CHAVES_ANUAIS_BASE_ = new Set([
        'saldos_mensais',
        'meta_lucro_mensal',
        'valores_mensalidade',
        'valores_avulsos',
        'dias_letivos',
        'capacidade_maxima',
        'convenios_multivaga',
        'categorias_indicadores',
        'auto_lancamentos_v15',
        // v12 — bases que também pertencem a um exercício específico.
        // Compras permanece global de propósito.
        'contas_pessoais_v1',
        'valores_casos_especiais',
        'rematricula_status_alunos',
        'rematricula_reajuste_padrao',
        'festas_tdb',
        'festas_tdb_abas'
      ]);

      function chaveAnualParaAno_(base, ano) {
        const y = Number(ano) || 2026;
        if (base === 'transacoes_financas2026') return `transacoes_financas${y}`;
        if (CHAVES_ANUAIS_BASE_.has(base)) return y === 2026 ? base : `${base}__${y}`;
        return base;
      }

      function resolverChaveAnual_(key) {
        const k = String(key || '');
        if (k.startsWith('@@raw:')) return k.slice(6);
        if (/__\d{4}$/.test(k) || /^transacoes_financas(?!2026)\d{4}$/.test(k)) return k;
        return chaveAnualParaAno_(k, window.__exercicioAtual || 2026);
      }

      window.__chaveAnualParaAno = chaveAnualParaAno_;

      window.storage = {
        // v4.38: nenhum efeito financeiro monta antes de uma leitura válida.
        prepararAbertura: async (forcarDrive) => {
          window.__transacoesProntas = false;
          const chave = resolverChaveAnual_('transacoes_financas2026');
          const validar = valor => {
            if (valor == null) return false;
            try { return Array.isArray(JSON.parse(valor)); } catch (e) { return false; }
          };
          const concluir = origem => {
            window.__transacoesProntas = true;
            window.__aberturaConcluida = true;
            setTimeout(() => { reenvioAutomaticoPendencias_().catch(() => {}); }, 250);
            return { ok: true, origem };
          };

          let local = null;
          try { local = localStorage.getItem(chave); } catch (e) {}
          const localValido = validar(local);
          const semPendencias = lerPendencias().size === 0 && lerPendenciasAnexos().size === 0;

          // TDB 02b: nenhuma chamada de rede bloqueia a cópia local válida.
          // Chaves ausentes ainda aguardam uma leitura real, para não criar dados-modelo.
          if (!forcarDrive && APPS_SCRIPT_URL && localValido) {
            window.__statusPlanilha = 'sincronizando';
            window.__driveDisponivel = null;
            validacaoAbertura_ = (async () => {
              try {
                const revisaoLocal = lerRevisaoConfirmadaLocal_();
                if (revisaoLocal.existe && semPendencias) {
                  const status = await checarStatusAbertura_();
                  if (Number(status.revisaoGlobal) === revisaoLocal.valor) {
                    window.__versaoBackend = status.versaoBackend;
                    window.__revisaoGlobalServidor = Number(status.revisaoGlobal);
                    window.__driveDisponivel = true;
                    window.__statusPlanilha = lerPendencias().size ? 'pendente' : 'ok';
                    registrarSync_('leitura-validada');
                    return;
                  }
                }
                await carregarDaPlanilha();
              } catch (e) {
                window.__driveDisponivel = false;
                window.__statusPlanilha = 'erro';
                window.__ultimoErroSync = 'Conferência do Drive pendente. A cópia deste aparelho está disponível. ' + e.message;
              }
            })().finally(() => { validacaoAbertura_ = null; });
            return concluir('local-imediato');
          }

          if (APPS_SCRIPT_URL) {
            // Só fazemos a leitura pesada quando houve mudança no servidor, não existe
            // revisão local confirmada, há pendências ou o usuário forçou atualização.
            const leitura = await window.storage.refreshDrive({ aberturaRapida: !forcarDrive && localValido });
            if (leitura.ok && cachePlanilha && validar(cachePlanilha[chave])) {
              return concluir('drive');
            }

            // Internet/Drive lento: não deixa o usuário preso por minutos. A cópia local
            // protegida abre, e o botão de sincronização/manual pode tentar novamente.
            if (!forcarDrive && localValido) {
              window.__statusPlanilha = 'erro';
              window.__driveDisponivel = false;
              window.__ultimoErroSync = (leitura && leitura.erro)
                ? leitura.erro + ' — abrindo a cópia protegida deste aparelho.'
                : 'Google Drive indisponível — abrindo a cópia protegida deste aparelho.';
              // Continua tentando uma leitura completa sem prender a tela. Se o Drive
              // responder depois, o evento painel:drive-atualizado remonta os dados.
              setTimeout(() => { window.storage.refreshDrive().catch(() => {}); }, 1500);
              return concluir('local-fallback');
            }

            if (!leitura.ok) throw new Error(leitura.erro || 'Não foi possível ler o Google Drive. Tente novamente.');
            throw new Error('O Drive respondeu, mas não trouxe lançamentos válidos para ' + (window.__exercicioAtual || 2026) + '. No computador, confirme o envio pelo botão Salvar. Confira também se os aparelhos usam a mesma URL /exec. Nenhum dado-modelo foi criado.');
          }

          if (localValido) return concluir('local');
          throw new Error('Não há dados locais válidos para abrir o painel.');
        },
        refreshDrive: async (opcoes) => {
          if (!APPS_SCRIPT_URL) return { ok:false, localOnly:true };
          const r = await carregarDaPlanilha(opcoes);
          return {
            ok: !!(cacheCarregadoComSucesso && r),
            dados: r,
            dadosAtualizados: !!window.__ultimaLeituraMudouDados,
            erro: window.__ultimoErroSync || null
          };
        },

        get: async (key) => {
          key = resolverChaveAnual_(key);
          // Anexos usam IndexedDB porque localStorage costuma ter limite de poucos MB.
          // Isso evita que um PDF grande corrompa/estoure o armazenamento local.
          if (key.indexOf('anexo_') !== -1) {
            try {
              const localAnexo = await idbAnexoGet_(key);
              if (localAnexo !== null) return { value: localAnexo };
            } catch (e) {}
            try {
              const legado = localStorage.getItem(key);
              if (legado !== null) {
                try { await idbAnexoSet_(key, legado); } catch (e) {}
                return { value: legado };
              }
            } catch (e) {}
          }

          // Se esta chave foi alterada localmente e ainda está pendente, ela é a fonte
          // mais recente. Isso evita o Drive antigo aparecer por cima dela.
          const pendentes = lerPendencias();
          if (pendentes.has(key)) {
            try {
              const local = localStorage.getItem(key);
              return local !== null ? { value: local } : null;
            } catch (e) {}
          }

          // LOCAL-FIRST: abre imediatamente com a cópia deste aparelho.
          // A conferência com o Drive acontece em segundo plano.
          // Depois de uma leitura confirmada, usa o retorno em memória mesmo se o
          // navegador não conseguiu persistir o cache (ex.: armazenamento restrito).
          if (cacheCarregadoComSucesso && cachePlanilha && Object.prototype.hasOwnProperty.call(cachePlanilha, key)) {
            return { value: cachePlanilha[key] };
          }
          let localRapido = null;
          try { localRapido = localStorage.getItem(key); } catch (e) {}
          if (localRapido !== null) {
            return { value: localRapido };
          }

          // Compartilha a verificação inicial; não abre duas leituras concorrentes.
          if (key.indexOf('anexo_') === -1 && validacaoAbertura_) await validacaoAbertura_;
          // Só bloqueia esperando o Drive se este aparelho realmente não possui a chave.
          if (APPS_SCRIPT_URL && key.indexOf('anexo_') === -1 && !cacheCarregadoComSucesso && Date.now() - ultimaFalhaLeituraEm > 15000) {
            await carregarDaPlanilha();
          }

          if (cacheCarregadoComSucesso && cachePlanilha && Object.prototype.hasOwnProperty.call(cachePlanilha, key)) {
            const valor = cachePlanilha[key];
            try { if (valor !== undefined && valor !== null) localStorage.setItem(key, valor); } catch (e) {}
            return { value: valor };
          }

          // Anexos grandes não entram no GET em massa. Busca sob demanda.
          if (APPS_SCRIPT_URL && key.indexOf('anexo_') !== -1) {
            try {
              const corpo = await lerRespostaJSON(await timeoutFetch(
                APPS_SCRIPT_URL + '?key=' + encodeURIComponent(key),
                { method: 'GET', cache: 'no-store' },
                45000
              ));
              if (corpo.dados && Object.prototype.hasOwnProperty.call(corpo.dados, key)) {
                if (!cachePlanilha) cachePlanilha = {};
                cachePlanilha[key] = corpo.dados[key];
                try { await idbAnexoSet_(key, corpo.dados[key]); } catch (e) {}
                return { value: corpo.dados[key] };
              }
            } catch (e) {
              console.warn('Não consegui buscar o anexo no Drive agora:', e);
            }
          }

          // Se não existe cópia local e a leitura central falhou, isso NÃO significa
          // banco vazio. Propagamos a falha para impedir a criação automática dos dados
          // modelo por cima de um banco real temporariamente indisponível.
          if (APPS_SCRIPT_URL && !cacheCarregadoComSucesso && window.__driveDisponivel === false) {
            throw new Error(window.__ultimoErroSync || 'Não foi possível carregar os dados do Google Drive.');
          }

          try {
            const local = localStorage.getItem(key);
            return local !== null ? { value: local } : null;
          } catch (e) { return null; }
        },

        set: async (key, val, exigirConfirmacao) => {
          key = resolverChaveAnual_(key);
          marcarEscritaLocal_(key);
          if (/^transacoes_financas\d{4}$/.test(key) && !window.__transacoesProntas) {
            throw new Error('Gravação bloqueada: carregue lançamentos válidos antes de editar.');
          }
          const eAnexo = key.indexOf('anexo_') !== -1;
          if (!eAnexo && localStorage.getItem(key) === String(val)) {
            if (!exigirConfirmacao) return true;
            await filaEscrita;
            if (!lerPendencias().has(key)) return true;
          }
          // Anexo: IndexedDB primeiro; nunca jogamos um PDF de 10/20MB dentro do localStorage.
          if (eAnexo) {
            try { await idbAnexoSet_(key, val); } catch (e) {
              window.__statusPlanilha = 'erro';
              window.__ultimoErroSync = 'Não consegui guardar o anexo neste aparelho. Verifique o espaço disponível.';
              throw e;
            }
            if (!cachePlanilha) cachePlanilha = {};
            cachePlanilha[key] = val;
            registrarBaseVersao_(key);
            const versao = novaVersao(key);
            marcarPendenteAnexo(key);
            if (!APPS_SCRIPT_URL) return true;
            filaEscrita = filaEscrita.then(async () => {
              const atual = Number(lerVersoes()[key]) || versao;
              if (atual !== versao) return { ok: true, ignorada: true };
              return enviarAnexo_(key, val, versao);
            }).catch(e => {
              marcarPendenteAnexo(key);
              window.__statusPlanilha = 'erro';
              window.__ultimoErroSync = String(e && e.message || e);
              return { ok: false, erro: window.__ultimoErroSync };
            });
            const resultado = await filaEscrita;
            if (exigirConfirmacao && (!resultado || resultado.ok !== true)) {
              throw new Error((resultado && resultado.erro) || 'O anexo não foi confirmado pelo Google Drive.');
            }
            return !resultado || resultado.ok !== false;
          }

          // Dados normais: guarda primeiro no aparelho. Se o aplicativo fechar agora,
          // a alteração continua disponível e marcada como pendente.
          // v37: preserva também o valor-base usado para mesclar edições feitas em aparelhos diferentes.
          registrarBaseValor_(key);
          try { localStorage.setItem(key, val); } catch (e) {
            window.__statusPlanilha = 'erro';
            window.__ultimoErroSync = 'Não foi possível guardar a alteração neste aparelho. Verifique o espaço e as permissões do navegador.';
            throw new Error(window.__ultimoErroSync);
          }
          if (!cachePlanilha) cachePlanilha = {};
          cachePlanilha[key] = val;
          registrarBaseVersao_(key);
          const versao = novaVersao(key);
          marcarPendente(key);

          if (!APPS_SCRIPT_URL) return true;

          // Agrupa digitação rápida e ignora versões já substituídas antes do envio.
          const aguardarEdicoes = new Promise(resolve => setTimeout(resolve, 250));
          filaEscrita = filaEscrita.then(async () => {
            await aguardarEdicoes;
            const atual = Number(lerVersoes()[key]) || versao;
            if (atual !== versao) return { ok: true, ignorada: true };
            return enviarSet_(key, val, versao, false);
          }).catch(e => {
            marcarPendente(key);
            window.__statusPlanilha = 'erro';
            window.__ultimoErroSync = String(e && e.message || e);
            return { ok: false, erro: window.__ultimoErroSync };
          });
          if (!exigirConfirmacao) return true; // já persistido; Drive continua na fila
          const resultado = await filaEscrita;
          if (exigirConfirmacao && (!resultado || resultado.ok !== true)) {
            throw new Error((resultado && resultado.erro) || 'A alteração não foi confirmada pelo Google Drive.');
          }
          return !resultado || resultado.ok !== false;
        },

        resync: async (onProgress, opcoes) => {
          if (!APPS_SCRIPT_URL) return { ok: true, total: 0, falhas: 0 };

          // v4.37 — a leitura ajuda na reconciliação, mas NÃO bloqueia o reenvio.
          // Se o GET falhar e os POSTs estiverem funcionando, as pendências locais
          // ainda são enviadas e só saem da fila após aceite explícito do servidor.
          let carregado = cacheCarregadoComSucesso ? cachePlanilha : null;
          // Pendências conhecidas são enviadas antes da leitura completa.
          let leituraConfirmada = !!(cacheCarregadoComSucesso && carregado);

          // carregarDaPlanilha pode ter recolocado pendências na fila automática.
          // Aguarda essa fila antes da reconciliação manual para não enviar a mesma
          // chave duas vezes em paralelo.
          const executar = async () => {

          const pendentes = Array.from(lerPendencias());
          const pendentesAnexos = Array.from(lerPendenciasAnexos());
          let falhas = 0;
          let feitos = 0;
          const totalTarefas = pendentes.length + pendentesAnexos.length;

          const tarefas = pendentes.map(key => {
            let valor = null;
            try { valor = localStorage.getItem(key); } catch (e) {}
            return {
              key,
              valor,
              deletar: valor === null,
              versao: Number(lerVersoes()[key]) || Date.now()
            };
          });

          for (const tarefa of tarefas) {
            if (Number(lerVersoes()[tarefa.key]) !== tarefa.versao) continue;
            const resultado = tarefa.deletar
              ? await enviarDelete_(tarefa.key, tarefa.versao)
              : await enviarSet_(tarefa.key, tarefa.valor, tarefa.versao, false);
            feitos++;
            if (!resultado.ok && !(resultado.stale && resultado.resolvido)) falhas++;
            if (onProgress) onProgress(feitos, totalTarefas);
          }

          for (const key of pendentesAnexos) {
            let valor = null;
            try { valor = await idbAnexoGet_(key); } catch (e) {}
            if (valor === null) { falhas++; feitos++; if (onProgress) onProgress(feitos, totalTarefas); continue; }
            const versao = Number(lerVersoes()[key]) || Date.now();
            const resultado = await enviarAnexo_(key, valor, versao);
            feitos++;
            if (!resultado.ok) falhas++;
            if (onProgress) onProgress(feitos, totalTarefas);
          }

          // Depois dos POSTs, tenta conferir o estado central. A confirmação do GET é
          // informada separadamente: uma falha de leitura não desfaz o aceite explícito
          // recebido para cada gravação nem recoloca itens já confirmados na fila.
          if (falhas === 0 && !(opcoes && opcoes.semLeitura)) {
            const verificado = await carregarDaPlanilha();
            leituraConfirmada = !!(cacheCarregadoComSucesso && verificado);
            if (leituraConfirmada) {
              const restantes = lerPendencias().size + lerPendenciasAnexos().size;
              if (restantes > 0) falhas = restantes;
            }
          }

          const ok = falhas === 0 && lerPendencias().size === 0 && lerPendenciasAnexos().size === 0;
          window.__statusPlanilha = ok && (leituraConfirmada || (opcoes && opcoes.semLeitura)) ? 'ok' : (ok ? 'pendente' : 'erro');
          if (ok && leituraConfirmada) window.__ultimoErroSync = null;
          return {
            ok,
            total: totalTarefas,
            falhas,
            leituraConfirmada,
            gravacoesConfirmadas: ok,
            aviso: ok && !leituraConfirmada
              ? 'As alterações foram aceitas pelo Drive, mas a leitura de conferência ainda não respondeu.'
              : null
          };
          };
          filaEscrita = filaEscrita.then(executar, executar);
          return filaEscrita;
        },

        salvarTudo: (onProgress) => {
          if (!salvamentoManual_) {
            salvamentoManual_ = window.storage._salvarTudo(onProgress).finally(() => { salvamentoManual_ = null; });
          }
          return salvamentoManual_;
        },
        _salvarTudo: async (onProgress) => {
          // TDB 10.2 — "Salvar" de verdade (equivalente ao Ctrl+S):
          // 1) descarrega o campo que ainda está sendo editado;
          // 2) espera a fila de gravação;
          // 3) envia o que estiver pendente (com confirmação por gravação);
          // 4) se não havia nada pendente, confere se o servidor mudou (consulta barata).
          const confirmacaoNoInicio = Number(window.__ultimoSalvamentoDrive || 0);
          try {
            const a = document.activeElement;
            if (a && a !== document.body && typeof a.blur === 'function') a.blur();
          } catch (e) {}
          try { window.dispatchEvent(new CustomEvent('painel:flush-edicoes')); } catch (e) {}
          await new Promise(r => setTimeout(r, 450));
          const haviaPendencia = (lerPendencias().size + lerPendenciasAnexos().size) > 0;
          try { await filaEscrita; } catch (e) {}
          if (!APPS_SCRIPT_URL) return { tipo: 'local' };

          const pendentes = lerPendencias().size + lerPendenciasAnexos().size;
          if (pendentes === 0 && (haviaPendencia || Number(window.__ultimoSalvamentoDrive || 0) > confirmacaoNoInicio)) {
            // A fila automática acabou de enviar e confirmar tudo enquanto esperávamos.
            return { tipo: 'enviado', ultimoSalvamento: Number(window.__ultimoSalvamentoDrive) || null };
          }
          if (pendentes > 0) {
            const r = await window.storage.resync(onProgress, { semLeitura: true });
            if (r.ok) return { tipo: 'enviado', total: r.total, ultimoSalvamento: Number(window.__ultimoSalvamentoDrive) || null };
            return { tipo: 'falha', falhas: r.falhas, erro: window.__ultimoErroSync || null };
          }

          const revLocal = lerRevisaoConfirmadaLocal_();
          try {
            const url = APPS_SCRIPT_URL + '?acao=statusAbertura&_=' + Date.now();
            const status = await lerRespostaJSON(await timeoutFetch(url, { method: 'GET', cache: 'no-store' }, 15000));
            window.__driveDisponivel = true;
            if (status && status.ok && revLocal.existe && revLocal.valor === Number(status.revisaoGlobal)) {
              window.__statusPlanilha = 'ok';
              window.__ultimoErroSync = null;
              return { tipo: 'tudoSalvo', ultimoSalvamento: Number(window.__ultimoSalvamentoDrive) || null };
            }
          } catch (e) {
            return { tipo: 'semResposta', erro: String((e && e.message) || e) };
          }

          // O servidor tem algo que este aparelho ainda não conferiu: leitura completa.
          const leitura = await window.storage.refreshDrive();
          if (leitura.ok) return { tipo: leitura.dadosAtualizados ? 'atualizado' : 'tudoSalvo', ultimoSalvamento: Number(window.__ultimoSalvamentoDrive) || null };
          return { tipo: 'semResposta', erro: leitura.erro || null };
        },

        delete: async (key) => {
          key = resolverChaveAnual_(key);
          marcarEscritaLocal_(key);
          const eAnexo = key.indexOf('anexo_') !== -1;
          if (eAnexo) {
            await idbAnexoDelete_(key);
            if (cachePlanilha) delete cachePlanilha[key];
            registrarBaseVersao_(key);
            const versao = novaVersao(key);
            marcarPendenteAnexo(key);
            if (!APPS_SCRIPT_URL) return true;
            filaEscrita = filaEscrita.then(async () => {
              const atual = Number(lerVersoes()[key]) || versao;
              if (atual !== versao) return { ok: true, ignorada: true };
              const r = await enviarDelete_(key, versao);
              if (r.ok) marcarSincronizadoAnexo(key);
              return r;
            }).catch(e => {
              marcarPendenteAnexo(key);
              window.__statusPlanilha = 'erro';
              window.__ultimoErroSync = String(e && e.message || e);
              return { ok: false };
            });
            return filaEscrita.then(() => true);
          }

          try { localStorage.removeItem(key); } catch (e) {}
          if (cachePlanilha) delete cachePlanilha[key];
          registrarBaseVersao_(key);
          const versao = novaVersao(key);
          marcarPendente(key);
          if (!APPS_SCRIPT_URL) return true;
          filaEscrita = filaEscrita.then(async () => {
            const atual = Number(lerVersoes()[key]) || versao;
            if (atual !== versao) return { ok: true, ignorada: true };
            return enviarDelete_(key, versao);
          }).catch(e => {
            marcarPendente(key);
            window.__statusPlanilha = 'erro';
            window.__ultimoErroSync = String(e && e.message || e);
            return { ok: false };
          });
          return filaEscrita.then(() => true);
        },

        list: async (prefixo) => {
          const chaves = new Set();
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && (!prefixo || k.startsWith(prefixo))) chaves.add(k);
            }
          } catch (e) {}
          if (cachePlanilha) {
            Object.keys(cachePlanilha).forEach(k => {
              if (!prefixo || k.startsWith(prefixo)) chaves.add(k);
            });
          }
          return { keys: Array.from(chaves) };
        }
      };

      // TDB 10.2 — Ctrl+S / Cmd+S salva de verdade (o botão diz "igual o Ctrl+S do Excel").
      window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 's') {
          if (typeof window.__tdbSalvarAgora === 'function') { e.preventDefault(); window.__tdbSalvarAgora(); }
        }
      });

      // Se houver pendências, avisa antes de fechar. Não bloqueia o fechamento;
      // apenas deixa claro que ainda existe algo esperando confirmação do Drive.
      window.addEventListener('beforeunload', (e) => {
        if ((window.__pendenciasSync || 0) > 0) {
          e.preventDefault();
          e.returnValue = '';
        }
      });
    }
  