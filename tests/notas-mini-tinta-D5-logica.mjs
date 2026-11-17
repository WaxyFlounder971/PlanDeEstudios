// Regresión D5: la miniatura prioriza el ancho observado y solo usa un respaldo de un solo pintado.
import assert from "node:assert/strict";
import fs from "node:fs";
const s=fs.readFileSync(new URL("../js/notas/notas-tinta.js",import.meta.url),"utf8");
const b=s.slice(s.indexOf("function crearMiniTinta"),s.indexOf("export { crearCapaTinta"));
assert.ok(b.includes("let pintado = false")); assert.ok(b.includes("new ResizeObserver")); assert.ok(b.includes("pintarAncho(ancho)"));
assert.ok(b.includes("requestAnimationFrame(() => requestAnimationFrame")); assert.ok(b.includes("pintar(360 * (window.devicePixelRatio || 1))"));
assert.ok(b.includes("observador.disconnect()")); assert.equal((b.match(/pintar\(360 \* \(window\.devicePixelRatio \|\| 1\)\)/g)||[]).length,2);
console.log("  ✓ D5: un pintado con ancho medido o un único respaldo");
