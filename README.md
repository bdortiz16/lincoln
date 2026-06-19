# Lincoln 💵

App móvil de billetera de **dólares y cripto** estilo Lemon Cash, Wenia, Dólar App y Monabit.
Las personas se registran, ven su saldo, **compran/venden** dólares y cripto, y **envían/reciben** fondos.

Construida con **React Native + Expo** (expo-router, TypeScript).

## Funcionalidades

- **Onboarding**: pantalla de bienvenida, registro e inicio de sesión.
- **Sesión persistente** con `expo-secure-store`.
- **Inicio**: balance total en USD, accesos rápidos y lista de activos.
- **Mercado**: precios y variación 24h de USD, USDT, USDC, BTC, ETH.
- **Comprar / Vender**: convierte entre USD y cripto con estimación en vivo.
- **Enviar / Recibir**: transferencias por usuario/dirección + pantalla de recepción con QR.
- **Actividad**: historial de movimientos.
- **Perfil**: datos de usuario, accesos a verificación/seguridad y cerrar sesión.

> ⚠️ Es un MVP con datos simulados (mock). La autenticación, los precios y los saldos
> son locales/en memoria. Para producción se deben conectar un backend, un proveedor
> de precios y un proveedor de custodia/KYC reales.

## Cómo correr

Requisitos: Node 18+ y la app **Expo Go** en tu teléfono (o un emulador iOS/Android).

```bash
npm install
npm start
```

Luego escanea el QR con Expo Go, o presiona `i` (iOS) / `a` (Android) / `w` (web).

## Estructura

```
app/                       # Rutas (expo-router)
  _layout.tsx              # Providers + navegación raíz
  index.tsx                # Redirección según sesión
  (auth)/                  # welcome, login, register
  (tabs)/                  # index (inicio), market, activity, profile
  buy.tsx | send.tsx | receive.tsx   # pantallas modales
src/
  context/                 # AuthContext, WalletContext (estado global)
  components/              # UI reutilizable (Button, Card, Field, ...)
  data/assets.ts           # Catálogo de activos + precios mock
  utils/format.ts          # Formato de moneda/fechas
  theme.ts                 # Tokens de diseño
```

## Próximos pasos sugeridos

- Backend de autenticación real (JWT) + verificación KYC.
- Integración con proveedor de precios (CoinGecko, Binance) en tiempo real.
- Custodia/on-ramp para fondear con tarjeta o transferencia.
- Notificaciones push y biometría para confirmar operaciones.
