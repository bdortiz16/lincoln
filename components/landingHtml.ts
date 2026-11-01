// La página de inicio de Lincoin: pasarela de pagos para empresas en
// Colombia (cobrar y pagar por Bre-B y ACH). Reescrita el 1 nov: antes era
// la cuenta para recibir USDT/EURT y enviar entre países, que Lincoin ya no
// ofrece. La pinta LandingPage.tsx (botones data-open / data-page).
export const LANDING_HTML = `<style>
* { box-sizing: border-box; } .lincoin-landing-root { margin: 0; background: #0a0a0a; color: #f4f4f2; font-family: "Archivo", system-ui, sans-serif; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  a { color: inherit; text-decoration: none; }
  summary { list-style: none; }
  summary::-webkit-details-marker { display: none; } .lincoin-landing-root { scroll-behavior: smooth; }

  /* hover / focus states (were style-hover / style-focus in the design) */
  .nl:hover { color: #f4f4f2 !important; }
  .btn-ghost:hover { color: #4ade80 !important; }
  .btn-white:hover { background: #4ade80 !important; }
  .btn-green:hover { background: #6ee7a0 !important; }
  .btn-outline:hover { border-color: #4ade80 !important; color: #4ade80 !important; }
  .feature-row:hover { background: rgba(255,255,255,0.03); }
  .store:hover { border-color: #4ade80 !important; }
  .modal-input:focus { outline: none; border-color: #4ade80 !important; }
  .mclose:hover { color: #f4f4f2 !important; }
  .faq:hover summary { color: #f4f4f2; }

  @media (max-width: 900px) {
    .wrap { padding-left: 20px !important; padding-right: 20px !important; }
    .hero-grid { grid-template-columns: 1fr !important; gap: 28px !important; padding-top: 48px !important; padding-bottom: 48px !important; }
    .hero-art { display: block !important; height: auto !important; }
    .sec-grid { grid-template-columns: 1fr !important; gap: 32px !important; padding: 56px 20px !important; }
    .faq-grid { grid-template-columns: 1fr !important; gap: 20px !important; padding: 56px 20px !important; }
    .trust-grid { grid-template-columns: 1fr 1fr !important; }
    .foot-grid { grid-template-columns: 1fr 1fr !important; }
    .testi-grid { grid-template-columns: 1fr !important; }
    .feature-row { flex-wrap: wrap !important; gap: 10px !important; }
    .feature-title { width: 100% !important; }
    h1 { font-size: 44px !important; letter-spacing: -2px !important; }
    .download-row { flex-direction: column !important; align-items: flex-start !important; }
  }

</style>

<!-- NAV -->
<header style="position: sticky; top: 0; z-index: 50; background: rgba(10,10,10,0.88); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,0.12);">
  <div class="wrap" style="max-width: 1180px; margin: 0 auto; padding: 0 48px; display: flex; align-items: center; justify-content: space-between; height: 72px;">
    <a href="#top" style="font-weight: 800; font-size: 21px; letter-spacing: -0.6px; color: #f4f4f2;">Lincoin<span style="color: #4ade80;">.</span></a>
    <nav style="display: flex; gap: 32px; font-size: 14px; color: #8f8f8a;">
      <a class="nl" href="#funciones">Producto</a>
      <a class="nl" href="#como">Cómo funciona</a>
      <a class="nl" href="#seguridad">Seguridad</a>
      <a class="nl" href="#faq">Preguntas</a>
    </nav>
    <div style="display: flex; gap: 10px;">
      <button class="btn-ghost" data-open="login" style="font-family: inherit; font-size: 14px; font-weight: 600; padding: 11px 18px; background: transparent; border: none; color: #f4f4f2; cursor: pointer;">Ingresar</button>
      <button class="btn-white" data-open="register" style="font-family: inherit; font-size: 14px; font-weight: 700; padding: 11px 22px; background: #f4f4f2; color: #0a0a0a; border: none; border-radius: 8px; cursor: pointer;">Crear cuenta</button>
    </div>
  </div>
</header>

<!-- BARRA SUPERIOR -->
<div style="background: #101010; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 12px; color: #8f8f8a;">
  <div class="wrap" style="max-width: 1180px; margin: 0 auto; padding: 8px 48px; display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
    <span>Pasarela de pagos para empresas en Colombia · Bre-B y ACH</span>
    <span style="display: inline-flex; align-items: center; gap: 6px;"><span style="width: 6px; height: 6px; border-radius: 50%; background: #4ade80;"></span>Todos los sistemas operativos</span>
  </div>
</div>

<!-- HERO -->
<section id="top" style="border-bottom: 1px solid rgba(255,255,255,0.12);">
  <div class="wrap hero-grid" style="max-width: 1180px; margin: 0 auto; padding: 80px 48px 72px; display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 64px; align-items: center;">
    <div>
      <div style="display: inline-flex; align-items: center; gap: 8px; border: 1px solid rgba(74,222,128,0.35); color: #4ade80; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 999px; margin-bottom: 26px;">
        <svg viewBox="0 0 24 24" style="width: 14px; height: 14px;"><rect x="3" y="7" width="18" height="13" rx="2.5" fill="none" stroke="#4ade80" stroke-width="2"></rect><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" fill="none" stroke="#4ade80" stroke-width="2"></path></svg>
        Pasarela de pagos para empresas
      </div>
      <h1 style="font-size: 68px; line-height: 1.0; font-weight: 800; letter-spacing: -3.2px; margin: 0;">Cobra y paga<br>en <span style="color: #4ade80;">segundos</span>.</h1>
      <p style="color: #8f8f8a; font-size: 18px; margin: 22px 0 0; max-width: 480px;">La cuenta de pagos de tu empresa en Colombia. Recibe pagos por llave Bre-B o link de pago, y paga a proveedores y nómina en cualquier banco por Bre-B o ACH — todo desde un solo lugar.</p>
      <div style="display: flex; gap: 12px; margin-top: 32px; flex-wrap: wrap;">
        <button class="btn-green" data-open="register" style="font-family: inherit; font-weight: 700; font-size: 16px; padding: 17px 32px; background: #4ade80; color: #0a0a0a; border: none; border-radius: 8px; cursor: pointer;">Crear cuenta de empresa</button>
        <a class="btn-outline" href="#como" style="font-weight: 600; font-size: 16px; padding: 17px 32px; border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; color: #f4f4f2; display: inline-flex; align-items: center; box-sizing: border-box;">Cómo funciona</a>
      </div>
      <div style="display: flex; gap: 28px; margin-top: 40px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.12); color: #8f8f8a; font-size: 13px; flex-wrap: wrap;">
        <span style="display: inline-flex; align-items: center; gap: 7px;"><span style="color: #4ade80; font-weight: 700;">✓</span>Bre-B 24/7</span>
        <span style="display: inline-flex; align-items: center; gap: 7px;"><span style="color: #4ade80; font-weight: 700;">✓</span>Factura electrónica conectada</span>
        <span style="display: inline-flex; align-items: center; gap: 7px;"><span style="color: #4ade80; font-weight: 700;">✓</span>Soporte humano</span>
      </div>
    </div>

    <!-- Panel de la cuenta (ilustrativo) -->
    <div class="hero-art" style="display: flex; align-items: center; justify-content: center;">
      <div style="position: relative; width: 100%; max-width: 440px;">
        <div style="position: absolute; inset: -20px; background: radial-gradient(circle, rgba(74,222,128,0.09), transparent 62%); filter: blur(24px); z-index: 0;"></div>
        <div style="position: relative; z-index: 1; background: #0C0E0D; border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; padding: 24px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
            <span style="font-size: 13px; color: #878E88;">Saldo de tu empresa</span>
            <span style="display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(74,222,128,0.3); border-radius: 999px; padding: 4px 10px;">
              <span style="width: 5px; height: 5px; border-radius: 50%; background: #4ADE80;"></span>
              <span style="font-size: 11px; font-weight: 700; color: #4ADE80; letter-spacing: 0.4px;">COP</span>
            </span>
          </div>
          <div style="font-size: 34px; font-weight: 800; letter-spacing: -1.2px; color: #F4F4F2;">$48.750.300</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 18px;">
            <span style="text-align: center; background: #F4F4F2; color: #0A0A0A; border-radius: 10px; padding: 11px 0; font-size: 14px; font-weight: 700;">Cobrar</span>
            <span style="text-align: center; border: 1px solid rgba(255,255,255,0.18); color: #F4F4F2; border-radius: 10px; padding: 11px 0; font-size: 14px; font-weight: 700;">Pagar</span>
          </div>
          <div style="margin-top: 20px; font-size: 10.5px; font-weight: 700; letter-spacing: 1.2px; color: #878E88;">MOVIMIENTOS DE HOY</div>
          <div style="margin-top: 6px;">
            <div style="display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
              <span style="width: 32px; height: 32px; border-radius: 10px; background: rgba(74,222,128,0.12); color: #4ADE80; display: grid; place-items: center; font-weight: 800; flex-shrink: 0;">↓</span>
              <span style="flex: 1; min-width: 0;"><span style="display: block; font-size: 13.5px; font-weight: 700; color: #F4F4F2;">Cobro por llave Bre-B</span><span style="display: block; font-size: 11.5px; color: #878E88;">Cliente · recibido al instante</span></span>
              <span style="font-size: 13.5px; font-weight: 700; color: #4ADE80; white-space: nowrap;">+$1.200.000</span>
            </div>
            <div style="display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
              <span style="width: 32px; height: 32px; border-radius: 10px; background: rgba(255,255,255,0.06); color: #F4F4F2; display: grid; place-items: center; font-weight: 800; flex-shrink: 0;">↑</span>
              <span style="flex: 1; min-width: 0;"><span style="display: block; font-size: 13.5px; font-weight: 700; color: #F4F4F2;">Pago a proveedor · Bre-B</span><span style="display: block; font-size: 11.5px; color: #878E88;">Llegó en segundos</span></span>
              <span style="font-size: 13.5px; font-weight: 700; color: #F4F4F2; white-space: nowrap;">−$4.850.000</span>
            </div>
            <div style="display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
              <span style="width: 32px; height: 32px; border-radius: 10px; background: rgba(74,222,128,0.12); color: #4ADE80; display: grid; place-items: center; font-weight: 800; flex-shrink: 0;">↓</span>
              <span style="flex: 1; min-width: 0;"><span style="display: block; font-size: 13.5px; font-weight: 700; color: #F4F4F2;">Link de pago</span><span style="display: block; font-size: 11.5px; color: #878E88;">Factura FE-1043 · pagada</span></span>
              <span style="font-size: 13.5px; font-weight: 700; color: #4ADE80; white-space: nowrap;">+$2.300.000</span>
            </div>
            <div style="display: flex; align-items: center; gap: 12px; padding: 12px 0;">
              <span style="width: 32px; height: 32px; border-radius: 10px; background: rgba(255,255,255,0.06); color: #F4F4F2; display: grid; place-items: center; font-weight: 800; flex-shrink: 0;">↑</span>
              <span style="flex: 1; min-width: 0;"><span style="display: block; font-size: 13.5px; font-weight: 700; color: #F4F4F2;">Nómina · ACH</span><span style="display: block; font-size: 11.5px; color: #878E88;">En el ciclo bancario de hoy</span></span>
              <span style="font-size: 13.5px; font-weight: 700; color: #F4F4F2; white-space: nowrap;">−$12.400.000</span>
            </div>
          </div>
          <p style="text-align: center; font-size: 11px; color: rgba(244,244,242,0.45); margin: 12px 0 0;">Ejemplo ilustrativo de la cuenta de una empresa.</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- FRANJA DE CONFIANZA -->
<section style="border-bottom: 1px solid rgba(255,255,255,0.12); background: #101010;">
  <div class="wrap trust-grid" style="max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr);">
    <div style="padding: 26px 40px; border-right: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 14px;">
      <svg viewBox="0 0 24 24" style="width: 24px; height: 24px; flex-shrink: 0;"><polyline points="13 3 5 14 12 14 11 21 19 10 12 10 13 3" fill="none" stroke="#4ade80" stroke-width="2" stroke-linejoin="round"></polyline></svg>
      <div><div style="font-weight: 700; font-size: 14px;">Bre-B · 24/7</div><div style="color: #8f8f8a; font-size: 12px;">pagos inmediatos entre bancos</div></div>
    </div>
    <div style="padding: 26px 40px; border-right: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 14px;">
      <svg viewBox="0 0 24 24" style="width: 24px; height: 24px; flex-shrink: 0;"><path d="M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18M12 3l9 5H3z" fill="none" stroke="#4ade80" stroke-width="2" stroke-linejoin="round"></path></svg>
      <div><div style="font-weight: 700; font-size: 14px;">ACH</div><div style="color: #8f8f8a; font-size: 12px;">a cualquier cuenta en Colombia</div></div>
    </div>
    <div style="padding: 26px 40px; border-right: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 14px;">
      <svg viewBox="0 0 24 24" style="width: 24px; height: 24px; flex-shrink: 0;"><rect x="5" y="10" width="14" height="10" rx="2.5" fill="none" stroke="#4ade80" stroke-width="2"></rect><circle cx="12" cy="7" r="4" fill="none" stroke="#4ade80" stroke-width="2"></circle><circle cx="12" cy="15" r="1.7" fill="#4ade80"></circle></svg>
      <div><div style="font-weight: 700; font-size: 14px;">Dos pasos</div><div style="color: #8f8f8a; font-size: 12px;">en cada pago que sale</div></div>
    </div>
    <div style="padding: 26px 40px; display: flex; align-items: center; gap: 14px;">
      <svg viewBox="0 0 24 24" style="width: 24px; height: 24px; flex-shrink: 0;"><rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="#4ade80" stroke-width="2"></rect><line x1="4" y1="10" x2="20" y2="10" stroke="#4ade80" stroke-width="2"></line></svg>
      <div><div style="font-weight: 700; font-size: 14px;">Empresa verificada</div><div style="color: #8f8f8a; font-size: 12px;">revisión KYB de cada cuenta</div></div>
    </div>
  </div>
</section>

<!-- FUNCIONES -->
<section id="funciones" style="border-bottom: 1px solid rgba(255,255,255,0.12);">
  <div class="wrap" style="max-width: 1180px; margin: 0 auto;">
    <div class="feature-row" style="display: flex; align-items: center; gap: 32px; padding: 36px 48px; border-bottom: 1px solid rgba(255,255,255,0.12);">
      <span style="font-size: 14px; color: #4ade80; font-weight: 700; width: 40px; flex-shrink: 0;">01</span>
      <h3 class="feature-title" style="font-size: 26px; font-weight: 700; letter-spacing: -0.8px; margin: 0; width: 340px; flex-shrink: 0;">Cobra por llave Bre-B</h3>
      <p style="color: #8f8f8a; font-size: 15px; margin: 0; flex: 1;">Tus clientes te pagan a la llave Bre-B de tu empresa desde cualquier banco, y el dinero entra a tu saldo en segundos, también los fines de semana.</p>
    </div>
    <div class="feature-row" style="display: flex; align-items: center; gap: 32px; padding: 36px 48px; border-bottom: 1px solid rgba(255,255,255,0.12);">
      <span style="font-size: 14px; color: #4ade80; font-weight: 700; width: 40px; flex-shrink: 0;">02</span>
      <h3 class="feature-title" style="font-size: 26px; font-weight: 700; letter-spacing: -0.8px; margin: 0; width: 340px; flex-shrink: 0;">Links de pago</h3>
      <p style="color: #8f8f8a; font-size: 15px; margin: 0; flex: 1;">Genera un link por el monto exacto y compártelo por WhatsApp o correo. Cuando el pago se confirma, entra directo a tu cuenta.</p>
    </div>
    <div class="feature-row" style="display: flex; align-items: center; gap: 32px; padding: 36px 48px; border-bottom: 1px solid rgba(255,255,255,0.12);">
      <span style="font-size: 14px; color: #4ade80; font-weight: 700; width: 40px; flex-shrink: 0;">03</span>
      <h3 class="feature-title" style="font-size: 26px; font-weight: 700; letter-spacing: -0.8px; margin: 0; width: 340px; flex-shrink: 0;">Paga a proveedores y nómina</h3>
      <p style="color: #8f8f8a; font-size: 15px; margin: 0; flex: 1;">Envía a cualquier banco en Colombia: por Bre-B en segundos, 24/7, o por ACH a cualquier cuenta de ahorros o corriente.</p>
    </div>
    <div class="feature-row" style="display: flex; align-items: center; gap: 32px; padding: 36px 48px; border-bottom: 1px solid rgba(255,255,255,0.12);">
      <span style="font-size: 14px; color: #4ade80; font-weight: 700; width: 40px; flex-shrink: 0;">04</span>
      <h3 class="feature-title" style="font-size: 26px; font-weight: 700; letter-spacing: -0.8px; margin: 0; width: 340px; flex-shrink: 0;">Beneficiarios verificados</h3>
      <p style="color: #8f8f8a; font-size: 15px; margin: 0; flex: 1;">Inscribes una vez a quién le pagas. Antes de cada envío por llave revisamos que el titular sea el que esperas, para que la plata no le llegue a otro.</p>
    </div>
    <div class="feature-row" style="display: flex; align-items: center; gap: 32px; padding: 36px 48px; border-bottom: 1px solid rgba(255,255,255,0.12);">
      <span style="font-size: 14px; color: #4ade80; font-weight: 700; width: 40px; flex-shrink: 0;">05</span>
      <h3 class="feature-title" style="font-size: 26px; font-weight: 700; letter-spacing: -0.8px; margin: 0; width: 340px; flex-shrink: 0;">Contabilidad al día</h3>
      <p style="color: #8f8f8a; font-size: 15px; margin: 0; flex: 1;">Cada cobro y cada pago queda listo para tu contabilidad, con factura electrónica y documento soporte, y tu contador entra a su propio portal.</p>
    </div>
    <div class="feature-row" style="display: flex; align-items: center; gap: 32px; padding: 36px 48px;">
      <span style="font-size: 14px; color: #4ade80; font-weight: 700; width: 40px; flex-shrink: 0;">06</span>
      <h3 class="feature-title" style="font-size: 26px; font-weight: 700; letter-spacing: -0.8px; margin: 0; width: 340px; flex-shrink: 0;">Tu equipo, con permisos</h3>
      <p style="color: #8f8f8a; font-size: 15px; margin: 0; flex: 1;">Tus operadores entran con su propio usuario y solo hacen lo que la empresa les autoriza. Tú ves cada movimiento y quién lo hizo.</p>
    </div>
  </div>
</section>

<!-- CÓMO FUNCIONA -->
<section id="como" style="border-bottom: 1px solid rgba(255,255,255,0.12); background: #101010;">
  <div class="wrap" style="max-width: 1180px; margin: 0 auto; padding: 80px 48px;">
    <h2 style="font-size: 44px; font-weight: 800; letter-spacing: -2px; margin: 0 0 36px;">Empieza en tres pasos<span style="color: #4ade80;">.</span></h2>
    <div class="testi-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
      <div style="background: #0a0a0a; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 28px;">
        <div style="font-size: 14px; font-weight: 700; color: #4ade80;">01</div>
        <h3 style="font-size: 21px; font-weight: 700; letter-spacing: -0.5px; margin: 12px 0 8px;">Crea la cuenta de tu empresa</h3>
        <p style="color: #8f8f8a; font-size: 15px; margin: 0;">Regístrate con los datos de la empresa y de su representante legal. Toma pocos minutos.</p>
      </div>
      <div style="background: #0a0a0a; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 28px;">
        <div style="font-size: 14px; font-weight: 700; color: #4ade80;">02</div>
        <h3 style="font-size: 21px; font-weight: 700; letter-spacing: -0.5px; margin: 12px 0 8px;">Verificamos tu empresa</h3>
        <p style="color: #8f8f8a; font-size: 15px; margin: 0;">Nuestro equipo revisa la documentación (KYB). Cuando queda aprobada, la cuenta se habilita.</p>
      </div>
      <div style="background: #0a0a0a; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 28px;">
        <div style="font-size: 14px; font-weight: 700; color: #4ade80;">03</div>
        <h3 style="font-size: 21px; font-weight: 700; letter-spacing: -0.5px; margin: 12px 0 8px;">Cobra y paga</h3>
        <p style="color: #8f8f8a; font-size: 15px; margin: 0;">Comparte tu llave Bre-B o tus links de pago, inscribe a tus proveedores y envía cuando lo necesites.</p>
      </div>
    </div>
  </div>
</section>

<!-- SEGURIDAD -->
<section id="seguridad" style="border-bottom: 1px solid rgba(255,255,255,0.12);">
  <div class="wrap sec-grid" style="max-width: 1180px; margin: 0 auto; padding: 88px 48px; display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center;">
    <div>
      <h2 style="font-size: 48px; font-weight: 800; letter-spacing: -2.2px; margin: 0 0 18px;">El dinero de tu empresa, protegido en cada paso<span style="color: #4ade80;">.</span></h2>
      <p style="color: #8f8f8a; font-size: 17px; margin: 0 0 26px;">No somos un banco. Los pagos viajan por los rieles del sistema de pagos colombiano (Bre-B y ACH) a través de aliados de infraestructura, y cada operación de tu empresa se cuida así:</p>
      <div style="display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 16px;"><span style="color: #4ade80; font-weight: 700;">✓</span>Verificación de la empresa y su representante (KYB)</div>
        <div style="display: flex; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 16px;"><span style="color: #4ade80; font-weight: 700;">✓</span>Confirmación en dos pasos en cada pago</div>
        <div style="display: flex; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 16px;"><span style="color: #4ade80; font-weight: 700;">✓</span>Revisión del titular antes de enviar por llave</div>
        <div style="display: flex; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 16px;"><span style="color: #4ade80; font-weight: 700;">✓</span>Prevención de LA/FT (SARLAFT) y monitoreo de operaciones</div>
      </div>
    </div>
    <div style="background: #0a0a0a; border: 1px solid rgba(255,255,255,0.14); border-radius: 16px; padding: 10px;">
      <div style="display: flex; align-items: center; gap: 14px; padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1);">
        <span style="width: 10px; height: 10px; border-radius: 50%; background: #4ade80;"></span>
        <span style="flex: 1; font-size: 15px;">Estado del sistema</span><strong style="color: #4ade80;">Operativo</strong>
      </div>
      <div style="display: flex; align-items: center; gap: 14px; padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1);">
        <svg viewBox="0 0 24 24" style="width: 18px; height: 18px;"><polyline points="13 3 5 14 12 14 11 21 19 10 12 10 13 3" fill="none" stroke="#4ade80" stroke-width="2" stroke-linejoin="round"></polyline></svg>
        <span style="flex: 1; font-size: 15px;">Pagos por Bre-B</span><strong>24/7 · segundos</strong>
      </div>
      <div style="display: flex; align-items: center; gap: 14px; padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1);">
        <svg viewBox="0 0 24 24" style="width: 18px; height: 18px;"><path d="M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18M12 3l9 5H3z" fill="none" stroke="#4ade80" stroke-width="2" stroke-linejoin="round"></path></svg>
        <span style="flex: 1; font-size: 15px;">Pagos por ACH</span><strong>Días hábiles</strong>
      </div>
      <div style="display: flex; align-items: center; gap: 14px; padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1);">
        <svg viewBox="0 0 24 24" style="width: 18px; height: 18px;"><rect x="5" y="10" width="14" height="10" rx="2.5" fill="none" stroke="#4ade80" stroke-width="2"></rect><circle cx="12" cy="7" r="4" fill="none" stroke="#4ade80" stroke-width="2"></circle></svg>
        <span style="flex: 1; font-size: 15px;">Confirmación</span><strong>Dos pasos</strong>
      </div>
      <div style="display: flex; align-items: center; gap: 14px; padding: 20px;">
        <svg viewBox="0 0 24 24" style="width: 18px; height: 18px;"><rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="#4ade80" stroke-width="2"></rect><line x1="4" y1="10" x2="20" y2="10" stroke="#4ade80" stroke-width="2"></line></svg>
        <span style="flex: 1; font-size: 15px;">Verificación</span><strong>KYB</strong>
      </div>
    </div>
  </div>
</section>

<!-- PREGUNTAS -->
<section id="faq" style="border-bottom: 1px solid rgba(255,255,255,0.12);">
  <div class="wrap faq-grid" style="max-width: 1180px; margin: 0 auto; padding: 80px 48px; display: grid; grid-template-columns: 0.8fr 1.2fr; gap: 64px; align-items: start;">
    <h2 style="font-size: 44px; font-weight: 800; letter-spacing: -2px; margin: 0;">Preguntas frecuentes<span style="color: #4ade80;">.</span></h2>
    <div style="display: flex; flex-direction: column;">
      <details class="faq" style="border-bottom: 1px solid rgba(255,255,255,0.12); padding: 20px 0;">
        <summary style="cursor: pointer; font-weight: 700; font-size: 17px; display: flex; justify-content: space-between; gap: 16px;">¿Qué es Lincoin?<span style="color: #4ade80; font-size: 22px; line-height: 1;">+</span></summary>
        <p style="color: #8f8f8a; font-size: 15px; margin: 14px 0 0;">Una pasarela de pagos para empresas en Colombia: una cuenta en pesos para cobrarles a tus clientes y pagar a proveedores, nómina y terceros por Bre-B y ACH.</p>
      </details>
      <details class="faq" style="border-bottom: 1px solid rgba(255,255,255,0.12); padding: 20px 0;">
        <summary style="cursor: pointer; font-weight: 700; font-size: 17px; display: flex; justify-content: space-between; gap: 16px;">¿Cómo me pagan mis clientes?<span style="color: #4ade80; font-size: 22px; line-height: 1;">+</span></summary>
        <p style="color: #8f8f8a; font-size: 15px; margin: 14px 0 0;">A la llave Bre-B de tu empresa, desde cualquier banco, o con un link de pago por el monto exacto que les compartes.</p>
      </details>
      <details class="faq" style="border-bottom: 1px solid rgba(255,255,255,0.12); padding: 20px 0;">
        <summary style="cursor: pointer; font-weight: 700; font-size: 17px; display: flex; justify-content: space-between; gap: 16px;">¿Cuánto tarda un pago?<span style="color: #4ade80; font-size: 22px; line-height: 1;">+</span></summary>
        <p style="color: #8f8f8a; font-size: 15px; margin: 14px 0 0;">Por Bre-B, segundos, todos los días. Por ACH, en los ciclos bancarios de los días hábiles.</p>
      </details>
      <details class="faq" style="border-bottom: 1px solid rgba(255,255,255,0.12); padding: 20px 0;">
        <summary style="cursor: pointer; font-weight: 700; font-size: 17px; display: flex; justify-content: space-between; gap: 16px;">¿Cuánto cuesta?<span style="color: #4ade80; font-size: 22px; line-height: 1;">+</span></summary>
        <p style="color: #8f8f8a; font-size: 15px; margin: 14px 0 0;">Abrir la cuenta no tiene costo. Cada operación tiene una tarifa fija que ves antes de confirmarla, sin cobros escondidos.</p>
      </details>
      <details class="faq" style="border-bottom: 1px solid rgba(255,255,255,0.12); padding: 20px 0;">
        <summary style="cursor: pointer; font-weight: 700; font-size: 17px; display: flex; justify-content: space-between; gap: 16px;">¿Quién puede abrir una cuenta?<span style="color: #4ade80; font-size: 22px; line-height: 1;">+</span></summary>
        <p style="color: #8f8f8a; font-size: 15px; margin: 14px 0 0;">Empresas en Colombia. Las personas de tu equipo entran como operadores, con los permisos que la empresa les dé.</p>
      </details>
      <details class="faq" style="border-bottom: 1px solid rgba(255,255,255,0.12); padding: 20px 0;">
        <summary style="cursor: pointer; font-weight: 700; font-size: 17px; display: flex; justify-content: space-between; gap: 16px;">¿Lincoin es un banco?<span style="color: #4ade80; font-size: 22px; line-height: 1;">+</span></summary>
        <p style="color: #8f8f8a; font-size: 15px; margin: 14px 0 0;">No. Lincoin es una plataforma de pagos para empresas que opera a través de aliados de infraestructura de pagos en Colombia.</p>
      </details>
    </div>
  </div>
</section>

<!-- LLAMADO FINAL -->
<section style="border-bottom: 1px solid rgba(255,255,255,0.12); background: #101010;">
  <div class="wrap download-row" style="max-width: 1180px; margin: 0 auto; padding: 76px 48px; display: flex; justify-content: space-between; align-items: center; gap: 32px; flex-wrap: wrap;">
    <div>
      <h2 style="font-size: 52px; font-weight: 800; letter-spacing: -2.5px; margin: 0 0 8px;">Pon a tu empresa a cobrar y pagar hoy<span style="color: #4ade80;">.</span></h2>
      <p style="color: #8f8f8a; font-size: 16px; margin: 0;">Crea la cuenta en minutos. Sin costo de apertura.</p>
    </div>
    <div style="display: flex; gap: 12px; flex-shrink: 0; flex-wrap: wrap;">
      <button class="btn-green" data-open="register" style="font-family: inherit; font-weight: 700; font-size: 16px; padding: 17px 32px; background: #4ade80; color: #0a0a0a; border: none; border-radius: 8px; cursor: pointer;">Crear cuenta de empresa</button>
      <button class="btn-outline" data-open="login" style="font-family: inherit; font-weight: 600; font-size: 16px; padding: 17px 32px; background: transparent; border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; color: #f4f4f2; cursor: pointer;">Ingresar</button>
    </div>
  </div>
</section>

<!-- PIE -->
<footer style="padding: 56px 0 32px;">
  <div class="wrap" style="max-width: 1180px; margin: 0 auto; padding: 0 48px;">
    <div class="foot-grid" style="display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: 40px; padding-bottom: 40px; border-bottom: 1px solid rgba(255,255,255,0.12);">
      <div>
        <div style="font-weight: 800; font-size: 20px; letter-spacing: -0.6px; margin-bottom: 14px;">Lincoin<span style="color: #4ade80;">.</span></div>
        <p style="color: #8f8f8a; font-size: 13px; margin: 0; max-width: 280px;">La pasarela de pagos para empresas en Colombia. Cobra y paga por Bre-B y ACH desde una sola cuenta.</p>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px; font-size: 14px; color: #8f8f8a;">
        <strong style="color: #f4f4f2; font-size: 13px; letter-spacing: 1px;">PRODUCTO</strong>
        <a class="nl" href="#funciones">Funciones</a><a class="nl" href="#como">Cómo funciona</a><a class="nl" href="#faq">Preguntas</a>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px; font-size: 14px; color: #8f8f8a;">
        <strong style="color: #f4f4f2; font-size: 13px; letter-spacing: 1px;">SEGURIDAD</strong>
        <a class="nl" data-page="security" href="#">Cómo te protegemos</a><a class="nl" data-page="status" href="#">Estado del sistema</a><a class="nl" data-page="support" href="#">Centro de ayuda</a>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px; font-size: 14px; color: #8f8f8a;">
        <strong style="color: #f4f4f2; font-size: 13px; letter-spacing: 1px;">LEGAL</strong>
        <a class="nl" data-page="terms" href="#">Términos y condiciones</a><a class="nl" data-page="privacy" href="#">Política de privacidad</a><a class="nl" data-page="complaints" href="#">Reclamaciones</a>
      </div>
    </div>
    <p style="color: #6b6b66; font-size: 12px; margin: 24px 0 8px; max-width: 900px;">Lincoin no es un banco ni una entidad de crédito. Los pagos se procesan a través de aliados de infraestructura de pagos en Colombia. Lincoin implementa el SARLAFT (Sistema de Administración del Riesgo de Lavado de Activos y de la Financiación del Terrorismo): conocimiento del cliente (KYC/KYB), debida diligencia, monitoreo transaccional y reporte de operaciones sospechosas.</p>
    <p style="color: #6b6b66; font-size: 12px; margin: 0;">© 2026 Lincoin.</p>
  </div>
</footer>
`;
