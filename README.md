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

## Correr en Android Studio y Xcode (proyectos nativos)

El repo ya incluye los proyectos nativos generados con `expo prebuild`:
`android/` (Android Studio) e `ios/` (Xcode).

### Android (Android Studio)

```bash
npm install
# Opción A: desde la terminal
npx expo run:android
# Opción B: abrir en Android Studio
#   File > Open... > selecciona la carpeta  android/
#   Espera el sync de Gradle y pulsa ▶ Run con un emulador o dispositivo
```

Requisitos: Android Studio, un SDK de Android y un emulador (o teléfono con
depuración USB). `package` de la app: `com.lincoln.wallet`.

### iOS (Xcode — solo en macOS)

```bash
npm install
cd ios && pod install && cd ..   # genera Lincoln.xcworkspace
# Opción A: desde la terminal
npx expo run:ios
# Opción B: abrir en Xcode
#   Abre  ios/Lincoln.xcworkspace  (¡el .xcworkspace, no el .xcodeproj!)
#   Elige un simulador y pulsa ▶ Run
```

Requisitos: macOS con Xcode y CocoaPods (`sudo gem install cocoapods`).
`bundleIdentifier`: `com.lincoln.wallet`.

> Si cambias `app.json` (nombre, ícono, plugins), regenera los nativos con
> `npx expo prebuild --clean`.

## Página web (landing)

En `web/` está el sitio web de Lincoln: una landing con hero, funciones, cómo
funciona, seguridad, preguntas frecuentes y un **modal para ingresar / crear
cuenta**. No requiere build — ábrela directamente:

```bash
# opción 1: abrir el archivo
open web/index.html        # macOS  (o doble clic en el explorador)

# opción 2: servidor local
npx serve web              # luego abre la URL que muestre
```

Archivos: `web/index.html`, `web/styles.css`, `web/app.js`. El registro/login
es una demo en el navegador (datos simulados); se conecta a un backend real
cambiando el `fetch` simulado en `web/app.js`.

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
