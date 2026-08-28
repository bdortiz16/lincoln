-- ───────────────────────────────────────────────────────
-- 2026_app_banners.sql
--
-- Banners de campaña que aparecen en el home de la app móvil
-- sobre el asset de la mascota Cuy sosteniendo un cartel.
-- Spec final acordada con Claude Web.
--
-- La app móvil consume directamente desde la tabla con un simple
-- SELECT * FROM app_banners WHERE is_active = true — sin RPCs.
-- ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_banners (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title        text NOT NULL,
    description  text NOT NULL,
    coupon_code  text,
    image_url    text,
    action_url   text,
    is_active    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_banners_active_idx
    ON public.app_banners(is_active, created_at DESC)
    WHERE is_active = true;

-- Trigger touch updated_at
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_banners_touch ON public.app_banners;
CREATE TRIGGER app_banners_touch
    BEFORE UPDATE ON public.app_banners
    FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ─────────────────────────────────────────────
-- RLS: admins (super_admin/compliance/support) hacen CRUD;
-- los usuarios autenticados leen solo activos (para que la app
-- pueda hidratar el home).
-- ─────────────────────────────────────────────
ALTER TABLE public.app_banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_banners_admin_all ON public.app_banners;
CREATE POLICY app_banners_admin_all ON public.app_banners
    FOR ALL TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.users u
                WHERE u.id = auth.uid()
                  AND u.admin_role IN ('super_admin','compliance','support'))
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u
                WHERE u.id = auth.uid()
                  AND u.admin_role IN ('super_admin','compliance','support'))
    );

DROP POLICY IF EXISTS app_banners_user_read_active ON public.app_banners;
CREATE POLICY app_banners_user_read_active ON public.app_banners
    FOR SELECT TO authenticated
    USING (is_active = true);
