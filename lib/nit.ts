// ── NIT colombiano ────────────────────────────────────────────────────────
// Un NIT tiene 10 dígitos: 9 del número y 1 de verificación (DV), que la
// DIAN calcula con módulo 11 a partir de los otros nueve. Se pide COMPLETO,
// con el DV, y se comprueba: un NIT con el DV equivocado es un número mal
// copiado, y vale más frenarlo al inscribir que descubrirlo cuando el banco
// devuelve la plata.

const PESOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

// Dígito de verificación de un NIT SIN el DV (los 9 dígitos base).
export function digitoVerificacionNit(base: string): number | null {
    const d = String(base ?? '').replace(/\D/g, '');
    if (!d.length || d.length > 15) return null;
    let suma = 0;
    for (let i = 0; i < d.length; i++) {
        // El peso se aplica de derecha a izquierda.
        suma += Number(d[d.length - 1 - i]) * PESOS[i];
    }
    const r = suma % 11;
    return r > 1 ? 11 - r : r;
}

// Qué le pasa a lo que se escribió. `ok` solo con 10 dígitos y DV correcto.
export function validarNit(numero: string): { ok: boolean; texto: string; digitos: string } {
    const d = String(numero ?? '').replace(/\D/g, '');
    if (!d) return { ok: false, texto: 'Escribe el NIT: 10 dígitos, los 9 del número y el de verificación.', digitos: d };
    if (d.length < 9) return { ok: false, texto: `El NIT tiene 10 dígitos (9 del número y 1 de verificación). Van ${d.length}.`, digitos: d };
    if (d.length === 9) {
        const dv = digitoVerificacionNit(d);
        return { ok: false, texto: `Falta el dígito de verificación. Para ${d} es ${dv}: escribe ${d}${dv}.`, digitos: d };
    }
    if (d.length > 10) return { ok: false, texto: `Sobran dígitos: el NIT tiene 10 y van ${d.length}.`, digitos: d };
    const base = d.slice(0, 9);
    const dv = digitoVerificacionNit(base);
    if (dv !== Number(d[9])) {
        return { ok: false, texto: `El dígito de verificación no corresponde: para ${base} sería ${dv}, no ${d[9]}. Revisa el número.`, digitos: d };
    }
    return { ok: true, texto: 'NIT completo, dígito de verificación correcto.', digitos: d };
}

// Completa el DV cuando llega un NIT de 9 dígitos de una fuente que lo
// entrega sin él (el directorio de Bre-B, por ejemplo). Con otra longitud se
// devuelve tal cual.
export function completarNit(numero: string): string {
    const d = String(numero ?? '').replace(/\D/g, '');
    if (d.length !== 9) return numero;
    const dv = digitoVerificacionNit(d);
    return dv === null ? numero : `${d}${dv}`;
}

// ¿Es el NIT de una EMPRESA? Los de personas jurídicas tienen 9 dígitos y
// empiezan por 8 o 9 (800…, 860…, 900…, 901…), con o sin el DV pegado. Una
// cédula no tiene esa forma: las nuevas son de 10 dígitos y empiezan por 1.
// Mismo criterio que el servidor (supabase/functions/_shared/cupos.ts).
export function esNitEmpresa(numero: string): boolean {
    let d = String(numero ?? '').replace(/\D/g, '').replace(/^0+/, '');
    if (d.length === 10 && /^[89]/.test(d) && digitoVerificacionNit(d.slice(0, 9)) === Number(d[9])) d = d.slice(0, 9);
    return /^[89]\d{8}$/.test(d);
}

// Los 9 dígitos base, sin DV, para quien lo pide así. Solo se quita el
// último dígito si de verdad es el DV de los otros nueve.
export function nitSinDv(numero: string): string {
    const d = String(numero ?? '').replace(/\D/g, '');
    if (d.length !== 10) return d;
    return digitoVerificacionNit(d.slice(0, 9)) === Number(d[9]) ? d.slice(0, 9) : d;
}

// ¿Persona o empresa? Por la forma del número (la misma regla que aplica el
// servidor en Lincoin Risk antes de cobrar). Solo orienta: el cliente elige.
// 'seguro' = sin duda razonable: un NIT de empresa con su dígito de
// verificación correcto, o una cédula nueva de 10 dígitos que empieza por 1.
export function tipoProbable(numero: string): { tipo: 'empresa' | 'persona' | null; seguro: boolean; nit?: string } {
    const d = String(numero ?? '').replace(/\D/g, '');
    if (/^[89]\d{9}$/.test(d) && digitoVerificacionNit(d.slice(0, 9)) === Number(d[9])) return { tipo: 'empresa', seguro: true, nit: `${d.slice(0, 9)}-${d[9]}` };
    if (/^[89]\d{8}$/.test(d)) return { tipo: 'empresa', seguro: false, nit: `${d}-${digitoVerificacionNit(d)}` };
    if (/^1\d{9}$/.test(d)) return { tipo: 'persona', seguro: true };
    if (/^\d{6,8}$/.test(d)) return { tipo: 'persona', seguro: false };
    return { tipo: null, seguro: false };
}
