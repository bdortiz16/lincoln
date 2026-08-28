# Guía de migración a Lincoln (producto cripto + fiat)

> **Para el Claude que trabaja el repo de Lincoln (`lincoln-psi.vercel.app`).**
> Este documento mapea TODO el código de CuyPay para que lo adaptes a Lincoln.
> **Lincoln = producto cripto + fiat** (se queda con USDT + OTC). **CuyPay pasa a
> ser solo fiat** (le quitamos USDT + OTC). O sea: **la base de Lincoln es el
> repo actual de CuyPay tal cual está HOY** (con cripto y OTC). Tomá este repo
> como punto de partida y adaptalo (branding, proyectos Supabase, secrets).

---

## 1. Arquitectura general

- **Frontend**: React + Vite + TypeScript + TailwindCSS. Deploy en Vercel.
- **Backend**: Supabase (Postgres + Auth + Edge Functions en Deno).
- **Dos productos, dos proyectos Supabase distintos:**
  - **Empresas** (`afaysiaontmhgrjnoene`) — clientes empresa (KYB). Cliente `supabase` en `lib/supabaseClient.ts`.
  - **Personas** (`jnbmqzalkeheqoukjmhy` / "CuyPayANDROID") — clientes persona (app móvil). Cliente `supabasePersonas`.
- **Entradas (routing en `index.tsx` + `App.tsx`):**
  - `/` → landing + app de cliente (empresas) → `PersonalDashboard`.
  - `/admin-empresas` (y `/admin`) → `AdminEmpresasApp` → `AdminDashboard` (login propio).
  - `/admin-personas` → `PersonasAdminApp` → `PersonasAdminDashboard` (usa `supabasePersonas`).

## 2. Plataforma interna (cliente / empresas)

| Área | Archivo(s) | Notas |
|---|---|---|
| Dashboard cliente | `components/PersonalDashboard.tsx` | **El más grande.** Tarjetas de cuentas (incluye USDT/GasFree), Enviar, Convertir (OTC), Movimientos, perfil, KYB banner, comprobantes. |
| Contexto de datos | `context/DatabaseContext.tsx` | Estado global: `currentUser`, `users`, `transactions`, auth (login/registro/logout), `fetchData`, saldos, optimistic updates (`bumpLocalBalance`, `addLocalTx`). |
| Config del sistema | `context/SystemConfigContext.tsx`, `context/ExchangeRateContext.tsx` | Tasas, config. |
| Cliente Supabase | `lib/supabaseClient.ts` | Exporta `supabase` (Empresas) y `supabasePersonas`. **Cambiar los proyectos/keys para Lincoln.** |
| Login / registro | `components/Login.tsx`, `components/Register.tsx`, `App.tsx` | El registro fuerza rol `business`. |
| Contactos (destinos bancarios) | `components/ContactsSection.tsx` | Inscribe cuentas destino (Finity `external_accounts`) + wallets. Dedup + borrado en proveedor. |
| Landing | `components/LandingPage.tsx` | Marketing. **Rebrand a Lincoln.** |

## 3. Admin Empresas

| Área | Archivo(s) |
|---|---|
| Panel admin | `components/AdminDashboard.tsx` (login: `components/AdminEmpresasApp.tsx`) |
| Sección GasFree USDT (cripto) | `components/AdminGasFreeSection.tsx` |
| Sección OTC | `components/AdminOtcSection.tsx` |
| Datos admin (service-role) | edge function `admin-data` |

## 4. CRIPTO — USDT / GasFree (esto es lo que Lincoln SÍ conserva)

> En CuyPay lo **removemos**; en Lincoln es núcleo. Archivos:

| Pieza | Archivo(s) | Qué hace |
|---|---|---|
| Edge function GasFree | `supabase/functions/gasfree/index.ts` | Wallets USDT-TRON gasless derivadas de una mnemónica maestra. Depósitos, envíos, barridos, multi-wallet, conversión no-caja. **Secrets: `GASFREE_TRON_MNEMONIC`/`TATUM_TRON_MNEMONIC`.** |
| Wallet USDT en el dashboard | `components/PersonalDashboard.tsx` | Tarjeta "USDT · GasFree · TRON", modal de depósito (QR), verificación de depósito, auto-refresh de saldo on-chain. |
| Multi-wallet (studios/negocios) | `components/WalletsGasfreeSection.tsx` | Crear/archivar/renombrar/enviar varias wallets USDT. |
| Tatum (legado on-chain) | `supabase/functions/tatum-wallet/index.ts`, `tatum-webhook/index.ts` | Wallets/depósitos vía Tatum. |
| Admin cripto | `components/AdminGasFreeSection.tsx` | Tesorería GasFree, recuperación, auditoría de índices. |

## 5. OTC — conversión USD/USDT → COP (Lincoln conserva)

| Pieza | Archivo(s) | Qué hace |
|---|---|---|
| UI del convertidor | `components/FinitySection.tsx` | Convertidor OTC: tasa en vivo (30s), flujo no-caja (recarga→confirma→convierte→acredita), reintento, guardas anti-cierre. |
| Proxy proveedor (Finity) | `supabase/functions/finity-proxy/index.ts` | Auth OAuth, rates/convert/convert_confirm, external accounts, balances portal. |
| Webhook Finity | `supabase/functions/finity-webhook/index.ts` | Estados de dispersión. |
| Proxy proveedor (Mouv, nuevo) | `supabase/functions/mouv-proxy/index.ts` | **En construcción.** Rails Colombia BREB/ACH/PSE. Auth API key `MOUV_API_KEY`. Base `https://consola.mouvlatam.com/api`. |
| Gráfico de tasa | `components/FinityRateChart.tsx` | |
| OTC admin | `components/AdminOtcSection.tsx`, `AdminPersonas/sections/AccountingSection.tsx` | Contabilidad OTC. |

## 6. Compliance / KYC-KYB / notificaciones (ambos productos las usan)

| Pieza | Archivo(s) |
|---|---|
| KYC/KYB (Didit) | `supabase/functions/didit-kyc/index.ts`, `didit-aml-monitor/index.ts` |
| Correos transaccionales | `supabase/functions/notify-transaction/index.ts`, `notify-account-events`, `notify-limit-increase`, `send-compliance-email` |
| Admin Personas (referencia) | `components/AdminPersonas/**` (compliance, tesorería, tasas, soporte, legal, etc.) |

## 7. Edge functions (lista completa)

`admin-data`, `admin-login`, `crisp-proxy`, `delete-self`, `didit-aml-monitor`,
`didit-kyc`, `fastforex-sync`, `finity-proxy`, `finity-webhook`, `fx-snapshot`,
`gasfree`, `get-system-config`, `mouv-proxy`, `notify-account-events`,
`notify-limit-increase`, `notify-transaction`, `send-compliance-email`,
`tatum-wallet`, `tatum-webhook`, `user-login`.
Deploy vía `.github/workflows/deploy-edge-functions.yml`.

## 8. Qué debe cambiar para Lincoln (checklist)

1. **Branding**: nombre, logo, colores, textos "CuyPay" → "Lincoln". Ver `components/Logo.tsx`, landing, correos (`notify-*`), y el SVG inline del logo en varios componentes.
2. **Proyectos Supabase**: crear (o apuntar a) los proyectos Supabase de Lincoln y cambiar URLs/keys en `lib/supabaseClient.ts` y en las env (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, y las de Personas si aplica).
3. **Secrets de edge functions** (nuevos, del proyecto de Lincoln): `GASFREE_TRON_MNEMONIC`, `FINITY_CLIENT_ID/SECRET`, `MOUV_API_KEY`, `ADMIN_PASS`, claves de Didit, etc.
4. **Dominios/URLs**: reemplazar `cuypay.com` en el código (correos, links, QR, deep-links).
5. **Migraciones SQL**: `supabase/migrations/**` — correrlas en el proyecto de Lincoln.
6. **Vercel**: variables de entorno del proyecto Lincoln.

> Como Lincoln = CuyPay-de-hoy con otro branding, la vía más rápida es **clonar
> este repo como base** y hacer el checklist de arriba, en vez de reescribir.
