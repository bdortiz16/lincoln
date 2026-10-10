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

// Los 9 dígitos base, sin DV, para quien lo pide así. Solo se quita el
// último dígito si de verdad es el DV de los otros nueve.
export function nitSinDv(numero: string): string {
    const d = String(numero ?? '').replace(/\D/g, '');
    if (d.length !== 10) return d;
    return digitoVerificacionNit(d.slice(0, 9)) === Number(d[9]) ? d.slice(0, 9) : d;
}
