// ════════════════════════════════════════════════════════
// gowd-proxy — la salida con IP fija hacia el banco de Brasil.
//
// POR QUE EXISTE
//   Gowd exige registrar una IP de origen. Nuestras funciones corren en
//   infraestructura serverless, donde la IP de salida cambia entre una llamada
//   y otra: no hay un número que darles. Este proxy vive dentro de una red
//   privada cuya salida pasa por un NAT con IP fija. Esa es la IP que se
//   registra.
//
//   Lincoin → (este proxy) → NAT con IP fija → Gowd
//
// NO ES UN PROXY ABIERTO, Y ESO NO ES OPCIONAL
//   Una IP con permiso de un banco es una credencial. Si esto reenviara a
//   cualquier destino, acabaríamos de publicar un relay anónimo que habla
//   desde una IP en la que un banco confía — cualquiera que descubra la URL lo
//   usa, y los registros del banco dirían que fuimos nosotros.
//
//   Por eso: secreto propio para entrar, y un ÚNICO host de destino fijado en
//   la configuración. Nada más sale de acá.
//
// NO SE REGISTRAN LOS CUERPOS
//   Por acá pasan datos de clientes y montos. Se registra el método, la ruta,
//   el código de respuesta y cuánto tardó. Nunca el contenido.
//
// Variables de entorno:
//   PROXY_SECRET   secreto que tiene que traer Lincoin en x-proxy-secret
//   GOWD_BASE      base del banco, p. ej. https://api.gowd.com.br
// ════════════════════════════════════════════════════════

const PROXY_SECRET = process.env.PROXY_SECRET ?? '';
const GOWD_BASE = (process.env.GOWD_BASE ?? '').replace(/\/+$/, '');

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

export const handler = async (event) => {
  const t0 = Date.now();

  if (!PROXY_SECRET || !GOWD_BASE) {
    // Falla CERRADO. Sin configuración no se reenvía nada: un proxy a medio
    // configurar que deja pasar es peor que uno caído.
    console.error('gowd-proxy sin configurar (falta PROXY_SECRET o GOWD_BASE)');
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

  const metodo = (event.requestContext?.http?.method ?? event.httpMethod ?? 'POST').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH'].includes(metodo)) {
    return responder(405, { error: 'metodo_no_permitido' });
  }

  const cuerpo = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  // Solo se reenvían las cabeceras que el banco necesita. Las nuestras
  // (incluido el secreto del proxy) NO salen: si viajaran, el secreto quedaría
  // en los registros del banco.
  const aEnviar = { accept: 'application/json' };
  for (const k of ['content-type', 'authorization', 'x-api-key', 'idempotency-key']) {
    if (headers[k]) aEnviar[k] = headers[k];
  }

  try {
    const r = await fetch(`${GOWD_BASE}${ruta}`, {
      method: metodo,
      headers: aEnviar,
      body: ['GET'].includes(metodo) ? undefined : cuerpo,
      signal: AbortSignal.timeout(25000),
    });
    const texto = await r.text();

    // Método, ruta, código y duración. Nunca el cuerpo.
    console.log(JSON.stringify({ metodo, ruta, status: r.status, ms: Date.now() - t0 }));

    return {
      statusCode: r.status,
      headers: { 'content-type': r.headers.get('content-type') ?? 'application/json' },
      body: texto,
    };
  } catch (e) {
    const esTimeout = e?.name === 'TimeoutError';
    console.error(JSON.stringify({ metodo, ruta, error: esTimeout ? 'timeout' : String(e?.message ?? e), ms: Date.now() - t0 }));
    // 504 y no 500: le dice a quien llama que el desenlace es DESCONOCIDO —
    // el banco pudo haber recibido la operación. Con dinero, esa diferencia
    // decide si se puede reintentar o no.
    return responder(esTimeout ? 504 : 502, {
      error: esTimeout ? 'sin_respuesta_del_banco' : 'no_se_pudo_conectar',
      desenlaceDesconocido: esTimeout,
    });
  }
};
