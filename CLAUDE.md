# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Lincoin — instrucciones del proyecto

Las secciones de marca (logo, paleta, tipografía, producto) van primero y son obligatorias. La parte técnica está al final, en **Desarrollo**.

## LOGO — NO REDISEÑAR

El logo de Lincoin ya está definido y aprobado. **Nunca lo rediseñes, lo reinterpretes ni le agregues símbolos.** Reprodúcelo exactamente así:

### Construcción
Es un **wordmark tipográfico**: la palabra `Lincoin` seguida de un **punto verde**.

```html
<span style="font-family: Archivo, system-ui, sans-serif; font-weight: 800; letter-spacing: -0.6px; color: #F4F4F2;">Lincoin<span style="color: #4ADE80;">.</span></span>
```

Reglas:
- Fuente: **Archivo**, peso **800**. Nada más.
- `letter-spacing`: entre `-0.5px` y `-1px` según el tamaño.
- La "L" es la única mayúscula. Nunca `LINCOIN` ni `lincoin` en el wordmark principal.
- El punto final **siempre** es verde `#4ADE80` (o `#22A35C` sobre fondos claros).
- El punto es el punto de la tipografía, del mismo tamaño que un punto normal — no un círculo grande, no una pelota, no un elemento separado que flote.

### Prohibido
- ❌ Isotipos, monogramas, iconos de flecha, montañas, casas, escudos, gráficas.
- ❌ Encerrar el logo en un cuadrado, círculo o "app icon" con borde.
- ❌ Degradados sobre las letras.
- ❌ Cambiar la fuente (nada de Inter, Space Grotesk, serif, etc.).
- ❌ Poner el logo grande al centro del pecho en merch, o gigante en cualquier composición.
- ❌ Otro color en las letras que no sea `#F4F4F2` (fondo oscuro) o `#15181A` (fondo claro).

### Variante corta `L.` — solo para avatares y favicon

Úsala **solo** cuando el espacio es cuadrado y muy pequeño (favicon, foto de perfil, app icon). En cualquier otro caso va el wordmark completo.

Construcción exacta:
- Una sola letra: **`L` mayúscula** en Archivo 800, color `#F4F4F2`.
- A su derecha, **el punto verde** `#4ADE80` — el punto de la tipografía, alineado a la línea base de la L, no centrado ni flotando.
- El punto mide aproximadamente **1/9 de la altura de la L** y va separado de ella por un espacio del mismo ancho del punto. No es un círculo grande.

Fondo (para avatares y app icons — ahí el cuadro oscuro es obligatorio; ver excepciones más abajo):
- Fondo **negro Lincoin**: degradado `linear-gradient(135deg, #121413 0%, #0C0E0D 60%, #0A0B0A 100%)`.
- Encima, un glow verde muy sutil en la esquina superior derecha: `radial-gradient(circle at 85% 10%, rgba(74,222,128,0.18), transparent 45%)`.
- El fondo cubre todo el cuadro (full-bleed). Sin borde, sin marco, sin sombra interior.

Composición:
- El conjunto `L.` va **centrado óptimamente** en el cuadro, ocupando cerca del **55 % de la altura** — con aire alrededor.
- Al centrar, considera el punto: el bloque `L` + punto se centra como una unidad, no la L sola.
- Debe verse bien recortado en círculo (WhatsApp, Slack): nada importante en las esquinas.

Prohibido en esta variante: fondo blanco, fondo transparente, la L verde, el punto blanco, un círculo verde grande, borde alrededor, o la palabra completa reducida.

#### Cuando NO se puede usar el cuadro oscuro

Hay contextos donde el cuadro negro no cabe o no corresponde: papelería en blanco, documentos impresos, una web de fondo claro, el logo de un partner sobre fondo blanco, sellos de una sola tinta. En esos casos:

- **Fondo claro (blanco o crema):** la `L` va en `#15181A` y el punto en `#22A35C`. **Sin cuadro, sin fondo** — el logo se apoya directo sobre el papel o la superficie clara.
- **Fondo oscuro que no es el nuestro** (foto oscura, negro de otra marca, video): la `L` va en `#F4F4F2` y el punto en `#4ADE80`, **sin cuadro** — directo sobre el fondo.
- **Una sola tinta** (grabado, sello, bordado de un hilo, fax): todo el conjunto `L.` en un solo color — `#F4F4F2` sobre oscuro o `#15181A` sobre claro. El punto pierde el verde pero **no desaparece**: sigue estando.

Regla para decidir: el cuadro oscuro es el **contenedor** de la variante corta, no parte del logo. Si el contenedor no aplica, se quita el contenedor — nunca se cambia la letra ni el punto.

### Versión espaciada (uso secundario)
Para espalda de merch o pies de página se permite `LINCOIN` en mayúsculas, peso 700, `letter-spacing: 5px`, sin punto, con una línea verde debajo. Es una variante secundaria, no reemplaza el wordmark.

## Paleta

Fondos: `#070808` (base) · `#0C0E0D` (carbón) · `#121413` (elevado) · `#161A17` (degradado hero)
Acento: `#4ADE80` (verde Lincoin) · `#22A35C` (verde sobre claro) · `rgba(74,222,128,0.12–0.22)` (glows y badges)
Texto: `#F4F4F2` (principal) · `#878E88` (secundario) · `rgba(244,244,242,0.45)` (tenue)
Bordes: `rgba(255,255,255,0.06–0.14)`
Insignias de moneda (solo ahí): `#2775CA` USDC · `#16A34A` EURC · Mastercard `#EB001B` / `#F79E1B` / `#FF5F00`

El verde nunca es fondo grande. Es puntual: el punto del logo, un botón, un dato positivo.

## Tipografía

**Archivo** en todo. 700–800 para títulos y cifras, 400–600 para texto corrido.

## Producto — qué es Lincoin

Una cuenta digital para **recibir, cambiar y enviar USDC y EURC** (dólares y euros digitales) en Latinoamérica y Europa, con tarjeta Mastercard.

- **Solo USDC y EURC.** No mostrar Bitcoin, ETH ni otras cripto en la app, tickers o copy.
- **No somos banco** y **no tenemos licencia MiCA ni registro regulatorio.** Nunca afirmar que estamos regulados, licenciados o auditados por un regulador.
- La confianza se comunica vía **aliados de infraestructura**: Circle (emisor de USDC/EURC, atestaciones 1:1), Fireblocks (custodia), Sumsub (KYC), SEPA/SWIFT.
- La marca se llama **Lincoin** — nunca Cuy Pay, Alza ni otra.

## Desarrollo

### Comandos
```bash
npm install
npm run dev        # Vite en http://localhost:3000
npm run build      # build de producción a ./dist (lo mismo que corre Cloudflare)
npx tsc            # verificación de tipos (tsconfig ya trae noEmit)
```
No hay suite de tests ni linter configurados. Para verificar un cambio, compila con `npm run build` y míralo en el navegador.

Variables locales en `.env` (ver `.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, opcionales `VITE_SUPABASE_PERSONAS_URL/_ANON_KEY` (si faltan se usa el mismo proyecto), `VITE_TURNSTILE_SITE_KEY`. Todo lo que lleve prefijo `VITE_` queda en el bundle público: **nunca** metas ahí una llave de servidor ni una contraseña. Los secretos de servidor van en los secrets de Supabase Edge Functions.

### Stack y despliegue
- **Frontend**: React 19 + Vite 6 + TypeScript + Tailwind 3. Sin carpeta `src/`: `index.tsx`, `App.tsx`, `components/`, `context/`, `lib/` están en la raíz. Alias `@/` = raíz.
- **Backend**: Supabase (Postgres + Auth + Edge Functions en Deno). Proyecto Lincoin: `wqleypebmfiaygrurnrc`.
- **Hosting**: Cloudflare Workers con assets estáticos (`wrangler.jsonc`, worker `lincoln`), dominio `lincoin.me`. `vercel.json` sigue existiendo para la copia en Vercel; si cambias rewrites/webhooks, cambia **los dos**. Las variables `VITE_*` en Cloudflare solo entran tras recompilar. El archivo `.deploy` se toca para forzar un rebuild sin cambios de código.
- **Ramas**: se trabaja en `develop`; la rama principal es `claude/busy-fermi-h8to5p`.

### Ruteo de la app (`index.tsx` → `App.tsx`)
Tres apps aisladas en el mismo bundle, decididas por `window.location.pathname` antes de montar providers:
- `/admin-personas` → `components/AdminPersonas/PersonasAdminApp` (sin providers de Empresas; usa `supabasePersonas`).
- `/admin-empresas` o `/admin` → `AdminEmpresasApp` → `AdminDashboard` (login propio). Se chequea **después** de personas porque `/admin-personas` también empieza por `/admin`.
- Todo lo demás → `ThemeProvider > SystemConfigProvider > DatabaseProvider > ExchangeRateProvider > App`. `App.tsx` maneja vistas por estado (`currentView`) sincronizadas con la URL vía `RUTAS_APP` / `history.pushState`: landing, login/registro, `PersonalDashboard` (empresas, el archivo más grande), `PersonaDashboard`, `ContadorDashboard`.

Los paneles admin se cargan con `lazyNamed` (`lib/lazyRetry.ts`) para que un cliente no los descargue. `vite.config.ts` separa vendors en chunks fijos (react, supabase, mapa d3, iconos) a propósito.

Estado global del cliente en `context/DatabaseContext.tsx` (`currentUser`, transacciones, auth, actualizaciones optimistas de saldo).

### Edge functions (`supabase/functions/`)
- El frontend las llama con `llamarFuncion()` de `lib/edge.ts`, que manda el **token de sesión** del usuario (no solo la anon key). No copies otro fetch a mano: sin el token el servidor no sabe quién llama.
- Todas corren con `verify_jwt = false` y **cada función hace su propia autenticación**. Las acciones de admin deben exigir el 2FA de la sesión con `requireMfaSession` de `_shared/admin-auth.ts`, igual que `admin-data`.
- Código común en `_shared/`: `candado.ts` (candado atómico contra envíos duplicados vía tabla `envio_candados`), `webhook-auth.ts`, `field-crypto.ts`, `cupos.ts`, etc.
- **Despliegue**: `.github/workflows/deploy-edge-functions.yml` corre en push a `main` y `claude/busy-fermi-h8to5p`, y despliega **solo las funciones listadas en `FUNCTIONS`**. Una función nueva que no se agregue ahí no se despliega (el panel recibe 404). A mano: `npx supabase functions deploy <nombre> --project-ref wqleypebmfiaygrurnrc --no-verify-jwt`.
- **Webhooks de socios** entran por `lincoin.me/webhooks/<socio>`, nunca por la URL cruda de Supabase. Cada uno es una entrada explícita en `cloudflare/worker.js` (`WEBHOOKS`) y en `vercel.json` (antes del catch-all). Nunca un comodín. Detalle en `WEBHOOKS.md`.
- Jobs programados vía GitHub Actions contra la service_role: `conciliar-breb.yml` (cada 5 min, `mouv-proxy` `reconcile_breb`) y `facturas-al-dia.yml`. No imprimen el cuerpo de las respuestas en el log (trae datos de clientes).

### Base de datos (`supabase/migrations/`)
- Las migraciones se llaman `2026_<tema>.sql` (no con timestamp), y las nuevas se ordenan con prefijo `2026_zzN_…`. Se escriben **idempotentes** (`IF NOT EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`) porque se pegan en el SQL Editor de Supabase.
- `supabase/_lincoln_full_schema.sql` es el esquema completo consolidado para levantar un proyecto desde cero. Para validarlo en un Postgres local: `psql -f supabase/_local_validation_prelude.sql && psql -f supabase/_lincoln_full_schema.sql` (el prelude **no** se corre en Supabase).
- RLS en todo; las RPC sensibles de admin son solo para `service_role` y se llaman desde `admin-data`, no desde el navegador. Config privada en la tabla `private_config` (sin acceso para `anon`/`authenticated`).

### Herencia de CuyPay
El repo nació del código de CuyPay (`LINCOLN_MIGRATION.md`): quedan nombres como `cuypay_id`, `cuypay_notify_tx`, `"name": "cuypay"` en `package.json` e integraciones de USDT/GasFree (TRON), OTC, Finity, Mouv, Gowd (PIX), Kumplo (AML, ver `KUMPLO_INTEGRACION.md`), Tusdatos y Siigo (facturación). Los identificadores internos se pueden quedar; lo que ve el usuario (UI, copy, correos) debe decir **Lincoin** y respetar las reglas de producto de arriba.

### Convenciones
- Código, comentarios, commits y UI en **español**. Los comentarios explican el *porqué* (el incidente o el riesgo que motivó el código); mantén ese estilo y no borres esas explicaciones al refactorizar.
- Mensajes de commit: título descriptivo en español y cuerpo que explica qué cambia y por qué.
