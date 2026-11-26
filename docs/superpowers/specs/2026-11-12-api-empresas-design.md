# API de saldos por empresa: diseño

Fecha: 2026-11-12

## Para qué sirve

Un **sistema propio externo** se conecta para leer, de **todas** las
empresas, los saldos de sus clientes. Por ejemplo, con el ID de Jero recibe
los saldos de los clientes de Jero. Los clientes de una empresa son los
operadores que se vincularon con su ID Lincoin (`raw_data.ownReferralCode`)
y que Cumplimiento aprobó: la lista `raw_data.personasAutorizadas` de la
empresa.

Es **solo de lectura**. Tiene que ser seguro y dejar registro de cada
consulta: desde dónde se hizo y con qué dispositivo. No hay IPs fijas ni
VPN.

## Objetivos

- Listar todas las empresas y consultar el detalle de una por su ID Lincoin.
- Firmar cada consulta (HMAC), para que una consulta interceptada no sirva
  para nada.
- Rotar el secreto solo, sin cortar la conexión: si lo roban, deja de
  servir pronto y el robo se detecta.
- Registrar todas las consultas, también las rechazadas: IP, país,
  User-Agent, dispositivo declarado y resultado.
- Avisar a los administradores ante una IP o un país nuevo, y ante un
  posible robo.

## Lo que queda fuera

- Escribir, cargar saldo o mover plata.
- Mostrar el historial de movimientos.
- Avisar por webhook.

## Lo que haría que esto fallara aunque funcione

- Que el secreto viaje por la red o quede escrito en los registros.
- Que una consulta capturada se pueda repetir.
- Que una consulta no quede registrada, sobre todo si fue rechazada.
- Que la rotación corte al sistema legítimo en una operación normal.
- Exponer la base directamente.

## Enfoques considerados

1. **Llave fija en un encabezado.** Simple, pero una llave robada sirve
   hasta que alguien la revoque. Se descarta.
2. **Rotación con dos llaves (acceso y renovación).** La llave de acceso
   viaja en cada consulta y sirve hasta 15 minutos si la interceptan.
3. **Firma más rotación del secreto (el elegido).** El secreto nunca viaja;
   lo interceptado no sirve; el secreto rota cada hora y su reuso delata un
   robo. El sistema externo es propio, así que puede programar la firma.

## Diseño

### Credencial

- Una credencial por sistema consumidor: `llave_id` (público, como
  `lk_7f3a…`) y un **secreto** de 32 bytes aleatorios que solo conocen el
  sistema externo y Lincoin.
- El secreto tiene una **generación** (1, 2, 3…). El sistema externo lo
  rota **cada hora**. Cada generación vence a las **24 h** de creada, para
  que una caída del sistema externo de unas horas no lo desconecte.
- Al rotar, la generación anterior sigue valiendo **5 minutos de gracia**
  (consultas en vuelo). Después queda reemplazada.

### Firma de cada consulta

Encabezados:
- `X-Llave-Id`: el id público de la credencial.
- `X-Generacion`: la generación del secreto usado.
- `X-Hora`: ISO-8601 UTC.
- `X-Nonce`: aleatorio de 16 bytes o más, distinto en cada consulta.
- `X-Firma`: hex de HMAC-SHA256(secreto, texto).
- `X-Dispositivo` (opcional): el nombre del equipo o servidor, para el
  registro.

`texto` = `METODO\nRUTA\nQUERY_ORDENADA\nX-Hora\nX-Nonce\nSHA256_HEX(cuerpo)`.
Con cuerpo vacío se usa el SHA-256 de la cadena vacía.

El servidor rechaza:
- una hora a más de 5 minutos de la del servidor;
- un nonce repetido (se guardan 10 minutos);
- una firma que no coincide (comparación en tiempo constante);
- una generación vencida, o reemplazada hace más de 5 minutos.

### Rotación

`POST /functions/v1/api-empresas/rotar`, firmada con la generación vigente.
Devuelve `{ generacion: n+1, secreto, expira_at }`. El sistema externo
guarda el nuevo secreto **antes** de dejar de usar el anterior.

**Detección de robo.** Si llega una consulta o una rotación firmada con una
generación ya reemplazada (pasada la gracia), o una segunda rotación desde
la misma generación, hay dos usuarios del mismo secreto. Entonces:
- se **revoca la credencial completa**, con todas sus generaciones;
- se notifica a los administradores;
- queda en `audit_log` como `api.credencial_revocada_por_reuso`;
- desde el panel se emite una credencial nueva para el sistema legítimo.

### Consultas

- `GET /functions/v1/api-empresas`: todas las empresas, con `id`, `nombre`,
  número de clientes y total de saldos.
- `GET /functions/v1/api-empresas?id=<ID Lincoin>`: el detalle:

```json
{
  "empresa": { "id": "JERO123", "nombre": "…" },
  "generado_at": "2026-11-12T22:00:00Z",
  "totales": { "COP": 0, "por_cuenta": { "COP_ACH": 0, "COP_BREB": 0, "COP_C3": 0, "COP_C4": 0 } },
  "clientes": [{
    "id_lincoin": "…", "nombre": "…", "tipo": "persona|empresa",
    "documento": { "tipo": "CC", "numero": "…" },
    "saldos": { "COP_ACH": 0, "COP_BREB": 0, "COP_C3": 0, "COP_C4": 0 },
    "tope_mensual": 0, "usado_mes": 0, "vinculado_at": "…"
  }]
}
```

- No usa el JWT de Supabase (`verify_jwt = false`): se autentica solo con
  la firma.
- Máximo 60 consultas por minuto por credencial (429 si se pasa).
- Los errores son genéricos: un 401 no dice qué falló. El motivo real queda
  en el registro.
- Responde siempre `Cache-Control: no-store`.
- `usado_mes` reutiliza el cálculo de `autorizaciones`, no lo duplica.
- Se consideran empresas las cuentas con `company_name` o con al menos un
  cliente aprobado.

### Tablas (migración nueva, RLS sin políticas: solo la service role)

- `api_credenciales`: `id`, `llave_id` único, `etiqueta`,
  `empresa_id null` (vacío = todas), `ips_permitidas text[] null`
  (opcional), `estado` (`activa` o `revocada`), `motivo_revocacion`,
  `creada_por`, `creada_at`, `revocada_at`.
- `api_secretos`: `credencial_id`, `generacion`, `secreto_cifrado`,
  `creado_at`, `expira_at`, `reemplazado_at`, con PK
  `(credencial_id, generacion)`.
  - El secreto se guarda cifrado con AES-GCM, con una clave en la variable
    de entorno `API_SECRETOS_KEY`. Hace falta poder leerlo para verificar el
    HMAC, así que no puede ser un hash.
- `api_nonces`: `(credencial_id, nonce)` PK y `at`. Se borra lo que tenga
  más de 10 minutos.
- `api_consultas` (el registro): `at`, `credencial_id`, `generacion`,
  `accion` (`listar`, `detalle` o `rotar`), `id_consultado`, `ip`, `pais`
  (`cf-ipcountry`), `user_agent`, `dispositivo`, `resultado`,
  `clientes`, `duracion_ms`.
  - Valores de `resultado`: `ok`, `firma_invalida`, `hora_fuera_de_rango`,
    `nonce_repetido`, `generacion_vencida`, `reuso_detectado`,
    `credencial_revocada`, `ip_no_permitida`, `demasiadas_consultas`,
    `id_no_existe` o `error`.

La IP se toma con el mismo criterio de `admin-data` (`cf-connecting-ip`,
luego `x-forwarded-for`, luego `x-real-ip`).

### Avisos

- La primera consulta de una credencial desde una IP o un país no vistos
  antes notifica a los administradores.
- El reuso detectado revoca la credencial y notifica.

### Panel de administración: sección "API externa"

- **Crear credencial:** nombre del sistema, IPs (opcional). Muestra **una
  sola vez** el `llave_id` y el secreto de la generación 1, con botón de
  copiar.
- **Lista:** etiqueta, estado, generación actual, última rotación, último
  uso (fecha, IP y país), y botón **Revocar**.
- **Registro:** las últimas 200 consultas, con filtro por resultado.

Crear y revocar son acciones de `admin-data` y exigen lo mismo que las
demás acciones sensibles. Quedan en `audit_log` sin el secreto.

### Para el sistema externo

Una guía en `docs/api-empresas.md` con:
- cómo firmar, con ejemplos en Node y Python;
- cómo rotar cada hora y guardar el secreto de forma atómica;
- qué hacer ante un 401: no reintentar en bucle, avisar a Lincoin;
- los ejemplos de respuesta.

## Decisiones mías (revisables)

- Rotación cada hora, vencimiento a las 24 h y 5 minutos de gracia.
- Ventana de hora de ±5 minutos y nonces guardados 10 minutos.
- IPs opcionales.
- Las credenciales las emite un administrador de Lincoin.
- Documento del cliente completo, solo clientes aprobados.

## Para quien lo construya

- Los nombres exactos de las columnas de saldo (`balances`).
- Cómo reutilizar `usado_mes` de `autorizaciones`.
- Cómo se notifica hoy a los administradores, para reusarlo.
- La ubicación de la sección en el panel.
