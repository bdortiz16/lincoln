# Configurar el backend de Lincoin (Supabase + GasFree)

## 1. Crear el proyecto Supabase
1. En [supabase.com](https://supabase.com) → **New project** (para Empresas).
2. Copia de *Project Settings → API*:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public key** → `VITE_SUPABASE_ANON_KEY`

## 2. Crear el esquema (tablas, RPC, RLS)
**Opción A — SQL Editor (sin CLI):** pega el contenido de
`supabase/_lincoln_full_schema.sql` en *SQL Editor → New query → Run*.
(Si es muy grande y da timeout, córrelo por bloques o usa la Opción B.)

**Opción B — CLI (recomendado):**
```bash
npx supabase link --project-ref TU_REF
npx supabase db push
```

## 3. Desplegar las edge functions
```bash
npx supabase functions deploy gasfree
npx supabase functions deploy mouv-proxy
# (y las demás: notify-*, didit-kyc, admin-*, get-system-config, etc.)
```

## 4. Secrets de GasFree (Supabase → Edge Functions → Secrets)
```
GASFREE_API_KEY       = (portal GasFree)
GASFREE_API_SECRET    = (portal GasFree)
GASFREE_TRON_MNEMONIC = elder clarify before angry crumble shed trial beauty culture police hover clean
GASFREE_NET           = nile      # testnet — sin USDT real
```
> La mnemónica de arriba es SOLO para testnet (apareció en chat). Para mainnet, genera una nueva de forma segura.

## 5. Frontend (local + Vercel)
`.env` local (gitignored):
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```
En Vercel: Project → Settings → Environment Variables (las mismas).

## 6. Probar GasFree
```bash
node scripts/test-gasfree.mjs "$VITE_SUPABASE_URL" "$VITE_SUPABASE_ANON_KEY"
```
Debe responder `{ ok: true, service: "gasfree", net: "nile" }`.
Luego seguimos el flujo: derivar dirección → depósito de prueba → verificar → enviar.
