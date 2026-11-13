// ── El motivo de un envío ─────────────────────────────────────────────────
// Se pregunta al confirmar cada envío. Son los mismos motivos que Finity
// pide en su propia pantalla ("Selecciona la razón del pago"), y se le
// mandan con la orden. Y es lo que decide qué documento sale en Siigo:
// en Contabilidad → Configuración, cada motivo se liga (o no) a un ítem.
export const MOTIVOS_ENVIO: { v: string; l: string }[] = [
    { v: 'proveedores', l: 'Pago a proveedores' },
    { v: 'servicios', l: 'Pago de servicios' },
    { v: 'nomina', l: 'Pago de nómina' },
    { v: 'gastos', l: 'Gastos generales' },
    { v: 'compensacion', l: 'Transferencia a mi cuenta de compensación' },
    { v: 'otro', l: 'Otro' },
];

export const motivoTexto = (v?: string | null) => MOTIVOS_ENVIO.find(m => m.v === v)?.l ?? (v ? String(v) : '');
