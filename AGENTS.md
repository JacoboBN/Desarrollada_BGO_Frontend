# AGENTS.md - Frontend

Estas instrucciones aplican a `Frontend/` y complementan las instrucciones de `../AGENTS.md`.

## Contexto

- Aplicación de escritorio Electron para DriveShare.
- Archivo principal: `main.js`.
- Funcionalidad principal:
  - Login con Google mediante el backend.
  - Navegación, búsqueda y subida de archivos en Google Drive.
  - Envío de facturas/albaranes al backend para análisis IA asíncrono.
  - Polling y cancelación de jobs.
  - Creación de TXT de resumen en Drive.
  - Comparación de facturas y albaranes por totales.
  - Envío de emails mediante Gmail autenticado en backend.
  - Autoactualización con `electron-updater` y releases de GitHub.

## Estructura relevante

- `main.js`: proceso principal Electron y lógica de integración.
- `user.html`, `user.js`: interfaz y flujo de usuario.
- `lib/`: utilidades compartidas.
- `test/`: tests con el runner nativo de Node.
- `assets/`: iconos y binarios para empaquetado.
- `.github/workflows/release.yml`: workflow de release/build.
- `dist/`: artefactos generados; no editar como fuente de verdad.

## Comandos

```bash
# Instalar dependencias bloqueadas
npm ci

# Usar backend de producción por defecto
npm run start:prod

# Usar backend local Windows (http://localhost:3000)
npm run start:local

# Test unitario seguro
npm run test:albaran-numbers

# Empaquetar para Windows
npm run build:win
```

También existen `build:mac` y `build:linux`, pero no asumir compatibilidad real fuera de Windows sin revisar recursos y empaquetado.

## Variables de entorno y backend local

- Electron no carga `.env` automáticamente salvo que se añada un cargador explícito; el código usa `process.env`.
- Variables relevantes:
  - `BACKEND_URL`: URL base del backend; si falta, se usa producción por defecto.
  - `ENABLE_REFRESH_TOKENS`.
  - `RESET_SESSION_ON_START`.
  - `DRIVE_UPLOAD_TIMEOUT_MS`.
  - `DRIVE_UPLOAD_CONCURRENCY`.
- `npm run start:local` define `BACKEND_URL=http://localhost:3000` usando sintaxis de Windows.
- Para desarrollo integrado, arrancar previamente el backend local en el puerto 3000.

## Contrato con backend

- Si se modifican rutas, payloads o respuestas del backend, actualizar el frontend en la misma tarea.
- Mantener el flujo de jobs: el backend devuelve `job_id` y Electron hace polling hasta `done`, `error` o `cancelled`.
- Conservar la terminología de negocio y el flujo actual de Drive/TXT salvo petición expresa de refactorización.

## Build y recursos

`electron-builder` espera los siguientes recursos:

```text
assets/icon.ico
assets/icon.icns
assets/icon.png
assets/bin/win/
ocr/ocr.exe
```

- Comprobar su existencia antes de depurar un fallo de `npm run build:win`.
- No editar manualmente contenido de `dist/`.
- La publicación y actualización automática se configuran mediante `electron-builder` y GitHub releases; conservar la coherencia entre tag y `package.json.version`.

## Convenciones de código

- Usar JavaScript CommonJS (`require`, `module.exports`).
- No introducir React, Vue, Angular, Vite ni bundlers nuevos salvo petición explícita.
- Mantener la arquitectura Electron actual.
- Ser cuidadoso con `main.js`: concentra auth, Drive, uploads, IA, polling, email y auto-update.
- Preferir correcciones localizadas sobre rediseños globales de interfaz.
- No depender de dependencias transitivas: si el código requiere una librería directamente, declararla en `package.json` y actualizar el lockfile.

## Seguridad Electron

La configuración actual documentada usa `nodeIntegration: true` y `contextIsolation: false`. Al modificar UI o seguridad:

- No abrir URLs externas sin validación.
- No insertar HTML no confiable sin sanitizar.
- Validar IPC y entradas de usuario.
- Una migración a `preload.js` + `contextBridge` debe ser un cambio planificado y probado, no un refactor accidental.

## Flujos históricos o deshabilitados

No documentar ni tratar como activos sin revisarlos y probarlos:

- Monitor automático de Gmail para facturas.
- Escaneo automático de `No procesado` al iniciar.
- Comparación forzada manual desde UI.
- Secciones de UI comentadas o deshabilitadas.

## Validación y documentación

- Ejecutar `npm run test:albaran-numbers` al tocar esa lógica.
- Para cambios de comunicación con backend, validar con `npm run start:local` y backend local activo.
- Para cambios de empaquetado, validar `npm run build:win` cuando estén disponibles los recursos requeridos.
- Actualizar `Frontend/README.md` si cambian scripts, variables de entorno, contrato de backend, recursos de build, release/autoupdate o funcionalidades activas.