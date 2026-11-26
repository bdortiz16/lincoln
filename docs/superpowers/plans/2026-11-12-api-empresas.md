# API de saldos por empresa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edge Function `api-empresas` que un sistema externo consulta (firma HMAC + secreto rotativo) para leer los saldos de los clientes de todas las empresas, con registro de cada consulta y un panel para emitir/revocar credenciales.

**Architecture:** Una Edge Function con dos entradas: la API firmada (`GET` lista/detalle, `POST /rotar`) y acciones de admin (`POST {action}` con JWT admin + 2FA + rol dueño). La lógica pura (firma, cifrado, reglas de generación, armado de respuesta) vive en módulos aparte con tests Deno. Cuatro tablas nuevas con RLS sin políticas.

**Tech Stack:** Deno (Supabase Edge Functions), Web Crypto (HMAC-SHA256, AES-GCM, SHA-256), Postgres, React (panel admin).

**Spec:** `docs/superpowers/specs/2026-11-12-api-empresas-design.md`

## Global Constraints

- Rotación esperada cada 1 h; cada generación vence a las 24 h; gracia de 5 min tras reemplazo.
- Ventana de `X-Hora`: ±5 min. Nonces guardados 10 min.
- Máximo 60 consultas por minuto por credencial.
- El secreto nunca se guarda en claro ni en logs/audit: AES-GCM con `API_SECRETOS_KEY` (base64 de 32 bytes).
- Errores de autenticación genéricos (`401 {"error":"no_autorizado"}`); el motivo real solo en `api_consultas`.
- `Cache-Control: no-store` en todas las respuestas.
- Empresas = `users.role = 'business'`.
- Crear/revocar/ver registro: admin + 2FA + rol dueño.
- Nada de PII en commits (repo público).

## Review Focus

1. Dos rotaciones concurrentes legítimas (reintento de red) desde la misma generación → el sistema las trata como reuso y revoca; el doc debe decir "no reintentar rotar a ciegas: leer primero". Test: segunda rotación desde generación reemplazada → `reuso`.
2. Reloj del servidor externo desfasado > 5 min → 401 constante; el registro debe decir `hora_fuera_de_rango` para diagnosticar. Test en `firma.test.ts`.
3. Query con parámetros en distinto orden → la firma debe coincidir (query ordenada). Test.
4. Empresa sin clientes o con operador sin fila en `users` → detalle con lista vacía/omitido, no 500. Test en `datos.test.ts`.
5. `API_SECRETOS_KEY` ausente → 500 explícito `no_configurado` y nada se crea. Cubierto en index (rama temprana).

---

### Task 1: Migración

**Files:** Create `supabase/migrations/2026_zz34_api_empresas.sql`

Tablas `api_credenciales`, `api_secretos`, `api_nonces`, `api_consultas` exactamente como el spec; `enable row level security` sin políticas; índices `api_consultas(credencial_id, at desc)`, `api_consultas(ip, at desc)`, `api_nonces(at)`. Idempotente (`if not exists`). Encabezado recordando `_LEEME_ANTES_DE_CORRER.md`.

- [ ] Escribir la migración. - [ ] Commit.

### Task 2: Firma, cifrado y reglas de generación (puro)

**Files:** Create `supabase/functions/api-empresas/firma.ts`, Test `supabase/functions/api-empresas/firma.test.ts`

**Produces:**
- `textoAFirmar(metodo: string, ruta: string, query: URLSearchParams, hora: string, nonce: string, cuerpo: string): Promise<string>` — query ordenada por clave y valor, `k=v` unidos por `&`, cuerpo → sha256 hex.
- `firmar(secreto: string, texto: string): Promise<string>` (hex HMAC-SHA256; `secreto` en base64url).
- `horaValida(hora: string, ahora: number): boolean` (±5 min).
- `generarSecreto(): string` (32 bytes base64url), `generarLlaveId(): string` (`lk_` + 12 hex).
- `cifrar(claveB64: string, texto: string): Promise<string>` / `descifrar(claveB64: string, cifrado: string): Promise<string>` (AES-GCM, IV 12 bytes, salida `iv.ct` base64).
- `type Gen = { generacion: number; expira_at: string; reemplazado_at: string | null }`
- `evaluarGeneracion(gens: Gen[], g: number, ahora: number): 'ok' | 'vencida' | 'reuso' | 'desconocida'`
- `GRACIA_MS = 5*60e3`, `VIDA_MS = 24*3600e3`, `VENTANA_HORA_MS = 5*60e3`.

- [ ] **Tests** (`deno test`): firma conocida contra vector fijo calculado con el mismo algoritmo en Node (`crypto.createHmac`) — guardar el vector literal; query `b=2&a=1` y `a=1&b=2` dan el mismo texto; `horaValida` a ±4 min true, a 6 min false; `cifrar`→`descifrar` ida y vuelta y que un byte cambiado falle; `evaluarGeneracion`: vigente→ok, reemplazada hace 2 min→ok, hace 6 min→reuso, expirada→vencida, inexistente→desconocida.
- [ ] Verlos fallar, implementar, verlos pasar. - [ ] Commit.

### Task 3: Armado de respuesta (puro) y lectura

**Files:** Create `supabase/functions/api-empresas/datos.ts`, Test `supabase/functions/api-empresas/datos.test.ts`

**Produces:**
- `saldosCop(balances: Record<string, unknown> | null): Record<string, number>` — solo claves que empiezan por `COP`, numéricas.
- `armarDetalle(empresa: {id: string; raw_data: any; company_name?: string; full_name?: string; email?: string}, operadores: Map<string, {id: string; balances: any; ref: string | null}>, usado: Record<string, number>, ahora: Date): DetalleEmpresa` con la forma JSON del spec; operador sin fila → se omite.
- `armarResumen(empresa, operadores): { id, nombre, clientes, total_cop }`.
- `async leerOperadores(db, ids: string[]): Promise<Map<...>>` (de a 150, `id, balances, ref:raw_data->>ownReferralCode`).
- `async usadoMes(db, ids: string[]): Promise<Record<string, number>>` — misma regla que `autorizaciones` (dispersiones del mes Bogotá en `Completado|Procesando|Pendiente`), usando `leerPorPaginas` e `inicioMesBogota`.
- `codigoDe` y `nombreEmpresa` con la misma definición que `autorizaciones/index.ts:155-156`.

- [ ] **Tests:** `saldosCop({COP_ACH: 10, USDT: 5, COP_C3: '7'})` → `{COP_ACH:10, COP_C3:7}`; `armarDetalle` con 2 autorizados (uno sin fila) → 1 cliente, totales sumados por cuenta, `usado_mes` tomado del mapa, `id` en mayúsculas; empresa sin `personasAutorizadas` → `clientes: []`.
- [ ] Fallar, implementar, pasar. - [ ] Commit.

### Task 4: Edge Function

**Files:** Create `supabase/functions/api-empresas/index.ts`; Modify `.github/workflows/deploy-edge-functions.yml` (añadir `api-empresas` a `FUNCTIONS`), `supabase/config.toml` (`[functions.api-empresas] verify_jwt = false`).

Ruteo:
- Con `X-Llave-Id`: API firmada. Orden: credencial activa → generación (`evaluarGeneracion`; `reuso` revoca la credencial con `motivo_revocacion='reuso'`, audita `api.credencial_revocada_por_reuso`, avisa por correo) → hora → firma (`igualSeguro`) → nonce (insert; conflicto = repetido; borrar > 10 min) → IP permitida si hay lista → tope 60/min → acción: `GET` sin `id` = lista, `GET ?id=` = detalle (404 `no_encontrado` si no existe), `POST …/rotar` = marcar reemplazo condicional (`reemplazado_at is null`; si no actualiza → reuso) e insertar generación n+1, responder `{generacion, secreto, expira_at}`.
- Sin `X-Llave-Id` y `POST {action}`: admin vía `verificarAdminConMfa` + `accesoDe(...).rol` dueño (o sin rol). Acciones `crear {etiqueta, ips?}` → `{llave_id, secreto, generacion:1, expira_at}`; `listar`; `revocar {id}`; `registro {credencial_id?, resultado?}` (200 últimas). Audit `api.credencial_creada` / `api.credencial_revocada`.
- Cada salida de la API firmada escribe una fila en `api_consultas` (ip con el criterio de admin-data, `cf-ipcountry`, user-agent, `X-Dispositivo`, duración).
- Primera consulta `ok` desde una IP no vista para la credencial → correo a `ADMIN_EMAIL` vía Resend (patrón de `mouv-proxy` `avisarAdminSinConfirmar`).

- [ ] Implementar. - [ ] `esbuild` sin errores de sintaxis; tests de tasks 2–3 verdes. - [ ] Script de humo local `deno run` que firme con `firma.ts` y compruebe que `textoAFirmar` coincide con el ejemplo de la guía. - [ ] Commit.

### Task 5: Panel "API externa"

**Files:** Create `components/AdminApiExterna.tsx`; Modify `components/AdminDashboard.tsx` (añadir `'apiExterna'` a `GRUPO_SEG`, al tipo de `activeTab`, `SUBTAB_TITLES`, y render `{activeTab === 'apiExterna' && <AdminApiExterna />}`).

Usa `llamarFuncion('api-empresas', {action})`. Crear (etiqueta, IPs separadas por coma) muestra una sola vez `llave_id` y secreto con botón copiar y aviso; lista con estado, generación, último uso (fecha/IP/país) y Revocar con confirmación; registro con filtro por resultado. Estilo oscuro de las demás secciones.

- [ ] Implementar. - [ ] `npm run build` ok. - [ ] Commit.

### Task 6: Guía para el sistema externo

**Files:** Create `docs/api-empresas.md`

Endpoints, encabezados, cómo firmar (Node y Python), rotación cada hora con guardado atómico, qué hacer ante 401/429, ejemplos de respuesta, códigos de error. El ejemplo Node debe producir la misma firma que el vector del Task 2 (verificarlo ejecutándolo).

- [ ] Escribir. - [ ] Ejecutar el ejemplo Node con el vector y comparar. - [ ] Commit.
