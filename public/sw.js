// ════════════════════════════════════════════════════════
// sw.js — service worker de Lincoin.
//
// Existe por UNA razón: recibir notificaciones push con la app cerrada. En iOS
// es la única forma, y solo funciona si la app está agregada a la pantalla de
// inicio (Compartir → "Añadir a pantalla de inicio"); en una pestaña del
// navegador no llega nada.
//
// NO CACHEA NADA, a propósito. Un service worker que sirve respuestas
// guardadas en una app de dinero puede mostrar un saldo viejo como si fuera el
// de ahora, y eso es peor que una pantalla lenta. Acá solo se escuchan pushes.
// ════════════════════════════════════════════════════════

self.addEventListener('install', () => {
    // Tomar el control enseguida: si hay que esperar a que se cierren todas las
    // pestañas, el primer push llega cuando ya no sirve.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; }
    catch { d = { titulo: 'Lincoin', cuerpo: event.data ? event.data.text() : '' }; }

    const titulo = d.titulo || 'Lincoin';
    const opciones = {
        body: d.cuerpo || '',
        icon: '/apple-touch-icon.png',
        badge: '/favicon-32.png',
        // Mismo tag = la nueva reemplaza a la anterior en vez de apilar veinte
        // avisos del mismo cierre. renotify hace que igual vibre.
        tag: d.tag || 'lincoin',
        renotify: true,
        requireInteraction: !!d.insistir,
        data: { url: d.url || '/' },
    };
    // waitUntil es obligatorio: sin él el navegador puede matar el worker antes
    // de que la notificación llegue a mostrarse.
    event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil((async () => {
        // Si la app ya está abierta se reutiliza esa ventana en vez de abrir
        // otra: dos copias de un panel de mesa es justo lo que no se quiere.
        const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of abiertas) {
            if ('focus' in c) {
                try { if ('navigate' in c) await c.navigate(url); } catch { /* algunas no dejan navegar */ }
                return c.focus();
            }
        }
        return self.clients.openWindow(url);
    })());
});
