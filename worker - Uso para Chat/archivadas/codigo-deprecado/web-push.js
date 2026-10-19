/* =========================================================================
   web-push.js — Cifrado y firma para enviar Web Push estándar
   -------------------------------------------------------------------------
   Implementación mínima de:
     - RFC 8291 (Message Encryption for Web Push, esquema "aes128gcm")
     - RFC 8292 (VAPID: Voluntary Application Server Identification)

   Escrita 100% sobre la Web Crypto API nativa (globalThis.crypto.subtle),
   que Cloudflare Workers soporta sin instalar nada — se evita a propósito
   la librería npm "web-push" porque depende de módulos de Node (crypto,
   http, https) que no corren en el runtime de Workers. No hay ninguna
   dependencia externa en este archivo.

   Referencia de los pasos (para quien audite esto más adelante):
   https://datatracker.ietf.org/doc/html/rfc8291
   https://datatracker.ietf.org/doc/html/rfc8292
   ========================================================================= */

function b64urlABuffer(b64url) {
  let s = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const binario = atob(s);
  const buf = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) buf[i] = binario.charCodeAt(i);
  return buf;
}

function bufferAB64url(buf) {
  let binario = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

/** HKDF (RFC 5869) sobre Web Crypto, devuelve `largoBytes` bytes derivados. */
async function hkdf(salt, ikm, info, largoBytes) {
  const claveBase = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    claveBase,
    largoBytes * 8
  );
  return new Uint8Array(bits);
}

/**
 * Firma un JWT VAPID (ES256) a partir de las claves VAPID crudas (raw,
 * base64url) tal como las genera `wrangler` / el script de setup: clave
 * pública sin comprimir (65 bytes: 0x04 + X + Y) y clave privada como
 * escalar crudo (32 bytes).
 */
async function firmarJwtVapid({ audiencia, subject, clavePublicaB64url, clavePrivadaB64url }) {
  const pubRaw = b64urlABuffer(clavePublicaB64url); // 65 bytes: 0x04 || X || Y
  const x = pubRaw.slice(1, 33);
  const y = pubRaw.slice(33, 65);
  const d = b64urlABuffer(clavePrivadaB64url); // 32 bytes

  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: bufferAB64url(x),
    y: bufferAB64url(y),
    d: bufferAB64url(d),
    ext: true,
  };

  const clavePrivada = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const encabezado = { typ: "JWT", alg: "ES256" };
  const ahora = Math.floor(Date.now() / 1000);
  const payload = { aud: audiencia, exp: ahora + 12 * 60 * 60, sub: subject };

  const encabezadoB64 = bufferAB64url(new TextEncoder().encode(JSON.stringify(encabezado)));
  const payloadB64 = bufferAB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const datosAFirmar = new TextEncoder().encode(`${encabezadoB64}.${payloadB64}`);

  // Web Crypto firma ECDSA en formato "raw" (r || s, 64 bytes) — es
  // exactamente el formato que espera un JWT ES256, sin conversión DER de
  // por medio.
  const firmaBuf = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, clavePrivada, datosAFirmar);
  const firmaB64 = bufferAB64url(firmaBuf);

  return `${encabezadoB64}.${payloadB64}.${firmaB64}`;
}

/**
 * Cifra `payloadObjeto` (se serializa a JSON) siguiendo RFC 8291
 * ("aes128gcm") para la suscripción push dada (`{ p256dh, auth }`, tal
 * cual llegan en `PushSubscription.toJSON().keys`). Devuelve el body
 * binario listo para mandar en el POST al endpoint del push service.
 */
async function cifrarPayloadWebPush(suscripcionKeys, payloadObjeto) {
  const userPublicRaw = b64urlABuffer(suscripcionKeys.p256dh); // 65 bytes
  const authSecret = b64urlABuffer(suscripcionKeys.auth); // 16 bytes

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
  // Delimitador de fin de registro (0x02) — no se usa padding extra acá
  // (el mensaje es corto, un solo registro alcanza siempre).
  const padded = concatBuffers(plaintext, new Uint8Array([0x02]));

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

/**
 * Envía un push real a una suscripción. Lanza si el push service responde
 * con error; el llamador (index.js) decide qué hacer con cada status
 * (410/404 = suscripción muerta, limpiar; otros = error transitorio).
 */
async function enviarWebPush({ suscripcion, payloadObjeto, vapidPublicKey, vapidPrivateKey, vapidSubject }) {
  const endpointUrl = new URL(suscripcion.endpoint);
  const audiencia = `${endpointUrl.protocol}//${endpointUrl.host}`;

  const jwt = await firmarJwtVapid({
    audiencia,
    subject: vapidSubject,
    clavePublicaB64url: vapidPublicKey,
    clavePrivadaB64url: vapidPrivateKey,
  });

  const body = await cifrarPayloadWebPush(suscripcion.keys, payloadObjeto);

  const respuesta = await fetch(suscripcion.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "86400", // 24h: si el dispositivo está offline, el push service
      // reintenta entregarlo hasta ese tiempo antes de descartarlo.
      Authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
    },
    body,
  });

  return respuesta;
}

export { enviarWebPush };
