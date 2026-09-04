# Lincoin — instrucciones del proyecto

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
