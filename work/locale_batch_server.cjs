const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const source = JSON.parse(fs.readFileSync(path.join(root, 'idiomas/espanol.json'), 'utf8'));
const PORT = 5867;
const state = new Map();

function escapeHtml(s) { return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
function findExprEnd(s, from) {
  let depth = 1, quote = '', escaped = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return s.length;
}
function quotedLiterals(expr) {
  const out = [];
  for (let i = 0; i < expr.length;) {
    const quote = expr[i];
    if (quote !== '"' && quote !== "'" && quote !== '`') { i++; continue; }
    let j = i + 1, escaped = false;
    for (; j < expr.length; j++) { const c = expr[j]; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) break; }
    if (j < expr.length) { const text = expr.slice(i + 1, j); if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2}/.test(text)) out.push({ start: i, end: j + 1, quote, text }); i = j + 1; }
    else i++;
  }
  return out;
}
function translatable(s) {
  if (/^\s*__[^\s]+__\s*$/.test(s)) return false;
  if (/^\s*@(?:keyframes|media|supports|font-face)\b/i.test(s)) return false;
  if (/^\s*\.[A-Za-z_-][\w-]*\s*\{/.test(s)) return false;
  return /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2}/.test(s.replace(/\{[^{}]*\}/g, ' ').replace(/<[^>]*>/g, ' '));
}
function prepare(value, index) {
  let body = value, counters = { expr: 0, variable: 0, tag: 0, side: 0 };
  const expressions = [], variables = [], tags = [], side = [];
  for (let pos = body.indexOf('${'); pos !== -1;) {
    const end = findExprEnd(body, pos + 2), expr = body.slice(pos, end), literals = quotedLiterals(expr), repl = [];
    for (const lit of literals) {
      const num = String(counters.side++).padStart(4, '0'), token = `QZXA${num}QXZ`, endToken = `QZXAEND${num}QXZ`;
      side.push({ token, endToken, text: lit.text, kind: 'expr', exprIndex: expressions.length, literalStart: lit.start, literalEnd: lit.end, quote: lit.quote });
      repl.push({ ...lit, token });
    }
    const num = String(counters.expr++).padStart(4, '0'), token = `QZXE${num}QXZ`;
    expressions.push({ token, expr, repl });
    body = body.slice(0, pos) + token + body.slice(end);
    pos = body.indexOf('${', pos + token.length);
  }
  body = body.replace(/\{variable\}/g, match => { const n = String(counters.variable++).padStart(4, '0'), token = `QZXV${n}QXZ`; variables.push({ token, original: match }); return token; });
  const tagRegex = /<\/?[A-Za-z][^>]*>/g;
  body = body.replace(tagRegex, tag => {
    const n = String(counters.tag++).padStart(4, '0'), token = `QZXT${n}QXZ`;
    const attrs = [...tag.matchAll(/\s(aria-label|title|placeholder|alt)\s*=\s*(["'])(.*?)\2/gi)];
    for (const attr of attrs) {
      const text = attr[3]; if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2}/.test(text)) continue;
      const sideNum = String(counters.side++).padStart(4, '0');
      side.push({ token: `QZXA${sideNum}QXZ`, endToken: `QZXAEND${sideNum}QXZ`, text, kind: 'attr', tagToken: token, attrName: attr[1], quote: attr[2] });
    }
    tags.push({ token, original: tag }); return token;
  });
  const line = `QZXID${String(index).padStart(4, '0')}QXZ: ${body}` + side.map(x => ` ${x.token} ${x.text} ${x.endToken}`).join('');
  return { index, original: value, line, expressions, variables, tags, side };
}
function build(lang) {
  const checkpointFile = path.join(__dirname, `checkpoint-${lang}.json`);
  const completed = fs.existsSync(checkpointFile) ? JSON.parse(fs.readFileSync(checkpointFile, 'utf8')) : {};
  const records = Object.entries(source.traducciones).map(([key, value], i) => ({ key, value, prepared: translatable(value) ? prepare(value, i) : null }));
  const pending = records.filter(x => x.prepared && completed[x.prepared.index] === undefined);
  const batches = []; let batch = [], size = 0;
  for (const record of pending) {
    const line = record.prepared.line;
    if (batch.length && size + line.length + 1 > 4300) { batches.push(batch); batch = []; size = 0; }
    batch.push(record); size += line.length + 1;
  }
  if (batch.length) batches.push(batch);
  return { lang, checkpointFile, completed, records, batches };
}
function getState(lang) { if (!state.has(lang)) state.set(lang, build(lang)); return state.get(lang); }
function finish(lang, s) {
  const result = { id: lang, nombre: lang === 'pt' ? 'Português' : 'Deutsch', locale: lang, traducciones: {} };
  for (const record of s.records) {
    const prep = record.prepared;
    if (!prep) { result.traducciones[record.key] = record.value; continue; }
    let out = s.completed[prep.index];
    if (out === undefined) throw new Error(`Missing translation for ${prep.index}`);
    for (const item of prep.side) {
      const translated = out.side?.[item.token];
      if (translated) {
        if (item.kind === 'attr') {
          const tag = prep.tags.find(t => t.token === item.tagToken);
          if (tag) tag.original = tag.original.replace(new RegExp(`(\\s${item.attrName}\\s*=\\s*)(["'])[^"']*\\2`, 'i'), (_, prefix, q) => `${prefix}${q}${translated.replaceAll('&','&amp;').replaceAll(q === '"' ? '"' : "'", q === '"' ? '&quot;' : '&#39;')}${q}`);
        } else {
          const expr = prep.expressions[item.exprIndex];
          if (expr) expr.repl.find(r => r.start === item.literalStart).translated = translated;
        }
      }
    }
    for (const expr of prep.expressions) {
      let exprText = expr.expr;
      for (const lit of [...expr.repl].reverse()) if (lit.translated) exprText = exprText.slice(0, lit.start + 1) + lit.translated + exprText.slice(lit.end - 1);
      out.text = out.text.replace(expr.token, exprText);
    }
    for (const variable of prep.variables) out.text = out.text.replace(variable.token, variable.original);
    for (const tag of prep.tags) out.text = out.text.replace(tag.token, tag.original);
    if (/materia/i.test(record.key)) {
      if (lang === 'pt') out.text = out.text.replace(/\bassuntos\b/gi, 'disciplinas').replace(/\bassunto\b/gi, 'disciplina');
      if (lang === 'de') out.text = out.text.replace(/\bThemen\b/gi, 'Fächer').replace(/\bThema\b/gi, 'Fach');
    }
    if (record.key === 'Agenda') out.text = lang === 'pt' ? 'Agenda' : 'Kalender';
    result.traducciones[record.key] = out.text;
  }
  const filename = lang === 'pt' ? 'portugues.json' : 'aleman.json';
  fs.writeFileSync(path.join(root, 'idiomas', filename), JSON.stringify(result, null, 2) + '\n', 'utf8');
  const listPath = path.join(root, 'idiomas/lista.json'), list = JSON.parse(fs.readFileSync(listPath, 'utf8'));
  list.idiomas = list.idiomas.filter(x => x.id !== lang); list.idiomas.push({ id: lang, nombre: result.nombre, archivo: filename });
  fs.writeFileSync(listPath, JSON.stringify(list, null, 2) + '\n', 'utf8');
  return filename;
}
function page(lang, n) {
  const s = getState(lang);
  if (n >= s.batches.length) { const file = finish(lang, s); return `<!doctype html><meta charset="utf-8"><h2>${lang} completo</h2><p>Guardado ${file} con ${Object.keys(source.traducciones).length} claves.</p>`; }
  const batch = s.batches[n], text = batch.map(x => x.prepared.line).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Batch ${n + 1}/${s.batches.length}</title><p id="status">${lang}: lote ${n + 1} de ${s.batches.length}, ${batch.length} filas</p><textarea id="source" readonly>${escapeHtml(text)}</textarea><form method="post" action="/?lang=${lang}&n=${n}"><textarea id="translation" name="translation"></textarea><button id="save" type="submit">Guardar y continuar</button></form>`;
}
function parseTranslated(s, batch) {
  s = s.replace(/^Resultados de tradu[cç][aã]o\s*/i, '');
  const markers = [...s.matchAll(/QZXID(\d{4})QXZ\s*[:：]?\s*/g)], expected = batch.map(x => x.prepared.index);
  const found = markers.map(x => Number(x[1]));
  const unique = [...new Set(found)];
  if (unique.length !== expected.length || unique.some((v, i) => v !== expected[i])) throw new Error(`IDs do not match: got ${unique.length} unique IDs, expected ${expected.length}`);
  const out = {};
  const seen = new Set();
  markers.forEach((m, i) => {
    const id = found[i]; if (seen.has(id)) return; seen.add(id);
    let j = i + 1; while (j < markers.length && found[j] === id) j++;
    const end = j < markers.length ? markers[j].index : s.length;
    let segment = s.slice(m.index + m[0].length, end).trim();
    segment = segment.replace(/(?:Guardar traducción|Escuchar traducción|Copiar traducción|Share translation)[\s\S]*$/i, '').trim();
    const side = {};
    for (const meta of batch[i].prepared.side) {
      const start = segment.indexOf(meta.token), finish = segment.indexOf(meta.endToken, start + meta.token.length);
      if (start >= 0 && finish > start) { side[meta.token] = segment.slice(start + meta.token.length, finish).trim(); segment = segment.slice(0, start) + segment.slice(finish + meta.endToken.length); }
    }
    out[id] = { text: segment.trim(), side };
  });
  return out;
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'POST' && url.pathname === '/') {
    const lang = url.searchParams.get('lang'), n = Number(url.searchParams.get('n') || 0), s = getState(lang), batch = s.batches[n];
    let body = ''; req.on('data', part => body += part); req.on('end', () => {
      try { const translated = new URLSearchParams(body).get('translation') || ''; Object.assign(s.completed, parseTranslated(translated, batch)); fs.writeFileSync(s.checkpointFile, JSON.stringify(s.completed), 'utf8'); res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' }).end(page(lang, n + 1)); }
      catch (error) { res.writeHead(400, { 'Content-Type':'text/plain; charset=utf-8' }).end(error.stack || String(error)); }
    }); return;
  }
  if (req.method === 'GET' && url.pathname === '/') {
    const lang = url.searchParams.get('lang'), n = Number(url.searchParams.get('n') || 0);
    if (!['pt','de'].includes(lang)) { res.writeHead(400).end('bad language'); return; }
    const translated = url.searchParams.get('translation');
    if (translated !== null) {
      const s = getState(lang), batch = s.batches[n];
      try { Object.assign(s.completed, parseTranslated(translated, batch)); fs.writeFileSync(s.checkpointFile, JSON.stringify(s.completed), 'utf8'); }
      catch (error) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(error.stack || String(error)); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(lang, n + 1)); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(lang, n)); return;
  }
  if ((req.method === 'POST' || req.method === 'GET') && url.pathname === '/record') {
    const lang = url.searchParams.get('lang'), n = Number(url.searchParams.get('n') || 0), s = getState(lang), batch = s.batches[n];
    if (!batch) { res.writeHead(400).end('bad batch'); return; }
    const processTranslation = body => {
      try {
        const form = new URLSearchParams(body), translated = form.get('translation') || '';
        Object.assign(s.completed, parseTranslated(translated, batch));
        fs.writeFileSync(s.checkpointFile, JSON.stringify(s.completed), 'utf8');
        res.writeHead(303, { Location: `/?lang=${lang}&n=${n + 1}` }).end();
      } catch (error) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(error.stack || String(error)); }
    };
    if (req.method === 'GET') { processTranslation(url.searchParams.toString()); return; }
    let body = ''; req.on('data', part => body += part); req.on('end', () => processTranslation(body)); return;
  }
  res.writeHead(404).end('not found');
});
server.listen(PORT, '127.0.0.1', () => console.log(`Local translation queue at http://127.0.0.1:${PORT}`));
