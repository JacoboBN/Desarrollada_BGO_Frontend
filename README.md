# Frontend - DriveShare / BGO

Aplicación de escritorio Electron para gestionar facturas y albaranes con Google Drive, backend Express y análisis con IA.

## Funcionalidad principal

- Login con Google mediante el backend.
- Navegación y búsqueda de archivos/carpetas en Google Drive.
- Subida única de documentos: se pueden mezclar facturas y albaranes y la IA identifica cada tipo automáticamente.
- Envío de documentos al backend para análisis asíncrono con IA.
- Polling de jobs y cancelación de elementos en cola.
- Persistencia de las extracciones de IA en PostgreSQL y comparación de facturas contra albaranes por totales desde la base de datos.
- Comparación automática de documentos relacionados, independientemente del orden de subida; Drive solo representa su estado visual (`No procesado`, `No comparado`, `Documentos`).
- Botón temporal de pruebas para vaciar los datos operativos de PostgreSQL con confirmación explícita, sin borrar tablas ni migraciones.
- Envío de emails de resultado mediante Gmail autenticado. Solo se notifica la comparación cuando una factura tiene todos sus albaranes relacionados: verde si no hay diferencias, amarillo si solo hay diferencias de 1 céntimo y rojo si existe alguna diferencia de 2 céntimos o más. La calidad documental clasifica campos como `mortal`, `critico`, `medio` o `indiferente`: el aviso `🚨` se reserva para número, total o referencias imprescindibles ausentes, o `confidence < 0.60`; los avisos no mortales no generan emails automáticos.
- Actualización automática con `electron-updater` y releases de GitHub.

## Requisitos

- Node.js/npm.
- Windows para el build actualmente soportado.
- Backend accesible por `BACKEND_URL` o por la URL de producción por defecto.
- Credenciales OAuth configuradas en el backend.
- Recursos de build si se quiere empaquetar instalador Windows: iconos, binarios y `ocr.exe` según `package.json`.

## Instalación

```bash
npm ci
```

Si estás inicializando dependencias sin lock limpio:

```bash
npm install
```

## Variables de entorno

El código lee variables desde `process.env`. El archivo `.env` no se carga automáticamente por Electron salvo que se añada un cargador explícito; para desarrollo se recomienda usar scripts npm o variables del sistema.

Copia el ejemplo si quieres documentar valores locales:

```bash
copy .env.example .env
```

Variables usadas:

| Variable | Uso |
| --- | --- |
| `BACKEND_URL` | URL base del backend. Si falta, usa `https://desarrollada-bgo-backend.onrender.com`. |
| `ENABLE_REFRESH_TOKENS` | Fuerza uso de refresh tokens propios. Si falta, se activa en producción/app empaquetada. |
| `RESET_SESSION_ON_START` | Si vale `true`, borra sesiones guardadas al iniciar. |
| `ENABLE_STARTUP_NO_PROCESADO_SCAN` | Si vale `true`, escanea automáticamente las carpetas `No procesado` al iniciar con una sesión válida o después de un login principal. Por defecto está desactivado. |
| `DRIVE_UPLOAD_TIMEOUT_MS` | Timeout de uploads a Drive. Por defecto `180000`. |
| `DRIVE_UPLOAD_CONCURRENCY` | Concurrencia de uploads a Drive. Por defecto `3`. |

## Ejecución

Usar backend de producción por defecto:

```bash
npm run start:prod
```

Usar backend local en Windows:

```bash
npm run start:local
```

El script local define:

```text
BACKEND_URL=http://localhost:3000
```

## Build

Windows:

```bash
npm run build:win
```

También existen scripts `build:mac` y `build:linux`, pero el código y recursos actuales están orientados a Windows (`ocr.exe`, rutas `assets/bin/win`, target NSIS). No asumir compatibilidad real con macOS/Linux sin revisar recursos y empaquetado.

## Recursos requeridos para empaquetar

La configuración `build.extraResources` de `package.json` espera:

```text
assets/icon.ico
assets/icon.icns
assets/icon.png
assets/bin/win/
ocr/ocr.exe
```

En un clon limpio estos recursos pueden no existir. El workflow de release también necesita tenerlos disponibles antes de ejecutar `npm run build:win`.

Consulta `assets/bin/README.md` para detalles de los binarios.

## Release y actualizaciones

La configuración de `electron-builder` publica/consulta releases en:

```text
https://github.com/JacoboBN/frontend_factura_albaran
```

El repositorio fuente remoto de este checkout puede ser distinto:

```text
https://github.com/JacoboBN/Desarrollada_BGO_Fontend
```

Si el workflow se ejecuta desde un repo y publica en otro, `GITHUB_TOKEN` puede no ser suficiente. En ese caso se necesita un token con permisos sobre el repositorio de publicación.

El workflow valida que el tag `vX.Y.Z` coincida con `package.json.version` antes de publicar.

## Estructura de Drive esperada

El flujo de negocio crea/usa carpetas como:

- `Albaranes`
- `Facturas`
- `No procesado`
- `Informes - No tocar`
- Subcarpetas de informes y documentos procesados/no comparados.

El frontend intenta crear carpetas necesarias cuando faltan, según el flujo de subida y comparación.

## Funcionalidades futuras o reactivables

Estas funcionalidades se conservan, pero no forman parte del flujo activo por defecto. Antes de activarlas, revisar sus permisos, el contrato con el backend y realizar pruebas integradas con datos de prueba.

- **Monitor automático de Gmail para facturas:** conserva `startBillingMonitor` y `runBillingMonitorCycle` en `main.js`, junto con los endpoints `/gmail/*` del backend. Permanece desactivado y requiere pruebas con una cuenta Gmail autorizada antes de reactivarlo.
- **Escaneo automático de Drive `No procesado`:** se controla con `ENABLE_STARTUP_NO_PROCESADO_SCAN=true`. Revisa las carpetas de `No procesado`, procesa documentos y relanza comparaciones pendientes; por defecto permanece desactivado.
- **OCR local de Electron:** conserva el handler `ocr-document`, `performLocalOCR`, `getBinaryPaths` y el recurso `ocr/ocr.exe` configurado para el empaquetado Windows.
- **Comparación compleja por líneas:** la lógica permanece en `compareFacturaWithAlbaranes` y sus helpers. El flujo activo compara por totales; reactivarla requiere incorporar una selección de modo y revisar los emails de comparación.
- **Centros:** la tarjeta permanece visible pero deshabilitada hasta que se defina e implemente su flujo de negocio.
- **Comparación forzada manual desde UI:** la comparación programática de facturas pendientes se conserva, pero no hay botón manual en la interfaz.

No documentar estas funciones como activas sin reactivarlas y probarlas.

## Tests

Test unitario seguro disponible:

```bash
npm run test:albaran-numbers
npm run test:document-order
npm run test:document-quality
```

Las zonas de subida de facturas y albaranes permanecen separadas. Una factura se intenta comparar al terminar su análisis; si faltan albaranes queda en `Facturas/No comparado`. Al analizar un albarán, PostgreSQL identifica exclusivamente las facturas que esperaban ese número y el frontend compara solo esas facturas; el reintento global de pendientes se conserva como fallback, no como paso automático de cada subida.

Las notificaciones automáticas se registran y deduplican en PostgreSQL por organización. Por tanto, relanzar una comparación final con el mismo resultado no vuelve a enviar el mismo email, incluso desde otro equipo. Un error de Gmail se muestra en la cola, pero no bloquea el movimiento de documentos; el registro queda disponible para reintento en una ejecución posterior.

## Seguridad conocida

Las ventanas Electron se crean actualmente con:

```js
nodeIntegration: true
contextIsolation: false
```

Esto facilita el desarrollo, pero no es la configuración recomendada para producción. Antes de exponer contenido no confiable conviene migrar a:

- `nodeIntegration: false`
- `contextIsolation: true`
- `preload.js` con `contextBridge`
- Validación estricta de IPC
- Validación de URLs abiertas con `shell.openExternal`

## Dependencias

La aplicación usa, entre otras:

- Electron
- electron-builder
- electron-updater
- axios
- electron-store
- electron-log

Además, `main.js` usa `require('form-data')`, pero `form-data` no está declarado como dependencia directa en `package.json` en este checkout. Conviene añadirlo explícitamente para no depender de una dependencia transitiva de `electron-builder`.

Revisar periódicamente:

```bash
npm audit
```

## Problemas frecuentes

### No conecta con backend local

Arranca el backend en `http://localhost:3000` y usa:

```bash
npm run start:local
```

### El build falla por recursos faltantes

Verifica que existen iconos, `assets/bin/win` y `ocr/ocr.exe`, o ajusta `package.json`/workflow para descargarlos antes del build.

### Las actualizaciones no aparecen

Verifica que la release existe en `frontend_factura_albaran`, que el tag coincide con `package.json.version` y que los artefactos `latest.yml`/instalador se publicaron correctamente.
