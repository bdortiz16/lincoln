# Integración Lincoin ↔ Kumplo

Qué pedirle a Kumplo para conectar las dos plataformas.

## Qué queremos que pase

1. Alguien se inscribe en **Lincoin**.
2. Lincoin lo da de alta automáticamente en **Kumplo**.
3. Lincoin le pide a Kumplo la **consulta AML**.
4. Según el resultado:
   - **Riesgo bajo o medio** → la persona opera con normalidad.
   - **Riesgo alto** → Lincoin muestra *"Riesgo alto — no se puede transferir"* y bloquea los envíos.

El expediente, los documentos y lo contable siguen viviendo en Kumplo. Lincoin solo consulta y aplica el veredicto.

---

## Lo que necesitamos de Kumplo

Esto es lo que hay que pedirles textualmente. Son cinco cosas.

### 1. Una credencial de API para producción

Una llave (API key o token) a nombre de **XATECH SERVICES SAS**, con permiso para crear personas y lanzar consultas AML.

Preguntar también:
- ¿Cómo esperan la credencial? ¿`Authorization: Bearer <llave>`, `x-api-key: <llave>`, otra?
- ¿Vence? ¿Cada cuánto hay que rotarla?
- ¿Hay una llave de pruebas (sandbox) separada de la de producción?

### 2. La dirección base de su API

Por ejemplo `https://api.usekumplo.com/v1`. Y si existe un ambiente de pruebas, su dirección también.

### 3. El endpoint para dar de alta a una persona

Método, ruta y el cuerpo que esperan. Nosotros podemos enviar:

| Dato | Ejemplo |
|---|---|
| Referencia externa | el id de la persona en Lincoin — sirve para conciliar después |
| Nombre completo | |
| Documento y tipo | CC 1090076866 |
| Correo | |
| Teléfono | |
| País | CO |

Necesitamos que la respuesta incluya **el id que Kumplo le asigna a esa persona**, y saber en qué campo del JSON viene (por ejemplo `data.id`).

**Importante:** preguntar qué pasa si la persona **ya existe** en Kumplo (mismo documento). ¿Devuelve el id existente, o da error? Nos sirve más que devuelva el existente.

### 4. El endpoint de la consulta AML

Método, ruta y cuerpo. Y sobre la respuesta:

- ¿En qué campo viene el nivel de riesgo? (por ejemplo `data.risk.level`)
- ¿Qué valores puede tomar? (`low` / `medium` / `high`, o un puntaje 0–100, o lo que usen)
- ¿La consulta es **inmediata** o **asíncrona**? Si tarda, ¿cómo avisan cuando termina — un webhook, o hay que volver a consultar?

### 5. Un webhook para el monitoreo continuo *(lo más importante a mediano plazo)*

Una persona puede salir limpia hoy y aparecer en una lista dentro de tres meses. Necesitamos que Kumplo nos avise cuando el riesgo de alguien **cambie**, sin que tengamos que preguntar.

Pedirles:
- Que puedan enviar un POST a una URL nuestra cuando el riesgo cambie.
- Que el envío venga firmado o con un secreto compartido, para que nadie pueda falsificarlo.
- Qué eventos existen y qué trae cada uno.

---

## Correo para enviarles

> Hola,
>
> Somos XATECH SERVICES SAS. Queremos conectar nuestra plataforma (Lincoin) con Kumplo por API, para que al inscribirse un usuario en Lincoin quede automáticamente creado en Kumplo y se dispare la consulta AML. Según el resultado, Lincoin habilita o bloquea las transferencias de esa persona.
>
> Para eso necesitamos:
>
> 1. Credencial de API para nuestra empresa (y una de pruebas, si existe), indicando cómo esperan que viaje: `Authorization: Bearer`, `x-api-key`, u otra.
> 2. La dirección base de la API y, si aplica, la del ambiente de pruebas.
> 3. Documentación del endpoint para **crear una persona**: método, ruta y cuerpo. Necesitamos poder enviar una referencia externa (nuestro id) y que la respuesta incluya el id que ustedes asignan. ¿Qué ocurre si la persona ya existe con el mismo documento?
> 4. Documentación del endpoint de **consulta AML**: método, ruta, cuerpo, y en qué campo de la respuesta viene el nivel de riesgo y qué valores puede tomar. ¿Es inmediata o asíncrona?
> 5. Si tienen **webhooks** para avisar cuando el riesgo de una persona cambia (monitoreo continuo), la documentación y cómo se firman los envíos.
>
> También nos sirve saber si hay límites de peticiones por minuto y a quién escribir si algo falla en producción.
>
> Gracias,

---

## Lo que ya está construido del lado de Lincoin

Todo listo y esperando esos datos. **Nada de la API de Kumplo está escrito en el código** — se configura desde el panel, así que el día que llegue la documentación se llenan los campos y funciona.

### Admin → Sistema → Kumplo

- Interruptor de encendido. **Arranca apagada** y no se deja encender hasta que estén la dirección base, las dos rutas y la credencial. Encender algo que no puede responder solo produce clientes bloqueados sin motivo.
- Los campos: dirección base, cabecera y prefijo de la credencial, id de la empresa, ruta de alta, ruta AML, ruta de estado.
- El mapeo de la respuesta: en qué campo viene el id, en qué campo viene el riesgo, y qué valores significan alto y medio. Si el riesgo llega como número 0–100, también se entiende (≥70 alto, ≥40 medio).
- **Cuentas en la prueba**: una lista de ids. Vacío = todas. Mientras esto sea una prueba conviene empezar con una o dos.
- Botón de probar la conexión, y el listado de personas ya evaluadas con su riesgo.

### Configuración del usuario → Kumplo

Se ve el resultado (bajo / medio / alto), la fecha de la última revisión y el id en Kumplo. Si la persona ya tenía expediente allá, puede pegar su id para vincularlo. **La tarjeta no aparece** si la integración está apagada o si la cuenta no entra en la prueba.

### El bloqueo

Vive en el servidor, en el mismo punto por donde ya pasa toda operación que mueve dinero (`assertNotBlocked` en la función `gasfree`). Ponerlo solo en la pantalla sería un letrero, no un control: la API se puede llamar directamente.

**Falla abierto a propósito.** Si la configuración está a medias, si Kumplo no ha respondido todavía, o si la lectura se cae, la cuenta opera. Un control de cumplimiento a medio conectar no puede dejar sin transferir a un cliente legítimo. Solo bloquea cuando hay un veredicto explícito de riesgo alto.

### El veredicto no se puede falsificar

El resultado se guarda en `raw_data.kumplo` y esa clave quedó protegida: solo la escribe el servidor. Si un cliente pudiera escribirla, se pondría "riesgo bajo" a sí mismo y el control dejaría de existir.

Hay que correr la migración `supabase/migrations/2026_kumplo_protected_key.sql` para que esa protección quede activa en la base.

### La credencial

Va en la Bóveda como `KUMPLO_API_KEY`. Nunca se guarda en la base de datos ni se devuelve al panel — el panel solo muestra si está puesta o no.

---

## Lo que falta, y conviene decidir pronto

- **Monitoreo continuo.** Hoy la consulta se hace al inscribirse. Sin el webhook de Kumplo, alguien que aparezca en una lista después queda sin detectar. Es el punto 5 de arriba y es el que más valor agrega.
- **Qué hacer con el riesgo medio.** Hoy opera igual que el bajo. Si quieren pedirle documentación adicional o ponerle un límite, hay que definir la regla.
- **Quién levanta un bloqueo por riesgo alto**, y con qué evidencia. Hoy el bloqueo se levanta solo si Kumplo cambia el veredicto.
