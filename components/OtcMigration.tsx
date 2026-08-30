// ─────────────────────────────────────────────
// Shim de compatibilidad: el convertidor OTC real vive en FinitySection
// (restaurado — riel ACH vía Finity). Este módulo mantiene los nombres
// "Mouv*" que ya importan las pantallas, apuntando a la implementación
// real. Bre-B vía Mouv aún no tiene conversor apificado (mesa manual).
// ─────────────────────────────────────────────
export {
    FinitySection as MouvSection,
    callFinity as callMouv,
    fetchFinityBalance as fetchMouvBalance,
    fetchFinityRateValue as fetchMouvRateValue,
    fetchFinityUsdCopConfig as fetchMouvUsdCopConfig,
    extractRate,
} from './FinitySection';
