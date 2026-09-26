/*
 * Idiomas de la interfaz.
 *
 * El HTML y los módulos conservan el español como fuente. Cada archivo de
 * idioma traduce esas frases sin intervenir en la lógica ni en los datos.
 * Los textos que aparezcan en el futuro y aún no estén en un catálogo se
 * muestran en español hasta que se traduzcan.
 */

const CLAVE_IDIOMA = "idioma_interfaz_v1";
const URL_LISTA_IDIOMAS = new URL("../../idiomas/lista.json", import.meta.url);
const ATRIBUTOS_TRADUCIBLES = ["title", "aria-label", "aria-description", "placeholder", "alt"];

let idiomasDisponibles = [];
let idiomaActual = "es";
let tablaTraducciones = new Map();
let patronesTraduccion = [];
let observador = null;

const textosOriginales = new WeakMap();
const textosAplicados = new WeakMap();
const atributosOriginales = new WeakMap();
const atributosAplicados = new WeakMap();

function compilarPatrones(traducciones) {
  const patrones = [];
  for (const [origen, destino] of Object.entries(traducciones || {})) {
    if (!origen.includes("{variable}")) continue;
    const partes = origen.split("{variable}");
    const expresion = new RegExp(`^${partes.map(escaparRegex).join("([\\s\\S]+?)")}$`);
    patrones.push({ expresion, destino, cantidad: partes.length - 1 });
  }
  return patrones;
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function traducir(texto) {
  if (idiomaActual === "es") return texto;
  const coincidenciaBordes = texto.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const prefijo = coincidenciaBordes[1];
  const sufijo = coincidenciaBordes[3];
  const origen = coincidenciaBordes[2].replace(/\s+/g, " ");
  if (!origen) return texto;
  if (tablaTraducciones.has(origen)) return `${prefijo}${tablaTraducciones.get(origen)}${sufijo}`;

  for (const regla of patronesTraduccion) {
    const coincidencia = origen.match(regla.expresion);
    if (!coincidencia) continue;
    let indice = 1;
    return `${prefijo}${regla.destino.replaceAll("{variable}", () => coincidencia[indice++])}${sufijo}`;
  }
  return texto;
}

function procesarNodoTexto(nodo) {
  const actual = nodo.nodeValue;
  const ultimoAplicado = textosAplicados.get(nodo);
  const original = ultimoAplicado !== undefined && actual === ultimoAplicado
    ? textosOriginales.get(nodo)
    : actual;
  if (original === undefined) return;
  textosOriginales.set(nodo, original);

  const nuevo = traducir(original);
  if (nuevo !== actual) nodo.nodeValue = nuevo;
  textosAplicados.set(nodo, nuevo);
}

function procesarAtributo(elemento, atributo) {
  const actual = elemento.getAttribute(atributo);
  if (actual === null) return;

  let originales = atributosOriginales.get(elemento);
  if (!originales) {
    originales = new Map();
    atributosOriginales.set(elemento, originales);
  }
  let aplicados = atributosAplicados.get(elemento);
  if (!aplicados) {
    aplicados = new Map();
    atributosAplicados.set(elemento, aplicados);
  }

  const original = aplicados.has(atributo) && actual === aplicados.get(atributo)
    ? originales.get(atributo)
    : actual;
  originales.set(atributo, original);
  const nuevo = traducir(original);
  if (nuevo !== actual) elemento.setAttribute(atributo, nuevo);
  aplicados.set(atributo, nuevo);
}

function recorrerNodo(nodo) {
  if (nodo.nodeType === Node.TEXT_NODE) {
    const padre = nodo.parentElement;
    if (!padre || padre.closest("script, style, textarea, input, select, option, [contenteditable='true'], [data-i18n-keep]")) return;
    procesarNodoTexto(nodo);
    return;
  }
  if (nodo.nodeType !== Node.ELEMENT_NODE) return;

  const elemento = nodo;
  if (elemento.matches("[data-i18n-keep]")) return;
  for (const atributo of ATRIBUTOS_TRADUCIBLES) procesarAtributo(elemento, atributo);
  for (const hijo of elemento.childNodes) recorrerNodo(hijo);
}

function traducirDocumento() {
  if (document.body) recorrerNodo(document.body);
}

function observarCambiosDOM() {
  if (observador || !document.body) return;
  observador = new MutationObserver((cambios) => {
    for (const cambio of cambios) {
      if (cambio.type === "characterData") recorrerNodo(cambio.target);
      else if (cambio.type === "attributes") procesarAtributo(cambio.target, cambio.attributeName);
      else for (const agregado of cambio.addedNodes) recorrerNodo(agregado);
    }
  });
  observador.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATRIBUTOS_TRADUCIBLES,
  });
}

async function cargarArchivoIdioma(idioma) {
  const registro = idiomasDisponibles.find((item) => item.id === idioma);
  if (!registro) throw new Error(`Idioma no registrado: ${idioma}`);
  const archivo = new URL(`../../idiomas/${encodeURIComponent(registro.archivo)}`, import.meta.url);
  const respuesta = await fetch(archivo);
  if (!respuesta.ok) throw new Error(`No se pudo cargar ${registro.archivo}`);
  const datos = await respuesta.json();
  return { registro, datos };
}

async function aplicarIdioma(idioma, { guardar = true } = {}) {
  try {
    const { registro, datos } = await cargarArchivoIdioma(idioma);
    idiomaActual = idioma;
    tablaTraducciones = new Map(Object.entries(datos.traducciones || {}));
    patronesTraduccion = compilarPatrones(datos.traducciones || {});
    document.documentElement.lang = datos.locale || idioma;
    if (guardar) localStorage.setItem(CLAVE_IDIOMA, idioma);
  } catch (error) {
    console.warn("No se pudo aplicar el idioma seleccionado; se mantiene el español.", error);
    idiomaActual = "es";
    tablaTraducciones = new Map();
    patronesTraduccion = [];
    document.documentElement.lang = "es";
    if (guardar) localStorage.setItem(CLAVE_IDIOMA, "es");
  }

  const selector = document.getElementById("selector-idioma");
  if (selector) selector.value = idiomaActual;
  traducirDocumento();
}

async function cargarListaIdiomas() {
  const respuesta = await fetch(URL_LISTA_IDIOMAS);
  if (!respuesta.ok) throw new Error("No se pudo leer idiomas/lista.json");
  const datos = await respuesta.json();
  const lista = Array.isArray(datos.idiomas) ? datos.idiomas : [];
  idiomasDisponibles = lista.filter((item) =>
    item && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(item.id) &&
    typeof item.nombre === "string" && typeof item.archivo === "string" &&
    /^[a-zA-Z0-9_-]+\.json$/.test(item.archivo)
  );
  if (!idiomasDisponibles.some((item) => item.id === "es")) {
    idiomasDisponibles.unshift({ id: "es", nombre: "Español", archivo: "espanol.json" });
  }
}

function renderizarSelector() {
  const selector = document.getElementById("selector-idioma");
  if (!selector) return;
  selector.replaceChildren();
  for (const idioma of idiomasDisponibles) {
    const opcion = document.createElement("option");
    opcion.value = idioma.id;
    opcion.textContent = idioma.nombre;
    opcion.dataset.i18nKeep = "";
    selector.append(opcion);
  }
  selector.value = idiomaActual;
  selector.onchange = () => aplicarIdioma(selector.value);
}

export async function inicializarIdiomas() {
  observarCambiosDOM();
  const idiomaGuardado = localStorage.getItem(CLAVE_IDIOMA) || "es";
  try {
    await cargarListaIdiomas();
    renderizarSelector();
    const idiomaInicial = idiomasDisponibles.some((item) => item.id === idiomaGuardado) ? idiomaGuardado : "es";
    await aplicarIdioma(idiomaInicial, { guardar: false });
  } catch (error) {
    console.warn("No se pudo cargar la lista de idiomas; se usa español.", error);
    idiomasDisponibles = [{ id: "es", nombre: "Español", archivo: "espanol.json" }];
    renderizarSelector();
    await aplicarIdioma("es", { guardar: false });
  }
}
