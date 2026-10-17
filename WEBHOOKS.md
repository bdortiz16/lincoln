# Webhooks: por qué van bajo nuestro dominio

Las URLs que se le dan a un socio (un banco, un proveedor de correo) apuntan a
`lincoin.me/webhooks/...`, no a la URL cruda de Supabase. El reenvío está en
`vercel.json`.

> Esta explicación vivía dentro de `vercel.json` como una clave `_comment_rewrites`.
> **Vercel rechaza las propiedades que no están en su esquema**, así que el deploy
> fallaba con la configuración entera válida menos por un comentario. JSON no
> admite comentarios; el lugar de una explicación es un archivo como este.

## Tres razones, y las tres pesan

**No se revela con qué operamos.** La URL cruda dice en qué corremos y además
expone el identificador del proyecto. Es el mismo criterio por el que el
comprobante del proveedor no va al cliente.

**Se puede mudar.** Si algún día cambia el backend, la URL que el banco registró
sigue funcionando: se re-apunta acá. Cambiarle la URL de un webhook a un banco es
un trámite de semanas, no un deploy.

**Se lee como una empresa** y no como un prototipo.

## Una entrada por webhook, nunca un comodín

Con `/webhooks/:path*` se abriría un proxy a **todas** nuestras funciones bajo un
dominio de confianza, incluidas las de admin. Cada socio tiene su línea explícita.

## El catch-all va último

Vercel toma la primera regla que coincide. Si `/(.*)` → `index.html` va antes, se
traga los webhooks y el banco recibe el HTML de la app en vez de un 200.

## Las que hay hoy

| Ruta | Función | Socio |
|---|---|---|
| `/webhooks/gowd` | `gowd-webhook` | Gowd (Brasil, PIX) |
| `/webhooks/resend` | `resend-webhook` | Resend (rebotes de correo) |
