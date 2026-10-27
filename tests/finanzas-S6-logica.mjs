// Pruebas de lógica de la sesión 6 (Node, sin DOM): texto, CSV, exportar, importar sin duplicados y mensajes del banco.
import assert from "node:assert/strict";
import * as schema from "../core/schema.js";
import { crearMovimiento, crearMeta } from "../core/finanzas-modelo.js";
import { calcularTotalesMovimientos } from "../core/finanzas-derivados.js";
import { quitarMovimiento } from "../core/finanzas-registro.js";
import { archivarCategoriaFinanzas, crearCategoriaFinanzas } from "../core/finanzas-categorias.js";
import {
  compararMoneda, detectarOrdenFecha, hashTexto, huellaMovimiento, normalizarTipo, parsearFechaTexto, parsearMontoTexto,
} from "../core/finanzas-texto.js";
import { decodificarBytes, detectarSeparador, escribirCsv, leerCsv, neutralizarFormula, restaurarFormula } from "../core/finanzas-csv.js";
import {
  advertenciasImportacion, aplicarImportacion, candidatosDeCsv, clasificarCandidatos, deshacerImportacion, detectarMapeo,
  exportarMovimientosCsv, exportarRespaldoJson, mapeoSuficiente, prepararImportacion, resumirCandidatos,
} from "../core/finanzas-importar.js";
import {
  compilarPlantilla, crearPatron, editarPatron, eliminarPatron, leerConPlantilla, leerMensajeGenerico, leerMensajes, listarPatrones,
  separarMensajes, sugerirPlantilla, MAX_PATRONES,
} from "../core/finanzas-mensajes.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const HOY = "2026-10-24";
const nuevo = () => schema.migrarDatosAntiguos(JSON.parse(JSON.stringify(schema.crearDatosUsuarioNuevo())));
const importar = (datos, texto, opciones = {}) => {
  const prep = prepararImportacion(texto, { hoy: HOY });
  assert.equal(prep.ok, true, "el archivo debía leerse: " + prep.motivo);
  const cands = clasificarCandidatos(datos, prep.formato === "json" ? prep.candidatos : candidatosDeCsv(prep, { hoy: HOY, ...opciones }));
  const res = aplicarImportacion(datos, cands);
  return { prep, cands, res };
};
const CSV_BASE = [
  "Fecha,Descripción,Monto",
  "2026-10-01,Almuerzo,-2500",
  "2026-10-02,Pasaje,-700",
  "2026-10-03,Depósito familia,50000",
].join("\n");

console.log("Texto: montos, fechas y huellas");
test("montos con miles y decimales en los estilos comunes", () => {
  const casos = { "2.500": 2500, "2,500": 2500, "2.500,75": 2500.75, "2,500.75": 2500.75, "2 500": 2500, "2500,5": 2500.5, "1500": 1500, "12.5": 12.5, "₡5.000": 5000, "0,99": 0.99, "1.234.567": 1234567, "": 0, "abc": 0, "1'250.50": 1250.5 };
  Object.entries(casos).forEach(([t, v]) => assert.equal(parsearMontoTexto(t), v, `"${t}"`));
});
test("fechas: ISO, con barras, con nombre de mes en español e inglés, y día que no existe", () => {
  ["24/10/2026", "2026-10-24", "24-10-26", "24 oct 2026", "24 de octubre de 2026", "Oct 24, 2026", "24 Oct. 2026", "24/10/2026 14:35"].forEach((t) => assert.equal(parsearFechaTexto(t, { hoy: HOY }), "2026-10-24", t));
  assert.equal(parsearFechaTexto("31/02/2026"), null); assert.equal(parsearFechaTexto("hola"), null); assert.equal(parsearFechaTexto(""), null);
  assert.equal(parsearFechaTexto("03/04/2026"), "2026-04-03"); assert.equal(parsearFechaTexto("03/04/2026", { orden: "mdy" }), "2026-03-04");
});
test("fecha sin año: usa el año de hoy, o el anterior si caería a más de un mes en el futuro", () => {
  assert.equal(parsearFechaTexto("24 oct", { hoy: HOY }), "2026-10-24"); assert.equal(parsearFechaTexto("3 dic", { hoy: HOY }), "2025-12-03"); assert.equal(parsearFechaTexto("20 nov", { hoy: HOY }), "2026-11-20");
});
test("el orden de día y mes se detecta por las pistas del archivo", () => {
  assert.equal(detectarOrdenFecha(["24/10/2026", "03/04/2026"]), "dmy"); assert.equal(detectarOrdenFecha(["10/24/2026", "03/04/2026"]), "mdy"); assert.equal(detectarOrdenFecha(["03/04/2026"]), "dmy"); assert.equal(detectarOrdenFecha([]), "dmy");
});
test("huella: ignora mayúsculas y tildes, distingue monto, fecha, tipo y meta; los ajustes distinguen el sentido", () => {
  const base = { tipo: "gasto", fecha: "2026-10-01", monto: 2500, nombre: "Almuerzo" };
  assert.equal(huellaMovimiento(base), huellaMovimiento({ ...base, nombre: "  ALMUÉRZO " }.nombre ? { ...base, nombre: "almuerzo" } : base));
  assert.equal(huellaMovimiento({ ...base, nombre: "Café" }), huellaMovimiento({ ...base, nombre: "CAFE" }));
  assert.notEqual(huellaMovimiento(base), huellaMovimiento({ ...base, monto: 2500.01 })); assert.notEqual(huellaMovimiento(base), huellaMovimiento({ ...base, tipo: "ingreso" }));
  assert.notEqual(huellaMovimiento({ tipo: "ajuste", sentido: "suma", monto: 5 }), huellaMovimiento({ tipo: "ajuste", sentido: "resta", monto: 5 }));
  assert.notEqual(huellaMovimiento({ tipo: "ahorro", monto: 5, metaId: "a" }), huellaMovimiento({ tipo: "ahorro", monto: 5, metaId: "b" }));
  assert.equal(hashTexto("x") === hashTexto("x") && hashTexto("x") !== hashTexto("y"), true);
});
test("tipos en varios idiomas y moneda distinta", () => {
  assert.equal(normalizarTipo("Egreso"), "gasto"); assert.equal(normalizarTipo("CRÉDITO"), "ingreso"); assert.equal(normalizarTipo("Savings"), "ahorro"); assert.equal(normalizarTipo("xyz"), null); assert.equal(normalizarTipo(""), null);
  assert.equal(compararMoneda("₡", "CRC"), "igual"); assert.equal(compararMoneda("USD", "USD"), "igual"); assert.equal(compararMoneda("$", "CRC"), "distinta"); assert.equal(compararMoneda("", "CRC"), "desconocida");
});

console.log("CSV");
test("lee comillas, separadores dentro de comillas, comillas dobles, saltos dentro de comillas, BOM y CRLF", () => {
  const t = '﻿a,b,c\r\n1,"x,y","di ""hola"""\r\n2,"línea1\nlínea2",z\r\n\r\n';
  const r = leerCsv(t);
  assert.deepEqual(r.filas, [["a", "b", "c"], ["1", "x,y", 'di "hola"'], ["2", "línea1\nlínea2", "z"]]);
});
test("detecta coma, punto y coma y tabulador, sin confundirse por separadores dentro de comillas", () => {
  assert.equal(detectarSeparador("a;b;c\n1;2;3"), ";"); assert.equal(detectarSeparador("a\tb\tc"), "\t"); assert.equal(detectarSeparador('a,b\n"1;2;3",x'), ","); assert.equal(detectarSeparador("solo una columna"), ",");
  assert.equal(detectarSeparador('"a;b";c;d'), ";");
});
test("escribir y leer de vuelta no cambia nada, ni con comas, comillas, saltos o espacios en los bordes", () => {
  const filas = [["id", "nombre"], ["1", 'Pan, "integral"'], ["2", "dos\nlíneas"], ["3", " con espacios "], ["4", ""]];
  [",", ";", "\t"].forEach((sep) => assert.deepEqual(leerCsv(escribirCsv(filas, { separador: sep }), { separador: sep }).filas.map((f) => f.length === 2 ? f : f), filas));
});
test("el límite de filas corta y avisa", () => {
  const t = "a,b\n" + Array.from({ length: 30 }, (_, i) => `${i},x`).join("\n");
  const r = leerCsv(t, { maxFilas: 10 }); assert.equal(r.filas.length, 10); assert.equal(r.truncado, true); assert.equal(leerCsv(t).truncado, false);
});
test("las celdas que una hoja ejecutaría como fórmula se neutralizan y se restauran", () => {
  ["=1+1", "+cmd", "-5", "@x", "\tx"].forEach((s) => { const n = neutralizarFormula(s); assert.equal(n[0], "'"); assert.equal(restaurarFormula(n), s); });
  assert.equal(neutralizarFormula("Almuerzo"), "Almuerzo"); assert.equal(restaurarFormula("'hola"), "'hola");
});
test("un archivo en Windows-1252 se lee con sus tildes", () => {
  const bytes = Uint8Array.from([0x44, 0x65, 0x70, 0xf3, 0x73, 0x69, 0x74, 0x6f]); // "Depósito" en Latin-1
  assert.equal(decodificarBytes(bytes), "Depósito"); assert.equal(decodificarBytes(new TextEncoder().encode("Depósito")), "Depósito");
});

console.log("Exportar");
test("el CSV trae sus columnas, sin recurrentes, con coma decimal si el separador es ; y neutraliza fórmulas", () => {
  const d = nuevo();
  d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "=SUMA(1;1)", monto: 1234.5, fechaRegistro: "2026-10-02", categoriaId: "cat_comida" }));
  d.movimientos.push(crearMovimiento({ tipo: "ingreso", nombre: "Mesada", monto: 5000, fechaRegistro: "2026-10-01" }));
  d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "Netflix", monto: 0, fechaRegistro: "2026-09-01", recurrente: { frecuencia: "mensual", fecha_inicio: "2026-09-01", monto_por_pago: 5000 } }));
  const e = exportarMovimientosCsv(d, { separador: ";", hoy: HOY });
  assert.equal(e.total, 2); assert.equal(e.recurrentesOmitidos, 1); assert.equal(e.nombreArchivo, "finanzas-movimientos-2026-10-24.csv");
  const filas = leerCsv(e.texto, { separador: ";" }).filas;
  assert.deepEqual(filas[0], ["id", "fecha", "tipo", "nombre", "monto", "categoria", "nota", "semestre", "meta", "fuente", "sentido", "origen", "pagado_con_meta"]);
  assert.equal(filas[1][1], "2026-10-01"); assert.equal(filas[2][3], "'=SUMA(1;1)"); assert.equal(filas[2][4], "1234,5"); assert.equal(filas[2][5], "Comida");
  assert.equal(exportarMovimientosCsv(d, { separador: "," , hoy: HOY }).texto.includes("1234.5"), true);
});
test("exportar e importar en una cuenta vacía deja los mismos movimientos, con los mismos ids y totales; y en la misma cuenta no hace nada", () => {
  const a = nuevo(); const meta = crearMeta({ nombre: "Viaje", objetivo: 100000 }); a.metas.push(meta);
  [crearMovimiento({ tipo: "gasto", nombre: "Almuerzo, \"rico\"", monto: 2500.5, fechaRegistro: "2026-10-01", categoriaId: "cat_comida", nota: "con\nsalto" }),
    crearMovimiento({ tipo: "ingreso", nombre: "Mesada", monto: 20000, fechaRegistro: "2026-10-02" }),
    crearMovimiento({ tipo: "ahorro", nombre: "Aporte", monto: 3000, fechaRegistro: "2026-10-03", metaId: meta.id, fuente: "nuevo" }),
    crearMovimiento({ tipo: "transferencia", nombre: "A la meta", monto: 1000, fechaRegistro: "2026-10-04", metaId: meta.id, sentido: "a_meta" }),
    crearMovimiento({ tipo: "ajuste", nombre: "Saldo inicial", monto: 500, fechaRegistro: "2026-10-05", sentido: "resta" }),
    crearMovimiento({ tipo: "gasto", nombre: "Pagado con meta", monto: 800, fechaRegistro: "2026-10-06", pagadoConMetaId: meta.id }),
  ].forEach((m) => a.movimientos.push(m));
  const csv = exportarMovimientosCsv(a, { hoy: HOY }).texto;
  const b = nuevo(); b.metas.push({ ...meta });
  const r = importar(b, csv);
  assert.equal(r.res.creados.length, 6);
  const clave = (m) => [m.id, m.tipo, m.nombre, m.monto, m.fecha_registro, String(m.nota || "").replace(/\s+/g, " "), m.meta_id, m.fuente, m.sentido, m.pagado_con_meta_id, m.categoria_id].join("|");
  assert.deepEqual(b.movimientos.map(clave).sort(), a.movimientos.map(clave).sort());
  assert.deepEqual(calcularTotalesMovimientos(b, HOY), calcularTotalesMovimientos(a, HOY));
  assert.equal(importar(a, csv).res.creados.length, 0); // en la misma cuenta: todo es repetido
});

console.log("Importar: leer y mapear");
test("encabezados en español e inglés, y débito y crédito en columnas aparte", () => {
  assert.deepEqual(detectarMapeo(["Date", "Description", "Amount"]), { fecha: 0, monto: 2, nombre: 1 });
  const m = detectarMapeo(["Fecha de movimiento", "Concepto", "Débito", "Crédito", "Saldo", "Número de referencia"]);
  assert.equal(m.fecha, 0); assert.equal(m.nombre, 1); assert.equal(m.debito, 2); assert.equal(m.credito, 3); assert.equal(m.referencia, 5); assert.equal(m.monto, undefined);
  assert.equal(mapeoSuficiente(m), true); assert.equal(mapeoSuficiente({ fecha: 0 }), false); assert.equal(mapeoSuficiente({ monto: 1 }), false);
});
test("archivos que no sirven dan un motivo claro", () => {
  assert.equal(prepararImportacion("").motivo, "vacio"); assert.equal(prepararImportacion("solo encabezado").motivo, "sin_filas");
  assert.equal(prepararImportacion("{roto").motivo, "json"); assert.equal(prepararImportacion('{"hola":1}').motivo, "formato"); assert.equal(prepararImportacion("x".repeat(2_000_001)).motivo, "muy_grande");
});
test("el signo manda cuando no hay columna de tipo: negativo es gasto y positivo, ingreso (o gasto si la persona lo elige)", () => {
  const d = nuevo();
  const prep = prepararImportacion(CSV_BASE, { hoy: HOY });
  assert.deepEqual(clasificarCandidatos(d, candidatosDeCsv(prep, { hoy: HOY })).map((c) => c.tipo), ["gasto", "gasto", "ingreso"]);
  const todoPositivo = prepararImportacion("Fecha,Detalle,Importe\n2026-10-01,Pan,500\n2026-10-02,Leche,900", { hoy: HOY });
  assert.deepEqual(clasificarCandidatos(d, candidatosDeCsv(todoPositivo, { signoPositivo: "gasto", hoy: HOY })).map((c) => c.tipo), ["gasto", "gasto"]);
  assert.deepEqual(clasificarCandidatos(d, candidatosDeCsv(todoPositivo, { hoy: HOY })).map((c) => c.tipo), ["ingreso", "ingreso"]);
});
test("débito y crédito, paréntesis como negativo, columna de tipo y fechas con barras día/mes", () => {
  const d = nuevo();
  const a = prepararImportacion("Fecha;Concepto;Débito;Crédito\n24/10/2026;Super;5.000,00;\n25/10/2026;Depósito;;12.500,00", { hoy: HOY });
  assert.deepEqual(clasificarCandidatos(d, candidatosDeCsv(a, { hoy: HOY })).map((c) => [c.tipo, c.monto, c.fecha]), [["gasto", 5000, "2026-10-24"], ["ingreso", 12500, "2026-10-25"]]);
  const b = prepararImportacion("Fecha,Concepto,Monto\n2026-10-01,Pan,(500.00)\n2026-10-02,Leche,-900", { hoy: HOY });
  assert.deepEqual(clasificarCandidatos(d, candidatosDeCsv(b, { hoy: HOY })).map((c) => [c.tipo, c.monto]), [["gasto", 500], ["gasto", 900]]);
  const c = prepararImportacion("Fecha,Concepto,Monto,Tipo\n2026-10-01,Pan,500,Egreso\n2026-10-02,Beca,9000,Ingreso\n2026-10-03,Raro,100,Otra cosa", { hoy: HOY });
  assert.deepEqual(clasificarCandidatos(d, candidatosDeCsv(c, { hoy: HOY })).map((x) => x.tipo), ["gasto", "ingreso", "ingreso"]);
});

console.log("Importar: no duplicar");
test("importar el mismo archivo dos veces no duplica nada", () => {
  const d = nuevo();
  const uno = importar(d, CSV_BASE); assert.equal(uno.res.creados.length, 3); assert.equal(d.movimientos.length, 3);
  const dos = importar(d, CSV_BASE); assert.equal(dos.res.creados.length, 0); assert.equal(d.movimientos.length, 3);
  assert.deepEqual(resumirCandidatos(dos.cands), { total: 3, nuevo: 0, parecido: 0, repetido: 3, eliminado: 0, invalido: 0, aImportar: 0 });
});
test("aplicar dos veces la misma selección no crea nada la segunda vez", () => {
  const d = nuevo(); const prep = prepararImportacion(CSV_BASE, { hoy: HOY });
  const cands = clasificarCandidatos(d, candidatosDeCsv(prep, { hoy: HOY }));
  assert.equal(aplicarImportacion(d, cands).creados.length, 3); const r2 = aplicarImportacion(d, cands); assert.equal(r2.creados.length, 0); assert.equal(r2.saltados, 3); assert.equal(d.movimientos.length, 3);
});
test("un movimiento parecido que ya registraste a mano se marca 'parecido' y no se importa por defecto", () => {
  const d = nuevo(); d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "almuerzo", monto: 2500, fechaRegistro: "2026-10-01" }));
  const cands = clasificarCandidatos(d, candidatosDeCsv(prepararImportacion(CSV_BASE, { hoy: HOY }), { hoy: HOY }));
  assert.deepEqual(cands.map((c) => c.estado), ["parecido", "nuevo", "nuevo"]); assert.equal(cands[0].incluir, false);
  assert.equal(aplicarImportacion(d, cands).creados.length, 2);
  cands[0].incluir = true; assert.equal(aplicarImportacion(d, cands).creados.length, 1); assert.equal(d.movimientos.length, 4); // la persona puede forzarlo
  assert.equal(importar(d, CSV_BASE).res.creados.length, 0); // y reimportar sigue sin duplicar
});
test("dos movimientos iguales el mismo día cuentan por cantidad: con 1 ya registrado entra 1; con ninguno entran 2", () => {
  const csv = "Fecha,Descripción,Monto\n2026-10-01,Café,-1000\n2026-10-01,Café,-1000";
  const a = nuevo(); a.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "Café", monto: 1000, fechaRegistro: "2026-10-01" }));
  assert.equal(importar(a, csv).res.creados.length, 1); assert.equal(a.movimientos.length, 2);
  const b = nuevo(); assert.equal(importar(b, csv).res.creados.length, 2); assert.equal(importar(b, csv).res.creados.length, 0); assert.equal(b.movimientos.length, 2);
});
test("dos archivos que se traslapan (extractos del 1 al 15 y del 10 al 25) no duplican lo del traslape", () => {
  const a = "Fecha,Descripción,Monto\n2026-10-01,A,-100\n2026-10-10,B,-200\n2026-10-12,C,-300";
  const b = "Fecha,Descripción,Monto\n2026-10-10,B,-200\n2026-10-12,C,-300\n2026-10-20,D,-400";
  const d = nuevo(); importar(d, a); const r = importar(d, b); assert.equal(r.res.creados.length, 1); assert.equal(d.movimientos.length, 4);
});
test("un archivo que luego trae un segundo movimiento igual: el primero es 'repetido' por su id y el segundo es nuevo, no 'parecido'", () => {
  const d = nuevo(); importar(d, "Fecha,Descripción,Monto\n2026-10-01,Café,-1000");
  const cands = clasificarCandidatos(d, candidatosDeCsv(prepararImportacion("Fecha,Descripción,Monto\n2026-10-01,Café,-1000\n2026-10-01,Café,-1000", { hoy: HOY }), { hoy: HOY }));
  assert.deepEqual(cands.map((c) => c.estado), ["repetido", "nuevo"]); assert.equal(aplicarImportacion(d, cands).creados.length, 1); assert.equal(d.movimientos.length, 2);
});
test("lo que borraste no vuelve solo: queda 'eliminado' y solo regresa si lo eliges, una sola vez", () => {
  const d = nuevo(); const uno = importar(d, CSV_BASE);
  quitarMovimiento(d, uno.res.creados[0]);
  const cands = clasificarCandidatos(d, candidatosDeCsv(prepararImportacion(CSV_BASE, { hoy: HOY }), { hoy: HOY }));
  assert.deepEqual(cands.map((c) => c.estado), ["eliminado", "repetido", "repetido"]); assert.equal(aplicarImportacion(d, cands).creados.length, 0); assert.equal(d.movimientos.length, 2);
  cands[0].incluir = true; const r = aplicarImportacion(d, cands); assert.equal(r.creados.length, 1); assert.equal(r.creados[0], cands[0].id + "_r1"); assert.equal(d.movimientos.length, 3);
  assert.equal(aplicarImportacion(d, cands).creados.length, 0); // aplicar otra vez no lo duplica
  assert.equal(clasificarCandidatos(d, candidatosDeCsv(prepararImportacion(CSV_BASE, { hoy: HOY }), { hoy: HOY }))[0].estado, "repetido"); // ya está presente
});
test("deshacer una importación quita lo creado, deja tumbas y no toca lo anterior", () => {
  const d = nuevo(); d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "Previo", monto: 10, fechaRegistro: "2026-09-01" }));
  const r = importar(d, CSV_BASE).res; assert.equal(d.movimientos.length, 4);
  assert.equal(deshacerImportacion(d, r.creados), 3); assert.equal(d.movimientos.length, 1); assert.equal(d.movimientos[0].nombre, "Previo");
  r.creados.forEach((id) => assert.ok(d._eliminados_movimientos.some((t) => t.id === id)));
});
test("el mismo número de referencia es el mismo movimiento, aunque cambie el nombre o la fecha; repetido dentro del archivo se salta", () => {
  const d = nuevo();
  importar(d, "Fecha,Descripción,Monto,Referencia\n2026-10-01,Super,-5000,A100\n2026-10-02,Otro,-300,A101\n2026-10-02,Otro,-300,A101");
  assert.equal(d.movimientos.length, 2);
  const r = importar(d, "Fecha,Descripción,Monto,Referencia\n2026-10-03,SUPER MERCADO,-5000,A100"); assert.equal(r.res.creados.length, 0); assert.equal(d.movimientos.length, 2);
  assert.equal(d.movimientos.find((m) => m.nombre === "Super").nota, "Ref. A100");
});

console.log("Importar: filas con problemas, categorías, módulos y moneda");
test("filas inválidas se marcan con su motivo y nunca se importan", () => {
  const csv = "Fecha,Descripción,Monto,Tipo,Meta\n,SinFecha,-100,,\n2026-10-01,SinMonto,,,\n2026-13-45,FechaMala,-5,,\n2026-10-01,Ahorro sin meta,500,Ahorro,Inexistente\n2026-10-01,Bien,-5,,";
  const d = nuevo(); const cands = clasificarCandidatos(d, candidatosDeCsv(prepararImportacion(csv, { hoy: HOY }), { hoy: HOY }));
  assert.deepEqual(cands.map((c) => [c.estado, c.motivo || ""]), [["invalido", "fecha"], ["invalido", "monto"], ["invalido", "fecha"], ["invalido", "meta"], ["nuevo", ""]]);
  cands.forEach((c) => { c.incluir = true; }); assert.equal(aplicarImportacion(d, cands).creados.length, 1);
});
test("las categorías se asignan por nombre (sin tildes ni mayúsculas), se crean una sola vez si faltan y no se crean si no quieres", () => {
  const csv = "Fecha,Descripción,Monto,Categoría\n2026-10-01,Pan,-500,COMIDA\n2026-10-02,Pasaje,-700,transporté\n2026-10-03,Pastilla,-900,Salud\n2026-10-04,Doctor,-2000,salud";
  const d = nuevo(); const r = importar(d, csv);
  assert.equal(r.res.categoriasCreadas, 1); assert.deepEqual(d.movimientos.map((m) => m.categoria_id), ["cat_comida", "cat_transporte", d.categorias_finanzas.find((c) => c.nombre === "Salud").id, d.categorias_finanzas.find((c) => c.nombre === "Salud").id]);
  const d2 = nuevo(); const prep = prepararImportacion(csv, { hoy: HOY });
  const sin = clasificarCandidatos(d2, candidatosDeCsv(prep, { hoy: HOY }), { crearCategorias: false }); aplicarImportacion(d2, sin);
  assert.equal(d2.categorias_finanzas.length, 4); assert.equal(d2.movimientos.filter((m) => m.categoria_id).length, 2);
});
test("una categoría archivada se sigue usando, y una de gasto no se asigna a un ingreso", () => {
  const d = nuevo(); archivarCategoriaFinanzas(d, "cat_comida");
  importar(d, "Fecha,Descripción,Monto,Categoría\n2026-10-01,Pan,-500,Comida\n2026-10-02,Beca,500,Comida");
  const pan = d.movimientos.find((m) => m.nombre === "Pan"), beca = d.movimientos.find((m) => m.nombre === "Beca");
  assert.equal(pan.categoria_id, "cat_comida"); assert.notEqual(beca.categoria_id, "cat_comida"); assert.equal(d.categorias_finanzas.find((c) => c.id === beca.categoria_id).tipo, "ingreso");
});
test("importar mueve Mi dinero bien: gastos restan, ingresos suman, un ajuste no cuenta como gasto ni ingreso, un ahorro va a su meta", () => {
  const d = nuevo(); const meta = crearMeta({ nombre: "Viaje", objetivo: 1 }); d.metas.push(meta);
  importar(d, "Fecha,Descripción,Monto,Tipo,Meta,Sentido\n2026-10-01,Pan,500,Gasto,,\n2026-10-02,Mesada,2000,Ingreso,,\n2026-10-03,Corrección,300,Ajuste,,suma\n2026-10-04,Aporte,400,Ahorro,Viaje,");
  const t = calcularTotalesMovimientos(d, HOY);
  assert.equal(t.totalGastado, 500); assert.equal(t.totalIngresos, 2000); assert.equal(t.saldoLiquido, 2000 - 500 + 300 - 400); assert.equal(t.enMetas, 400);
});
test("avisa cuando lo importado quedaría oculto por un módulo apagado, y cuando la moneda parece otra", () => {
  const d = nuevo(); d.configuracion.finanzas_modulos = { ...d.configuracion.finanzas_modulos, gastos: false };
  const prep = prepararImportacion("Fecha,Descripción,Monto\n2026-10-01,Pan,$-5.00", { hoy: HOY });
  const cands = clasificarCandidatos(d, candidatosDeCsv(prep, { hoy: HOY }));
  assert.deepEqual(advertenciasImportacion(d, cands).sort(), ["modulo_gastos", "moneda"]);
  const d2 = nuevo(); assert.deepEqual(advertenciasImportacion(d2, clasificarCandidatos(d2, candidatosDeCsv(prepararImportacion("Fecha,Descripción,Monto\n2026-10-01,Pan,₡-500", { hoy: HOY }), { hoy: HOY }))), []);
});
test("el nombre se limpia y recorta, y una celda con fórmula neutralizada vuelve igual", () => {
  const d = nuevo(); importar(d, `Fecha,Descripción,Monto,Nota\n2026-10-01,"  Pan   con\n  queso ${"x".repeat(100)}",-500,'=HIPERVINCULO()`);
  assert.equal(d.movimientos[0].nombre.length <= 80, true); assert.equal(d.movimientos[0].nombre.startsWith("Pan con queso"), true); assert.equal(d.movimientos[0].nota, "=HIPERVINCULO()");
});

console.log("Respaldo JSON");
test("el respaldo trae todo sin marcas internas y se vuelve a importar sin duplicar; en otra cuenta conserva recurrentes y filas sin fecha", () => {
  const a = nuevo();
  a.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "Sin fecha", monto: 100, fechaRegistro: null }));
  a.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "Netflix", monto: 0, fechaRegistro: "2026-09-01", recurrente: { frecuencia: "mensual", fecha_inicio: "2026-09-01", monto_por_pago: 5000, fecha_fin: null, personalizado: null } }));
  a.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "Pan", monto: 500, fechaRegistro: "2026-10-01", categoriaId: "cat_comida" }));
  const e = exportarRespaldoJson(a, { hoy: HOY }); const o = JSON.parse(e.texto);
  assert.equal(o.formato, "finanzas-respaldo"); assert.equal(o.movimientos.length, 3); assert.equal(JSON.stringify(o).includes("_actualizadoEn"), false); assert.equal(e.nombreArchivo, "finanzas-respaldo-2026-10-24.json");
  assert.equal(importar(a, e.texto).res.creados.length, 0);
  const b = nuevo(); const r = importar(b, e.texto); assert.equal(r.res.creados.length, 3);
  assert.equal(b.movimientos.find((m) => m.nombre === "Netflix").recurrente.monto_por_pago, 5000); assert.equal(b.movimientos.find((m) => m.nombre === "Sin fecha").fecha_registro, null);
  assert.equal(b.movimientos.find((m) => m.nombre === "Pan").categoria_id, "cat_comida");
  assert.deepEqual(calcularTotalesMovimientos(b, HOY), calcularTotalesMovimientos(a, HOY));
});
test("un respaldo de otra cuenta enlaza la categoría por nombre", () => {
  const a = nuevo(); const salud = crearCategoriaFinanzas(a, { nombre: "Salud" }).categoria; a.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "Doctor", monto: 9000, fechaRegistro: "2026-10-02", categoriaId: salud.id }));
  const b = nuevo(); importar(b, exportarRespaldoJson(a).texto);
  const cat = b.categorias_finanzas.find((c) => c.nombre === "Salud"); assert.ok(cat); assert.equal(b.movimientos[0].categoria_id, cat.id);
});
test("datos raros en un JSON no se cuelan: tipo inválido y recurrente sin frecuencia se rechazan o se ignoran", () => {
  const texto = JSON.stringify({ formato: "finanzas-respaldo", movimientos: [{ id: "mov_x1", tipo: "hackeo", monto: 5, fecha_registro: "2026-10-01" }, { id: "mov_x2", tipo: "gasto", monto: 5, fecha_registro: "2026-10-01", nombre: "Ok", recurrente: { evil: true } }, null, 7] });
  const d = nuevo(); const r = importar(d, texto); assert.equal(r.res.creados.length, 1); assert.equal(d.movimientos[0].recurrente, null);
});

console.log("Mensajes: plantillas y patrones");
test("la plantilla se valida: vacía, sin monto, demasiado general, huecos repetidos o desconocidos, llaves sueltas", () => {
  assert.equal(compilarPlantilla("").motivo, "vacia"); assert.equal(compilarPlantilla("Compra en {nombre}").motivo, "sin_monto"); assert.equal(compilarPlantilla("{monto}").motivo, "muy_general");
  assert.equal(compilarPlantilla("Pago {monto} y {monto}").motivo, "repetido"); assert.equal(compilarPlantilla("Pago {dinero}").motivo, "llaves"); assert.equal(compilarPlantilla("Pago {monto").motivo, "llaves");
  assert.equal(compilarPlantilla("x".repeat(301) + "{monto}").motivo, "larga"); assert.equal(compilarPlantilla("Compra {monto} {cualquiera} a {cualquiera} b {nombre} c {cualquiera}").motivo, "muchos");
  assert.equal(compilarPlantilla("Compra por {monto} en {nombre}").ok, true);
});
test("la plantilla ignora mayúsculas y tildes, y los espacios extra", () => {
  const r = leerConPlantilla("Débito por {monto} en {nombre}", "DEBITO   POR  ₡2.500,00 en Panadería Lola.", { hoy: HOY });
  assert.equal(r.monto, 2500); assert.equal(r.nombre, "Panadería Lola"); assert.equal(r.monedaToken, "₡");
});
test("lee monto con moneda antes o después, en cualquier estilo de miles y decimales", () => {
  const casos = [["Pagaste {monto} a {nombre}", "Pagaste CRC 12.500,00 a Juan", 12500, "CRC"], ["Pagaste {monto} a {nombre}", "Pagaste 12,500.50 USD a Juan", 12500.5, "USD"], ["Pagaste {monto} a {nombre}", "Pagaste $5 a Juan", 5, "$"], ["Pagaste {monto} a {nombre}", "Pagaste 7500 a Juan", 7500, ""]];
  casos.forEach(([p, t, m, mon]) => { const r = leerConPlantilla(p, t, { hoy: HOY }); assert.equal(r.monto, m, t); assert.equal(r.monedaToken, mon, t); });
});
test("{fecha}, {hora} y {ref}: la fecha se lee según el orden del patrón; sin fecha usa hoy y lo avisa", () => {
  const p = "Compra {monto} en {nombre} el {fecha} a las {hora} ref {ref}";
  const t = "Compra 5000 en Super X el 03/04/2026 a las 14:35 ref AB-123";
  const a = leerConPlantilla(p, t, { hoy: HOY, ordenFecha: "dmy" }), b = leerConPlantilla(p, t, { hoy: HOY, ordenFecha: "mdy" });
  assert.equal(a.fecha, "2026-04-03"); assert.equal(b.fecha, "2026-03-04"); assert.equal(a.referencia, "AB-123"); assert.equal(a.fechaInferida, false); assert.equal(a.nombre, "Super X");
  const sin = leerConPlantilla("Compra {monto} en {nombre}", "Compra 5000 en Super X", { hoy: HOY }); assert.equal(sin.fecha, HOY); assert.equal(sin.fechaInferida, true);
});
test("{nombre} al final toma hasta el fin de la línea; en medio, hasta el texto que sigue; sin nombre usa el nombre fijo", () => {
  assert.equal(leerConPlantilla("Recibiste {monto} de {nombre}", "Recibiste 5000 de María S.A.", { hoy: HOY }).nombre, "María S.A");
  assert.equal(leerConPlantilla("Compra {monto} en {nombre} con tarjeta", "Compra 5000 en Super X con tarjeta 1234", { hoy: HOY }).nombre, "Super X");
  assert.equal(leerConPlantilla("Transferencia recibida {monto}", "Transferencia recibida 5000", { hoy: HOY, nombreFijo: "Transferencia" }).nombre, "Transferencia");
});
test("no coincide si falta el texto fijo, y un monto en cero no cuenta", () => {
  assert.equal(leerConPlantilla("Compra por {monto} en {nombre}", "Pagaste 5000 a Juan", { hoy: HOY }), null);
  assert.equal(leerConPlantilla("Compra por {monto} en {nombre}", "Compra por 0 en Juan", { hoy: HOY }), null);
});
test("la plantilla sugerida desde un mensaje de ejemplo se vuelve a leer a sí misma y deja el nombre como hueco", () => {
  const ej = "Compra por ₡5.000,00 en SUPER LA ESQUINA con tarjeta terminada en 1234 el 24/10/2026 14:35. Ref 884412";
  const s = sugerirPlantilla(ej, { textoNombre: "SUPER LA ESQUINA" });
  assert.equal(s.ok, true); ["{monto}", "{nombre}", "{fecha}", "{hora}", "{ref}", "{cualquiera}"].forEach((h) => assert.ok(s.plantilla.includes(h), h));
  assert.equal(s.plantilla.includes("1234") || s.plantilla.includes("884412") || s.plantilla.includes("5.000"), false);
  const r = leerConPlantilla(s.plantilla, ej, { hoy: HOY }); assert.deepEqual([r.monto, r.nombre, r.fecha, r.referencia], [5000, "SUPER LA ESQUINA", "2026-10-24", "884412"]);
  const otro = leerConPlantilla(s.plantilla, "Compra por ₡1.250,50 en PANADERIA LOLA con tarjeta terminada en 9876 el 25/10/2026 09:05. Ref 112233", { hoy: HOY });
  assert.deepEqual([otro.monto, otro.nombre, otro.fecha], [1250.5, "PANADERIA LOLA", "2026-10-25"]);
});
test("crear, editar y eliminar patrones: valida, no repite, respeta categoría y tipo, deja tumba y tiene límite", () => {
  const d = nuevo();
  const a = crearPatron(d, { nombre: "Compra", plantilla: "Compra por {monto} en {nombre}", tipo: "gasto", categoriaId: "cat_comida" }); assert.equal(a.ok, true); assert.ok(a.patron._actualizadoEn); assert.equal(a.patron.activo, true);
  assert.equal(crearPatron(d, { nombre: "Otra", plantilla: "compra por {monto} en {nombre}", tipo: "gasto" }).motivo, "repetida");
  assert.equal(crearPatron(d, { nombre: "", plantilla: "Compra x {monto}", tipo: "gasto" }).motivo, "nombre"); assert.equal(crearPatron(d, { nombre: "x", plantilla: "Compra x {monto}", tipo: "otro" }).motivo, "tipo");
  assert.equal(crearPatron(d, { nombre: "x", plantilla: "Compra x {monto}", tipo: "ingreso", categoriaId: "cat_comida" }).motivo, "categoria"); assert.equal(crearPatron(d, { nombre: "x", plantilla: "{monto}", tipo: "gasto" }).detalle, "muy_general");
  assert.equal(editarPatron(d, a.patron.id, { plantilla: "Pago por {monto} a {nombre}", activo: false }).ok, true); assert.equal(listarPatrones(d, { incluirInactivos: false }).length, 0);
  assert.equal(editarPatron(d, "no", {}).motivo, "patron");
  assert.equal(eliminarPatron(d, a.patron.id).ok, true); assert.equal(d.patrones_mensajes.length, 0); assert.ok(d._eliminados_patrones_mensajes.some((t) => t.id === a.patron.id));
  for (let i = 0; i < MAX_PATRONES; i++) assert.equal(crearPatron(d, { nombre: "p" + i, plantilla: `Aviso numero ${i} por {monto}`, tipo: "gasto" }).ok, true);
  assert.equal(crearPatron(d, { nombre: "extra", plantilla: "Aviso extra por {monto}", tipo: "gasto" }).motivo, "limite");
});

console.log("Mensajes: lectura general y varios mensajes");
test("lectura general: monto con moneda, tipo por palabras, nombre, fecha y referencia; el saldo no se confunde con el monto", () => {
  const r = leerMensajeGenerico("Compra por ₡5.000,00 en SUPER LA ESQUINA con tarjeta el 24/10/2026 14:35. Ref 884412. Saldo disponible ₡120.000,00", { hoy: HOY });
  assert.deepEqual([r.monto, r.tipo, r.nombre, r.fecha, r.referencia, r.advertencias], [5000, "gasto", "SUPER LA ESQUINA", "2026-10-24", "884412", []]);
  const i = leerMensajeGenerico("Recibiste $20.50 de Juan Perez", { hoy: HOY }); assert.deepEqual([i.monto, i.tipo, i.nombre, i.monedaToken], [20.5, "ingreso", "Juan Perez", "$"]); assert.deepEqual(i.advertencias, ["fecha_inferida"]);
});
test("lectura general: sin palabras claras el tipo queda sin decidir; una fecha o una hora no se toman por monto", () => {
  const r = leerMensajeGenerico("Movimiento 2.500 en Panadería Lola", { hoy: HOY }); assert.equal(r.tipo, null); assert.ok(r.advertencias.includes("tipo_incierto"));
  const t = leerMensajeGenerico("Compra a las 14:35 del 24/10/2026 por 3.200 en Tienda", { hoy: HOY }); assert.equal(t.monto, 3200); assert.equal(t.fecha, "2026-10-24");
  assert.equal(leerMensajeGenerico("hola, ¿cómo estás?", { hoy: HOY }), null); assert.equal(leerMensajeGenerico("tarjeta terminada en ****1234", { hoy: HOY }), null);
  assert.equal(leerMensajeGenerico("Compra con tarjeta de crédito por 5000 en Tienda", { hoy: HOY }).tipo, "gasto");
});
test("lectura general: avisa si hay varios montos distintos", () => {
  const r = leerMensajeGenerico("Pagaste ₡5.000 y ₡700 de comisión a Netflix", { hoy: HOY }); assert.ok(r.advertencias.includes("varios_montos")); assert.deepEqual(r.montosEncontrados, [5000, 700]);
});
test("varios mensajes pegados juntos se separan por línea en blanco, y los vacíos se ignoran", () => {
  assert.deepEqual(separarMensajes("uno\ndos\n\n\n  \ntres\r\n\r\ncuatro"), ["uno\ndos", "tres", "cuatro"]); assert.deepEqual(separarMensajes("   "), []);
  assert.equal(separarMensajes(Array.from({ length: 150 }, (_, i) => "m" + i).join("\n\n")).length, 100);
});
test("un patrón ganador tiene prioridad sobre la lectura general, el más específico gana, y uno apagado no se usa", () => {
  const d = nuevo();
  crearPatron(d, { nombre: "General", plantilla: "Compra por {monto}", tipo: "gasto" }); const esp = crearPatron(d, { nombre: "Específico", plantilla: "Compra por {monto} en {nombre} con tarjeta", tipo: "gasto", categoriaId: "cat_comida" }).patron;
  const [a] = leerMensajes(d, "Compra por ₡5.000 en Super X con tarjeta 1234", { hoy: HOY }); assert.equal(a.lectura, "patron"); assert.equal(a.patronNombre, "Específico"); assert.equal(a.categoriaId, "cat_comida"); assert.equal(a.nombre, "Super X");
  editarPatron(d, esp.id, { activo: false }); assert.equal(leerMensajes(d, "Compra por ₡5.000 en Super X con tarjeta 1234", { hoy: HOY })[0].patronNombre, "General");
  assert.equal(leerMensajes(d, "Recibiste $20 de Ana", { hoy: HOY })[0].lectura, "general"); assert.equal(leerMensajes(d, "buenos días", { hoy: HOY })[0].lectura, "ninguna");
});
test("los mensajes se importan por el mismo camino: sin duplicar si los pegas otra vez, y con la categoría sugerida por tu historial", () => {
  const d = nuevo();
  crearPatron(d, { nombre: "Compra", plantilla: "Compra por {monto} en {nombre} el {fecha} ref {ref}", tipo: "gasto" });
  [1, 2].forEach((i) => d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "Bus", monto: 600, fechaRegistro: `2026-10-0${i}`, categoriaId: "cat_transporte" })));
  const texto = "Compra por ₡5.000 en Super X el 24/10/2026 ref A1B2C\n\nCompra por ₡700 en Bus el 24/10/2026 ref A2B3C\n\nRecibiste ₡9.000 de Mamá el 24/10/2026";
  const c = clasificarCandidatos(d, leerMensajes(d, texto, { hoy: HOY }));
  assert.deepEqual(c.map((x) => x.estado), ["nuevo", "nuevo", "nuevo"]); assert.equal(c[1].categoriaId, "cat_transporte"); assert.equal(c[0].categoriaId, null);
  assert.equal(aplicarImportacion(d, c).creados.length, 3);
  assert.deepEqual(clasificarCandidatos(d, leerMensajes(d, texto, { hoy: HOY })).map((x) => x.estado), ["repetido", "repetido", "repetido"]);
});
test("un mensaje con tipo seguro y sin patrón se guarda, y pegarlo otra vez no lo duplica", () => {
  const d = nuevo(); const texto = "Recibiste ₡9.000 de Mamá el 24/10/2026\n\nPagaste ₡700 a Bus el 24/10/2026";
  const c1 = clasificarCandidatos(d, leerMensajes(d, texto, { hoy: HOY })); assert.deepEqual(c1.map((x) => [x.tipo, x.monto, x.nombre, x.estado]), [["ingreso", 9000, "Mamá", "nuevo"], ["gasto", 700, "Bus", "nuevo"]]);
  assert.equal(aplicarImportacion(d, c1).creados.length, 2);
  assert.deepEqual(clasificarCandidatos(d, leerMensajes(d, texto, { hoy: HOY })).map((x) => x.estado), ["repetido", "repetido"]);
});
test("el texto del mensaje nunca se guarda: ni en el movimiento ni en nada de los datos; solo 'Ref. …'", () => {
  const d = nuevo(); crearPatron(d, { nombre: "C", plantilla: "Compra por {monto} en {nombre} cuenta 99887766 ref {ref}", tipo: "gasto" });
  const c = clasificarCandidatos(d, leerMensajes(d, "Compra por ₡5.000 en Super X cuenta 99887766 ref Z9Z9Z", { hoy: HOY })); aplicarImportacion(d, c);
  const volcado = JSON.stringify(d.movimientos); assert.equal(volcado.includes("textoOriginal"), false); assert.equal(volcado.includes("cuenta 99887766"), false); assert.equal(d.movimientos[0].nota, "Ref. Z9Z9Z");
  const sinRef = clasificarCandidatos(d, leerMensajes(d, "Pagaste ₡700 a Bus el 24/10/2026, cuenta 11223344", { hoy: HOY })); aplicarImportacion(d, sinRef);
  assert.equal(d.movimientos.at(-1).nota, null); assert.equal(JSON.stringify(d.movimientos).includes("11223344"), false);
});
test("un mensaje en otra moneda avisa y no convierte nada", () => {
  const d = nuevo(); const c = clasificarCandidatos(d, leerMensajes(d, "Pagaste $15.99 a Netflix el 24/10/2026", { hoy: HOY }));
  assert.ok(c[0].advertencias.includes("moneda")); assert.equal(c[0].monto, 15.99); assert.ok(advertenciasImportacion(d, c).includes("moneda"));
});
test("el tiempo de lectura se mantiene bajo aunque el mensaje y la plantilla sean molestos", () => {
  const t0 = Date.now();
  leerConPlantilla("a {cualquiera} a {cualquiera} b {nombre} {monto}", "a ".repeat(290), { hoy: HOY });
  leerConPlantilla("x {cualquiera} y {cualquiera} z {nombre} w {monto}", "x y z w ".repeat(70), { hoy: HOY });
  leerMensajeGenerico("1 ".repeat(290), { hoy: HOY }); leerMensajeGenerico("9".repeat(600), { hoy: HOY }); sugerirPlantilla("1,2.3 ".repeat(100));
  assert.ok(Date.now() - t0 < 1500, `tardó ${Date.now() - t0} ms`);
});


console.log("Archivo con varias tablas");
test("usa solo la tabla de movimientos, deja fuera lo no pagado y lee la moneda de su columna", () => {
  const txt = "Format version,Period,User ID\n1,01-04-2025..30-04-2025,anonymous\n\n###\n\nDate,Payment,Is paid,Amount,Currency,Category,Description\n25-04-2025,Electricity bill,true,-20,USD,House,Bill\n26-04-2025,Gym,false,-10,USD,House,x\n\n###\n\nAccount,Account Balance,Currency\nCard,100,USD\n";
  const prep = prepararImportacion(txt, { hoy: "2026-10-25" }); assert.equal(prep.ok, true); assert.equal(prep.secciones, 3); assert.equal(prep.omitidas, 1);
  const c = candidatosDeCsv(prep, { hoy: "2026-10-25" }); assert.equal(c.length, 1);
  assert.equal(c[0].monto, 20); assert.equal(c[0].tipo, "gasto"); assert.equal(c[0].nombre, "Electricity bill"); assert.equal(c[0].fecha, "2025-04-25"); assert.equal(c[0].monedaToken, "USD");
});
test("un CSV normal sigue igual (una sola sección, nada omitido)", () => {
  const prep = prepararImportacion("Fecha,Descripción,Monto\n2026-10-01,Almuerzo,-2500", { hoy: "2026-10-25" }); assert.equal(prep.secciones, 1); assert.equal(prep.omitidas, 0);
});

console.log(`\n${ok} pruebas de lógica OK`);
