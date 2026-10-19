var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/web-push.js
function b64urlABuffer(b64url) {
  let s = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const binario = atob(s);
  const buf = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) buf[i] = binario.charCodeAt(i);
  return buf;
}
__name(b64urlABuffer, "b64urlABuffer");
function bufferAB64url(buf) {
  let binario = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(bufferAB64url, "bufferAB64url");
function concatBuffers(...partes) {
  const largoTotal = partes.reduce((acc, p) => acc + p.length, 0);
  const resultado = new Uint8Array(largoTotal);
  let offset = 0;
  for (const p of partes) {
    resultado.set(p, offset);
    offset += p.length;
  }
  return resultado;
}
__name(concatBuffers, "concatBuffers");
async function hkdf(salt, ikm, info, largoBytes) {
  const claveBase = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    claveBase,
    largoBytes * 8
  );
  return new Uint8Array(bits);
}
__name(hkdf, "hkdf");
async function firmarJwtVapid({ audiencia, subject, clavePublicaB64url, clavePrivadaB64url }) {
  const pubRaw = b64urlABuffer(clavePublicaB64url);
  const x = pubRaw.slice(1, 33);
  const y = pubRaw.slice(33, 65);
  const d = b64urlABuffer(clavePrivadaB64url);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: bufferAB64url(x),
    y: bufferAB64url(y),
    d: bufferAB64url(d),
    ext: true
  };
  const clavePrivada = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const encabezado = { typ: "JWT", alg: "ES256" };
  const ahora = Math.floor(Date.now() / 1e3);
  const payload = { aud: audiencia, exp: ahora + 12 * 60 * 60, sub: subject };
  const encabezadoB64 = bufferAB64url(new TextEncoder().encode(JSON.stringify(encabezado)));
  const payloadB64 = bufferAB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const datosAFirmar = new TextEncoder().encode(`${encabezadoB64}.${payloadB64}`);
  const firmaBuf = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, clavePrivada, datosAFirmar);
  const firmaB64 = bufferAB64url(firmaBuf);
  return `${encabezadoB64}.${payloadB64}.${firmaB64}`;
}
__name(firmarJwtVapid, "firmarJwtVapid");
async function cifrarPayloadWebPush(suscripcionKeys, payloadObjeto) {
  const userPublicRaw = b64urlABuffer(suscripcionKeys.p256dh);
  const authSecret = b64urlABuffer(suscripcionKeys.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const parEfimero = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", parEfimero.publicKey));
  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    userPublicRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const secretoCompartido = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey }, parEfimero.privateKey, 256)
  );
  const infoAuth = concatBuffers(
    new TextEncoder().encode("WebPush: info\0"),
    userPublicRaw,
    asPublicRaw
  );
  const prk = await hkdf(authSecret, secretoCompartido, infoAuth, 32);
  const cek = await hkdf(salt, prk, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
  const plaintext = new TextEncoder().encode(JSON.stringify(payloadObjeto));
  const padded = concatBuffers(plaintext, new Uint8Array([2]));
  const claveAes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, claveAes, padded));
  const recordSize = 4096;
  const cabecera = new Uint8Array(16 + 4 + 1 + asPublicRaw.length);
  cabecera.set(salt, 0);
  new DataView(cabecera.buffer).setUint32(16, recordSize, false);
  cabecera[20] = asPublicRaw.length;
  cabecera.set(asPublicRaw, 21);
  return concatBuffers(cabecera, ciphertext);
}
__name(cifrarPayloadWebPush, "cifrarPayloadWebPush");
async function enviarWebPush({ suscripcion, payloadObjeto, vapidPublicKey, vapidPrivateKey, vapidSubject }) {
  const endpointUrl = new URL(suscripcion.endpoint);
  const audiencia = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const jwt = await firmarJwtVapid({
    audiencia,
    subject: vapidSubject,
    clavePublicaB64url: vapidPublicKey,
    clavePrivadaB64url: vapidPrivateKey
  });
  const body = await cifrarPayloadWebPush(suscripcion.keys, payloadObjeto);
  const respuesta = await fetch(suscripcion.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      // 24h: si el dispositivo está offline, el push service
      // reintenta entregarlo hasta ese tiempo antes de descartarlo.
      Authorization: `vapid t=${jwt}, k=${vapidPublicKey}`
    },
    body
  });
  return respuesta;
}
__name(enviarWebPush, "enviarWebPush");

// src/index.js
var ORIGEN_PERMITIDO = "https://waxyflounder971.github.io";
var TOPE_ENVIOS_POR_CORRIDA = 40;
function encabezadosCors(origen) {
  const permitido = origen === ORIGEN_PERMITIDO;
  return {
    "Access-Control-Allow-Origin": permitido ? origen : "null",
    "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
__name(encabezadosCors, "encabezadosCors");
function respuestaJson(cuerpo, status, origen) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json", ...encabezadosCors(origen) }
  });
}
__name(respuestaJson, "respuestaJson");
async function manejarProgramar(request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inv\xE1lido (se esperaba JSON)." }, 400, origen);
  }
  const { id, suscripcion_push, fecha_hora_utc, titulo, cuerpo } = body || {};
  if (!id || typeof id !== "string" || !suscripcion_push || typeof suscripcion_push !== "object" || !suscripcion_push.endpoint || !Number.isFinite(fecha_hora_utc) || !titulo || typeof titulo !== "string") {
    return respuestaJson(
      { error: "Faltan campos requeridos: id, suscripcion_push (con endpoint), fecha_hora_utc, titulo." },
      400,
      origen
    );
  }
  await env.DB_NOTIFICACIONES.prepare(
    `INSERT INTO recordatorios (id, suscripcion_push, fecha_hora_utc, titulo, cuerpo, enviado)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       suscripcion_push = excluded.suscripcion_push,
       fecha_hora_utc = excluded.fecha_hora_utc,
       titulo = excluded.titulo,
       cuerpo = excluded.cuerpo,
       enviado = 0`
  ).bind(id, JSON.stringify(suscripcion_push), Math.floor(fecha_hora_utc), titulo, cuerpo || null).run();
  return respuestaJson({ ok: true }, 200, origen);
}
__name(manejarProgramar, "manejarProgramar");
async function manejarCancelar(id, env, origen) {
  if (!id) return respuestaJson({ error: "Falta el id en la URL." }, 400, origen);
  await env.DB_NOTIFICACIONES.prepare(`DELETE FROM recordatorios WHERE id = ?`).bind(id).run();
  return respuestaJson({ ok: true }, 200, origen);
}
__name(manejarCancelar, "manejarCancelar");
async function manejarPrueba(request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inv\xE1lido (se esperaba JSON)." }, 400, origen);
  }
  const { suscripcion_push } = body || {};
  if (!suscripcion_push || typeof suscripcion_push !== "object" || !suscripcion_push.endpoint) {
    return respuestaJson({ error: "Falta suscripcion_push (con endpoint)." }, 400, origen);
  }
  try {
    const respuesta = await enviarWebPush({
      suscripcion: suscripcion_push,
      payloadObjeto: {
        titulo: "\xA1Notificaciones activadas! \u{1F389}",
        cuerpo: "Todo qued\xF3 bien configurado \u2014 as\xED se van a ver tus recordatorios reales de Agenda."
      },
      vapidPublicKey: env.VAPID_CLAVE_PUBLICA,
      vapidPrivateKey: env.VAPID_CLAVE_PRIVADA,
      vapidSubject: env.VAPID_SUBJECT
    });
    if (respuesta.ok) return respuestaJson({ ok: true }, 200, origen);
    return respuestaJson({ ok: false, error: `El servicio de push devolvi\xF3 status ${respuesta.status}.` }, 502, origen);
  } catch (e) {
    return respuestaJson({ ok: false, error: "No se pudo cifrar/enviar el push de prueba." }, 502, origen);
  }
}
__name(manejarPrueba, "manejarPrueba");
async function enviarRecordatorio(fila, env) {
  const suscripcion = JSON.parse(fila.suscripcion_push);
  try {
    const respuesta = await enviarWebPush({
      suscripcion,
      payloadObjeto: { titulo: fila.titulo, cuerpo: fila.cuerpo || "" },
      vapidPublicKey: env.VAPID_CLAVE_PUBLICA,
      vapidPrivateKey: env.VAPID_CLAVE_PRIVADA,
      vapidSubject: env.VAPID_SUBJECT
    });
    if (respuesta.ok) return "enviado";
    if (respuesta.status === 404 || respuesta.status === 410) return "suscripcion_muerta";
    console.warn(`Push de "${fila.id}" fall\xF3 con status ${respuesta.status}, se reintenta en la pr\xF3xima corrida.`);
    return "reintentar";
  } catch (e) {
    console.warn(`Push de "${fila.id}" fall\xF3 (excepci\xF3n), se reintenta en la pr\xF3xima corrida:`, e);
    return "reintentar";
  }
}
__name(enviarRecordatorio, "enviarRecordatorio");
async function manejadorProgramado(env) {
  const ahora = Math.floor(Date.now() / 1e3);
  const { results } = await env.DB_NOTIFICACIONES.prepare(
    `SELECT id, suscripcion_push, titulo, cuerpo FROM recordatorios
     WHERE enviado = 0 AND fecha_hora_utc <= ?
     ORDER BY fecha_hora_utc ASC
     LIMIT ?`
  ).bind(ahora, TOPE_ENVIOS_POR_CORRIDA).all();
  if (!results || results.length === 0) return;
  for (const fila of results) {
    const resultado = await enviarRecordatorio(fila, env);
    if (resultado === "enviado" || resultado === "suscripcion_muerta") {
      await env.DB_NOTIFICACIONES.prepare(`DELETE FROM recordatorios WHERE id = ?`).bind(fila.id).run();
    }
  }
}
__name(manejadorProgramado, "manejadorProgramado");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origen = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: encabezadosCors(origen) });
    }
    if (origen !== ORIGEN_PERMITIDO) {
      return respuestaJson({ error: "Origen no permitido." }, 403, origen);
    }
    if (request.method === "POST" && url.pathname === "/programar") {
      return manejarProgramar(request, env, origen);
    }
    if (request.method === "POST" && url.pathname === "/prueba") {
      return manejarPrueba(request, env, origen);
    }
    const matchCancelar = url.pathname.match(/^\/programar\/(.+)$/);
    if (request.method === "DELETE" && matchCancelar) {
      return manejarCancelar(decodeURIComponent(matchCancelar[1]), env, origen);
    }
    return respuestaJson({ error: "Not found." }, 404, origen);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(manejadorProgramado(env));
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
