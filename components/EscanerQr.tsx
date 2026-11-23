// Escáner de QR con la cámara (23 nov, Mesa OTC: "escanear para que se pegue
// la wallet automáticamente").
//
// Lee con el BarcodeDetector del navegador cuando existe (Chrome en Android y
// en Mac) y si no con jsQR, que se baja aparte solo al abrir el escáner: el
// iPhone y Safari no traen el detector, y sin el respaldo el botón no haría
// nada justo en el celular, que es donde más se usa. También se puede subir la
// foto o captura del QR: en un computador sin cámara es la única vía.
//
// La cámara se apaga al leer, al cerrar y al desmontar: una cámara que queda
// prendida después de cerrar la ventana es lo primero que asusta a un cliente.
// El sitio la permite solo para sí mismo (Permissions-Policy camera=(self)).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, ImageUp, ScanLine } from 'lucide-react';

type Lector = (fuente: HTMLVideoElement | HTMLCanvasElement | ImageBitmap) => Promise<string | null>;

// El lector de respaldo: pinta el cuadro en un canvas y se lo pasa a jsQR.
async function lectorJsqr(): Promise<Lector> {
  const { default: jsQR } = await import('jsqr');
  const lienzo = document.createElement('canvas');
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  return async (fuente) => {
    if (!ctx) return null;
    const ancho = (fuente as HTMLVideoElement).videoWidth || (fuente as HTMLCanvasElement | ImageBitmap).width;
    const alto = (fuente as HTMLVideoElement).videoHeight || (fuente as HTMLCanvasElement | ImageBitmap).height;
    if (!ancho || !alto) return null;
    // Más de ~1000 px no mejora la lectura y vuelve lento cada intento.
    const escala = Math.min(1, 1000 / Math.max(ancho, alto));
    lienzo.width = Math.round(ancho * escala); lienzo.height = Math.round(alto * escala);
    ctx.drawImage(fuente as CanvasImageSource, 0, 0, lienzo.width, lienzo.height);
    const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
  };
}

async function crearLector(): Promise<Lector> {
  const BD = (window as any).BarcodeDetector;
  if (BD) {
    try {
      const formatos: string[] = typeof BD.getSupportedFormats === 'function' ? await BD.getSupportedFormats() : ['qr_code'];
      if (formatos.includes('qr_code')) {
        const det = new BD({ formats: ['qr_code'] });
        const respaldo = await lectorJsqr().catch(() => null);
        return async (fuente) => {
          try {
            const r = await det.detect(fuente);
            if (r?.[0]?.rawValue) return String(r[0].rawValue);
          } catch { /* cae al respaldo */ }
          return respaldo ? respaldo(fuente) : null;
        };
      }
    } catch { /* sin detector usable: jsQR */ }
  }
  return lectorJsqr();
}

const mensajeCamara = (e: any): string => {
  const n = String(e?.name ?? '');
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'No diste permiso para usar la cámara. Actívalo en la configuración del navegador o sube una foto del QR.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Este equipo no tiene cámara disponible. Sube una foto o captura del QR.';
  if (n === 'NotReadableError') return 'La cámara la está usando otra aplicación. Ciérrala e intenta de nuevo, o sube una foto del QR.';
  return 'No se pudo abrir la cámara. Sube una foto o captura del QR.';
};

export const EscanerQr: React.FC<{
  titulo?: string;
  ayuda?: string;
  // Devuelve un mensaje si el texto leído no sirve (y se sigue escaneando);
  // null si se aceptó y la ventana se cierra.
  onLeido: (texto: string) => string | null;
  onCerrar: () => void;
}> = ({ titulo = 'Escanear QR', ayuda = 'Apunta la cámara al código QR.', onLeido, onCerrar }) => {
  const video = useRef<HTMLVideoElement>(null);
  const flujo = useRef<MediaStream | null>(null);
  const lector = useRef<Lector | null>(null);
  const vivo = useRef(true);
  const ultimoRechazo = useRef('');
  const [estado, setEstado] = useState<'abriendo' | 'leyendo' | 'sin_camara'>('abriendo');
  const [aviso, setAviso] = useState<string | null>(null);
  const [leyendoFoto, setLeyendoFoto] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);
  const leido = useRef(onLeido); leido.current = onLeido;
  const cerrar = useRef(onCerrar); cerrar.current = onCerrar;

  const apagar = useCallback(() => {
    flujo.current?.getTracks().forEach(t => t.stop());
    flujo.current = null;
  }, []);

  // Lo leído pasa por quien abrió el escáner: si no es una dirección válida,
  // se avisa y se sigue leyendo (el mismo QR no repite el aviso en bucle).
  const entregar = useCallback((texto: string): boolean => {
    const motivo = leido.current(texto);
    if (!motivo) { vivo.current = false; apagar(); cerrar.current(); return true; }
    if (texto !== ultimoRechazo.current) { ultimoRechazo.current = texto; setAviso(motivo); }
    return false;
  }, [apagar]);

  useEffect(() => {
    vivo.current = true;
    let cuadro = 0;
    (async () => {
      const lec = await crearLector().catch(() => null);
      lector.current = lec;
      if (!navigator.mediaDevices?.getUserMedia) { setEstado('sin_camara'); setAviso('Este navegador no deja usar la cámara aquí. Sube una foto o captura del QR.'); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!vivo.current) { s.getTracks().forEach(t => t.stop()); return; }
        flujo.current = s;
        const v = video.current;
        if (!v) return;
        v.srcObject = s;
        v.setAttribute('playsinline', 'true');
        await v.play().catch(() => {});
        setEstado('leyendo');
        // Un intento cada ~250 ms: más seguido calienta el celular sin leer antes.
        let ocupado = false;
        const ciclo = async () => {
          if (!vivo.current) return;
          if (!ocupado && lec && v.readyState >= 2) {
            ocupado = true;
            const t = await lec(v).catch(() => null);
            ocupado = false;
            if (t && entregar(t)) return;
          }
          cuadro = window.setTimeout(ciclo, 250);
        };
        ciclo();
      } catch (e) {
        setEstado('sin_camara');
        setAviso(mensajeCamara(e));
      }
    })();
    return () => { vivo.current = false; window.clearTimeout(cuadro); apagar(); };
  }, [apagar, entregar]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar.current(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, []);

  const deFoto = async (f: File | null | undefined) => {
    if (!f) return;
    setLeyendoFoto(true); setAviso(null);
    try {
      const lec = lector.current ?? await crearLector();
      lector.current = lec;
      const bmp = await createImageBitmap(f);
      const t = await lec(bmp);
      bmp.close?.();
      if (!t) setAviso('No se encontró un código QR en esa imagen. Prueba con una foto más cercana y nítida.');
      else { ultimoRechazo.current = ''; entregar(t); }
    } catch {
      setAviso('No se pudo leer esa imagen. Prueba con otra foto o captura del QR.');
    }
    setLeyendoFoto(false);
    if (archivo.current) archivo.current.value = '';
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={titulo} onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(4,5,5,0.82)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', padding: 16, fontFamily: "'Archivo', system-ui, sans-serif" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(420px, 100%)', boxSizing: 'border-box', borderRadius: 20, padding: 18, color: '#F4F4F2', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          background: 'radial-gradient(circle at 88% 0%, rgba(74,222,128,0.12), transparent 42%), linear-gradient(135deg, #121413 0%, #0C0E0D 60%, #0A0B0A 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 800 }}>
            <ScanLine size={17} style={{ color: '#4ADE80' }} /> {titulo}
          </span>
          <button onClick={onCerrar} aria-label="Cerrar"
            style={{ width: 32, height: 32, borderRadius: 9, border: 'none', background: 'transparent', color: '#878E88', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <X size={17} />
          </button>
        </div>
        <p style={{ margin: '4px 0 12px', fontSize: 12.5, color: '#878E88', lineHeight: 1.5 }}>{ayuda}</p>

        {/* El visor: cuadrado, con la guía en el centro. */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: 14, overflow: 'hidden', background: '#070808', border: '1px solid rgba(255,255,255,0.08)' }}>
          <video ref={video} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: estado === 'sin_camara' ? 'none' : 'block' }} />
          {estado !== 'sin_camara' && (
            <div aria-hidden style={{ position: 'absolute', inset: '16%', borderRadius: 16, boxShadow: '0 0 0 9999px rgba(7,8,8,0.45)', border: '2px solid rgba(74,222,128,0.85)' }} />
          )}
          {estado === 'abriendo' && (
            <p style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', margin: 0, fontSize: 13, color: '#878E88' }}>Abriendo la cámara…</p>
          )}
          {estado === 'sin_camara' && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
              <ImageUp size={34} style={{ color: '#878E88', margin: '0 auto' }} />
            </div>
          )}
        </div>

        {aviso && (
          <p style={{ margin: '12px 0 0', padding: '9px 12px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5, color: '#FBBF24', background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.3)' }}>{aviso}</p>
        )}

        <input ref={archivo} type="file" accept="image/*" onChange={e => deFoto(e.target.files?.[0])} style={{ display: 'none' }} />
        <button onClick={() => archivo.current?.click()} disabled={leyendoFoto}
          style={{ marginTop: 12, width: '100%', height: 40, borderRadius: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
            color: '#F4F4F2', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', opacity: leyendoFoto ? 0.6 : 1 }}>
          <ImageUp size={15} /> {leyendoFoto ? 'Leyendo la imagen…' : 'Subir foto o captura del QR'}
        </button>
      </div>
    </div>
  );
};
