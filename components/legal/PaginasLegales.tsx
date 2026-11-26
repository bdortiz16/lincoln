// ════════════════════════════════════════════════════════
// Documentos legales y de confianza de la página pública de Lincoin.
//
// Lincoin es una pasarela de pagos para EMPRESAS en Colombia (cobrar y pagar
// en pesos por Bre-B y ACH). Reglas que estos textos respetan (CLAUDE.md):
//   · no somos banco y no tenemos licencia ni registro regulatorio: nunca se
//     dice "regulado", "vigilado", "licenciado" ni "auditado por" un regulador;
//   · sí se dice que Lincoin implementa su SARLAFT y verifica a cada empresa;
//   · los aliados de infraestructura de pagos NO se nombran;
//   · no se publican tarifas (cada operación muestra la suya antes de
//     confirmarla) ni se habla de USDT/EURT o envíos entre países.
//
// Antes estas páginas describían el producto viejo (dólares digitales,
// custodia, emisores) y nombraban aliados; los términos eran tan cortos que no
// cubrían lo que de verdad pasa: errores en datos del destinatario, órdenes de
// autoridades, bloqueos por SARLAFT, límites de responsabilidad, reclamos.
// Son una base sólida, pero deben pasar por revisión de un abogado colombiano.
// ════════════════════════════════════════════════════════

import React from 'react';
import { FileText, Lock, ShieldCheck, Mail, Users, Scale, Activity } from 'lucide-react';
import { DATOS_LINCOIN, FECHA_LEGAL, VERSION_LEGAL, identificacionLincoin } from '../../lib/datosLegales';

const VERDE = '#22A35C';
const correo = DATOS_LINCOIN.correo;

const Correo: React.FC<{ asunto?: string }> = ({ asunto }) => (
  <a href={`mailto:${correo}${asunto ? `?subject=${encodeURIComponent(asunto)}` : ''}`} className="font-semibold" style={{ color: VERDE }}>{correo}</a>
);

const Enlace: React.FC<{ a: string; children: React.ReactNode }> = ({ a, children }) => (
  <a href={a} className="font-semibold underline" style={{ color: VERDE }}>{children}</a>
);

const Vigencia: React.FC = () => (
  <p className="text-xs text-slate-400 m-0">Versión {VERSION_LEGAL} · Última actualización: {FECHA_LEGAL}</p>
);

const S: React.FC<{ n?: string; t: string; children: React.ReactNode }> = ({ n, t, children }) => (
  <section className="space-y-3">
    <h3 className="text-lg font-bold text-[#0C0E0D] m-0">{n ? `${n}. ` : ''}{t}</h3>
    {children}
  </section>
);

const L: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
  <ul className="list-disc pl-5 space-y-2 m-0">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
);

const Nota: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm leading-relaxed">{children}</div>
);

const Cuerpo: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="space-y-7 text-slate-600 leading-relaxed">{children}</div>
);

// Lo que Lincoin NO es. Va igual en varios documentos para que no haya dos
// versiones distintas de la misma afirmación.
const QueNoEs: React.FC = () => (
  <Nota>
    <strong className="text-[#0C0E0D]">Lincoin no es un banco.</strong> No es un establecimiento de crédito, una sociedad
    especializada en depósitos y pagos electrónicos ni una entidad vigilada por la Superintendencia Financiera de Colombia.
    Los saldos de una cuenta Lincoin <strong>no son depósitos</strong>, no generan intereses, no están amparados por el
    seguro de depósitos de Fogafín y Lincoin no otorga créditos con ellos. Los pagos se procesan a través de aliados de
    infraestructura de pagos en Colombia, cada uno responsable de su propia función y cumplimiento.
  </Nota>
);

// ─────────────────────────────────────────────
// Términos y condiciones
// ─────────────────────────────────────────────
const Terminos: React.FC = () => (
  <Cuerpo>
    <Vigencia />
    <p>
      Estos Términos y Condiciones (los "Términos") regulan el uso de la plataforma y de los servicios de {identificacionLincoin()} ("Lincoin")
      por parte de las empresas que abren una cuenta y de las personas que actúan en su nombre. Léelos completos: al registrarte,
      marcar la casilla de aceptación o usar los servicios, la empresa y quien la representa los aceptan de forma expresa, con plenos
      efectos legales (Ley 527 de 1999 sobre mensajes de datos y comercio electrónico). Si no estás de acuerdo, no uses Lincoin.
    </p>
    <QueNoEs />

    <S n="1" t="Definiciones">
      <L items={[
        <><strong>Empresa:</strong> la persona jurídica (o el comerciante) titular de la cuenta, verificada por Lincoin.</>,
        <><strong>Operador:</strong> la persona del equipo de la Empresa a quien ella da acceso a la cuenta. Lo que hace un Operador se entiende hecho por la Empresa.</>,
        <><strong>Cuenta:</strong> el registro en Lincoin donde la Empresa ve sus saldos, cobros, pagos y comprobantes.</>,
        <><strong>Saldo:</strong> el valor en pesos colombianos disponible para la Empresa, que refleja sus cobros recibidos menos sus pagos, tarifas y ajustes.</>,
        <><strong>Cobro:</strong> el dinero que la Empresa recibe, por ejemplo por su llave Bre-B o por un link de pago.</>,
        <><strong>Pago:</strong> la orden que da la Empresa para enviar dinero a un beneficiario en una entidad financiera en Colombia, por Bre-B o por ACH.</>,
        <><strong>Beneficiario:</strong> la persona o empresa que recibe un pago, inscrita por la Empresa en su Cuenta.</>,
        <><strong>Aliados:</strong> las entidades y proveedores de infraestructura de pagos, verificación y tecnología a través de los cuales Lincoin presta el servicio.</>,
      ]} />
    </S>

    <S n="2" t="Qué hace Lincoin">
      <p>
        Lincoin es una plataforma tecnológica que le permite a una Empresa cobrar y pagar en pesos colombianos desde una sola cuenta,
        a través de los rieles de pago de Colombia (Bre-B y ACH) y de los Aliados. Lincoin no presta servicios de captación de recursos del
        público, de crédito, de cambio de divisas ni de inversión, y no ofrece asesoría financiera, contable ni tributaria.
      </p>
      <p>
        La ejecución de cada pago o cobro depende de los sistemas de pago, de las entidades financieras de origen y destino y de los Aliados.
        Lincoin no controla esos sistemas y no garantiza tiempos de acreditación distintos a los que ellos permitan.
      </p>
    </S>

    <S n="3" t="Quién puede usar Lincoin">
      <L items={[
        'Empresas legalmente constituidas y vigentes, a través de su representante legal o de un apoderado con facultades suficientes.',
        'Operadores autorizados por la Empresa. Lincoin no abre cuentas a personas naturales para su uso personal.',
        'Quien acepta estos Términos declara que tiene capacidad legal y facultades para obligar a la Empresa.',
        'No pueden usar Lincoin personas o empresas incluidas en listas restrictivas o vinculantes para Colombia, ni quienes realicen las actividades prohibidas del numeral 10.',
      ]} />
    </S>

    <S n="4" t="Registro y verificación de la Empresa (KYB)">
      <p>
        Para abrir y mantener la Cuenta, la Empresa debe entregar información completa, veraz y actualizada, y los documentos que Lincoin
        solicite (por ejemplo: certificado de existencia y representación legal, RUT, documento del representante legal, composición
        accionaria, beneficiarios finales, declaración de origen de fondos y datos de contacto). Lincoin puede verificar esa información con
        fuentes públicas y privadas y con listas restrictivas, y puede pedir información adicional en cualquier momento.
      </p>
      <p>
        Lincoin puede negar la apertura de una Cuenta, limitarla o condicionar su uso cuando la información sea incompleta, inconsistente o
        no pueda verificarse, o cuando así lo indiquen sus políticas de riesgo, sin estar obligado a explicar los motivos cuando la ley o la
        prevención de LA/FT lo impidan. La Empresa debe informar a Lincoin, dentro de los diez (10) días hábiles siguientes, cualquier cambio en
        su información (representación legal, accionistas, beneficiarios finales, domicilio, actividad) y actualizarla al menos una vez al año.
      </p>
    </S>

    <S n="5" t="Operadores, credenciales y seguridad">
      <L items={[
        'La Empresa decide quién es Operador y qué puede hacer, y responde por todas las operaciones hechas con las credenciales de sus Operadores.',
        'Las credenciales (correo, contraseña, códigos de verificación y llaves de dispositivo) son personales e intransferibles. La Empresa debe custodiarlas y activar la verificación en dos pasos, que es obligatoria para enviar dinero.',
        'Si una credencial se pierde o se ve comprometida, la Empresa debe avisar de inmediato a Lincoin. Hasta ese aviso, las operaciones hechas con credenciales válidas se tienen por autorizadas por la Empresa.',
        'Lincoin nunca pide contraseñas ni códigos de verificación por teléfono, mensajes o correo.',
      ]} />
    </S>

    <S n="6" t="Cobros">
      <p>
        Los cobros se reflejan en el Saldo cuando el Aliado o el sistema de pagos correspondiente los confirma. Lincoin puede retener,
        dejar en revisión o devolver un cobro cuando no pueda confirmarse, cuando se identifique un error, fraude o una señal de alerta, o
        cuando así lo ordene una autoridad. La Empresa es responsable frente a sus propios clientes por los bienes o servicios que vende:
        Lincoin no es parte de esa relación ni responde por ella.
      </p>
      <p>
        Si un cobro se acredita por error, o un pagador o su entidad lo revierte conforme a las reglas del sistema de pagos, Lincoin podrá
        descontar ese valor del Saldo. Si el Saldo no alcanza, la Empresa debe pagar la diferencia a Lincoin cuando se le requiera.
      </p>
    </S>

    <S n="7" t="Pagos a beneficiarios">
      <L items={[
        'La Empresa es la única responsable de los datos del beneficiario (nombre, documento, entidad, tipo y número de cuenta o llave Bre-B) y del monto. Lincoin ejecuta la orden con los datos que la Empresa entrega y no está obligado a comprobar que el beneficiario sea quien la Empresa cree.',
        'Los pagos por Bre-B son inmediatos y, una vez aceptados por el sistema, por regla general no pueden reversarse. Un pago a un destinatario equivocado por un error de la Empresa debe recuperarse directamente con quien lo recibió; Lincoin colaborará en lo que esté a su alcance, sin garantizar el resultado.',
        'Los pagos por ACH se procesan en los ciclos del sistema y pueden ser rechazados por la entidad de destino (por ejemplo, por cuenta inexistente o datos que no coinciden). Si un pago es rechazado o devuelto, el valor vuelve al Saldo cuando el Aliado lo confirma, menos los costos que ya se hayan causado, si los hay.',
        'Lincoin puede exigir que los beneficiarios estén inscritos y verificados antes de pagarles, aplicar límites y cupos por operación, por beneficiario y por periodo, y dejar un pago en revisión o rechazarlo por razones de seguridad, de cumplimiento o por orden de autoridad.',
        'Una orden confirmada con la verificación en dos pasos se tiene como impartida por la Empresa.',
      ]} />
    </S>

    <S n="8" t="Tarifas, impuestos y facturación">
      <p>
        Cada operación muestra su tarifa antes de confirmarla; al confirmarla, la Empresa la acepta y autoriza a Lincoin a descontarla del
        Saldo. Las tarifas pueden cambiar en el futuro; los cambios se informan en la plataforma antes de aplicarse y no afectan operaciones
        ya confirmadas. Lincoin expide factura electrónica por sus servicios. Cada parte responde por sus propias obligaciones tributarias; la
        Empresa es responsable de declarar, retener y pagar los impuestos que le correspondan por sus operaciones, y Lincoin practicará las
        retenciones y entregará la información a las autoridades cuando la ley lo exija.
      </p>
    </S>

    <S n="9" t="Prevención de lavado de activos y financiación del terrorismo">
      <p>
        Lincoin implementa un Sistema de Administración del Riesgo de Lavado de Activos y de la Financiación del Terrorismo (SARLAFT),
        descrito en su <Enlace a="/sarlaft">Política SARLAFT</Enlace>, que hace parte de estos Términos. En desarrollo de ese sistema, Lincoin puede,
        sin previo aviso y sin responsabilidad frente a la Empresa: solicitar soportes de cualquier operación y del origen de los fondos;
        suspender, retener o rechazar operaciones; bloquear temporalmente la Cuenta; terminar la relación; y reportar a la Unidad de
        Información y Análisis Financiero (UIAF) y a las autoridades competentes, sin informar de ello a la Empresa cuando la ley lo prohíba.
      </p>
      <p>
        La Empresa declara que sus recursos y los de sus clientes provienen de actividades lícitas, que no usará Lincoin para actividades
        ilícitas y que entregará la información que se le solicite. Información falsa o la negativa a entregarla es causal de terminación inmediata.
      </p>
    </S>

    <S n="10" t="Actividades prohibidas">
      <p>La Empresa no puede usar Lincoin, directamente o a través de terceros, para:</p>
      <L items={[
        'Lavado de activos, financiación del terrorismo o de la proliferación de armas de destrucción masiva, o cualquier delito.',
        'Captar recursos del público, hacer pirámides, esquemas de multinivel no autorizados o "pagadiarios" ilegales.',
        'Juegos de suerte y azar no autorizados por la autoridad competente, o venta de bienes o servicios prohibidos o sin los permisos exigidos.',
        'Recibir o enviar dinero a nombre de terceros que no sean sus propios clientes, proveedores, empleados o contratistas, o "prestar" la Cuenta.',
        'Fraccionar operaciones para evadir límites o controles, o suministrar información falsa.',
        'Operar con personas incluidas en listas restrictivas o vinculantes para Colombia.',
        'Interferir con la plataforma, vulnerar su seguridad, usarla de forma automatizada no autorizada o hacer ingeniería inversa.',
      ]} />
    </S>

    <S n="11" t="Órdenes de autoridades">
      <p>
        Lincoin cumplirá las órdenes y requerimientos de autoridades judiciales y administrativas competentes (entre otras, jueces, Fiscalía
        General de la Nación, DIAN, UIAF y superintendencias), incluidos embargos, retenciones e informes. Cumplirlos no genera
        responsabilidad para Lincoin frente a la Empresa. Cuando la ley lo permita, Lincoin informará a la Empresa.
      </p>
    </S>

    <S n="12" t="Disponibilidad del servicio">
      <p>
        Lincoin procura que la plataforma esté disponible de forma continua, pero no garantiza que funcione sin interrupciones ni errores.
        Puede haber mantenimientos, fallas de los sistemas de pago, de las entidades financieras, de los Aliados, de internet o de terceros, y
        eventos de fuerza mayor o caso fortuito. En esos casos las operaciones pueden demorarse, quedar en revisión o tener que repetirse.
        Lincoin no responde por demoras o fallas que no le sean imputables.
      </p>
    </S>

    <S n="13" t="Errores, conciliación y plazo para reportar">
      <p>
        La Empresa debe revisar sus movimientos y comprobantes y reportar cualquier inconsistencia dentro de los treinta (30) días calendario
        siguientes a la operación, por los canales de <Enlace a="/reclamaciones">Reclamaciones</Enlace>. Pasado ese plazo sin reporte, los movimientos se
        entienden aceptados, sin perjuicio de los derechos que la ley no permita renunciar. Lincoin puede corregir en cualquier momento los
        errores de registro o acreditación que encuentre, informando a la Empresa.
      </p>
    </S>

    <S n="14" t="Limitación de responsabilidad">
      <p>En la máxima medida permitida por la ley colombiana:</p>
      <L items={[
        'Lincoin responde solo por los daños directos y probados que cause por su culpa en la prestación del servicio, y no por lucro cesante, pérdida de oportunidades, daño reputacional ni daños indirectos o consecuenciales.',
        'Lincoin no responde por errores en los datos entregados por la Empresa, por el uso de las credenciales de la Empresa o sus Operadores, por actos de terceros ajenos a Lincoin, ni por las decisiones de los sistemas de pago, las entidades financieras o las autoridades.',
        'La responsabilidad total de Lincoin por cualquier reclamación relacionada con la Cuenta no excederá el valor de las tarifas pagadas por la Empresa a Lincoin en los tres (3) meses anteriores al hecho que la origina, salvo dolo o culpa grave de Lincoin.',
      ]} />
    </S>

    <S n="15" t="Indemnidad">
      <p>
        La Empresa mantendrá indemne a Lincoin, sus accionistas, administradores, empleados y Aliados frente a reclamaciones, sanciones,
        multas, costos y gastos (incluidos honorarios razonables de abogados) que se deriven del incumplimiento de estos Términos o de la
        ley por parte de la Empresa o de sus Operadores, de información falsa, o de las operaciones con sus propios clientes, proveedores o terceros.
      </p>
    </S>

    <S n="16" t="Suspensión, cierre y terminación">
      <L items={[
        'La Empresa puede pedir el cierre de su Cuenta cuando no tenga operaciones en curso. El Saldo disponible se le pagará a una cuenta a nombre de la propia Empresa, después de las verificaciones que correspondan.',
        'Lincoin puede terminar la relación con aviso de treinta (30) días calendario, o de inmediato y sin aviso cuando haya incumplimiento de estos Términos, información falsa, señales de alerta de LA/FT, inclusión en listas restrictivas, orden de autoridad o riesgo para Lincoin, sus clientes o los Aliados.',
        'Mientras se adelanta una verificación, Lincoin puede suspender temporalmente la Cuenta o retener fondos por el tiempo razonablemente necesario o el que ordene la autoridad.',
        'Las obligaciones pendientes, la información que deba conservarse y las cláusulas que por su naturaleza deban seguir vigentes sobreviven a la terminación.',
      ]} />
    </S>

    <S n="17" t="Conservación de información">
      <p>
        Lincoin conserva los soportes de la relación y de las operaciones por el término que exige la ley (como mínimo diez (10) años, en
        los términos del artículo 60 del Código de Comercio y las normas de prevención de LA/FT), aun después de cerrada la Cuenta.
      </p>
    </S>

    <S n="18" t="Datos personales y confidencialidad">
      <p>
        Los datos personales se tratan según la <Enlace a="/privacidad">Política de Tratamiento de Datos Personales</Enlace>, que hace parte de estos
        Términos. La Empresa declara que cuenta con la autorización de los titulares (sus representantes, accionistas, empleados, Operadores,
        beneficiarios y clientes) para entregar sus datos a Lincoin con las finalidades allí descritas. Cada parte guardará reserva sobre la
        información confidencial de la otra, salvo cuando la ley o una autoridad exijan revelarla.
      </p>
    </S>

    <S n="19" t="Propiedad intelectual">
      <p>
        La marca Lincoin, la plataforma, su software, diseño y contenidos pertenecen a Lincoin o a sus licenciantes. La Empresa recibe un
        derecho de uso limitado, no exclusivo e intransferible mientras su Cuenta esté activa, solo para su operación propia.
      </p>
    </S>

    <S n="20" t="Comunicaciones">
      <p>
        Las comunicaciones de Lincoin se envían al correo registrado de la Empresa o se publican en la plataforma, y se entienden recibidas al
        enviarse. La Empresa debe mantener su correo actualizado. Las comunicaciones de la Empresa a Lincoin se dirigen a <Correo />.
      </p>
    </S>

    <S n="21" t="Cambios a estos Términos">
      <p>
        Lincoin puede modificar estos Términos. La versión vigente se publica en <Enlace a="/terminos">{DATOS_LINCOIN.sitio}/terminos</Enlace> con su fecha.
        Los cambios que afecten de forma sustancial los derechos de la Empresa se informarán con al menos quince (15) días calendario de
        anticipación. Si la Empresa no está de acuerdo, puede cerrar su Cuenta antes de que entren en vigor; usarla después significa que los acepta.
      </p>
    </S>

    <S n="22" t="Cesión">
      <p>
        La Empresa no puede ceder su Cuenta ni estos Términos sin autorización escrita de Lincoin. Lincoin puede cederlos a una sociedad de su
        grupo, a un sucesor o a quien adquiera su negocio, informándolo a la Empresa.
      </p>
    </S>

    <S n="23" t="Ley aplicable y solución de controversias">
      <p>
        Estos Términos se rigen por las leyes de la República de Colombia. Cualquier diferencia se intentará resolver primero de forma
        directa, mediante una reclamación por los canales de <Enlace a="/reclamaciones">Reclamaciones</Enlace>, durante un plazo de treinta (30) días
        calendario. Si no se llega a un acuerdo, la controversia se someterá a los jueces competentes de la República de Colombia.
      </p>
    </S>

    <S n="24" t="Disposiciones finales">
      <p>
        Si alguna cláusula se declara inválida, las demás siguen vigentes. Que Lincoin no ejerza un derecho no significa que renuncie a él.
        Estos Términos, junto con la Política de Tratamiento de Datos, la Política SARLAFT y las condiciones particulares que se muestren en
        cada operación, constituyen el acuerdo completo entre las partes.
      </p>
      <p>Dudas sobre estos Términos: <Correo asunto="Términos y condiciones" />.</p>
    </S>
  </Cuerpo>
);

// ─────────────────────────────────────────────
// Política de tratamiento de datos personales (Ley 1581 de 2012)
// ─────────────────────────────────────────────
const Privacidad: React.FC = () => (
  <Cuerpo>
    <Vigencia />
    <p>
      Esta Política explica cómo {identificacionLincoin()} ("Lincoin"), como responsable del tratamiento, recolecta, usa, guarda y protege los
      datos personales, en cumplimiento de la Ley 1581 de 2012, el Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015) y las demás
      normas que los modifiquen o complementen.
    </p>

    <S n="1" t="Responsable y contacto">
      <L items={[
        <><strong>Responsable:</strong> {identificacionLincoin()}.</>,
        <><strong>Correo para ejercer tus derechos:</strong> <Correo asunto="Datos personales" /> (asunto: "Datos personales").</>,
        ...(DATOS_LINCOIN.telefono ? [<><strong>Teléfono:</strong> {DATOS_LINCOIN.telefono}</>] : []),
        <><strong>Sitio:</strong> {DATOS_LINCOIN.sitio}</>,
      ]} />
    </S>

    <S n="2" t="A quién aplica y qué datos tratamos">
      <p>Tratamos datos de los representantes legales, apoderados, accionistas, beneficiarios finales y Operadores de las empresas clientes,
        de los beneficiarios y pagadores de sus operaciones, y de quienes visitan el sitio o nos escriben. Según el caso:</p>
      <L items={[
        'Identificación: nombre, tipo y número de documento, fecha de nacimiento, nacionalidad, firma.',
        'Contacto: correo, teléfono, dirección y ciudad.',
        'Información de la empresa y su vinculación: cargo, participación accionaria, calidad de persona expuesta políticamente (PEP).',
        'Financiera y transaccional: cuentas bancarias, llaves Bre-B, cobros, pagos, montos, fechas, contrapartes y comprobantes.',
        'Verificación: resultados de consultas en listas restrictivas, antecedentes y fuentes públicas.',
        'Técnica: dirección IP, dispositivo, navegador, ubicación aproximada, registros de ingreso y de seguridad.',
        'Imágenes de documentos y, cuando el proceso de verificación lo requiera, fotografía del rostro (ver numeral 5).',
      ]} />
      <p>No tratamos de forma intencional datos de niñas, niños y adolescentes.</p>
    </S>

    <S n="3" t="Para qué los usamos (finalidades)">
      <L items={[
        'Abrir, verificar (KYB/KYC) y administrar la cuenta de la empresa y de sus Operadores.',
        'Ejecutar cobros y pagos, inscribir y verificar beneficiarios, emitir comprobantes y facturas, y atender reclamos.',
        'Prevenir el fraude, el lavado de activos, la financiación del terrorismo y la de la proliferación de armas de destrucción masiva, incluido el monitoreo de operaciones, las consultas en listas y los reportes a la UIAF.',
        'Cumplir obligaciones legales, contables, tributarias y requerimientos de autoridades.',
        'Proteger la seguridad de la plataforma: verificación en dos pasos, alertas de ingreso y bloqueo ante intentos sospechosos.',
        'Enviar avisos sobre la cuenta y sus operaciones, y comunicaciones sobre cambios del servicio.',
        'Con autorización previa y separada, enviar información comercial. Puedes revocarla en cualquier momento sin afectar el servicio.',
        'Elaborar estadísticas y mejorar el servicio con información agregada o anonimizada.',
      ]} />
    </S>

    <S n="4" t="Autorización">
      <p>
        Tratamos los datos con autorización previa, expresa e informada del titular, que se obtiene al registrarse, al aceptar estos documentos
        o por cualquier medio que permita su consulta posterior, salvo en los casos en que la ley no la exige (por ejemplo, información
        requerida por una autoridad o datos de naturaleza pública).
      </p>
      <p>
        Cuando una empresa nos entrega datos de terceros (sus representantes, accionistas, empleados, Operadores, beneficiarios o clientes),
        declara que cuenta con la autorización de esos titulares para entregarlos a Lincoin con las finalidades de esta Política, y responde por ello.
      </p>
    </S>

    <S n="5" t="Datos sensibles">
      <p>
        La fotografía del rostro y los datos biométricos son datos sensibles. Su entrega es facultativa: nadie está obligado a autorizar su
        tratamiento. Si no se entregan, es posible que no podamos completar la verificación necesaria para operar. Se usan solo para confirmar
        identidad y prevenir fraude, con medidas de seguridad reforzadas.
      </p>
    </S>

    <S n="6" t="Con quién compartimos los datos">
      <p>
        No vendemos datos personales. Los compartimos solo en lo necesario para prestar el servicio y cumplir la ley con:
      </p>
      <L items={[
        'Aliados de infraestructura de pagos y entidades financieras que ejecutan los cobros y pagos.',
        'Proveedores de verificación de identidad, listas restrictivas y antecedentes.',
        'Proveedores de nube, correo, mensajería, facturación electrónica y soporte, como encargados del tratamiento y bajo acuerdos de confidencialidad y seguridad.',
        'Autoridades judiciales o administrativas que lo soliciten en ejercicio de sus funciones, y la UIAF.',
      ]} />
      <p>
        Algunos proveedores tecnológicos pueden almacenar o procesar datos fuera de Colombia. En esos casos se hace con las garantías que
        exige la ley para la transferencia o transmisión internacional de datos.
      </p>
    </S>

    <S n="7" t="Tus derechos">
      <L items={[
        'Conocer, actualizar y rectificar tus datos.',
        'Solicitar prueba de la autorización otorgada.',
        'Ser informado sobre el uso que se ha dado a tus datos.',
        'Revocar la autorización y pedir la supresión de los datos cuando no exista un deber legal o contractual de conservarlos.',
        'Acceder gratuitamente a tus datos.',
        'Presentar quejas ante la Superintendencia de Industria y Comercio (SIC), después de haber agotado el trámite de consulta o reclamo ante Lincoin.',
      ]} />
    </S>

    <S n="8" t="Cómo ejercer tus derechos">
      <p>Escribe a <Correo asunto="Datos personales" /> con el asunto "Datos personales", indicando tu nombre, documento, la solicitud concreta y un dato de contacto. Si actúas por otra persona, adjunta el poder o el documento que acredite la representación.</p>
      <L items={[
        <><strong>Consultas:</strong> se responden en un máximo de diez (10) días hábiles desde su recibo. Si no es posible, te informaremos los motivos y la nueva fecha, que no superará cinco (5) días hábiles adicionales.</>,
        <><strong>Reclamos</strong> (corrección, actualización, supresión o incumplimiento): se responden en un máximo de quince (15) días hábiles desde el día siguiente a su recibo, prorrogables hasta por ocho (8) días hábiles informándote el motivo. Si el reclamo está incompleto, te pediremos completarlo dentro de los cinco (5) días siguientes; si pasan dos (2) meses sin respuesta, se entenderá que desististe.</>,
      ]} />
      <p>La supresión no procede cuando la ley o un contrato exijan conservar los datos, por ejemplo los soportes de operaciones y de prevención de LA/FT.</p>
    </S>

    <S n="9" t="Seguridad">
      <p>
        Aplicamos medidas técnicas, humanas y administrativas para proteger los datos: cifrado en tránsito y en reposo, control de accesos con
        verificación en dos pasos, registro de auditoría de las operaciones y accesos, y acceso limitado al personal que lo necesita para su
        función. Ningún sistema es infalible; si detectamos un incidente que afecte tus datos, lo informaremos a ti y a la autoridad según la ley.
      </p>
    </S>

    <S n="10" t="Conservación">
      <p>
        Conservamos los datos mientras exista la relación y después por el tiempo que exijan la ley comercial, tributaria y de prevención de
        LA/FT (como mínimo diez (10) años para los soportes de las operaciones). Cumplido ese plazo, los suprimimos o anonimizamos.
      </p>
    </S>

    <S n="11" t="Cookies y datos de navegación">
      <p>
        El sitio usa almacenamiento local del navegador para mantener la sesión, recordar preferencias y proteger el ingreso, y registra visitas
        de forma agregada para mejorar las páginas. Puedes borrar esa información desde tu navegador; algunas funciones de seguridad dejarán de recordarte.
      </p>
    </S>

    <S n="12" t="Vigencia y cambios">
      <p>
        Esta Política rige desde su publicación. Los cambios sustanciales se informarán por la plataforma o por correo antes de aplicarse.
        Las bases de datos se conservan por el término necesario para las finalidades descritas.
      </p>
    </S>
  </Cuerpo>
);

// ─────────────────────────────────────────────
// SARLAFT
// ─────────────────────────────────────────────
const Sarlaft: React.FC = () => (
  <Cuerpo>
    <Vigencia />
    <Nota>
      <strong className="text-[#0C0E0D]">SARLAFT:</strong> Sistema de Administración del Riesgo de Lavado de Activos y de la Financiación del
      Terrorismo. Lincoin lo extiende también a la financiación de la proliferación de armas de destrucción masiva (LA/FT/FPADM).
    </Nota>
    <p>
      Lincoin no permite que su plataforma se use para dar apariencia de legalidad a recursos de origen ilícito, ni para financiar el
      terrorismo o la proliferación de armas. Esta Política resume cómo Lincoin identifica, mide, controla y monitorea ese riesgo y qué
      compromisos asume cada empresa cliente. Hace parte de los <Enlace a="/terminos">Términos y Condiciones</Enlace>.
    </p>

    <S n="1" t="Marco de referencia">
      <p>
        El sistema se construye con base en la normativa colombiana aplicable, entre otras la Ley 526 de 1999 (que crea la UIAF), la
        Ley 1121 de 2006 (financiación del terrorismo y listas vinculantes del Consejo de Seguridad de las Naciones Unidas) y los artículos 323
        y 345 del Código Penal, así como en las Recomendaciones del Grupo de Acción Financiera Internacional (GAFI) y, como buena práctica, en
        los estándares de autocontrol y gestión del riesgo LA/FT/FPADM que usan las autoridades colombianas.
      </p>
      <p className="text-sm">
        Lincoin no es una entidad vigilada por la Superintendencia Financiera de Colombia. Este sistema es un compromiso propio de Lincoin
        y una condición para operar con sus aliados de infraestructura de pagos.
      </p>
    </S>

    <S n="2" t="Principios">
      <L items={[
        'Ninguna meta comercial está por encima de la prevención de LA/FT/FPADM.',
        'Conocer a cada empresa y a quienes están detrás de ella antes de que opere, y mantener ese conocimiento actualizado.',
        'Rechazar o terminar relaciones cuando no sea posible conocer al cliente o el origen de sus recursos.',
        'Colaborar con las autoridades y guardar la reserva que exige la ley.',
      ]} />
    </S>

    <S n="3" t="Etapas del sistema">
      <L items={[
        <><strong>Identificación:</strong> de los riesgos según el tipo de cliente, su actividad económica, el producto, los canales y las jurisdicciones.</>,
        <><strong>Medición:</strong> de la probabilidad y el impacto de cada riesgo, para segmentar a los clientes y definir controles proporcionales.</>,
        <><strong>Control:</strong> mediante debida diligencia, límites, verificación de beneficiarios, consultas en listas y aprobaciones.</>,
        <><strong>Monitoreo:</strong> seguimiento continuo de las operaciones frente al perfil de cada cliente para detectar lo inusual.</>,
      ]} />
    </S>

    <S n="4" t="Conocimiento de la empresa (KYB)">
      <p>Antes de habilitar una cuenta, Lincoin solicita y verifica, entre otros:</p>
      <L items={[
        'Certificado de existencia y representación legal vigente y RUT.',
        'Documento de identidad del representante legal y de los Operadores.',
        'Composición accionaria y beneficiarios finales (las personas naturales que en últimas poseen o controlan la empresa), conforme a la normativa vigente sobre beneficiario final.',
        'Actividad económica, información financiera básica y declaración del origen de los fondos.',
        'Calidad de persona expuesta políticamente (PEP) de administradores, accionistas y beneficiarios finales.',
      ]} />
      <p>
        Todas las personas vinculadas se consultan en listas restrictivas y vinculantes (incluidas las del Consejo de Seguridad de las
        Naciones Unidas) y en otras fuentes de información. Una coincidencia confirmada impide operar.
      </p>
    </S>

    <S n="5" t="Debida diligencia intensificada">
      <p>
        Se aplican controles reforzados (más información, más soportes y aprobación de un nivel superior) a los clientes de mayor riesgo, por
        ejemplo: PEP o vinculados con ellos, actividades económicas de alto riesgo, operaciones con jurisdicciones de alto riesgo o volúmenes
        que no corresponden al perfil declarado.
      </p>
    </S>

    <S n="6" t="Beneficiarios y contrapartes">
      <p>
        Los beneficiarios de los pagos se inscriben y verifican antes de recibir dinero: se confirma su identidad con fuentes disponibles y se
        consultan en listas. Lincoin puede limitar, condicionar o rechazar pagos a beneficiarios con señales de riesgo, aplicar cupos por
        beneficiario y exigir soportes de la relación comercial.
      </p>
    </S>

    <S n="7" t="Monitoreo y señales de alerta">
      <p>Algunas señales que generan revisión:</p>
      <L items={[
        'Operaciones que no corresponden a la actividad, el tamaño o el perfil declarado de la empresa.',
        'Fraccionamiento de montos para no superar límites o reportes.',
        'Entradas que salen de inmediato hacia muchos destinatarios sin justificación aparente.',
        'Uso de la cuenta para recibir o pagar a nombre de terceros ajenos a la operación de la empresa.',
        'Negativa a entregar información o soportes, o información que no puede verificarse.',
        'Coincidencias en listas, noticias negativas relevantes o requerimientos de autoridades.',
      ]} />
    </S>

    <S n="8" t="Operaciones inusuales y sospechosas">
      <p>
        Toda operación inusual se analiza y su resultado queda documentado. Cuando, de acuerdo con los usos y costumbres de la actividad, no
        tenga una justificación razonable, se califica como sospechosa y se reporta a la Unidad de Información y Análisis Financiero (UIAF)
        mediante un Reporte de Operación Sospechosa (ROS). El reporte no es una denuncia penal ni requiere certeza de que haya un delito.
        Lincoin también presenta ante la UIAF, a través del SIREL, los reportes que le correspondan.
      </p>
      <p>
        Lincoin no informará a la empresa ni a terceros que una operación fue reportada, en los términos de la ley. Mientras se analiza una
        operación, Lincoin puede suspenderla, retener los fondos o bloquear temporalmente la cuenta.
      </p>
    </S>

    <S n="9" t="Actualización, conservación y colaboración">
      <L items={[
        'La información de cada empresa se actualiza al menos una vez al año, o antes si cambia o si su riesgo aumenta.',
        'Los soportes de la vinculación, de las operaciones y de los análisis se conservan como mínimo por diez (10) años.',
        'Lincoin atiende de forma oportuna los requerimientos de las autoridades competentes.',
      ]} />
    </S>

    <S n="10" t="Organización y capacitación">
      <p>
        Lincoin designa a un responsable de cumplimiento encargado de administrar el sistema, con acceso a la información y autonomía para
        decidir sobre operaciones y clientes de riesgo. El equipo recibe capacitación sobre el sistema y las señales de alerta, y el
        cumplimiento de esta Política se revisa periódicamente.
      </p>
      <p>Comunicaciones sobre este tema: <Correo asunto="Cumplimiento" /> (asunto: "Cumplimiento").</p>
    </S>

    <S n="11" t="Compromisos de la empresa cliente">
      <L items={[
        'Entregar información veraz y completa, actualizarla y aportar los soportes que se le pidan, incluido el origen de los fondos.',
        'Usar la cuenta solo para su propia actividad económica lícita.',
        'Contar con sus propios controles de prevención de LA/FT cuando la ley se los exija, y no vincular a Lincoin con clientes o recursos de origen ilícito.',
        'Aceptar que, sin estas condiciones, Lincoin puede suspender o terminar la relación sin responsabilidad.',
      ]} />
    </S>
  </Cuerpo>
);

// ─────────────────────────────────────────────
// Peticiones, quejas, reclamos y sugerencias
// ─────────────────────────────────────────────
const Reclamaciones: React.FC = () => (
  <Cuerpo>
    <Vigencia />
    <p>Si algo no salió como esperabas, queremos saberlo y resolverlo. Este es el procedimiento para presentar una petición, queja, reclamo o sugerencia (PQRS).</p>

    <S n="1" t="Qué puedes presentar">
      <L items={[
        <><strong>Petición:</strong> una solicitud de información, de documentos o de una actuación sobre tu cuenta.</>,
        <><strong>Queja:</strong> tu inconformidad con la atención o la conducta de alguien de Lincoin.</>,
        <><strong>Reclamo:</strong> tu inconformidad con una operación o con el servicio (un cobro que no aparece, un pago rechazado, una tarifa, un bloqueo).</>,
        <><strong>Sugerencia:</strong> una propuesta para mejorar el servicio.</>,
      ]} />
    </S>

    <S n="2" t="Cómo presentarla">
      <ol className="list-decimal pl-5 space-y-2 m-0">
        <li>Escribe a <Correo asunto="Reclamación" /> desde el correo registrado de tu cuenta, con el asunto "Petición", "Queja", "Reclamo" o "Sugerencia".</li>
        <li>Incluye el nombre de la empresa, el NIT, tu nombre y documento, y un teléfono de contacto.</li>
        <li>Si es sobre una operación, incluye la <strong>referencia del movimiento</strong> (está en el comprobante), la fecha y el monto.</li>
        <li>Describe lo ocurrido y lo que solicitas, y adjunta los soportes que tengas (capturas, comprobantes).</li>
      </ol>
    </S>

    <S n="3" t="Plazos">
      <L items={[
        'Te confirmamos el recibo con un número de radicado, por regla general el mismo día hábil o el siguiente.',
        'Respondemos de fondo dentro de los quince (15) días hábiles siguientes al recibo. Si necesitamos más tiempo o información (por ejemplo, la respuesta de una entidad financiera o de un sistema de pagos), te informaremos el motivo y la nueva fecha antes de que venza el plazo.',
        <>Las solicitudes sobre datos personales tienen los plazos de la <Enlace a="/privacidad">Política de Tratamiento de Datos</Enlace>: diez (10) días hábiles para consultas y quince (15) para reclamos.</>,
      ]} />
    </S>

    <S n="4" t="Reclamos sobre operaciones">
      <p>
        Repórtalos dentro de los treinta (30) días calendario siguientes a la operación. Revisamos el registro de la operación, su comprobante y
        la información del sistema de pagos o del aliado que la procesó. Si hubo un error atribuible a Lincoin, lo corregimos y te devolvemos
        lo que corresponda. Si el error está en los datos que entregaste (por ejemplo, un pago a un destinatario equivocado), te ayudaremos a
        gestionar la recuperación con la entidad de destino, sin poder garantizar el resultado.
      </p>
      <p>
        Lincoin no atiende reclamos sobre los productos o servicios que tu empresa vende a sus clientes: esos se resuelven entre tu empresa y ellos.
      </p>
    </S>

    <S n="5" t="Si no estás de acuerdo con la respuesta">
      <p>
        Puedes pedir que la revise una instancia superior respondiendo el mismo radicado. En temas de protección de datos personales, una vez
        agotado el trámite ante Lincoin, puedes acudir a la Superintendencia de Industria y Comercio. Lo anterior sin perjuicio de las demás
        acciones que la ley te otorgue.
      </p>
    </S>

    <Nota>Nunca te pediremos tu contraseña ni tus códigos de verificación para atender una solicitud.</Nota>
  </Cuerpo>
);

// ─────────────────────────────────────────────
// Cómo te protegemos
// ─────────────────────────────────────────────
const Seguridad: React.FC = () => (
  <Cuerpo>
    <p>La seguridad del dinero y de los datos de tu empresa es nuestra prioridad. Estas son las medidas con las que protegemos tu cuenta:</p>
    <S t="Cifrado de la información">
      <p>La información viaja cifrada (HTTPS con TLS) y se almacena cifrada. Las contraseñas nunca se guardan en texto plano y los secretos de la verificación en dos pasos se guardan cifrados.</p>
    </S>
    <S t="Verificación en dos pasos (2FA)">
      <p>Para enviar dinero es obligatorio el código de tu app de autenticación, y esa verificación se valida en nuestros servidores, no solo en tu navegador. Cada código sirve una sola vez y los intentos fallidos tienen límite.</p>
    </S>
    <S t="Verificación de cada empresa (KYB)">
      <p>Antes de operar verificamos la existencia de la empresa, su representación legal, sus beneficiarios finales y el origen de sus fondos, y consultamos a las personas vinculadas en listas restrictivas. Ver la <Enlace a="/sarlaft">Política SARLAFT</Enlace>.</p>
    </S>
    <S t="Pagos solo a beneficiarios verificados">
      <p>Los pagos salen a beneficiarios que tu empresa inscribe y que verificamos antes de pagarles, con límites por operación, por beneficiario y por periodo.</p>
    </S>
    <S t="Controles contra el fraude">
      <L items={[
        'Detección de envíos duplicados y bloqueo de reintentos cuando una operación queda en estado incierto.',
        'Monitoreo de operaciones y alertas ante comportamientos inusuales.',
        'Avisos al correo cuando alguien entra a tu cuenta y bloqueo ante intentos repetidos.',
        'Registro de auditoría de cada movimiento de dinero y de cada acción del equipo de Lincoin.',
        'Cierre de sesión automático por inactividad.',
      ]} />
    </S>
    <S t="Qué puedes hacer tú">
      <L items={[
        'Activa la verificación en dos pasos y no compartas tus códigos con nadie, tampoco con alguien que diga ser de Lincoin.',
        'Da acceso solo a los Operadores que lo necesitan y retíralo cuando alguien deje la empresa.',
        `Entra siempre escribiendo ${DATOS_LINCOIN.sitio} en tu navegador; desconfía de enlaces recibidos por mensajes.`,
        'Revisa los datos del beneficiario antes de confirmar un pago: los pagos por Bre-B son inmediatos.',
      ]} />
    </S>
    <Nota>
      Nunca te pediremos tu contraseña ni tu código de verificación por teléfono, WhatsApp o correo. Si algo te parece sospechoso, o si
      encontraste una vulnerabilidad en la plataforma, escríbenos a <Correo asunto="Seguridad" />.
    </Nota>
  </Cuerpo>
);

// ─────────────────────────────────────────────
// Estado del sistema
// ─────────────────────────────────────────────
const Estado: React.FC = () => (
  <Cuerpo>
    <div className="flex items-center gap-3 bg-green-50 border border-green-200 p-4 rounded-xl">
      <span className="w-3 h-3 rounded-full inline-block" style={{ background: VERDE }} />
      <p className="font-semibold text-[#0C0E0D] m-0">Sin incidentes reportados</p>
    </div>
    <ul className="space-y-3 m-0 p-0 list-none">
      {['Aplicación web e ingreso', 'Cobros por llave Bre-B y links de pago', 'Pagos por Bre-B', 'Pagos por ACH', 'Avisos por correo'].map((s) => (
        <li key={s} className="flex items-center justify-between border-b border-slate-100 pb-2">
          <span>{s}</span>
          <span className="font-semibold text-sm flex items-center gap-2" style={{ color: VERDE }}><span className="w-2 h-2 rounded-full inline-block" style={{ background: VERDE }} /> Sin incidentes</span>
        </li>
      ))}
    </ul>
    <p className="text-sm text-slate-500">
      Esta página la actualiza el equipo de Lincoin cuando hay un incidente general. El estado de cada operación se ve en tiempo real en tu
      cuenta. Los pagos dependen también de los sistemas de pago y de las entidades financieras de destino, que pueden tener sus propias
      ventanas de mantenimiento. ¿Ves un problema que no aparece aquí? Escríbenos a <Correo asunto="Estado del sistema" />.
    </p>
  </Cuerpo>
);

// ─────────────────────────────────────────────
// Marco legal y de operación
// ─────────────────────────────────────────────
const MarcoLegal: React.FC = () => (
  <Cuerpo>
    <Vigencia />
    <QueNoEs />
    <S t="Qué es Lincoin">
      <p>Una plataforma tecnológica para que las empresas en Colombia cobren y paguen en pesos desde una sola cuenta, a través de los rieles de pago del país y de aliados de infraestructura de pagos.</p>
    </S>
    <S t="Cómo se mueve el dinero">
      <L items={[
        'Bre-B: el sistema de pagos inmediatos de Colombia, administrado por el Banco de la República.',
        'ACH: transferencias electrónicas entre entidades financieras, procesadas en ciclos.',
        'Aliados de infraestructura de pagos: entidades que ejecutan los cobros y pagos bajo su propio marco legal y sus propias obligaciones de cumplimiento.',
      ]} />
    </S>
    <S t="Cumplimiento">
      <L items={[
        <>Lincoin implementa su SARLAFT y verifica a cada empresa antes de que opere (<Enlace a="/sarlaft">ver Política SARLAFT</Enlace>).</>,
        'Lincoin presenta los reportes que le corresponden ante la UIAF.',
        <>Los datos personales se tratan conforme a la Ley 1581 de 2012 (<Enlace a="/privacidad">ver Política de Tratamiento de Datos</Enlace>).</>,
        'Lincoin expide factura electrónica por sus servicios.',
      ]} />
    </S>
    <S t="Documentos">
      <L items={[
        <Enlace a="/terminos">Términos y Condiciones</Enlace>,
        <Enlace a="/privacidad">Política de Tratamiento de Datos Personales</Enlace>,
        <Enlace a="/sarlaft">Política SARLAFT</Enlace>,
        <Enlace a="/reclamaciones">Peticiones, quejas y reclamos</Enlace>,
      ]} />
    </S>
  </Cuerpo>
);

// ─────────────────────────────────────────────
// Quiénes somos (sin cifras inventadas: antes decía "+50.000 usuarios" y
// "$500M+ transaccionados", que no son datos reales — publicidad engañosa).
// ─────────────────────────────────────────────
const Nosotros: React.FC = () => (
  <Cuerpo>
    <p className="text-lg">Somos <strong className="text-[#0C0E0D]">Lincoin</strong>, la pasarela de pagos para empresas en Colombia.</p>
    <p>Creemos que cobrar y pagar debería ser simple para cualquier empresa: una sola cuenta en pesos para recibir por llave Bre-B y links de pago, y para pagar a proveedores, nómina y terceros en cualquier banco por Bre-B y ACH, con un comprobante por cada operación.</p>
    <p>Trabajamos con aliados de infraestructura de pagos en Colombia y con un sistema propio de prevención de lavado de activos (SARLAFT), porque la confianza se construye conociendo a cada cliente y cuidando cada peso que se mueve.</p>
    <QueNoEs />
  </Cuerpo>
);

// ─────────────────────────────────────────────
// Centro de ayuda (antes: un teléfono de ejemplo +1 555… y un formulario que
// no enviaba nada).
// ─────────────────────────────────────────────
const Ayuda: React.FC = () => (
  <Cuerpo>
    <p>¿Tienes una duda o un inconveniente? Escríbenos y te respondemos por correo.</p>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="border border-slate-200 p-6 rounded-xl">
        <Mail className="text-[#0C0E0D] mb-3" size={28} />
        <h3 className="font-bold text-slate-800 mb-1 mt-0">Soporte</h3>
        <p className="text-sm text-slate-500 mb-3">Dudas sobre tu cuenta, cobros y pagos.</p>
        <Correo asunto="Soporte" />
      </div>
      <div className="border border-slate-200 p-6 rounded-xl">
        <FileText className="text-[#0C0E0D] mb-3" size={28} />
        <h3 className="font-bold text-slate-800 mb-1 mt-0">Reclamaciones</h3>
        <p className="text-sm text-slate-500 mb-3">Radica una petición, queja o reclamo con su referencia.</p>
        <Enlace a="/reclamaciones">Ver el procedimiento</Enlace>
      </div>
    </div>
    {DATOS_LINCOIN.telefono && <p>Teléfono: <strong className="text-[#0C0E0D]">{DATOS_LINCOIN.telefono}</strong></p>}
    <S t="Antes de escribir">
      <L items={[
        'Si es sobre una operación, ten a la mano su referencia (está en el comprobante).',
        'Escríbenos desde el correo registrado en tu cuenta, para poder confirmar que eres tú.',
        'Nunca compartas tu contraseña ni tus códigos de verificación: no los necesitamos para ayudarte.',
      ]} />
    </S>
  </Cuerpo>
);

export type PaginaLegal = { title: string; icon: React.ElementType; content: React.ReactNode };

// La página para cada clave, o null si la clave no es de este archivo.
export function paginaLegal(pageKey: string): PaginaLegal | null {
  switch (pageKey) {
    case 'terms': return { title: 'Términos y Condiciones', icon: FileText, content: <Terminos /> };
    case 'privacy': return { title: 'Política de Tratamiento de Datos Personales', icon: Lock, content: <Privacidad /> };
    case 'sagrilaft':
    case 'sarlaft': return { title: 'Política SARLAFT', icon: ShieldCheck, content: <Sarlaft /> };
    case 'complaints': return { title: 'Peticiones, Quejas y Reclamos', icon: Mail, content: <Reclamaciones /> };
    case 'security': return { title: 'Cómo te protegemos', icon: ShieldCheck, content: <Seguridad /> };
    case 'status': return { title: 'Estado del sistema', icon: Activity, content: <Estado /> };
    case 'licenses':
    case 'reserves': return { title: 'Marco legal y de operación', icon: Scale, content: <MarcoLegal /> };
    case 'about': return { title: 'Quiénes somos', icon: Users, content: <Nosotros /> };
    case 'support':
    case 'contact': return { title: 'Centro de ayuda', icon: Mail, content: <Ayuda /> };
    default: return null;
  }
}
