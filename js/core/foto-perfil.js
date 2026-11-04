/* =========================================================================
   Foto de perfil personalizada (2026-11-04)
   Por defecto se usa la foto de la cuenta de Google (`perfil.foto_url`, que se vuelve a escribir en
   cada inicio de sesión). Si la persona elige otra, se guarda recortada y reducida como imagen en
   `perfil.foto_personalizada` (data URL JPEG) y tiene prioridad. Quitarla vuelve a la de Google.
   ========================================================================= */
import { estado } from "./storage/storage.js";
import { marcarCambioPendiente } from "./storage/storage-sync.js";
import { sellarTimestamp } from "./schema.js";
import { MODO_DEMO } from "./demo-mode.js";

const LADO_FOTO_PERFIL = 256;
const MAX_BYTES_ARCHIVO = 15 * 1024 * 1024;

/** URL de la foto que se debe mostrar: la elegida por la persona o, si no hay, la de Google. */
export function obtenerFotoPerfil(perfil = estado.datos?.perfil) {
  if (!perfil) return "";
  return perfil.foto_personalizada || perfil.foto_url || "";
}

/** Recorta al centro en cuadrado, reduce a 256 px y devuelve un data URL JPEG liviano (~20 KB). */
export function prepararFotoPerfil(archivo) {
  return new Promise((resolver, rechazar) => {
    if (!archivo || !/^image\//.test(archivo.type)) { rechazar(new Error("Elige un archivo de imagen.")); return; }
    if (archivo.size > MAX_BYTES_ARCHIVO) { rechazar(new Error("La imagen es demasiado grande.")); return; }
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      try {
        const lado = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - lado) / 2;
        const sy = (img.naturalHeight - lado) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = LADO_FOTO_PERFIL;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; // los PNG transparentes no quedan negros al pasar a JPEG
        ctx.fillRect(0, 0, LADO_FOTO_PERFIL, LADO_FOTO_PERFIL);
        ctx.drawImage(img, sx, sy, lado, lado, 0, 0, LADO_FOTO_PERFIL, LADO_FOTO_PERFIL);
        resolver(canvas.toDataURL("image/jpeg", 0.86));
      } catch (e) { rechazar(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); rechazar(new Error("No se pudo leer la imagen.")); };
    img.src = url;
  });
}

/** Guarda (o, con `null`, quita) la foto personalizada y repinta todo lo que muestra el perfil. */
export function guardarFotoPersonalizada(dataUrl) {
  if (!estado.datos) return;
  estado.datos.perfil = estado.datos.perfil || {};
  if (dataUrl) estado.datos.perfil.foto_personalizada = dataUrl;
  else delete estado.datos.perfil.foto_personalizada;
  if (!MODO_DEMO) {
    sellarTimestamp(estado.datos.perfil);
    marcarCambioPendiente();
  }
  window.renderizarPerfil?.();
  window.renderizarUsuarioAjustes?.();
}

/** Abre el selector de archivos y guarda la foto elegida. `alTerminar(ok, error)` es opcional. */
export function elegirYGuardarFotoPerfil(alTerminar) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", async () => {
    const archivo = input.files && input.files[0];
    if (!archivo) return;
    try {
      guardarFotoPersonalizada(await prepararFotoPerfil(archivo));
      alTerminar?.(true);
    } catch (e) { alTerminar?.(false, e); }
  });
  input.click();
}
