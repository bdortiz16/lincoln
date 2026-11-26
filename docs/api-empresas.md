# API de saldos por empresa: guía de implementación

Esta guía es para el equipo que construye el sistema externo. Explica cómo
consultar los saldos de los clientes de cada empresa en Lincoin.

La API es **solo de lectura**. Cada consulta va **firmada**, y el secreto
**rota cada hora**. Así, una consulta interceptada no sirve para nada y un
secreto robado deja de servir rápido.

---

## 1. Lo que Lincoin le entrega

Un administrador de Lincoin crea la credencial y le entrega, **por un canal
seguro**:

```
LLAVE_ID=lk_xxxxxxxxxxxx      ← identifica al sistema; no es secreto
GENERACION=1                   ← número de la versión del secreto
SECRETO=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   ← secreto, 43 caracteres
```

- Guarde el secreto en un almacén seguro, como un gestor de secretos o un
  archivo con permisos restringidos. **Nunca** en el código ni en el
  repositorio.
- El secreto nunca viaja en las consultas. Solo se usa para calcular la firma.

**URL base:**
```
https://wqleypebmfiaygrurnrc.supabase.co/functions/v1/api-empresas
```

---

## 2. Endpoints

| Método | Ruta | Para qué |
|---|---|---|
| `GET` | `/functions/v1/api-empresas` | Lista de todas las empresas |
| `GET` | `/functions/v1/api-empresas?id=<ID Lincoin>` | Detalle de una empresa y sus clientes |
| `POST` | `/functions/v1/api-empresas/rotar` | Obtener el secreto de la siguiente generación |

### Lista de empresas

```json
{
  "generado_at": "2026-11-12T22:00:00.000Z",
  "empresas": [
    {
      "id": "JERO123",
      "nombre": "JERO S.A.S",
      "saldos": { "COP": 0, "COP_BREB": 0, "COP_ACH": 1922593, "COP_C3": 155578292, "COP_C4": 5158592 },
      "total_cop": 162659477,
      "clientes": 2,
      "total_clientes_cop": 0
    }
  ]
}
```

### Detalle de una empresa

```json
{
  "empresa": {
    "id": "JERO123",
    "nombre": "JERO S.A.S",
    "saldos": { "COP": 0, "COP_BREB": 0, "COP_ACH": 1922593, "COP_C3": 155578292, "COP_C4": 5158592 },
    "total_cop": 162659477
  },
  "generado_at": "2026-11-12T22:00:00.000Z",
  "clientes": [
    {
      "id_lincoin": "ANA001",
      "nombre": "Ana Pérez",
      "tipo": "persona",
      "documento": { "tipo": "CC", "numero": "111" },
      "saldos": { "COP_ACH": 100, "COP_C3": 50 },
      "tope_mensual": 5000000,
      "usado_mes": 1200,
      "vinculado_at": "2026-11-01T00:00:00Z"
    }
  ],
  "totales_clientes": { "COP": 150, "por_cuenta": { "COP_ACH": 100, "COP_C3": 50 } }
}
```

- **`saldos` de la empresa:** son los saldos propios de la empresa en Lincoin.
  Siempre vienen las cinco cuentas, con 0 si una está vacía:

  | Clave | Cuenta |
  |---|---|
  | `COP` | Saldo Lincoin |
  | `COP_BREB` | Bre-B |
  | `COP_ACH` | ACH |
  | `COP_C3` | Cuenta 3 |
  | `COP_C4` | Cuenta 4 |

- **`total_cop`:** la suma de las cinco cuentas de la empresa.
- **`clientes`:** los operadores aprobados de la empresa (sus propios
  clientes vinculados en Lincoin), cada uno con sus saldos.
  `totales_clientes` es la suma de los saldos de esos clientes. Si la empresa
  no tiene operadores, `clientes` viene vacío.
- **`tope_mensual`:** puede ser `null` si el cliente no tiene tope.
- **`usado_mes`:** lo que el cliente ha enviado en el mes en curso, según
  la hora de Colombia.

---

## 3. Cómo firmar cada consulta

Cada consulta lleva estos encabezados:

| Encabezado | Valor |
|---|---|
| `X-Llave-Id` | `LLAVE_ID` |
| `X-Generacion` | La generación del secreto que está usando |
| `X-Hora` | Hora actual en UTC, ISO-8601 (`2026-11-12T22:10:00Z`) |
| `X-Nonce` | Texto aleatorio, distinto en **cada** consulta (16 a 128 caracteres) |
| `X-Firma` | La firma, en hexadecimal minúsculas |
| `X-Dispositivo` | Opcional: el nombre del equipo o servidor (queda en el registro de Lincoin) |

### El texto que se firma

Seis líneas unidas con `\n` (salto de línea, sin `\n` al final):

```
METODO
RUTA
QUERY_ORDENADA
X-Hora
X-Nonce
SHA256_HEX(cuerpo)
```

- **METODO:** `GET` o `POST`, en mayúsculas.
- **RUTA:** la ruta completa, empezando en `/functions/v1/…`, sin la query.
- **QUERY_ORDENADA:** los parámetros ordenados por nombre (y por valor si un
  nombre se repite), como `nombre=valor` unidos por `&`. Los valores van sin
  codificar. Si no hay query, la línea queda vacía.
- **SHA256_HEX(cuerpo):** el SHA-256 en hexadecimal del cuerpo. Si no hay
  cuerpo (los `GET` y `/rotar`), es el SHA-256 de la cadena vacía:
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

**Firma** = HMAC-SHA256 del texto, usando como clave los **bytes** del
secreto decodificado de base64url (no el texto del secreto), en hexadecimal.

### Vector de prueba

Úselo para comprobar su implementación antes de conectarse:

```
secreto (base64url) = AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA
método  = GET
ruta    = /functions/v1/api-empresas
query   = id=JERO123
X-Hora  = 2026-11-12T22:10:00Z
X-Nonce = n0nce-0000-1111
cuerpo  = (vacío)

firma esperada = 2f322d5c5aab4ca8e4e7342cac88a7900021e879d8d95328a7c1749b7b03f1ad
```

### Reglas que aplica Lincoin

- La hora no puede diferir más de **5 minutos** de la de Lincoin. Mantenga
  el reloj sincronizado con NTP.
- Cada `X-Nonce` sirve **una sola vez**.
- Máximo **60 consultas por minuto**.

---

## 4. Rotación del secreto (cada hora)

1. Cada hora, llame `POST /functions/v1/api-empresas/rotar`, firmado con la
   generación **actual**.
2. La respuesta trae la nueva generación:
   ```json
   { "generacion": 8, "secreto": "…", "expira_at": "2026-11-13T22:10:00.000Z" }
   ```
3. **Guarde el nuevo secreto y la nueva generación de forma atómica**: los
   dos juntos y en almacenamiento persistente. Hágalo **antes** de usarlos.
4. Desde ese momento, firme con la nueva generación. La anterior sigue
   valiendo **5 minutos** para las consultas que ya estaban en curso. Después
   de eso, **no la use nunca más**.

Cada generación vence a las **24 horas** de creada. Si su sistema se cae unas
horas, al volver puede rotar con la última generación guardada, siempre que
no hayan pasado 24 horas.

### Detección de robo: lea esto

Si Lincoin recibe una consulta firmada con una generación **ya reemplazada**
(pasados los 5 minutos de gracia), concluye que dos sistemas tienen el mismo
secreto. Entonces **revoca la credencial completa**. Para volver a conectarse
hace falta una credencial nueva emitida por Lincoin.

Para no provocarlo por error:

- Use **un solo** proceso para rotar. Si tiene varios servidores, todos deben
  leer el secreto del mismo almacén compartido.
- Nunca vuelva a una generación anterior. Por ejemplo, no restaure un backup
  viejo del secreto.
- **Si la respuesta de `/rotar` se pierde** por un timeout o un error de red,
  puede repetir `/rotar` con la **misma** generación. Lincoin le devuelve el
  mismo secreto nuevo, siempre que ese secreto todavía no se haya usado.

---

## 5. Respuestas de error

| Código | Cuerpo | Qué hacer |
|---|---|---|
| 401 | `{"error":"no_autorizado"}` | Firma, hora, nonce o generación inválidos, o credencial revocada. **No reintente en bucle.** Revise el reloj y la firma con el vector de prueba. Si persiste, contacte a Lincoin. |
| 403 | `{"error":"no_autorizado"}` | La IP no está permitida (solo si Lincoin registró IPs para su credencial). |
| 404 | `{"error":"no_encontrado"}` | No existe una empresa con ese ID. |
| 429 | `{"error":"demasiadas_consultas"}` | Espere un minuto. |
| 500 | `{"error":"error"}` | Error de Lincoin. Reintente con espera creciente. |

Por seguridad, el 401 no dice qué falló. Lincoin sí registra el motivo
exacto: si lo necesita, pídalo indicando la hora de la consulta.

---

## 6. Ejemplo en Node.js (18 o superior, sin dependencias)

```js
const crypto = require('crypto');

const BASE = 'https://wqleypebmfiaygrurnrc.supabase.co';
const RUTA_API = '/functions/v1/api-empresas';

// Cárguelos de su almacén seguro, y guárdelos ahí mismo al rotar.
let cred = { llaveId: process.env.LLAVE_ID, generacion: Number(process.env.GENERACION), secreto: process.env.SECRETO };

function textoAFirmar(metodo, ruta, params, hora, nonce, cuerpo) {
  const query = [...params.entries()]
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const hashCuerpo = crypto.createHash('sha256').update(cuerpo).digest('hex');
  return [metodo, ruta, query, hora, nonce, hashCuerpo].join('\n');
}

function firmar(secreto, texto) {
  return crypto.createHmac('sha256', Buffer.from(secreto, 'base64url')).update(texto).digest('hex');
}

async function llamar(metodo, ruta, params = new URLSearchParams(), cuerpo = '') {
  const hora = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const nonce = crypto.randomBytes(16).toString('hex');
  const firma = firmar(cred.secreto, textoAFirmar(metodo, ruta, params, hora, nonce, cuerpo));
  const qs = params.toString();
  const r = await fetch(`${BASE}${ruta}${qs ? `?${qs}` : ''}`, {
    method: metodo,
    headers: {
      'X-Llave-Id': cred.llaveId, 'X-Generacion': String(cred.generacion),
      'X-Hora': hora, 'X-Nonce': nonce, 'X-Firma': firma,
      'X-Dispositivo': 'servidor-contable-01',
    },
    body: metodo === 'POST' ? cuerpo : undefined,
  });
  if (!r.ok) throw new Error(`Lincoin respondió ${r.status}: ${await r.text()}`);
  return r.json();
}

async function rotar() {
  const r = await llamar('POST', `${RUTA_API}/rotar`);
  cred = { ...cred, generacion: r.generacion, secreto: r.secreto };
  // GUARDAR cred en el almacén seguro AQUÍ, antes de seguir.
}

// Uso
(async () => {
  const lista = await llamar('GET', RUTA_API);
  const detalle = await llamar('GET', RUTA_API, new URLSearchParams({ id: 'JERO123' }));
  console.log(lista.empresas.length, detalle.empresa.saldos);
})();
setInterval(() => rotar().catch(console.error), 60 * 60 * 1000);
```

## 7. Ejemplo en Python (3.8 o superior)

```python
import base64, hashlib, hmac, json, secrets, urllib.parse, urllib.request
from datetime import datetime, timezone

BASE = "https://wqleypebmfiaygrurnrc.supabase.co"
RUTA_API = "/functions/v1/api-empresas"

# Cárguelos de su almacén seguro, y guárdelos ahí mismo al rotar.
cred = {"llave_id": "lk_...", "generacion": 1, "secreto": "..."}

def texto_a_firmar(metodo, ruta, params, hora, nonce, cuerpo=b""):
    query = "&".join(f"{k}={v}" for k, v in sorted(params))
    hash_cuerpo = hashlib.sha256(cuerpo).hexdigest()
    return "\n".join([metodo, ruta, query, hora, nonce, hash_cuerpo])

def firmar(secreto, texto):
    clave = base64.urlsafe_b64decode(secreto + "=" * (-len(secreto) % 4))
    return hmac.new(clave, texto.encode(), hashlib.sha256).hexdigest()

def llamar(metodo, ruta, params=(), cuerpo=b""):
    params = list(params)
    hora = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    nonce = secrets.token_hex(16)
    firma = firmar(cred["secreto"], texto_a_firmar(metodo, ruta, params, hora, nonce, cuerpo))
    qs = urllib.parse.urlencode(params)
    req = urllib.request.Request(
        f"{BASE}{ruta}{'?' + qs if qs else ''}", method=metodo,
        data=cuerpo if metodo == "POST" else None,
        headers={
            "X-Llave-Id": cred["llave_id"], "X-Generacion": str(cred["generacion"]),
            "X-Hora": hora, "X-Nonce": nonce, "X-Firma": firma,
            "X-Dispositivo": "servidor-contable-01",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def rotar():
    r = llamar("POST", f"{RUTA_API}/rotar")
    cred.update(generacion=r["generacion"], secreto=r["secreto"])
    # GUARDAR cred en el almacén seguro AQUÍ, antes de seguir.

# Uso
lista = llamar("GET", RUTA_API)
detalle = llamar("GET", RUTA_API, [("id", "JERO123")])
```

> En los dos ejemplos, `params` se envía en la URL con su codificación
> normal. En cambio, el texto firmado usa los valores **sin codificar**. Los
> ID de Lincoin son letras y números, así que en la práctica coinciden.

---

## 8. Lista de chequeo antes de salir a producción

- [ ] Su implementación produce la firma del vector de prueba.
- [ ] El reloj del servidor está sincronizado (NTP).
- [ ] El secreto se lee y se guarda en un almacén seguro y compartido.
- [ ] Hay un solo proceso que rota, cada hora.
- [ ] Ante un 401 no se reintenta en bucle: se avisa a un humano.
- [ ] Se envía `X-Dispositivo` con un nombre que permita reconocer el
      servidor en el registro de Lincoin.
