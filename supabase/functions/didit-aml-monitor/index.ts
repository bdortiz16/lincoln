// ════════════════════════════════════════════════════════
// didit-aml-monitor — recibe los eventos AML de Didit (screening
// inicial + monitoreo continuo) y aplica la política de compliance
// de CuyPay:
//
//   • AML con hits / rechazado en el SCREENING INICIAL
//       → alerta HIGH en compliance_alerts
//       → bloqueo TEMPORAL del usuario (puede justificar con docs)
//
//   • Hit del MONITOREO CONTINUO (usuario que ya estaba aprobado)
//       → alerta CRITICAL en compliance_alerts
//       → bloqueo PERMANENTE (solo se levanta manualmente)
//
// Se registra como webhook en la consola de Didit (Settings →
// Webhooks) apuntando a:
//   https://<ref>.supabase.co/functions/v1/didit-aml-monitor?key=<WEBHOOK_KEY>
//
// Secrets:
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  → automáticos
//   WEBHOOK_KEY  → opcional pero recomendado (shared secret en la URL)
// ════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_KEY  = Deno.env.get('WEBHOOK_KEY') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

// Docs default que el usuario puede subir para justificar un bloqueo
// temporal por AML.
const AML_TEMP_DOCS = ['cedula_front', 'selfie', 'source_of_funds']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const url = new URL(req.url)

  if (req.method === 'GET') {
    return json({ ok: true, service: 'didit-aml-monitor', secured: !!WEBHOOK_KEY })
  }

  // Shared secret opcional
  if (WEBHOOK_KEY && url.searchParams.get('key') !== WEBHOOK_KEY) {
    return json({ error: 'bad key' }, 401)
  }

  try {
    const payload = await req.json().catch(() => ({}))
    const d: any = payload.data ?? payload
    const eventName = String(payload.event ?? payload.type ?? d.event ?? '').toLowerCase()
    const sessionId: string  = d.session_id ?? d.sessionId ?? ''
    const vendorData: string = String(d.vendor_data ?? d.vendorData ?? '')

    console.log(`[aml-monitor] event="${eventName}" session=${sessionId} vendor=${vendorData}`)

    // ── Extraer la sección AML del payload (tolerante a formatos) ──
    const decision: any = d.decision ?? d
    const aml: any =
      decision.aml_screenings?.[0] ?? decision.aml ?? d.aml ??
      decision.aml_screening ?? null

    const hits: number = Number(
      aml?.total_hits ?? (Array.isArray(aml?.hits) ? aml.hits.length : 0) ?? 0
    )
    const amlStatus = String(aml?.status ?? d.status ?? '').toLowerCase()
    const isRejected = /declined|rejected|failed|hit/.test(amlStatus)

    if (hits === 0 && !isRejected) {
      console.log('[aml-monitor] sin hits ni rechazo — no action')
      return json({ ok: true, action: 'none' })
    }

    // ── Resolver el sujeto: user o beneficiary ──
    let userId = ''
    let beneficiaryId = ''
    if (vendorData.startsWith('beneficiary:')) beneficiaryId = vendorData.slice('beneficiary:'.length)
    else if (vendorData.startsWith('user:'))   userId = vendorData.slice('user:'.length)
    else if (vendorData)                        userId = vendorData

    let userRow: any = null
    if (userId) {
      const { data } = await db.from('users')
        .select('id, email, full_name, kyc_status, kyc_verified_at')
        .eq('id', userId).maybeSingle()
      userRow = data
      if (!userRow) userId = ''
    }
    if (!userId && !beneficiaryId && sessionId) {
      // users por columna dedicada o raw_data
      const byCol = await db.from('users')
        .select('id, email, full_name, kyc_status, kyc_verified_at')
        .eq('didit_session_id', sessionId).maybeSingle()
      if (byCol.data) { userRow = byCol.data; userId = byCol.data.id }
      if (!userId) {
        const byRaw = await db.from('users')
          .select('id, email, full_name, kyc_status, kyc_verified_at')
          .eq('raw_data->>diditSessionId', sessionId).limit(1)
        if (byRaw.data?.[0]) { userRow = byRaw.data[0]; userId = byRaw.data[0].id }
      }
      if (!userId) {
        const ben = await db.from('beneficiaries')
          .select('id, full_name, owner_user_id, kyc_status')
          .eq('didit_session_id', sessionId).maybeSingle()
        if (ben.data) beneficiaryId = ben.data.id
      }
    }

    if (!userId && !beneficiaryId) {
      console.warn('[aml-monitor] no pude identificar user/beneficiary')
      return json({ ok: true, action: 'unidentified' })
    }

    // ── Screening inicial vs monitoreo continuo ──
    // Es monitoreo si el evento lo dice, o si el usuario YA estaba
    // aprobado (el hit llegó después de la verificación inicial).
    const isMonitoring =
      /monitor/.test(eventName) ||
      d.monitoring === true ||
      ['approved', 'verified'].includes(String(userRow?.kyc_status ?? '').toLowerCase())

    const hitNames = Array.isArray(aml?.hits)
      ? aml.hits.slice(0, 5).map((h: any) => h?.name ?? h?.title ?? h?.entity_name).filter(Boolean).join(', ')
      : ''

    const subjectLabel = userRow
      ? `${userRow.full_name ?? userRow.email ?? userId}`
      : `Tercero ${beneficiaryId.slice(0, 8)}…`

    // ── 1) Crear la alerta en compliance_alerts ──
    const alertRow = {
      rule_name:   isMonitoring ? 'Didit AML — Monitoreo continuo' : 'Didit AML — Screening',
      severity:    isMonitoring ? 'critical' : 'high',
      description: `${subjectLabel}: ${hits} coincidencia(s) en listas restrictivas` +
                   (hitNames ? ` (${hitNames})` : '') +
                   (isRejected ? ' — sesión RECHAZADA por Didit' : '') +
                   (isMonitoring
                     ? '. BLOQUEO PERMANENTE aplicado automáticamente.'
                     : '. Bloqueo temporal aplicado — puede justificar con documentación.'),
      status:      'open',
      user_id:     userId || null,
      metadata: {
        source: 'didit_aml',
        monitoring: isMonitoring,
        session_id: sessionId || null,
        beneficiary_id: beneficiaryId || null,
        hits,
        aml_status: amlStatus,
        hit_names: hitNames || null,
        event: eventName || null,
      },
    }
    const { error: alertErr } = await db.from('compliance_alerts').insert(alertRow)
    if (alertErr) console.error('[aml-monitor] alert insert error:', alertErr.message)

    // ── 2) Bloquear según la política ──
    const blockType   = isMonitoring ? 'permanent' : 'temporary'
    const blockReason = isMonitoring ? 'aml_monitoring_hit' : 'aml_hit'
    const blockNotes  = isMonitoring
      ? `[PERMANENTE — info requerida] Hit de monitoreo continuo AML (${hits} coincidencias${hitNames ? `: ${hitNames}` : ''}). Contactar a Compliance.`
      : `Coincidencias AML en screening (${hits}${hitNames ? `: ${hitNames}` : ''}). Subí la documentación para justificar.`

    if (userId) {
      const patch: Record<string, any> = {
        is_active:          false,
        is_blocked:         true,
        block_type:         blockType,
        block_reason:       blockReason,
        block_notes:        blockNotes,
        required_documents: isMonitoring ? [] : AML_TEMP_DOCS,
      }
      let { error: uerr } = await db.from('users').update(patch).eq('id', userId)
      if (uerr && /column/i.test(uerr.message)) {
        const r = await db.from('users').update({ is_active: false }).eq('id', userId)
        uerr = r.error
      }
      if (uerr) console.error('[aml-monitor] user block error:', uerr.message)
      else console.log(`[aml-monitor] user ${userId} → bloqueo ${blockType}`)
    } else if (beneficiaryId) {
      const patch: Record<string, any> = {
        is_active:          false,
        block_type:         blockType,
        block_reason:       blockReason,
        block_notes:        blockNotes,
        required_documents: isMonitoring ? [] : AML_TEMP_DOCS,
      }
      let { error: berr } = await db.from('beneficiaries').update(patch).eq('id', beneficiaryId)
      if (berr && /column/i.test(berr.message)) {
        const r = await db.from('beneficiaries').update({ is_active: false }).eq('id', beneficiaryId)
        berr = r.error
      }
      if (berr) console.error('[aml-monitor] beneficiary block error:', berr.message)
      else console.log(`[aml-monitor] beneficiary ${beneficiaryId} → bloqueo ${blockType}`)
    }

    return json({
      ok: true,
      action: isMonitoring ? 'permanent_block' : 'temporary_block',
      target: userId ? `user:${userId}` : `beneficiary:${beneficiaryId}`,
      hits,
    })
  } catch (e: any) {
    console.error('[aml-monitor] fatal:', e)
    return json({ error: e?.message ?? 'internal' }, 500)
  }
})
