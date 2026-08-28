-- ════════════════════════════════════════════════════════
-- Cargue de cliente → tesorería (auto-crédito al aprobar)
--
-- Cuando una transacción kind='load' (cargue) pasa a estado aprobado/
-- completado, se acredita automáticamente la cuenta del LIBRO de tesorería
-- enlazada a la cuenta bancaria donde el cliente depositó
-- (treasury_accounts.bank_account_id = transactions.bank_account_id).
--
-- Idempotente: cada TX genera a lo sumo UN movimiento client_load
-- (treasury_movements.source_tx_id único). No se puede duplicar el crédito.
--
-- Requisito del app: la TX de cargue debe traer bank_account_id (la cuenta
-- cuypay_bank_accounts donde se depositó). Si viene null, no se acredita
-- (el admin lo verá como cargue sin cuenta asignada).
-- ════════════════════════════════════════════════════════

-- ───── 1. Idempotencia: enlazar cada movimiento con su TX de origen ─────
ALTER TABLE public.treasury_movements ADD COLUMN IF NOT EXISTS source_tx_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_mov_source_tx
    ON public.treasury_movements(source_tx_id)
    WHERE source_tx_id IS NOT NULL;

-- ───── 2. Función del trigger ─────
CREATE OR REPLACE FUNCTION public.tg_treasury_on_load_approved()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_acct      public.treasury_accounts%ROWTYPE;
    v_amount    NUMERIC;
    v_is_final  BOOLEAN;
    v_was_final BOOLEAN;
    FINAL_STATES TEXT[] := ARRAY['approved','completed','aprobada','completado','aprobado','success','confirmed'];
    LOAD_KINDS   TEXT[] := ARRAY['load','carga','deposit','topup','recarga'];
BEGIN
    -- Solo cargues
    IF lower(COALESCE(NEW.kind, '')) <> ALL (LOAD_KINDS) THEN
        RETURN NEW;
    END IF;

    v_is_final  := lower(COALESCE(NEW.status, '')) = ANY (FINAL_STATES);
    v_was_final := lower(COALESCE(OLD.status, '')) = ANY (FINAL_STATES);

    -- Solo cuando la TX RECIÉN pasa a estado final
    IF NOT v_is_final OR v_was_final THEN
        RETURN NEW;
    END IF;

    -- Necesita cuenta de depósito para saber a qué cuenta del libro acreditar
    IF NEW.bank_account_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Cuenta del libro enlazada a esa cuenta bancaria
    SELECT * INTO v_acct
    FROM public.treasury_accounts
    WHERE bank_account_id = NEW.bank_account_id
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN NEW;  -- no hay cuenta de libro enlazada; el admin puede registrarlo manual
    END IF;

    -- Idempotencia: no duplicar si ya se registró el cargue de esta TX
    IF EXISTS (SELECT 1 FROM public.treasury_movements WHERE source_tx_id = NEW.id::text) THEN
        RETURN NEW;
    END IF;

    v_amount := COALESCE(NEW.amount, 0);
    IF v_amount <= 0 THEN
        RETURN NEW;
    END IF;

    -- Registrar el movimiento + acreditar la cuenta del libro
    INSERT INTO public.treasury_movements (
        kind, to_account_id, to_amount, to_currency, notes, source_tx_id, created_at
    ) VALUES (
        'client_load', v_acct.id, v_amount, v_acct.currency,
        'Cargue de cliente · TX ' || NEW.id::text, NEW.id::text, NOW()
    );

    UPDATE public.treasury_accounts
    SET balance = balance + v_amount, updated_at = NOW()
    WHERE id = v_acct.id;

    RETURN NEW;
END;
$$;

-- ───── 3. Trigger sobre cambios de estado de la transacción ─────
DROP TRIGGER IF EXISTS trg_treasury_on_load_approved ON public.transactions;
CREATE TRIGGER trg_treasury_on_load_approved
    AFTER UPDATE OF status ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_treasury_on_load_approved();

NOTIFY pgrst, 'reload schema';

-- ───── 4. Verificación ─────
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_treasury_on_load_approved';
