# Salida con IP fija hacia Gowd

Gowd exige registrar una IP de origen. Las funciones de Lincoin corren en
infraestructura serverless, donde **la IP de salida cambia entre una llamada y
otra**: no hay un número que darles. Esto crea una salida propia con IP fija.

```
Lincoin  →  Function URL  →  Lambda (subred privada)  →  NAT  →  IP fija  →  Gowd
```

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

## Cuando llegue la base de Gowd

```bash
terraform apply \
  -var="proxy_secret=$SECRETO" \
  -var="gowd_base=https://LA-BASE-DE-GOWD"
```

Esto **no cambia las IPs** — sólo actualiza la configuración de la Lambda. Las
IPs que le diste al banco siguen siendo las mismas.

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

**Cómo autentican su webhook hacia nosotros** — secreto en un header, firma
HMAC del cuerpo, o mTLS. Eso decide cómo se escribe `gowd-webhook`.

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
