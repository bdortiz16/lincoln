# La puerta hacia Gowd

```
Lincoin  →  Function URL  →  Lambda (subred privada)  →  NAT  →  IP fija  →  Gowd
                                  ↑
                        acá vive el certificado mTLS
```

Esta pieza existe por **dos** razones, y la segunda es la que manda:

1. **IP fija.** Gowd registra una IP de origen. Las funciones de Lincoin corren
   en infraestructura serverless, donde la IP de salida cambia entre una llamada
   y otra: no hay un número que darles.

2. **mTLS.** Gowd exige TLS mutuo: la conexión no se abre si no presentamos el
   `.pfx` que ellos emiten. **Una edge function de Supabase no puede hacer eso** —
   su `fetch` no expone el certificado de cliente. Aunque la IP no importara,
   esto seguiría siendo obligatorio.

Además el proxy **acuña el bearer** de `/auth/v1/token`. Las credenciales del
banco quedan en un solo lugar (el mismo donde ya tiene que estar el certificado)
y Supabase nunca las ve: solo conoce el secreto del proxy. De paso la caché del
token funciona de verdad, porque Lambda reusa el contenedor entre llamadas.

## Antes de aplicar

1. **Una cuenta de AWS** con permisos para crear VPC, NAT, EIP, Lambda e IAM.
2. **Terraform** (`>= 1.5`) y **AWS CLI**.

La base de la API de Gowd **no hace falta todavía**: las IPs las producen el NAT
y la EIP, que no dependen de ella. Se aplica ahora, se sacan las IPs y se les
manda, y cuando llegue su documentación se vuelve a aplicar con la base. Así no
quedan los dos lados esperándose.

## Aplicar (primera vez, para sacar las IPs)

```bash
cd infra/gowd-proxy/terraform
terraform init

SECRETO=$(openssl rand -hex 32)
echo "GUARDA ESTO: $SECRETO"

terraform apply -var="proxy_secret=$SECRETO"
```

Sin `gowd_base`, el proxy queda **arriba pero mudo**: contesta 503 "sin
configurar" y no reenvía nada. Es el estado honesto mientras no sepamos a dónde
tiene que hablar.

## Cuando Gowd entregue el certificado y las credenciales

Hacen falta cuatro cosas de ellos: el archivo **`.pfx`**, su **contraseña**, el
**clientId** y el **clientSecret** (y los **scopes**, si no son el
`api://<clientId>/.default` por defecto).

**1. Cargar el certificado en Secrets Manager.** No va en Terraform ni en
variables de entorno — ver "Dónde vive el certificado" más abajo.

```bash
cat > gowd.json <<JSON
{
  "pfxBase64": "$(base64 -w0 client.pfx)",
  "pfxPassword": "LA-CONTRASEÑA-DEL-PFX",
  "clientId": "EL-CLIENT-ID",
  "clientSecret": "EL-CLIENT-SECRET",
  "scopes": ["api://EL-CLIENT-ID/.default"]
}
JSON

aws secretsmanager put-secret-value \
  --secret-id lincoin-gowd-proxy \
  --secret-string file://gowd.json

shred -u gowd.json client.pfx     # que no queden en el disco
```

**2. Apuntar el proxy a producción.**

```bash
terraform apply \
  -var="proxy_secret=$SECRETO" \
  -var="gowd_base=https://mtls-api-platform.gowd.com"
```

| Ambiente | Base |
|---|---|
| Sandbox | `https://mtls-api-platform-hml.gowd.com` |
| Producción | `https://mtls-api-platform.gowd.com` |

El certificado es **por ambiente**: el de sandbox no sirve en producción ni al
revés. Las credenciales también.

Esto **no cambia las IPs** — sólo actualiza la configuración de la Lambda. Las
IPs que le diste al banco siguen siendo las mismas.

## Dónde vive el certificado, y por qué ahí

En **AWS Secrets Manager**, no en variables de entorno y no en Terraform.

- **No en variables de entorno**: un `.pfx` en base64 anda por los 3–5 KB y
  Lambda limita a **4 KB el total de todas sus variables juntas**. No entra — y
  si entrara, quedaría a la vista de cualquiera que pueda abrir la función.
- **No en Terraform**: el estado guarda **en texto plano** todo lo que
  administra. El certificado de un banco terminaría en un archivo que se copia,
  se respalda y se manda por chat.

Terraform crea el contenedor vacío con `ignore_changes`, así que los `apply`
siguientes **no lo pisan**. Sin eso, cada `apply` borraría el certificado y
Brasil dejaría de operar en silencio.

## Cómo se le pega al proxy

La ruta del banco va en una cabecera nuestra, no en la URL — así este endpoint
no parece, ni puede usarse como, un proxy genérico.

```
POST  <url_del_proxy>
  x-proxy-secret: <GOWD_PROXY_SECRET>
  x-gowd-path:    /banking/v1/...
  content-type:   application/json
  <cuerpo>
```

El `Authorization` **no se manda**: lo pone el proxy con su propio token.
`/auth/v1/token` está bloqueado a propósito — si se pudiera pedir a través del
proxy, el `clientSecret` saldría en una respuesta hacia afuera.

Al terminar imprime:

- **`ips_para_el_banco`** — las dos IPs que se le pasan a Gowd.
- **`url_del_proxy`** — a dónde le pega Lincoin.

Guardá el `$SECRETO`: hace falta en el paso siguiente y no se vuelve a mostrar.

## Después de aplicar

En los secretos de Supabase (Edge Functions → Secrets):

```
GOWD_PROXY_URL     = <url_del_proxy>
GOWD_PROXY_SECRET  = <el $SECRETO de arriba>
```

Y a Gowd se le mandan **las dos IPs**, no una.

## Qué pedirle a Gowd

**Que acepten las dos.** Con una sola, el día que esa zona de AWS tenga un
problema, Brasil deja de operar y no hay nada que hacer en el momento: agregar
una IP después es volver a abrir el trámite. Se registran las dos desde el
principio, aunque una esté de reserva.

**Cómo autentican su webhook hacia nosotros.** Su documentación describe el
cuerpo del postback con todo detalle y **no menciona ninguna firma ni secreto**.
Tal como está escrito, cualquiera que descubra la URL puede mandarnos
`ORDER-PAYIN.PAID` por el monto que se le ocurra. Hay que preguntarles si existe
algún mecanismo que no esté documentado.

Mientras tanto la regla es **el postback avisa, la API confirma**: al recibir un
aviso se guarda y se despierta a quien corresponda, pero antes de mover un peso
se le pregunta a Gowd por ese id y se le cree a la respuesta, no al aviso.

## Lo que cuesta

| Pieza | Aprox. mensual |
|---|---|
| NAT Gateway × 2 (São Paulo) | ~66 USD |
| Tráfico | ~0,045 USD/GB |
| Lambda | centavos con este volumen |

**Son ~66 USD/mes fijos, se use o no.** Es la parte cara de este camino y
conviene tenerla a la vista. Si en algún momento pesa, la misma Lambda funciona
con un solo NAT (~33) — a costa de quedarse sin IP de respaldo.

## Por qué el proxy está cerrado como está

**Una IP con permiso de un banco es una credencial.** Si esto reenviara a
cualquier destino, sería un relay anónimo hablando desde una IP en la que un
banco confía: cualquiera que descubra la URL lo usa, y los registros de Gowd
dirían que fuimos nosotros.

Por eso:

- **Secreto propio para entrar**, comparado en tiempo constante — comparar con
  `===` filtra, por lo que tarda en fallar, cuántos caracteres acertaste.
- **Un único host de destino**, fijado en la configuración. La ruta viaja en una
  cabecera nuestra y se valida; no se acepta `..` ni un host absoluto.
- **El secreto del proxy NO se reenvía** al banco: si viajara, quedaría en sus
  registros.
- **Sin configuración, no reenvía nada** (503). Un proxy a medio configurar que
  deja pasar es peor que uno caído.
- **No se registran los cuerpos.** Método, ruta, código y duración. Nada más:
  por acá pasan datos de clientes y montos.

## Un detalle que importa con dinero

Cuando el banco no contesta a tiempo, el proxy devuelve **504 con
`desenlaceDesconocido: true`**, no 500.

No es cosmético: un timeout **no significa que la operación no se hizo**. El
banco pudo haberla recibido. Quien llama tiene que poder distinguir "falló" de
"no sé", porque de eso depende si se puede reintentar — y reintentar una
transferencia que sí salió es pagar dos veces.

## Si alguna vez hay que dar de baja esto

```bash
terraform destroy
```

Las IPs se liberan. **Avisarle a Gowd antes**: si las sueltan y ellos las
siguen teniendo registradas, esas IPs se las puede asignar AWS a cualquier otro.
