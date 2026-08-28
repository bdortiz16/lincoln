-- ───────────────────────────────────────────────────────
-- 2026_legal_documents.sql
--
-- Textos legales dinámicos para las APPS (iOS/Android), guardados en
-- app_settings (misma tabla que ya edita el panel en Soporte →
-- Configuración → Documentación de páginas). Keys:
--
--   legal_add_beneficiary_terms  T&C al agregar un tercero (pantalla
--                                "Agregar Tercero" de la app)
--   page_terms                   Términos y Condiciones generales
--   page_data_treatment          Tratamiento de datos / privacidad
--
-- El value es un string JSON con el texto (soporta el markdown-lite del
-- panel: líneas "## " = título, "- " = viñeta, resto párrafos).
-- ───────────────────────────────────────────────────────

-- Seed inicial del texto de terceros (solo si no existe; el panel lo
-- sobreescribe al editar)
INSERT INTO public.app_settings (key, value)
VALUES (
    'legal_add_beneficiary_terms',
    to_jsonb('## Términos para agregar terceros

Al agregar un tercero (beneficiario) a tu libreta de contactos de CuyPay declaras que:

- Conoces a la persona que estás registrando y los datos proporcionados son verídicos.
- Las operaciones hacia este contacto son legítimas y con recursos de origen lícito.
- Autorizas a CuyPay a verificar la identidad del tercero (KYC) cuando la regulación lo requiera.
- CuyPay puede limitar, suspender o bloquear operaciones hacia este contacto por motivos de cumplimiento (SAGRILAFT / AML).

El uso de esta función se rige por los Términos y Condiciones generales y la Política de Tratamiento de Datos de CuyPay.'::text)
)
ON CONFLICT (key) DO NOTHING;

-- Lectura: los usuarios autenticados de la app leen cualquier key de
-- configuración pública; el anon (landing) solo las keys públicas.
-- Son policies ADICIONALES (OR con las existentes) — no restringen nada
-- que ya funcione.
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_auth_read ON public.app_settings;
CREATE POLICY app_settings_auth_read ON public.app_settings
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS app_settings_anon_public_read ON public.app_settings;
CREATE POLICY app_settings_anon_public_read ON public.app_settings
    FOR SELECT TO anon
    USING (
        key LIKE 'page_%'
        OR key LIKE 'legal_%'
        OR key LIKE 'link_%'
        OR key IN ('support_whatsapp','calendly_url','support_video_url','support_email')
    );

NOTIFY pgrst, 'reload schema';
