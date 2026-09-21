// ════════════════════════════════════════════════════════
// gowd-proxy — la única puerta por la que Lincoin habla con el banco de Brasil.
//
// POR QUE EXISTE (dos razones, y la segunda es la que manda)
//
//   1. IP FIJA. Gowd registra una IP de origen. Nuestras funciones corren en
//      infraestructura serverless, donde la IP de salida cambia entre una
//      llamada y otra: no hay un número que darles. Esto vive en una red
//      privada cuya salida pasa por un NAT con IP fija.
//
//   2. mTLS. Gowd exige TLS mutuo: la conexión no se abre si el cliente no
//      presenta un certificado (un .pfx que ellos emiten). Una edge function
//      de Supabase NO PUEDE hacer eso — su fetch no expone el certificado de
//      cliente. O sea que aunque la IP no importara, esta pieza seguiría
//      siendo obligatoria. No es un rodeo: es el único camino.
//
//   Lincoin → (este proxy, con el certificado) → NAT con IP fija → Gowd
//
// EL TOKEN SE ACUÑA ACA, NO EN LINCOIN
//   Gowd pide, además del mTLS, un bearer de /auth/v1/token con clientId y
//   clientSecret. Ese token se pide y se guarda acá adentro. Dos motivos:
//
//     · Las credenciales del banco quedan en UN solo lugar — el mismo donde
//       ya tiene que estar el certificado. Supabase nunca las ve: solo conoce
//       el secreto de este proxy.
//     · La caché funciona de verdad. Lambda reusa el contenedor entre
//       llamadas; una edge function no, y pediría token nuevo cada vez.
//
// EL CERTIFICADO Y LAS CREDENCIALES VIVEN EN SECRETS MANAGER
//   No en variables de entorno: un .pfx en base64 pasa el límite de 4 KB que
//   Lambda tiene para TODAS sus variables juntas. Y no en el código ni en el
//   estado de Terraform, donde quedarían en texto plano en un archivo que se
//   copia y se respalda.
//
//   El secreto es un JSON:
//     { "pfxBase64": "...", "pfxPassword": "...",
//       "clientId": "...", "clientSecret": "...",
//       "scopes": ["api://.../.default"] }
//
// NO ES UN PROXY ABIERTO, Y ESO NO ES OPCIONAL
//   Una IP con permiso de un banco, más un certificado que ese banco emitió,
//   es una credencial completa. Si esto reenviara a cualquier destino sería
//   un relay anónimo con la identidad de Lincoin ante Gowd: cualquiera que
//   descubra la URL lo usa, y los registros del banco dirían que fuimos
//   nosotros. Por eso: secreto propio para entrar, un ÚNICO host de destino
//   fijado en la configuración, y la ruta validada.
//
// NO SE REGISTRAN LOS CUERPOS
//   Por acá pasan documentos, nombres y montos. Se registra método, ruta,
//   código y duración. Nada más.
//
// Variables de entorno:
//   PROXY_SECRET     secreto que tiene que traer Lincoin en x-proxy-secret
//   GOWD_BASE        https://mtls-api-platform.gowd.com  (producción)
//   GOWD_SECRET_ID   nombre/ARN del secreto en AWS Secrets Manager
// ════════════════════════════════════════════════════════

import https from 'node:https';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const PROXY_SECRET = process.env.PROXY_SECRET ?? '';
const GOWD_BASE = (process.env.GOWD_BASE ?? '').replace(/\/+$/, '');
const SECRET_ID = process.env.GOWD_SECRET_ID ?? '';

const RUTA_TOKEN = '/auth/v1/token';
const TIMEOUT_MS = 25000;

// Comparación en tiempo constante: comparar secretos con === filtra, por el
// tiempo que tarda en fallar, cuántos caracteres iniciales acertaste.
function mismoSecreto(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

const responder = (status, cuerpo) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(cuerpo),
});

// ── Credenciales y agente TLS ─────────────────────────────────────────
// Se cargan una vez por contenedor. Lambda reusa el contenedor entre
// llamadas, así que el certificado se lee de Secrets Manager en el arranque
// en frío y no en cada request.
let credsPromesa = null;
let agente = null;

async function credenciales() {
  if (credsPromesa) return credsPromesa;
  credsPromesa = (async () => {
    const sm = new SecretsManagerClient({});
    const r = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
    const c = JSON.parse(r.SecretString ?? '{}');
    const faltan = ['pfxBase64', 'clientId', 'clientSecret'].filter((k) => !c[k]);
    if (faltan.length) throw new Error(`secreto incompleto: falta ${faltan.join(', ')}`);
    return {
      pfx: Buffer.from(c.pfxBase64, 'base64'),
      passphrase: c.pfxPassword ?? undefined,
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      scopes: Array.isArray(c.scopes) && c.scopes.length
        ? c.scopes
        : [`api://${c.clientId}/.default`],
    };
  })().catch((e) => {
    // Si falla, NO se cachea el fallo: el próximo intento vuelve a probar.
    // Un error de red al arrancar no debe dejar el contenedor roto para
    // siempre.
    credsPromesa = null;
    throw e;
  });
  return credsPromesa;
}

async function agenteTls() {
  if (agente) return agente;
  const c = await credenciales();
  agente = new https.Agent({
    pfx: c.pfx,
    passphrase: c.passphrase,
    keepAlive: true,           // el handshake mTLS es caro: se reusa
    maxSockets: 20,
  });
  return agente;
}

// ── Petición HTTPS con certificado de cliente ─────────────────────────
// Se usa node:https y no fetch a propósito: el fetch global de Node no acepta
// un agente con certificado de cliente, que es justo lo que hace falta acá.
async function pedir(url, { method, headers, body }) {
  const agent = await agenteTls();
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers,
        agent,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const trozos = [];
        res.on('data', (d) => trozos.push(d));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            texto: Buffer.concat(trozos).toString('utf8'),
          }),
        );
      },
    );
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('timeout'), { esTimeout: true }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Token ─────────────────────────────────────────────────────────────
let token = null; // { valor, venceEn }

async function tokenVigente() {
  // Margen de 5 minutos: un token que vence en camino deja una operación en
  // "no sé si salió", y con dinero eso es lo caro.
  if (token && Date.now() < token.venceEn - 5 * 60 * 1000) return token.valor;

  const c = await credenciales();
  const cuerpo = JSON.stringify({
    clientId: c.clientId,
    clientSecret: c.clientSecret,
    scopes: c.scopes,
  });
  const r = await pedir(`${GOWD_BASE}${RUTA_TOKEN}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'content-length': Buffer.byteLength(cuerpo),
    },
    body: cuerpo,
  });
  if (r.status < 200 || r.status >= 300) {
    throw Object.assign(new Error(`token ${r.status}`), { httpStatus: r.status });
  }
  const d = JSON.parse(r.texto);
  const valor = d.token ?? d.access_token;
  if (!valor) throw new Error('la respuesta del token no trae token');

  // Su documentación dice que expiresIn viene en MILISEGUNDOS (1 hora =
  // 3600000), lo cual es inusual — casi todos los OAuth devuelven segundos.
  // Se acepta cualquiera de las dos: un token que dure más de 86400 en la
  // unidad que sea, en segundos, sería de más de un día; a esa altura el
  // número es milisegundos. Equivocarse acá se paga caro en los dos sentidos:
  // leer ms como segundos guarda el token 41 días (401 en cada llamada), y
  // leer segundos como ms lo renueva cada 3 segundos.
  const n = Number(d.expiresIn ?? d.expires_in ?? 0);
  const duracionMs = !n ? 60 * 60 * 1000 : n > 86400 ? n : n * 1000;

  token = { valor, venceEn: Date.now() + duracionMs };
  return valor;
}

// ── Handler ───────────────────────────────────────────────────────────
export const handler = async (event) => {
  const t0 = Date.now();

  if (!PROXY_SECRET || !GOWD_BASE || !SECRET_ID) {
    // Falla CERRADO. Sin configuración no se reenvía nada: un proxy a medio
    // configurar que deja pasar es peor que uno caído.
    console.error('gowd-proxy sin configurar (falta PROXY_SECRET, GOWD_BASE o GOWD_SECRET_ID)');
    return responder(503, { error: 'proxy_sin_configurar' });
  }

  const headers = Object.fromEntries(
    Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );

  if (!mismoSecreto(headers['x-proxy-secret'] ?? '', PROXY_SECRET)) {
    // No se dice qué falló ni se distingue "sin secreto" de "secreto malo".
    console.warn('gowd-proxy: rechazado por credencial');
    return responder(401, { error: 'no_autorizado' });
  }

  // La ruta del banco viaja en una cabecera nuestra, no en la URL, para que
  // este endpoint no parezca —ni pueda usarse como— un proxy genérico.
  const ruta = String(headers['x-gowd-path'] ?? '');
  if (!ruta.startsWith('/')) return responder(400, { error: 'ruta_invalida' });
  // Sin '..' ni host absoluto: la base la decide la configuración, no quien llama.
  if (ruta.includes('..') || ruta.includes('://')) return responder(400, { error: 'ruta_invalida' });
  // El token lo acuña este proxy. Nadie lo pide "a través" de él: si se
  // permitiera, el clientSecret saldría en una respuesta hacia afuera.
  if (ruta.startsWith(RUTA_TOKEN)) return responder(403, { error: 'ruta_reservada' });

  const metodo = (event.requestContext?.http?.method ?? event.httpMethod ?? 'POST').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo)) {
    return responder(405, { error: 'metodo_no_permitido' });
  }

  const cuerpo = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  // Se carga acá, antes de cualquier llamada, para poder distinguir
  // "no tenemos certificado" (culpa nuestra, 503) de "el banco no contestó".
  try {
    await agenteTls();
  } catch (e) {
    console.error('gowd-proxy: no se pudo cargar el certificado:', String(e?.message ?? e));
    return responder(503, { error: 'certificado_no_disponible' });
  }

  const enviar = async (bearer) => {
    // Solo se reenvían las cabeceras que el banco necesita. Las nuestras
    // (incluido el secreto del proxy) NO salen: si viajaran, el secreto
    // quedaría en los registros del banco. La Authorization TAMPOCO se
    // reenvía desde el llamador: la pone este proxy, con su propio token.
    const aEnviar = {
      accept: 'application/json',
      authorization: `Bearer ${bearer}`,
    };
    for (const k of ['content-type', 'idempotency-key']) {
      if (headers[k]) aEnviar[k] = headers[k];
    }
    const conCuerpo = !['GET', 'DELETE'].includes(metodo) && cuerpo;
    if (conCuerpo) {
      if (!aEnviar['content-type']) aEnviar['content-type'] = 'application/json';
      aEnviar['content-length'] = Buffer.byteLength(cuerpo);
    }
    return pedir(`${GOWD_BASE}${ruta}`, {
      method: metodo,
      headers: aEnviar,
      body: conCuerpo ? cuerpo : undefined,
    });
  };

  try {
    let bearer = await tokenVigente();
    let r = await enviar(bearer);

    // Un 401 significa que la petición NO se procesó — el banco la rechazó
    // antes de mirarla. Solo por eso es seguro reintentarla: no puede haber
    // quedado media operación hecha del otro lado. Con cualquier otro código
    // NO se reintenta, porque ahí sí pudo haberse ejecutado.
    if (r.status === 401) {
      token = null;
      bearer = await tokenVigente();
      r = await enviar(bearer);
    }

    // Método, ruta, código y duración. Nunca el cuerpo.
    console.log(JSON.stringify({ metodo, ruta, status: r.status, ms: Date.now() - t0 }));

    return {
      statusCode: r.status,
      headers: { 'content-type': r.headers['content-type'] ?? 'application/json' },
      body: r.texto,
    };
  } catch (e) {
    const esTimeout = e?.esTimeout === true || e?.name === 'TimeoutError' || e?.code === 'ETIMEDOUT';
    console.error(JSON.stringify({
      metodo, ruta,
      error: esTimeout ? 'timeout' : String(e?.message ?? e),
      ms: Date.now() - t0,
    }));
    // 504 y no 500: le dice a quien llama que el desenlace es DESCONOCIDO —
    // el banco pudo haber recibido la operación. Con dinero, esa diferencia
    // decide si se puede reintentar o no.
    return responder(esTimeout ? 504 : 502, {
      error: esTimeout ? 'sin_respuesta_del_banco' : 'no_se_pudo_conectar',
      desenlaceDesconocido: esTimeout,
    });
  }
};
