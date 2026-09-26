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

const FECHAS_ES_EN = new Map([
  ["lunes", "Monday"], ["martes", "Tuesday"], ["miércoles", "Wednesday"], ["miercoles", "Wednesday"],
  ["jueves", "Thursday"], ["viernes", "Friday"], ["sábado", "Saturday"], ["sabado", "Saturday"], ["domingo", "Sunday"],
  ["lun", "Mon"], ["mar", "Tue"], ["mié", "Wed"], ["mie", "Wed"], ["jue", "Thu"], ["vie", "Fri"], ["sáb", "Sat"], ["sab", "Sat"], ["dom", "Sun"],
  ["enero", "January"], ["febrero", "February"], ["marzo", "March"], ["abril", "April"], ["mayo", "May"], ["junio", "June"],
  ["julio", "July"], ["agosto", "August"], ["septiembre", "September"], ["setiembre", "September"],
  ["octubre", "October"], ["noviembre", "November"], ["diciembre", "December"],
  ["ene", "Jan"], ["feb", "Feb"], ["abr", "Apr"], ["jun", "Jun"], ["jul", "Jul"], ["ago", "Aug"],
  ["sep", "Sep"], ["sept", "Sep"], ["oct", "Oct"], ["nov", "Nov"], ["dic", "Dec"],
]);
const DIAS_FECHA_ES = [...FECHAS_ES_EN.keys()].filter((palabra) =>
  ["lunes", "martes", "miércoles", "miercoles", "jueves", "viernes", "sábado", "sabado", "domingo", "lun", "mar", "mié", "mie", "jue", "vie", "sáb", "sab", "dom"].includes(palabra)
);
const MESES_FECHA_ES = [...FECHAS_ES_EN.keys()].filter((palabra) => !DIAS_FECHA_ES.includes(palabra));
const REGEX_DIA_FECHA_ES = DIAS_FECHA_ES.join("|");
const REGEX_MES_FECHA_ES = MESES_FECHA_ES.join("|");

function traducirFecha(texto) {
  if (idiomaActual !== "en" || !/\d/.test(texto)) return texto;
  const traducirFragmento = (fragmento) => fragmento
    .replace(/\bde\b/gi, " ")
    .replace(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g, (palabra) => FECHAS_ES_EN.get(palabra.toLocaleLowerCase("es")) || palabra)
    .replace(/\s{2,}/g, " ")
    .trim();
  const regexDiaMes = new RegExp(`\\b(?:(?:${REGEX_DIA_FECHA_ES})[,\\s]+)?\\d{1,2}(?:\\s+de)?\\s+(?:${REGEX_MES_FECHA_ES})(?:\\s+(?:de\\s+)?\\d{4})?`, "gi");
  const regexMesAnio = new RegExp(`\\b(?:${REGEX_MES_FECHA_ES})\\s+(?:de\\s+)?\\d{4}`, "gi");
  const conDiaMes = texto.replace(regexDiaMes, traducirFragmento);
  return conDiaMes !== texto ? conDiaMes : texto.replace(regexMesAnio, traducirFragmento);
}

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
  return traducirFecha(texto);
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

  actualizarSelectorIdioma();
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
  const boton = document.getElementById("selector-idioma-boton");
  const lista = document.getElementById("selector-idioma-lista");
  if (!selector || !boton || !lista) return;
  lista.replaceChildren();
  for (const idioma of idiomasDisponibles) {
    const opcion = document.createElement("li");
    opcion.className = "select-custom-opcion";
    opcion.textContent = idioma.nombre;
    opcion.dataset.i18nKeep = "";
    opcion.setAttribute("role", "option");
    opcion.tabIndex = -1;
    opcion.addEventListener("click", async () => {
      await aplicarIdioma(idioma.id);
      cerrarListaIdiomas();
      boton.focus();
    });
    lista.append(opcion);
  }

  lista._volverA = selector;
  boton.setAttribute("aria-controls", lista.id);
  boton.onclick = (evento) => {
    evento.stopPropagation();
    if (lista.classList.contains("oculto")) abrirListaIdiomas();
    else cerrarListaIdiomas();
  };
  boton.onkeydown = (evento) => {
    if (evento.key !== "ArrowDown" && evento.key !== "Enter" && evento.key !== " ") return;
    evento.preventDefault();
    abrirListaIdiomas();
    lista.querySelector("[role='option']")?.focus();
  };
  lista.onkeydown = (evento) => {
    const opciones = [...lista.querySelectorAll("[role='option']")];
    const actual = opciones.indexOf(document.activeElement);
    if (evento.key === "Escape") {
      evento.preventDefault();
      cerrarListaIdiomas();
      boton.focus();
    } else if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      const direccion = evento.key === "ArrowDown" ? 1 : -1;
      opciones[(actual + direccion + opciones.length) % opciones.length]?.focus();
    } else if (evento.key === "Enter" || evento.key === " ") {
      evento.preventDefault();
      document.activeElement?.click();
    }
  };
  document.addEventListener("click", (evento) => {
    if (!selector.contains(evento.target) && !lista.contains(evento.target)) cerrarListaIdiomas();
  });
  actualizarSelectorIdioma();
}

function actualizarSelectorIdioma() {
  const selector = document.getElementById("selector-idioma");
  const boton = document.getElementById("selector-idioma-boton");
  const texto = document.getElementById("selector-idioma-valor");
  const lista = document.getElementById("selector-idioma-lista");
  if (!selector || !boton || !texto || !lista) return;
  const seleccionado = idiomasDisponibles.find((idioma) => idioma.id === idiomaActual);
  texto.textContent = seleccionado?.nombre || "Español";
  lista.querySelectorAll("[role='option']").forEach((opcion, indice) => {
    const idioma = idiomasDisponibles[indice];
    const activa = idioma?.id === idiomaActual;
    opcion.classList.toggle("activa", activa);
    opcion.setAttribute("aria-selected", String(activa));
  });
}

function abrirListaIdiomas() {
  const selector = document.getElementById("selector-idioma");
  const boton = document.getElementById("selector-idioma-boton");
  const lista = document.getElementById("selector-idioma-lista");
  if (!selector || !boton || !lista) return;

  document.querySelectorAll(".select-custom-lista").forEach((otraLista) => {
    if (otraLista === lista) return;
    otraLista.classList.add("oculto");
    if (otraLista.parentElement === document.body && otraLista._volverA) otraLista._volverA.appendChild(otraLista);
  });

  lista._volverA = selector;
  document.body.appendChild(lista);
  const rect = boton.getBoundingClientRect();
  lista.style.position = "fixed";
  lista.style.top = `${rect.bottom + 6}px`;
  lista.style.left = `${rect.left}px`;
  lista.style.width = `${rect.width}px`;
  lista.classList.remove("oculto");
  boton.setAttribute("aria-expanded", "true");
  window.addEventListener("resize", cerrarListaIdiomas);
  window.addEventListener("scroll", cerrarListaIdiomas, true);
}

function cerrarListaIdiomas() {
  const selector = document.getElementById("selector-idioma");
  const boton = document.getElementById("selector-idioma-boton");
  const lista = document.getElementById("selector-idioma-lista");
  if (!selector || !lista) return;
  lista.classList.add("oculto");
  boton?.setAttribute("aria-expanded", "false");
  if (lista.parentElement === document.body) selector.appendChild(lista);
  window.removeEventListener("resize", cerrarListaIdiomas);
  window.removeEventListener("scroll", cerrarListaIdiomas, true);
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
