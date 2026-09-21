#  Salida con IP fija hacia Gowd (AWS).
#
#  LO QUE ARMA, Y POR QUE CADA PIEZA
#    El banco registra UNA IP. Para que exista, las llamadas tienen que salir
#    por algo nuestro con IP propia:
#
#      Lincoin → Function URL → Lambda (subred privada) → NAT → EIP → Gowd
#                                                                ↑
#                                                   esta es la IP que se registra
#
#    La Lambda va en una subred PRIVADA a propósito: una Lambda en subred
#    pública no tiene salida a internet en AWS. La salida la da el NAT, y el
#    NAT es el que tiene la IP fija.
#
#  DOS IPs, NO UNA
#    Se crean dos NAT en zonas distintas. Con una sola, el día que esa zona
#    tenga un problema Brasil deja de operar y no hay nada que hacer: agregar
#    una IP después es volver a abrir el trámite con el banco. Se registran las
#    dos desde el principio.
#
#  COSTO REAL (aproximado, São Paulo)
#    NAT Gateway: ~0,045 USD/hora cada uno → ~33 USD/mes × 2 = ~66 USD/mes
#    + tráfico (~0,045 USD/GB) + Lambda (centavos con este volumen)
#
#    Es la parte cara de esta opción y conviene tenerla a la vista: son unos
#    66 USD/mes fijos, se use o no. Si en algún momento pesa, la misma Lambda
#    funciona detrás de una sola zona (~33) o se reemplaza por un servidor
#    chico (~5).
#
#  APLICAR
#    cd infra/gowd-proxy/terraform
#    terraform init
#    terraform apply -var="proxy_secret=..." -var="gowd_base=https://..."
#
#    Al terminar imprime las dos IPs (las que van al banco) y la URL del proxy.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.0" }
    # archive: empaqueta index.mjs en el zip de la Lambda. Se declara aunque
    # Terraform lo instalaria solo, para que la version quede fijada.
    archive = { source = "hashicorp/archive", version = "~> 2.4" }
  }
}

variable "region" {
  description = "Región de AWS. sa-east-1 es São Paulo: el banco está en Brasil y la latencia cuenta."
  type        = string
  default     = "sa-east-1"
}

variable "proxy_secret" {
  description = "Secreto que Lincoin manda en x-proxy-secret. Generalo con: openssl rand -hex 32"
  type        = string
  sensitive   = true
}

variable "gowd_base" {
  description = "Base de la API del banco, sin barra final. Ej: https://api.gowd.com.br"
  type        = string
}

provider "aws" {
  region = var.region
}

data "aws_availability_zones" "disponibles" {
  state = "available"
}

locals {
  nombre = "lincoin-gowd-proxy"
  # Dos zonas: una IP por zona.
  zonas = slice(data.aws_availability_zones.disponibles.names, 0, 2)
}

# ── Red ───────────────────────────────────────────────────────────────
resource "aws_vpc" "esta" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.nombre }
}

resource "aws_internet_gateway" "esta" {
  vpc_id = aws_vpc.esta.id
  tags   = { Name = local.nombre }
}

# Subredes públicas: solo alojan los NAT.
resource "aws_subnet" "publica" {
  count                   = 2
  vpc_id                  = aws_vpc.esta.id
  cidr_block              = cidrsubnet(aws_vpc.esta.cidr_block, 8, count.index)
  availability_zone       = local.zonas[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.nombre}-publica-${count.index}" }
}

# Subredes privadas: acá vive la Lambda. Su salida pasa por el NAT.
resource "aws_subnet" "privada" {
  count             = 2
  vpc_id            = aws_vpc.esta.id
  cidr_block        = cidrsubnet(aws_vpc.esta.cidr_block, 8, count.index + 10)
  availability_zone = local.zonas[count.index]
  tags              = { Name = "${local.nombre}-privada-${count.index}" }
}

resource "aws_route_table" "publica" {
  vpc_id = aws_vpc.esta.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.esta.id
  }
  tags = { Name = "${local.nombre}-publica" }
}

resource "aws_route_table_association" "publica" {
  count          = 2
  subnet_id      = aws_subnet.publica[count.index].id
  route_table_id = aws_route_table.publica.id
}

# ── Las IPs que se le dan al banco ────────────────────────────────────
resource "aws_eip" "nat" {
  count      = 2
  domain     = "vpc"
  depends_on = [aws_internet_gateway.esta]
  tags       = { Name = "${local.nombre}-${count.index}" }
}

resource "aws_nat_gateway" "esta" {
  count         = 2
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.publica[count.index].id
  depends_on    = [aws_internet_gateway.esta]
  tags          = { Name = "${local.nombre}-${count.index}" }
}

resource "aws_route_table" "privada" {
  count  = 2
  vpc_id = aws_vpc.esta.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.esta[count.index].id
  }
  tags = { Name = "${local.nombre}-privada-${count.index}" }
}

resource "aws_route_table_association" "privada" {
  count          = 2
  subnet_id      = aws_subnet.privada[count.index].id
  route_table_id = aws_route_table.privada[count.index].id
}

# Solo salida. Nada entra a la Lambda por la red: entra por la Function URL.
resource "aws_security_group" "lambda" {
  name        = local.nombre
  description = "Salida hacia el banco. Sin reglas de entrada."
  vpc_id      = aws_vpc.esta.id
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = local.nombre }
}

# ── La función ────────────────────────────────────────────────────────
data "archive_file" "codigo" {
  type        = "zip"
  source_file = "${path.module}/../index.mjs"
  output_path = "${path.module}/.gowd-proxy.zip"
}

resource "aws_iam_role" "lambda" {
  name = local.nombre
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Lo mínimo: registrar y poder estar en la VPC. Nada más.
resource "aws_iam_role_policy_attachment" "vpc" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_lambda_function" "proxy" {
  function_name    = local.nombre
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.codigo.output_path
  source_code_hash = data.archive_file.codigo.output_base64sha256
  timeout          = 30

  vpc_config {
    subnet_ids         = aws_subnet.privada[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      PROXY_SECRET = var.proxy_secret
      GOWD_BASE    = var.gowd_base
    }
  }
}

# AUTH_TYPE NONE con el secreto propio de la función: la URL sola no alcanza
# para usarla. Firmar con IAM desde una edge function de Supabase obligaría a
# meter credenciales de AWS ahí, que es peor.
resource "aws_lambda_function_url" "proxy" {
  function_name      = aws_lambda_function.proxy.function_name
  authorization_type = "NONE"
}

# Los registros se borran solos: acá queda método, ruta y código, nunca
# cuerpos, pero guardarlos para siempre no le sirve a nadie.
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.nombre}"
  retention_in_days = 30
}

# ── Lo que hay que anotar ─────────────────────────────────────────────
output "ips_para_el_banco" {
  description = "Las dos IPs que Gowd tiene que registrar. Pedirles que acepten las DOS."
  value       = aws_eip.nat[*].public_ip
}

output "url_del_proxy" {
  description = "A donde le pega Lincoin. Va como secreto (GOWD_PROXY_URL), no en el código."
  value       = aws_lambda_function_url.proxy.function_url
}
