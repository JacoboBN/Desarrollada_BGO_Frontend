const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  cleanAlbaranDisplayId,
  normalizeAlbaranNumberForMatch: normalizeAlbaranId
} = require('./lib/albaranNumbers');
const {
  getMissingExpectedAlbaranes,
  areAllExpectedAlbaranesReady: areExpectedAlbaranesReady
} = require('./lib/documentOrder');
const {
  buildQualityPayload,
  evaluateDocumentExtractionQuality
} = require('./lib/documentQuality');

// Elementos del DOM
const loginSection = document.getElementById('login-section');
const uploadSection = document.getElementById('upload-section');
const loginBtn = document.getElementById('login-btn');
const fileUpload = document.getElementById('file-upload');
const logoutBtn = document.getElementById('logout-btn');
const menuButtons = document.querySelectorAll('.menu-item');
const tileButtons = document.querySelectorAll('.tile');

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const databaseView = document.getElementById('database-view');
const databaseTableList = document.getElementById('database-table-list');
const databaseTableContent = document.getElementById('database-table-content');
const databaseTableMeta = document.getElementById('database-table-meta');
const databaseSubtitle = document.getElementById('database-subtitle');
const databaseRefreshBtn = document.getElementById('database-refresh-btn');
const databaseClearTestBtn = document.getElementById('database-clear-test-btn');
const databaseRowDetail = document.getElementById('database-row-detail');
const foodOrderView = document.getElementById('food-order-view');
const foodProductSearch = document.getElementById('food-product-search');
const foodRefreshBtn = document.getElementById('food-refresh-btn');
const foodCategoryList = document.getElementById('food-category-list');
const foodProductsGrid = document.getElementById('food-products-grid');
const foodOrderAddBtn = document.getElementById('food-order-add-btn');
const foodAddProductBtn = document.getElementById('food-add-product-btn');
const foodAddSupplierBtn = document.getElementById('food-add-supplier-btn');
const foodSupplierModal = document.getElementById('food-supplier-modal');
const foodProductModal = document.getElementById('food-product-modal');
const foodSummaryModal = document.getElementById('food-summary-modal');
const foodEmailsModal = document.getElementById('food-emails-modal');
const foodSupplierForm = document.getElementById('food-supplier-form');
const foodProductForm = document.getElementById('food-product-form');
const foodProductSupplier = document.getElementById('food-product-supplier');
const foodProductCategoryChecks = document.getElementById('food-product-category-checks');
const foodSummaryContent = document.getElementById('food-summary-content');
const foodCreateOrderBtn = document.getElementById('food-create-order-btn');
const foodEmailsContent = document.getElementById('food-emails-content');
const foodEmailCounter = document.getElementById('food-email-counter');

const queueList = document.getElementById('upload-queue-list');
const queueTimeEstimateEl = document.getElementById('queue-time-estimate');
const queueBulkControls = document.getElementById('queue-bulk-controls');
const queueSelectAllBtn = document.getElementById('queue-select-all-btn');
const queueCancelSelectedBtn = document.getElementById('queue-cancel-selected-btn');
const uploadQueue = new Map();
const canceledQueueIds = new Set();
const queueFilePathMap = new Map(); // queueId → Drive file ID del archivo subido (para borrarlo de Drive si se cancela antes de finalizar el pipeline IA)
const selectedQueueIds = new Set();
const TERMINAL_QUEUE_STATUSES = new Set(['Error', 'Cancelado', 'Finalizado']);
const ESTIMATED_SECONDS_PER_DOC_MIN = 90;
const ESTIMATED_SECONDS_PER_DOC_MAX = 120;
let queueCompletionNotified = false;
const startupStatusEl = document.getElementById('startup-status');
const startupOverlay = document.getElementById('startup-overlay');
const startupOverlayMessage = document.getElementById('startup-overlay-message');
const billingSetupSection = document.getElementById('billing-setup-section');
const billingQuestionText = document.getElementById('billing-question-text');
const billingSameBtn = document.getElementById('billing-same-btn');
const billingDifferentBtn = document.getElementById('billing-different-btn');
const billingDifferentActions = document.getElementById('billing-different-actions');
const billingLoginBtn = document.getElementById('billing-login-btn');
const billingEmailLabel = document.getElementById('billing-email');
const uploadDropModal = document.getElementById('upload-drop-modal');
const uploadDropZone = document.getElementById('upload-drop-zone');
const uploadDropZoneFiles = document.getElementById('upload-drop-zone-files');
const uploadDropClose = document.getElementById('upload-drop-close');
const uploadDropTitle = document.getElementById('upload-drop-title');
const backendAlert = document.getElementById('backend-alert');
const backendAlertTitle = document.getElementById('backend-alert-title');
const backendAlertMessage = document.getElementById('backend-alert-message');
const backendAlertHelp = document.getElementById('backend-alert-help');
const backendAlertClose = document.getElementById('backend-alert-close');
const duplicateConfirmModal = document.getElementById('duplicate-confirm-modal');
const duplicateConfirmMessage = document.getElementById('duplicate-confirm-message');
const duplicateConfirmDetails = document.getElementById('duplicate-confirm-details');
const duplicateConfirmNo = document.getElementById('duplicate-confirm-no');
const duplicateConfirmYes = document.getElementById('duplicate-confirm-yes');
const appVersionEl = document.getElementById('app-version');
const updaterMessageEl = document.getElementById('updater-message');
const updaterProgressEl = document.getElementById('updater-progress');
const updaterCheckBtn = document.getElementById('updater-check-btn');
const updaterInstallBtn = document.getElementById('updater-install-btn');

let currentUpdaterStatus = {
  status: 'idle',
  message: 'Comprobación de actualizaciones pendiente.',
  progress: null
};

const DEFAULT_QUEUE_STEPS = ['En cola', 'Subiendo', 'Analizando', 'Comparando', 'Finalizado'];
let currentUploadTargetFolder = null;
let uploadFlowTail = Promise.resolve();

function formatDuplicateDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('es-ES');
}

function showDuplicateProcessedConfirm(fileName, duplicateInfo = {}) {
  return new Promise((resolve) => {
    if (!duplicateConfirmModal || !duplicateConfirmMessage || !duplicateConfirmNo || !duplicateConfirmYes) {
      resolve(false);
      return;
    }

    let settled = false;
    const documentInfo = duplicateInfo.document || duplicateInfo || {};
    const details = [];
    if (documentInfo.originalName && documentInfo.originalName !== fileName) {
      details.push(`Nombre anterior: ${documentInfo.originalName}`);
    }
    if (documentInfo.documentType) {
      details.push(`Tipo detectado: ${documentInfo.documentType}`);
    }
    const processedAt = formatDuplicateDate(documentInfo.createdAt || documentInfo.updatedAt);
    if (processedAt) details.push(`Procesado: ${processedAt}`);

    duplicateConfirmMessage.textContent = `El archivo ${fileName} ya se ha procesado, ¿desea procesarlo otra vez?`;
    if (duplicateConfirmDetails) {
      duplicateConfirmDetails.textContent = details.join('\n');
      duplicateConfirmDetails.classList.toggle('active', details.length > 0);
    }

    const onNo = () => finish(false);
    const onYes = () => finish(true);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    };
    const cleanup = () => {
      duplicateConfirmModal.classList.remove('active');
      duplicateConfirmModal.setAttribute('aria-hidden', 'true');
      duplicateConfirmNo.removeEventListener('click', onNo);
      duplicateConfirmYes.removeEventListener('click', onYes);
      document.removeEventListener('keydown', onKeyDown, true);
    };
    const finish = (shouldProcessAgain) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(shouldProcessAgain);
    };

    duplicateConfirmNo.addEventListener('click', onNo);
    duplicateConfirmYes.addEventListener('click', onYes);
    document.addEventListener('keydown', onKeyDown, true);
    duplicateConfirmModal.classList.add('active');
    duplicateConfirmModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => duplicateConfirmNo.focus(), 0);
  });
}

function renderUpdaterStatus(payload = {}) {
  currentUpdaterStatus = {
    ...currentUpdaterStatus,
    ...(payload || {})
  };

  if (updaterMessageEl) {
    updaterMessageEl.textContent = currentUpdaterStatus.message || 'Estado de actualización no disponible.';
  }

  const progressValue = Number(currentUpdaterStatus.progress);
  const shouldShowProgress = Number.isFinite(progressValue) && progressValue >= 0 && progressValue < 100;
  if (updaterProgressEl) {
    updaterProgressEl.classList.toggle('hidden', !shouldShowProgress);
    if (shouldShowProgress) {
      updaterProgressEl.value = Math.max(0, Math.min(100, progressValue));
    }
  }

  if (updaterInstallBtn) {
    updaterInstallBtn.disabled = currentUpdaterStatus.status !== 'downloaded';
  }
}

async function refreshUpdaterStatus() {
  try {
    const status = await ipcRenderer.invoke('updater-get-status');
    renderUpdaterStatus(status);
  } catch (error) {
    renderUpdaterStatus({
      status: 'error',
      message: `No se pudo obtener estado de actualización: ${error?.message || error}`,
      progress: null
    });
  }
}

if (updaterCheckBtn) {
  updaterCheckBtn.addEventListener('click', async () => {
    try {
      updaterCheckBtn.disabled = true;
      renderUpdaterStatus({ status: 'checking', message: 'Buscando actualizaciones...', progress: null });
      await ipcRenderer.invoke('updater-check-now');
    } catch (error) {
      showStatus(`Error al buscar actualizaciones: ${error?.message || error}`, 'error');
    } finally {
      updaterCheckBtn.disabled = false;
    }
  });
}

if (updaterInstallBtn) {
  updaterInstallBtn.addEventListener('click', async () => {
    try {
      updaterInstallBtn.disabled = true;
      showStatus('Reiniciando para instalar la actualización...', 'loading');
      await ipcRenderer.invoke('updater-install-now');
    } catch (error) {
      showStatus(`No se pudo iniciar la instalación: ${error?.message || error}`, 'error');
      updaterInstallBtn.disabled = false;
    }
  });
}

function normalizeQueueStep(step) {
  const rawStep = String(step || '').trim().toLowerCase();
  if (['pendiente', 'esperando', 'en cola', 'cola', 'queued', 'queue'].includes(rawStep)) {
    return 'En cola';
  }
  if (rawStep === 'subiendo') return 'Subiendo';
  if (rawStep === 'ocr' || rawStep === 'ia') return 'Analizando';
  if (rawStep === 'esperando albaranes') return 'Finalizado';
  if (rawStep === 'comparando') return 'Comparando';
  if (rawStep === 'comparado' || rawStep === 'email') return 'Finalizado';
  if (rawStep === 'enviando' || rawStep === 'moviendo' || rawStep === 'enviado' || rawStep === 'movido') return 'Finalizado';
  return step;
}

function canQueueItemBeSelectedForBulkCancel(item) {
  if (!item) return false;
  return ['En cola', 'Subiendo', 'Analizando'].includes(item.status);
}

function canQueueItemBeCancelled(item) {
  return canQueueItemBeSelectedForBulkCancel(item);
}

function isQueueTerminalSuccessStatus(status) {
  return status === 'Finalizado';
}

function formatDurationFromSeconds(totalSeconds = 0) {
  const secs = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  if (seconds === 0) {
    return `${minutes} min`;
  }

  return `${minutes} min ${seconds}s`;
}

function refreshQueueTimeEstimate() {
  if (!queueTimeEstimateEl) return;

  const pendingItemsCount = Array.from(uploadQueue.values())
    .filter((item) => item && !TERMINAL_QUEUE_STATUSES.has(item.status))
    .length;

  if (!pendingItemsCount) {
    queueTimeEstimateEl.classList.remove('active');
    queueTimeEstimateEl.textContent = '';
    return;
  }

  const minSeconds = pendingItemsCount * ESTIMATED_SECONDS_PER_DOC_MIN;
  const maxSeconds = pendingItemsCount * ESTIMATED_SECONDS_PER_DOC_MAX;
  const minLabel = formatDurationFromSeconds(minSeconds);
  const maxLabel = formatDurationFromSeconds(maxSeconds);

  queueTimeEstimateEl.textContent = `Tiempo estimado restante: ${minLabel} - ${maxLabel} (${pendingItemsCount} documento(s)).`;
  queueTimeEstimateEl.classList.add('active');
}

function areAllExpectedAlbaranesReady(compareResult = {}) {
  return areExpectedAlbaranesReady(compareResult);
}

function extractExpectedAlbaranesFromFactura(analysisText = '') {
  const sections = extractAnalysisSections(analysisText);
  if (!sections?.isFactura) return [];

  const expected = new Set();

  const resumenLine = (sections.resumenRaw || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);

  if (resumenLine) {
    try {
      const parsed = JSON.parse(resumenLine);
      const nums = Array.isArray(parsed?.num_albaran) ? parsed.num_albaran : [];
      nums.forEach((num) => {
        const clean = cleanAlbaranDisplayId(num);
        if (clean) expected.add(clean);
      });
    } catch (e) {
      // fallback abajo
    }
  }

  if (!expected.size) {
    (sections.articulosRaw || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        try {
          const parsed = JSON.parse(line);
          const clean = cleanAlbaranDisplayId(parsed?.num_albaran);
          if (clean) expected.add(clean);
        } catch (e) {
          // ignore
        }
      });
  }

  return Array.from(expected);
}

function hasTotalTxtForAlbaran(files = [], albaranNum = '') {
  const expected = normalizeAlbaranId(albaranNum);
  if (!expected) return false;

  return (Array.isArray(files) ? files : []).some((file) => {
    const name = String(file?.name || '').trim();
    if (!/^total/i.test(name) || !/alb\.txt$/i.test(name)) return false;
    const core = name.replace(/^total/i, '').replace(/alb\.txt$/i, '');
    return normalizeAlbaranId(core) === expected;
  });
}

function formatAlbaranesListLabel(items = []) {
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  if (!normalized.length) {
    return 'Ninguno';
  }

  return normalized.join(', ');
}

async function sendMissingAlbaranesAlertForPendingFactura({
  item = null,
  analysisText = '',
  expectedAlbaranes = [],
  missingAlbaranes = [],
  availableAlbaranes = []
} = {}) {
  const recipientEmail = await getCurrentSessionEmail();
  const facturaRef = getFacturaReferenceForEmail(analysisText, item?.fileName || 'XX');
  const expectedLabel = formatAlbaranesListLabel(expectedAlbaranes);
  const availableLabel = formatAlbaranesListLabel(availableAlbaranes);
  const missingLabel = formatAlbaranesListLabel(missingAlbaranes);

  const subject = `ℹ️ Factura procesada: faltan documentos relacionados (${facturaRef})`;
  const text = [
    'AVISO: FALTAN DOCUMENTOS RELACIONADOS PARA LA COMPARACIÓN',
    '',
    `Factura: ${facturaRef}`,
    `Nombre archivo factura: ${item?.fileName || 'N/A'}`,
    `Albaranes esperados: ${expectedLabel}`,
    `Albaranes disponibles: ${availableLabel}`,
    `Albaranes faltantes: ${missingLabel}`,
    '',
    'Estado actual: Documento procesado',
    'Acción: La comparación se realizará automáticamente cuando estén disponibles los documentos relacionados.'
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5; max-width: 760px;">
      <h2 style="margin: 0 0 12px; color: #8a1c1c;">ℹ️ <strong>Faltan documentos relacionados para comparar la factura</strong></h2>

      <div style="background:#f8f9fb; border:1px solid #e6e9ef; border-radius:8px; padding:12px; margin-bottom:12px;">
        <p style="margin:0 0 6px;"><strong>Factura:</strong> <strong>${escapeHtml(facturaRef)}</strong></p>
        <p style="margin:0 0 6px;"><strong>Nombre archivo factura:</strong> <strong>${escapeHtml(item?.fileName || 'N/A')}</strong></p>
        <p style="margin:0 0 6px;"><strong>Albaranes esperados:</strong> <strong>${escapeHtml(expectedLabel)}</strong></p>
        <p style="margin:0 0 6px;"><strong>Albaranes disponibles:</strong> <strong>${escapeHtml(availableLabel)}</strong></p>
        <p style="margin:0;"><strong>Albaranes faltantes:</strong> <strong>${escapeHtml(missingLabel)}</strong></p>
      </div>

      <p style="margin:0;"><strong>Estado actual:</strong> Documento procesado</p>
      <p style="margin:6px 0 0;"><strong>Acción:</strong> La comparación se realizará automáticamente cuando estén disponibles los documentos relacionados.</p>
    </div>
  `;

  await ipcRenderer.invoke('send-email', {
    to: recipientEmail,
    subject,
    text,
    html
  });
}

/*
 * Flujo histórico de comparación por Informes/TXT. La comparación vigente se
 * realiza en PostgreSQL mediante comparePendingInvoicesByDatabaseAndMove.
 * Se conserva como referencia temporal y no tiene llamadas activas.
async function comparePendingFacturasIfReady() {
  const pendingEntries = Array.from(pendingFacturaComparisons.entries());
  if (!pendingEntries.length) return;

  for (const [queueId, pending] of pendingEntries) {
    const item = pending?.item;
    const analysisText = pending?.analysisText || '';
    const parentFolderName = pending?.parentFolderName || 'Facturas';

    if (!item || !analysisText) {
      pendingFacturaComparisons.delete(queueId);
      continue;
    }

    try {
      const expectedAlbaranes = extractExpectedAlbaranesFromFactura(analysisText);
      if (expectedAlbaranes.length) {
        const informesNoComparado = await getOrCreateInformesNoComparadoFolder('Albaranes');
        const listed = await ipcRenderer.invoke('list-contents', informesNoComparado.id);
        const files = (listed?.files || []).filter(file => file.mimeType !== 'application/vnd.google-apps.folder');

        const missing = getMissingExpectedAlbaranes(expectedAlbaranes, files);
        if (missing.length) {
          await ipcRenderer.invoke('set-invoice-comparison-status', {
            driveFileId: item?.uploadedFileId || null,
            status: 'pending',
            result: { expectedAlbaranes, missingAlbaranes: missing, source: 'manual-upload' }
          });
          updateQueueStep(queueId, 'Finalizado');
          const missingSet = new Set(missing.map((num) => String(num || '').trim()).filter(Boolean));
          const available = expectedAlbaranes.filter((num) => {
            const clean = String(num || '').trim();
            return clean && !missingSet.has(clean);
          });
          try {
            await sendMissingAlbaranesAlertForPendingFactura({
              item,
              analysisText,
              expectedAlbaranes,
              missingAlbaranes: missing,
              availableAlbaranes: available
            });
            showStatus(`Aviso enviado: faltan albaranes para ${item?.fileName || 'factura'}.`, 'loading');
          } catch (emailError) {
            console.warn('No se pudo enviar aviso de albaranes faltantes:', emailError);
            showStatus(`No se pudo enviar aviso por albaranes faltantes: ${emailError?.message || emailError}`, 'error');
          }
          continue;
        }
      }

      updateQueueStep(queueId, 'Comparando');
      const compareResult = await ipcRenderer.invoke('compare-factura-albaranes', {
        facturaAnalysisText: analysisText,
        rootFolderName: parentFolderName,
        compareMode: 'totales'
      });

      if (!areAllExpectedAlbaranesReady(compareResult)) {
        await ipcRenderer.invoke('set-invoice-comparison-status', {
          driveFileId: item?.uploadedFileId || null,
          status: compareResult?.needsReview ? 'review' : 'pending',
          result: compareResult
        });
        updateQueueStep(queueId, 'Finalizado');
        if (compareResult?.needsReview) {
          showStatus(`Factura ${item?.fileName || ''} procesada; será necesaria una revisión si no se identifican documentos relacionados.`, 'loading');
          continue;
        }
        const expectedFromCompare = Array.isArray(compareResult?.expectedAlbaranes)
          ? compareResult.expectedAlbaranes
          : [];
        const matchedFromCompare = Array.isArray(compareResult?.matchedAlbaranes)
          ? compareResult.matchedAlbaranes
          : [];
        const matchedSet = new Set(matchedFromCompare.map((num) => String(num || '').trim()).filter(Boolean));
        const missingFromCompare = expectedFromCompare
          .map((num) => String(num || '').trim())
          .filter((num) => num && !matchedSet.has(num));
        try {
          await sendMissingAlbaranesAlertForPendingFactura({
            item,
            analysisText,
            expectedAlbaranes: expectedFromCompare,
            missingAlbaranes: missingFromCompare,
            availableAlbaranes: matchedFromCompare
          });
          showStatus(`Aviso enviado: faltan albaranes para ${item?.fileName || 'factura'}.`, 'loading');
        } catch (emailError) {
          console.warn('No se pudo enviar aviso de albaranes faltantes (compare):', emailError);
          showStatus(`No se pudo enviar aviso por albaranes faltantes: ${emailError?.message || emailError}`, 'error');
        }
        continue;
      }

      await ipcRenderer.invoke('set-invoice-comparison-status', {
        driveFileId: item?.uploadedFileId || null,
        status: compareResult?.ok ? 'matched' : 'mismatch',
        result: compareResult
      });

      updateQueueStep(queueId, 'Comparado');
      updateQueueStep(queueId, 'Email');

      const recipientEmail = await getCurrentSessionEmail();
      const facturaRef = getFacturaReferenceForEmail(analysisText, item?.fileName || 'XX');
      const albaranesLabel = getComparedAlbaranesLabel(compareResult);
      const facturaTotalLabel = formatAmountEuro(parseComparableNumber(compareResult?.facturaTotal));
      const albaranesTotalLabel = formatAmountEuro(parseComparableNumber(compareResult?.sumatoriaTotalesAlbaranes));
      const totalsByAlbaranLines = buildAlbaranTotalsComparisonLines(compareResult, item?.fileName || '');
      const htmlTotalsByAlbaran = toHtmlList(
        totalsByAlbaranLines,
        formatAlbaranTotalComparisonLineHtml,
        'No disponible'
      );

      await ipcRenderer.invoke('send-email', {
        to: recipientEmail,
        subject: compareResult?.ok
          ? `✅ ${item?.fileName || 'Factura'} validada (${facturaRef})`
          : `⚠️ ${item?.fileName || 'Factura'} con incongruencias (${facturaRef})`,
        text: [
          `Factura: ${facturaRef}`,
          `Nombre archivo factura: ${item?.fileName || 'N/A'}`,
          `Albaranes comparados: ${albaranesLabel}`,
          `Total factura: ${facturaTotalLabel}`,
          `Total albaranes: ${albaranesTotalLabel}`,
          '',
          '=== TOTALES POR ALBARÁN (CON ARCHIVOS ORIGEN) ===',
          ...totalsByAlbaranLines,
          compareResult?.message || 'Comparación completada.'
        ].join('\n'),
        html: `
          <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5; max-width: 760px;">
            <h2 style="margin: 0 0 12px; color: ${compareResult?.ok ? '#17693a' : '#8a1c1c'};">
              ${compareResult?.ok ? '✅ <strong>Factura validada correctamente</strong>' : '⚠️ <strong>Incongruencias encontradas</strong>'}
            </h2>

            <div style="background:${compareResult?.ok ? '#f6fbf8' : '#f8f9fb'}; border:1px solid ${compareResult?.ok ? '#dcefe3' : '#e6e9ef'}; border-radius:8px; padding:12px; margin-bottom:12px;">
              <p style="margin:0 0 6px;"><strong>Factura:</strong> <strong>${escapeHtml(facturaRef)}</strong></p>
              <p style="margin:0 0 6px;"><strong>Nombre archivo factura:</strong> <strong>${escapeHtml(item?.fileName || 'N/A')}</strong></p>
              <p style="margin:0 0 6px;"><strong>Albaranes comparados:</strong> <strong>${escapeHtml(albaranesLabel)}</strong></p>
              <p style="margin:0 0 6px;"><strong>Total factura:</strong> <strong>${escapeHtml(facturaTotalLabel)}</strong></p>
              <p style="margin:0;"><strong>Total albaranes:</strong> <strong>${escapeHtml(albaranesTotalLabel)}</strong></p>
            </div>

            <h3 style="margin:14px 0 8px; font-size:15px;">📊 Totales por albarán (con archivos origen)</h3>
            <ul style="margin-top:0;">${htmlTotalsByAlbaran}</ul>

            <div style="margin: 14px 0;">
              <h3 style="margin:0 0 8px; font-size:15px;">📌 Resumen</h3>
              <p style="margin:0;">${escapeHtml(compareResult?.message || 'Comparación completada.')}</p>
            </div>
          </div>
        `
      });

      const shouldMoveFactura = compareResult?.ok
        || (Array.isArray(compareResult?.matchedAlbaranes) && compareResult.matchedAlbaranes.length > 0);
      if (shouldMoveFactura && item?.uploadedFileId && pending?.documentosFolderId) {
        await ipcRenderer.invoke(
          'move-file',
          item.uploadedFileId,
          [pending.documentosFolderId],
          pending?.noComparadoFolderId ? [pending.noComparadoFolderId] : []
        );
      }

      pendingFacturaComparisons.delete(queueId);
      showStatus(`Factura ${item?.fileName || ''} comparada correctamente.`, 'success');
    } catch (error) {
      markQueueError(queueId, error?.message || 'Error al comparar factura pendiente');
      showStatus(`Error al comparar factura pendiente: ${error?.message || error}`, 'error');
    }
  }
}
*/

function enqueueUploadFlow(task, meta = {}) {
  const runTask = async () => {
    const label = meta?.label || 'documentos';
    try {
      return await task();
    } catch (error) {
      throw error;
    }
  };

  const next = uploadFlowTail.then(runTask, runTask);
  uploadFlowTail = next.catch(() => {});
  return next;
}

function normalizeQueueStepsList(steps = []) {
  const normalized = [];

  (Array.isArray(steps) ? steps : []).forEach((step) => {
    const normalizedStep = normalizeQueueStep(step);
    if (!normalizedStep) return;

    if (!normalized.length || normalized[normalized.length - 1] !== normalizedStep) {
      normalized.push(normalizedStep);
    }
  });

  return normalized;
}

function resolveQueueSteps({ source = '', docType = '', steps = null } = {}) {
  return [...DEFAULT_QUEUE_STEPS];
}

const RENDERER_LOG_PREFIX = '[Frontend-User]';

function serializeUiError(error) {
  if (!error) return null;
  return {
    message: error.message,
    name: error.name,
    stack: error.stack
  };
}

function uiLog(level = 'log', message = '', data = undefined) {
  const normalizedLevel = String(level || '').toLowerCase();
  if (normalizedLevel !== 'error') {
    return;
  }

  const method = 'error';
  const timestamp = new Date().toISOString();
  if (data === undefined) {
    console[method](`${RENDERER_LOG_PREFIX} ${timestamp} ${message}`);
    return;
  }
  console[method](`${RENDERER_LOG_PREFIX} ${timestamp} ${message}`, data);
}

function classifyBackendError(input = '') {
  const text = String(input || '').toLowerCase();
  const hasBackendConnectivityIssue = (
    text.includes('network error')
    || text.includes('econnrefused')
    || text.includes('econnreset')
    || text.includes('etimedout')
    || text.includes('timeout')
    || text.includes('failed to fetch')
    || text.includes('502')
    || text.includes('503')
    || text.includes('504')
    || text.includes('backend')
    || text.includes('error interno del servidor')
  );

  if (hasBackendConnectivityIssue) {
    return {
      title: 'No se pudo contactar con el backend',
      help: 'Parece una caída o problema temporal del backend.\n\nQué hacer:\n1) Espera 1-2 minutos y vuelve a intentar.\n2) Si persiste, avisa a bgoptimizing@gmail.com con una captura del error.'
    };
  }

  const hasPermissionIssue = (
    text.includes('403')
    || text.includes('forbidden')
    || text.includes('permiso')
    || text.includes('permisos')
    || text.includes('solo administradores')
    || text.includes('acceso denegado')
  );

  if (hasPermissionIssue) {
    return {
      title: 'No tienes permisos suficientes',
      help: 'Tu usuario no tiene permisos para esta acción.\n\nQué hacer:\n1) Verifica que hayas iniciado sesión con la cuenta correcta.\n2) Pide al administrador que comparta la carpeta/función necesaria en Google Drive.\n3) Si debe funcionar y no funciona, escribe a bgoptimizing@gmail.com.'
    };
  }

  const hasSessionIssue = (
    text.includes('401')
    || text.includes('sesión inválida')
    || text.includes('sesion invalida')
    || text.includes('sesión expirada')
    || text.includes('session expired')
    || text.includes('reauth')
  );

  if (hasSessionIssue) {
    return {
      title: 'Tu sesión ha caducado',
      help: 'Parece un problema de autenticación.\n\nQué hacer:\n1) Cierra sesión y vuelve a iniciar sesión con Google.\n2) Repite la acción.\n3) Si sigue pasando, avisa a bgoptimizing@gmail.com.'
    };
  }

  return null;
}

function showBackendAlert(message = '', details = '') {
  if (!backendAlert || !backendAlertTitle || !backendAlertMessage || !backendAlertHelp) return;

  const classified = classifyBackendError(`${message} ${details}`);
  if (!classified) return;

  backendAlertTitle.textContent = classified.title;
  backendAlertMessage.textContent = String(message || 'Se ha producido un error en el backend.');
  backendAlertHelp.textContent = classified.help;
  backendAlert.classList.add('active');
}

function hideBackendAlert() {
  if (!backendAlert) return;
  backendAlert.classList.remove('active');
}

if (backendAlertClose) {
  backendAlertClose.addEventListener('click', hideBackendAlert);
}

window.addEventListener('error', (event) => {
  uiLog('error', 'window.error', {
    message: event?.message,
    filename: event?.filename,
    lineno: event?.lineno,
    colno: event?.colno,
    error: serializeUiError(event?.error)
  });
});

window.addEventListener('unhandledrejection', (event) => {
  uiLog('error', 'window.unhandledrejection', {
    reason: serializeUiError(event?.reason) || event?.reason
  });

  const reason = event?.reason;
  const message = reason?.message || String(reason || 'Error desconocido');
  showBackendAlert(message, 'unhandledrejection');
});

function guessMimeTypeFromPath(filePath = '') {
  const ext = (path.extname(filePath || '') || '').toLowerCase();
  const mimeByExt = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.txt': 'text/plain'
  };
  return mimeByExt[ext] || '';
}

function isAllowedUploadExtension(filePath = '') {
  const ext = (path.extname(filePath || '') || '').toLowerCase();
  return ['.pdf', '.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff', '.txt'].includes(ext);
}

function expandPathsRecursively(inputPaths = []) {
  const resolvedFiles = [];
  const pending = Array.isArray(inputPaths) ? [...inputPaths] : [];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) continue;

    let stat;
    try {
      stat = fs.statSync(current);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      let entries = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        entries = [];
      }

      entries.forEach((entry) => {
        const childPath = path.join(current, entry.name);
        pending.push(childPath);
      });
      continue;
    }

    if (stat.isFile() && isAllowedUploadExtension(current)) {
      resolvedFiles.push(current);
    }
  }

  return [...new Set(resolvedFiles)];
}

async function invokeAnalyzeFileWithFallback(filePath, mimeType, originalName, docType, postProcess = null) {
  uiLog('log', 'invokeAnalyzeFileWithFallback:start', {
    filePath,
    mimeType,
    originalName,
    docType
  });
  try {
    const result = await ipcRenderer.invoke('analyze-file', filePath, mimeType, originalName, docType, postProcess);
    uiLog('log', 'invokeAnalyzeFileWithFallback:ok', { docType, hasAnalysis: Boolean(result?.analysis) });
    return result;
  } catch (error) {
    uiLog('warn', 'invokeAnalyzeFileWithFallback:error', { error: serializeUiError(error) });
    // SOLICITUD CLIENTE: prohibido fallback OCR. Solo IA.
    throw error;
  }
}

async function invokeAnalyzeFilesBatchWithFallback(items = [], docType = 'albaran') {
  const validItems = (Array.isArray(items) ? items : []).filter(item => item?.filePath);
  if (!validItems.length) return [];

  uiLog('log', 'invokeAnalyzeFilesBatchWithFallback:start', {
    docType,
    items: validItems.length
  });

  try {
    const results = await ipcRenderer.invoke('analyze-files-batch', validItems, docType);
    if (Array.isArray(results) && results.length) {
      uiLog('log', 'invokeAnalyzeFilesBatchWithFallback:ok', {
        docType,
        results: results.length
      });
      return results;
    }
    throw new Error('Batch IA sin resultados');
  } catch (error) {
    const message = String(error?.message || '');
    if (!message.includes("No handler registered for 'analyze-files-batch'")) {
      console.warn('Batch IA falló en renderer; fallback individual:', error);
    }
    uiLog('warn', 'invokeAnalyzeFilesBatchWithFallback:fallback-individual', {
      docType,
      error: serializeUiError(error)
    });

    const fallback = [];
    for (const item of validItems) {
      try {
        const single = await invokeAnalyzeFileWithFallback(
          item.filePath,
          item.mimeType || '',
          item.originalName || '',
          docType,
          item.postProcess || null
        );
        fallback.push({ success: true, analysis: single?.analysis || '', raw: single });
      } catch (singleError) {
        fallback.push({ success: false, analysis: '', error: singleError?.message || String(singleError) });
      }
    }
    return fallback;
  }
}

function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
}

function extractAnalysisSections(analysisText) {
  if (!analysisText) return null;
  const text = analysisText.toString();
  const markerArticulosFactura = '=== ARTÍCULOS POR ALBARÁN (JSON Lines) ===';
  const markerArticulosAlbaran = '=== ARTÍCULOS (JSON Lines) ===';
  const markerResumenFactura = '=== RESUMEN FACTURA (JSON) ===';
  const markerResumenAlbaran = '=== RESUMEN ALBARÁN (JSON) ===';

  const isFactura = text.includes(markerResumenFactura) || text.includes(markerArticulosFactura);
  const articulosMarker = isFactura ? markerArticulosFactura : markerArticulosAlbaran;
  const resumenMarker = isFactura ? markerResumenFactura : markerResumenAlbaran;

  if (!text.includes(articulosMarker) || !text.includes(resumenMarker)) {
    return null;
  }

  const articulosSplit = text.split(articulosMarker);
  if (articulosSplit.length < 2) return null;
  const afterArticulos = articulosSplit[1];
  const resumenSplit = afterArticulos.split(resumenMarker);
  if (resumenSplit.length < 2) return null;

  return {
    articulosRaw: resumenSplit[0].trim(),
    resumenRaw: resumenSplit[1].trim(),
    isFactura
  };
}

function appendSourceToJsonLines(text, sourceFileName) {
  if (!text) return text;
  const lines = text.split(/\r?\n/);
  const updated = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    try {
      const obj = JSON.parse(trimmed);
      obj.source_file = sourceFileName || null;
      return JSON.stringify(obj);
    } catch (e) {
      return line;
    }
  });
  return updated.join('\n');
}

function appendSourceToJsonObject(text, sourceFileName) {
  if (!text) return text;
  try {
    const obj = JSON.parse(text.trim());
    obj.source_file = sourceFileName || null;
    return JSON.stringify(obj);
  } catch (e) {
    return text;
  }
}

function buildTxtFilesFromAnalysis(analysisText, sourceFileName = null) {
  const sections = extractAnalysisSections(analysisText);
  if (!sections) return null;

  const { articulosRaw, resumenRaw, isFactura } = sections;
  const resumenLine = resumenRaw.split(/\r?\n/).find(line => line.trim());
  let resumenObj = null;
  let firstArticuloObj = null;

  if (resumenLine) {
    try {
      resumenObj = JSON.parse(resumenLine);
    } catch (e) {
      resumenObj = null;
    }
  }

  const firstArticuloLine = articulosRaw.split(/\r?\n/).find(line => line.trim());
  if (firstArticuloLine) {
    try {
      firstArticuloObj = JSON.parse(firstArticuloLine);
    } catch (e) {
      firstArticuloObj = null;
    }
  }

  const docNum = isFactura
    ? (resumenObj?.num_factura || firstArticuloObj?.num_factura)
    : (resumenObj?.num_albaran || firstArticuloObj?.num_albaran);

  const safeNum = sanitizeFileName(docNum || 'SinNumero');
  const suffix = isFactura ? 'Fact' : 'Alb';
  const files = [];

  const enrichedArticulos = appendSourceToJsonLines(articulosRaw, sourceFileName);
  const enrichedResumen = resumenLine ? appendSourceToJsonObject(resumenLine, sourceFileName) : resumenLine;

  // SOLICITUD CLIENTE: NO crear TXT no-total (artículos por línea).
  // Se mantiene el bloque antiguo comentado para histórico.
  // if (enrichedArticulos) {
  //   files.push({
  //     name: `${safeNum}${suffix}.txt`,
  //     content: enrichedArticulos
  //   });
  // }

  if (enrichedResumen) {
    if (isFactura) {
      files.push({
        name: `Total${safeNum}${suffix}.txt`,
        content: enrichedResumen
      });
    } else {
      let resumenForTotals = null;
      try {
        resumenForTotals = JSON.parse(enrichedResumen);
      } catch (e) {
        resumenForTotals = null;
      }

      const resumenAlbaranes = Array.isArray(resumenForTotals?.albaranes)
        ? resumenForTotals.albaranes
        : [];

      if (resumenAlbaranes.length) {
        const createdNames = new Set();
        for (const albaran of resumenAlbaranes) {
          const rawNum = albaran?.num_albaran;
          const safeAlbNum = sanitizeFileName(rawNum || 'SinNumero');
          const fileName = `Total${safeAlbNum}Alb.txt`;
          if (createdNames.has(fileName.toLowerCase())) continue;
          createdNames.add(fileName.toLowerCase());

          const resumenPorAlbaran = {
            num_albaran: rawNum ?? null,
            fecha: albaran?.fecha ?? null,
            total_sin_iva: albaran?.total_sin_iva ?? null,
            porcentaje_iva: albaran?.porcentaje_iva ?? null,
            iva: albaran?.iva ?? null,
            total: albaran?.total ?? null,
            total_sumado: albaran?.total_sumado ?? null,
            total_calculado_por_suma: albaran?.total_calculado_por_suma === 'Sí' ? 'Sí' : 'No',
            total_fallback_warning: albaran?.total_fallback_warning ?? null,
            error: 'No',
            source_file: sourceFileName || null
          };

          files.push({
            name: fileName,
            content: JSON.stringify(resumenPorAlbaran)
          });
        }
      }

      if (!files.length) {
        files.push({
          name: `Total${safeNum}${suffix}.txt`,
          content: enrichedResumen
        });
      }
    }
  }

  return { files, isFactura };
}

function getFacturaReferenceForEmail(analysisText, fallback = 'XX') {
  try {
    const sections = extractAnalysisSections(analysisText);
    if (sections?.isFactura && sections?.resumenRaw) {
      const resumenLine = sections.resumenRaw.split(/\r?\n/).find(line => line.trim());
      if (resumenLine) {
        const resumenObj = JSON.parse(resumenLine);
        const facturaNum = resumenObj?.num_factura;
        if (facturaNum && facturaNum !== 'NaN') {
          return sanitizeFileName(facturaNum);
        }
      }
    }
  } catch (e) {
    // fallback
  }

  const fallbackBase = path.basename(String(fallback || 'XX'), path.extname(String(fallback || '')));
  return sanitizeFileName(fallbackBase || 'XX');
}

function normalizeConfidenceToPercent(rawConfidence) {
  const value = Number(rawConfidence);
  if (!Number.isFinite(value)) return null;

  if (value >= 0 && value <= 1) {
    return value * 100;
  }

  if (value >= 0 && value <= 100) {
    return value;
  }

  return null;
}

function buildModelConfidenceEmailLines(analysisText) {
  let confidenceRaw = null;

  try {
    const sections = extractAnalysisSections(analysisText);
    if (sections?.isFactura && sections?.resumenRaw) {
      const resumenLine = sections.resumenRaw.split(/\r?\n/).find(line => line.trim());
      if (resumenLine) {
        const resumenObj = JSON.parse(resumenLine);
        confidenceRaw = resumenObj?.confidence;
      }
    }
  } catch (e) {
    confidenceRaw = null;
  }

  const confidencePercent = normalizeConfidenceToPercent(confidenceRaw);

  if (confidencePercent === null) {
    return ['Seguridad del modelo: No disponible'];
  }

  const roundedPercent = Math.round(confidencePercent * 10) / 10;
  const lines = [`Seguridad del modelo: ${roundedPercent}%`];

  if (confidencePercent < 70) {
    lines.push('⚠️ CUIDADO: baja seguridad del modelo (< 70%).');
  }

  return lines;
}

function extractModelConfidenceValue(analysisText) {
  let confidenceRaw = null;

  try {
    const sections = extractAnalysisSections(analysisText);
    if (sections?.isFactura && sections?.resumenRaw) {
      const resumenLine = sections.resumenRaw.split(/\r?\n/).find(line => line.trim());
      if (resumenLine) {
        const resumenObj = JSON.parse(resumenLine);
        confidenceRaw = resumenObj?.confidence;
      }
    }
  } catch (e) {
    confidenceRaw = null;
  }

  const value = Number(confidenceRaw);
  if (!Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return value;
  if (value >= 0 && value <= 100) return value / 100;
  return null;
}

function getIssueCountByAlbaran(compareResult = {}) {
  const counts = new Map();
  const issues = Array.isArray(compareResult?.issues) ? compareResult.issues : [];
  let currentAlbaran = null;

  for (const raw of issues) {
    const line = String(raw || '').trim();
    const matchHeader = line.match(/^Albar[aá]n\s+(.+?):$/i);
    if (matchHeader) {
      currentAlbaran = String(matchHeader[1] || '').trim() || null;
      if (currentAlbaran && !counts.has(currentAlbaran)) {
        counts.set(currentAlbaran, 0);
      }
      continue;
    }

    if (currentAlbaran && line.startsWith('-')) {
      counts.set(currentAlbaran, (counts.get(currentAlbaran) || 0) + 1);
    }
  }

  if (!counts.size) {
    const fallback = Array.isArray(compareResult?.incongruentAlbaranes)
      ? compareResult.incongruentAlbaranes
      : [];
    fallback.forEach((num) => counts.set(String(num || '').trim(), 1));
  }

  return counts;
}

function normalizeIssueDetail(rawLine = '') {
  return String(rawLine || '').replace(/^\-\s*/, '').trim();
}

function isArticleNotFoundIssue(issueDetail = '') {
  const detail = String(issueDetail || '');
  return /art[ií]culo/i.test(detail) && /no encontrado/i.test(detail);
}

function isZeroComparisonIssue(issueDetail = '') {
  const detail = String(issueDetail || '');
  if (!/^Cantidad distinta para|^Importe distinto para/i.test(detail)) {
    return false;
  }

  const match = detail.match(/factura=([-+]?\d*\.?\d+),\s*albar[aá]n=([-+]?\d*\.?\d+)/i);
  if (!match) return false;

  const facturaValue = Number(match[1]);
  const albaranValue = Number(match[2]);
  if (!Number.isFinite(facturaValue) || !Number.isFinite(albaranValue)) {
    return false;
  }

  return Math.abs(facturaValue) < 1e-9 || Math.abs(albaranValue) < 1e-9;
}

function evaluateEmptyUploadPattern(compareResult = {}) {
  const issues = Array.isArray(compareResult?.issues) ? compareResult.issues : [];
  const detailedIssues = issues
    .map(line => String(line || '').trim())
    .filter(line => line.startsWith('-'))
    .map(normalizeIssueDetail)
    .filter(Boolean);

  if (!detailedIssues.length) {
    return {
      shouldWarnEmptyUpload: false,
      detailedIssueCount: 0,
      suspiciousIssueCount: 0
    };
  }

  const suspiciousIssueCount = detailedIssues.filter((issue) => (
    isArticleNotFoundIssue(issue) || isZeroComparisonIssue(issue)
  )).length;

  return {
    shouldWarnEmptyUpload: detailedIssues.length > 8 && suspiciousIssueCount === detailedIssues.length,
    detailedIssueCount: detailedIssues.length,
    suspiciousIssueCount
  };
}

function buildPrimaryEmailIssueLines(compareResult = {}, severeAlbaranes = []) {
  const severeSet = new Set((Array.isArray(severeAlbaranes) ? severeAlbaranes : []).map(num => String(num || '').trim()));
  const sourceIssues = Array.isArray(compareResult?.issues) ? compareResult.issues : [];
  const normalizedIssues = [];
  let currentAlbaran = null;
  let currentIsSevere = false;

  for (const rawLine of sourceIssues) {
    const line = String(rawLine || '').trim();
    const headerMatch = line.match(/^Albar[aá]n\s+(.+?):$/i);

    if (headerMatch) {
      currentAlbaran = String(headerMatch[1] || '').trim();
      currentIsSevere = severeSet.has(currentAlbaran);
      normalizedIssues.push(line);
      if (currentIsSevere) {
        normalizedIssues.push('- REVISAR EL EMAIL IMPORTANTE');
      }
      continue;
    }

    if (currentIsSevere && line.startsWith('-')) {
      continue;
    }

    normalizedIssues.push(line);
  }

  return normalizedIssues;
}

function buildCriticalAlertContext(compareResult = {}, analysisText = '') {
  const confidence = extractModelConfidenceValue(analysisText);
  const lowConfidence = confidence !== null && confidence < 0.75;
  const issuesByAlbaran = getIssueCountByAlbaran(compareResult);
  const severeAlbaranes = Array.from(issuesByAlbaran.entries())
    .filter(([, issueCount]) => issueCount > 6)
    .map(([albaranNum]) => albaranNum);
  const emptyUploadPattern = evaluateEmptyUploadPattern(compareResult);

  return {
    shouldSend: lowConfidence || severeAlbaranes.length > 0,
    confidence,
    lowConfidence,
    severeAlbaranes,
    issuesByAlbaran,
    emptyUploadPattern
  };
}

function extractExtractionWarningsFromAnalysis(analysisText) {
  if (!analysisText) return [];
  const marker = '=== EXTRACTION WARNINGS (JSON) ===';
  const text = analysisText.toString();
  if (!text.includes(marker)) return [];

  const afterMarker = text.split(marker)[1] || '';
  const firstLine = afterMarker
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);

  if (!firstLine) return [];

  try {
    const parsed = JSON.parse(firstLine);
    return Array.isArray(parsed)
      ? parsed.map(item => String(item || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function buildExtractionWarningsEmailLines(analysisText) {
  const warnings = extractExtractionWarningsFromAnalysis(analysisText);
  if (!warnings.length) {
    return ['Warnings de extracción: ninguno'];
  }

  return [
    `Warnings de extracción (${warnings.length}):`,
    ...warnings.map(w => `- ${w}`)
  ];
}

function buildAlbaranTotalsComparisonLines(compareResult = {}, facturaFileName = '') {
  const rows = Array.isArray(compareResult?.albaranTotalsComparison)
    ? compareResult.albaranTotalsComparison
    : [];

  if (!rows.length) {
    return ['- No disponible'];
  }

  return rows.map((row) => {
    const num = row?.albaranNum || 'N/A';
    const totalFacturaSinIva = formatAmountEuro(row?.totalFacturaSinIva);
    const totalFacturaConIva = formatAmountEuro(row?.totalFacturaConIva);
    const totalDetectadoSinIva = formatAmountEuro(row?.totalAlbaranDetectadoSinIva);
    const totalDetectadoConIva = formatAmountEuro(row?.totalAlbaranDetectadoConIva);
    const albaranSource = row?.albaranSourceFileName || 'No disponible';
    const facturaSource = facturaFileName || 'No disponible';
    return `- Albarán ${num}: albarán_sin_iva=${totalDetectadoSinIva} | albarán_con_iva=${totalDetectadoConIva} (archivo_albarán=${albaranSource}) | factura_sin_iva=${totalFacturaSinIva} | factura_con_iva=${totalFacturaConIva} (archivo_factura=${facturaSource})`;
  });
}

function formatAlbaranTotalComparisonLineHtml(line = '') {
  const cleaned = String(line || '').replace(/^\-\s*/, '').trim();
  const match = cleaned.match(/^Albar[aá]n\s+(.+?):\s*albar[aá]n_sin_iva=(.+?)\s*\|\s*albar[aá]n_con_iva=(.+?)\s*\(archivo_albar[aá]n=(.+?)\)\s*\|\s*factura_sin_iva=(.+?)\s*\|\s*factura_con_iva=(.+?)\s*\(archivo_factura=(.+?)\)$/i);
  if (!match) return escapeHtml(cleaned);

  const [, num, albSinIva, albConIva, albaranSource, facSinIva, facConIva, facturaSource] = match;
  return `Albarán <strong>${escapeHtml(num)}</strong>: albarán sin IVA=<strong>${escapeHtml(albSinIva)}</strong> | albarán con IVA=<strong>${escapeHtml(albConIva)}</strong> (<strong>${escapeHtml(albaranSource)}</strong>) | factura sin IVA=<strong>${escapeHtml(facSinIva)}</strong> | factura con IVA=<strong>${escapeHtml(facConIva)}</strong> (<strong>${escapeHtml(facturaSource)}</strong>)`;
}

function getComparedAlbaranesLabel(compareResult = {}) {
  const fromExpected = Array.isArray(compareResult?.expectedAlbaranes)
    ? compareResult.expectedAlbaranes
    : [];
  const fromMatched = Array.isArray(compareResult?.matchedAlbaranes)
    ? compareResult.matchedAlbaranes
    : [];

  const source = fromExpected.length ? fromExpected : fromMatched;
  const normalized = source
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return normalized.length ? normalized.join(', ') : 'N/A';
}

function buildDriveFileLink(fileId) {
  if (!fileId) return null;
  return `https://drive.google.com/file/d/${fileId}/view`;
}

function buildIncongruentAlbaranesLinks(compareResult = {}) {
  const docs = Array.isArray(compareResult?.incongruentAlbaranDocs)
    ? compareResult.incongruentAlbaranDocs
    : [];
  if (docs.length) {
    return docs.map((doc) => {
      const num = doc?.albaranNum || 'N/A';
      const fileName = doc?.fileName || 'Nombre no disponible';
      const totalDetectedLabel = formatAmountEuro(doc?.totalDetected);
      const url = doc?.url || buildDriveFileLink(doc?.fileId) || 'No disponible';
      return `- Albarán ${num} (${fileName}, total detectado: ${totalDetectedLabel}): ${url}`;
    });
  }

  const nums = Array.isArray(compareResult?.incongruentAlbaranes)
    ? compareResult.incongruentAlbaranes
    : [];
  if (!nums.length) {
    return ['- No disponible'];
  }

  return nums.map((num) => `- Albarán ${num} (nombre no disponible, total detectado: No disponible): link no disponible`);
}

function buildNotificationCongruentAlbaranesSummary(compareResult = {}) {
  const docs = Array.isArray(compareResult?.congruentAlbaranDocs)
    ? compareResult.congruentAlbaranDocs
    : [];
  if (!docs.length) return ['- No disponible'];
  return docs.map((doc) => {
    const num = doc?.albaranNum || 'N/A';
    const fileName = doc?.fileName || 'Nombre no disponible';
    const total = formatAmountEuro(doc?.totalDetected);
    const url = doc?.url || buildDriveFileLink(doc?.fileId) || 'No disponible';
    return `- Albarán ${num} (${fileName}, total detectado: ${total}): ${url}`;
  });
}

function toNotificationHtmlList(lines = [], formatter = escapeHtml, fallback = 'No disponible') {
  const normalized = (Array.isArray(lines) ? lines : []).filter(Boolean);
  const items = normalized.length ? normalized : [fallback];
  return items.map((line) => `<li>${formatter(String(line))}</li>`).join('');
}

function formatComparisonLineHtml(line = '') {
  const urlPattern = /(https:\/\/drive\.google\.com\/[^\s<]+)/g;
  return escapeHtml(String(line || '').replace(/^\-\s*/, ''))
    .replace(urlPattern, '<a href="$1">Abrir en Drive</a>');
}

function getAnalysisSummary(analysisText = '') {
  try {
    const sections = extractAnalysisSections(analysisText);
    const resumenLine = sections?.resumenRaw?.split(/\r?\n/).find((line) => line.trim());
    return resumenLine ? JSON.parse(resumenLine) : {};
  } catch {
    return {};
  }
}

function getExtractionPayload(analysisResult = {}, analysisText = '', docType = null) {
  const persistence = analysisResult?.raw?.persistence || analysisResult?.persistence || {};
  return buildQualityPayload({
    documentType: docType,
    persistence,
    fallback: getAnalysisSummary(analysisText)
  });
}

function evaluateCurrentDocumentExtractionQuality({ docType, analysisResult, analysisText } = {}) {
  return evaluateDocumentExtractionQuality({
    docType,
    extracted: getExtractionPayload(analysisResult, analysisText, docType)
  });
}

async function sendDedupedEmail(payload = {}) {
  const recipientEmail = await getCurrentSessionEmail();
  return ipcRenderer.invoke('send-deduped-email', { ...payload, to: recipientEmail });
}

async function sendExtractionQualityEmailIfNeeded({ item, detectedDocType, analysisResult, analysisText }) {
  const quality = evaluateCurrentDocumentExtractionQuality({
    docType: detectedDocType,
    analysisResult,
    analysisText
  });
  if (!quality.shouldSendEmail) return { skipped: true, reason: 'quality_no_mortal_error', quality };

  const fileName = item?.fileName || 'Documento';
  const driveFileId = item?.uploadedFileId || null;
  const driveLink = buildDriveFileLink(driveFileId);
  const warningLines = quality.warnings.length ? quality.warnings.map((warning) => `- ${warning}`) : ['- Ninguno'];
  const missingLines = quality.mortalFields.length ? quality.mortalFields.map((field) => `- ${field}`) : ['- Ninguno'];
  const reasonLines = quality.reasons.length ? quality.reasons.map((reason) => `- ${reason}`) : ['- Revisar la extracción.'];
  const subject = `🚨 ${fileName} Con ERRORES, Revisar`;
  const text = [
    'DOCUMENTO CON ERRORES DE EXTRACCIÓN',
    '',
    `Archivo: ${fileName}`,
    `Tipo detectado: ${detectedDocType}`,
    `Confidence: ${quality.confidence === null ? 'No disponible' : quality.confidence.toFixed(2)}`,
    `Link Drive: ${driveLink || 'No disponible'}`,
    '',
    '=== MOTIVOS ===',
    ...reasonLines,
    '',
    '=== CAMPOS MORTALES VACÍOS O NO FIABLES ===',
    ...missingLines,
    '',
    '=== WARNINGS IA ===',
    ...warningLines
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;max-width:760px;">
      <h2 style="margin:0 0 12px;color:#a61b1b;">🚨 Documento con errores, revisar</h2>
      <p><strong>Archivo:</strong> ${escapeHtml(fileName)}</p>
      <p><strong>Tipo detectado:</strong> ${escapeHtml(detectedDocType)}</p>
      <p><strong>Confidence:</strong> ${escapeHtml(quality.confidence === null ? 'No disponible' : quality.confidence.toFixed(2))}</p>
      <p><strong>Documento original:</strong> ${driveLink ? `<a href="${escapeHtml(driveLink)}">Abrir en Drive</a>` : 'No disponible'}</p>
      <h3>Motivos</h3><ul>${toNotificationHtmlList(reasonLines, escapeHtml)}</ul>
      <h3>Campos mortales vacíos o no fiables</h3><ul>${toNotificationHtmlList(missingLines, escapeHtml)}</ul>
      <h3>Warnings IA</h3><ul>${toNotificationHtmlList(warningLines, escapeHtml)}</ul>
    </div>`;

  return sendDedupedEmail({
    notificationType: 'extraction_quality_error',
    documentType: detectedDocType,
    driveFileId,
    fileSha256: item?.fileSha256 || null,
    sourceFileName: fileName,
    subject,
    text,
    html,
    metadata: {
      dedupeKey: {
        driveFileId,
        fileSha256: item?.fileSha256 || null,
        documentType: detectedDocType,
        confidence: quality.confidence,
        mortalFields: quality.mortalFields,
        warnings: quality.warnings
      },
      quality: {
        confidence: quality.confidence,
        missingFields: quality.missingFields,
        blockingFields: quality.blockingFields,
        mortalFields: quality.mortalFields,
        criticalFields: quality.criticalFields,
        fieldsBySeverity: quality.fieldsBySeverity,
        warnings: quality.warnings
      }
    }
  });
}

function buildDatabaseComparisonEmailPayload(comparison = {}) {
  const result = comparison?.result || {};
  const invoice = comparison?.invoice || {};
  const fileName = invoice.sourceFileName || comparison.sourceFileName || 'Factura';
  const invoiceDriveFileId = invoice.driveFileId || comparison.driveFileId || null;
  const facturaLink = invoice.driveUrl || buildDriveFileLink(invoiceDriveFileId);
  const facturaTotal = parseComparableNumber(result.facturaTotal);
  const albaranesTotal = parseComparableNumber(result.sumatoriaTotalesAlbaranes);
  const difference = facturaTotal !== null && albaranesTotal !== null ? facturaTotal - albaranesTotal : null;
  const totalsLines = buildAlbaranTotalsComparisonLines(result, fileName);
  const issueLines = Array.isArray(result.issues) && result.issues.length
    ? result.issues.map((issue) => `- ${addEuroSymbolToAmounts(issue)}`)
    : ['- No se recibió detalle adicional.'];
  const matchedLines = buildNotificationCongruentAlbaranesSummary(result);
  const mismatchLines = buildIncongruentAlbaranesLinks(result);
  const common = [
    `Factura: ${fileName}`,
    `Número factura: ${invoice.invoiceNumber || 'No disponible'}`,
    `Total factura: ${formatAmountEuro(facturaTotal)}`,
    `Total albaranes: ${formatAmountEuro(albaranesTotal)}`,
    `Diferencia total: ${formatAmountEuro(difference)}`,
    `Factura en Drive: ${facturaLink || 'No disponible'}`
  ];
  const isWarningComparison = !result.ok && (result.warning || result.severity === 'warning');

  if (result.ok) {
    return {
      notificationType: 'comparison_matched',
      fileName,
      subject: `🟢 ${fileName} coincide`,
      text: [
        'VALIDACIÓN COMPLETADA: FACTURA COINCIDE',
        '',
        ...common,
        '',
        '=== ALBARANES CORRECTOS ===',
        ...matchedLines,
        '',
        '=== TOTALES POR ALBARÁN ===',
        ...totalsLines,
        '',
        'La factura y todos sus albaranes relacionados coinciden correctamente.'
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;max-width:760px;">
          <h2 style="color:#17693a;">🟢 Factura coincide</h2>
          <p><strong>Factura:</strong> ${escapeHtml(fileName)}</p>
          <p><strong>Número:</strong> ${escapeHtml(invoice.invoiceNumber || 'No disponible')}</p>
          <p><strong>Total factura:</strong> ${escapeHtml(formatAmountEuro(facturaTotal))}</p>
          <p><strong>Total albaranes:</strong> ${escapeHtml(formatAmountEuro(albaranesTotal))}</p>
          <p><strong>Diferencia:</strong> ${escapeHtml(formatAmountEuro(difference))}</p>
          <p><strong>Factura original:</strong> ${facturaLink ? `<a href="${escapeHtml(facturaLink)}">Abrir en Drive</a>` : 'No disponible'}</p>
          <h3>Albaranes correctos</h3><ul>${toNotificationHtmlList(matchedLines, formatComparisonLineHtml)}</ul>
          <h3>Totales por albarán</h3><ul>${toNotificationHtmlList(totalsLines, formatAlbaranTotalComparisonLineHtml)}</ul>
        </div>`
    };
  }

  if (isWarningComparison) {
    return {
      notificationType: 'comparison_mismatch',
      fileName,
      subject: `🟡 ${fileName} diferencias menores a revisar`,
      text: [
        'AVISO DE COMPARACIÓN: DIFERENCIAS MENORES',
        '',
        ...common,
        '',
        '=== DIFERENCIAS MENORES A REVISAR ===',
        ...issueLines,
        '',
        '=== TOTALES POR ALBARÁN ===',
        ...totalsLines,
        '',
        '=== ALBARANES CON DIFERENCIAS MENORES ===',
        ...mismatchLines,
        '',
        'Se detectaron diferencias de solo 1 céntimo. Conviene revisarlas, pero no se tratan como una alerta crítica.'
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;max-width:760px;">
          <h2 style="color:#b7791f;">🟡 Diferencias menores a revisar</h2>
          <p><strong>Factura:</strong> ${escapeHtml(fileName)}</p>
          <p><strong>Número:</strong> ${escapeHtml(invoice.invoiceNumber || 'No disponible')}</p>
          <p><strong>Total factura:</strong> ${escapeHtml(formatAmountEuro(facturaTotal))}</p>
          <p><strong>Total albaranes:</strong> ${escapeHtml(formatAmountEuro(albaranesTotal))}</p>
          <p><strong>Diferencia:</strong> ${escapeHtml(formatAmountEuro(difference))}</p>
          <p><strong>Factura original:</strong> ${facturaLink ? `<a href="${escapeHtml(facturaLink)}">Abrir en Drive</a>` : 'No disponible'}</p>
          <div style="background:#fffaf0;border:1px solid #f6d365;border-radius:8px;padding:12px;margin:12px 0;">
            <p style="margin:0;">Se detectaron diferencias de solo 1 céntimo. Conviene revisarlas, pero no se tratan como una alerta crítica.</p>
          </div>
          <h3>Diferencias menores a revisar</h3><ul>${toNotificationHtmlList(issueLines, escapeHtml)}</ul>
          <h3>Totales por albarán</h3><ul>${toNotificationHtmlList(totalsLines, formatAlbaranTotalComparisonLineHtml)}</ul>
          <h3>Albaranes con diferencias menores</h3><ul>${toNotificationHtmlList(mismatchLines, formatComparisonLineHtml)}</ul>
        </div>`
    };
  }

  return {
    notificationType: 'comparison_mismatch',
    fileName,
    subject: `🔴 ${fileName} no coincide`,
    text: [
      'ALERTA DE COMPARACIÓN: FACTURA NO COINCIDE',
      '',
      ...common,
      '',
      '=== COSAS QUE NO COINCIDEN ===',
      ...issueLines,
      '',
      '=== TOTALES POR ALBARÁN ===',
      ...totalsLines,
      '',
      '=== ALBARANES CON INCONGRUENCIAS ===',
      ...mismatchLines
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;max-width:760px;">
        <h2 style="color:#a61b1b;">🔴 Factura no coincide</h2>
        <p><strong>Factura:</strong> ${escapeHtml(fileName)}</p>
        <p><strong>Número:</strong> ${escapeHtml(invoice.invoiceNumber || 'No disponible')}</p>
        <p><strong>Total factura:</strong> ${escapeHtml(formatAmountEuro(facturaTotal))}</p>
        <p><strong>Total albaranes:</strong> ${escapeHtml(formatAmountEuro(albaranesTotal))}</p>
        <p><strong>Diferencia:</strong> ${escapeHtml(formatAmountEuro(difference))}</p>
        <p><strong>Factura original:</strong> ${facturaLink ? `<a href="${escapeHtml(facturaLink)}">Abrir en Drive</a>` : 'No disponible'}</p>
        <h3>Cosas que no coinciden</h3><ul>${toNotificationHtmlList(issueLines, escapeHtml)}</ul>
        <h3>Totales por albarán</h3><ul>${toNotificationHtmlList(totalsLines, formatAlbaranTotalComparisonLineHtml)}</ul>
        <h3>Albaranes con incongruencias</h3><ul>${toNotificationHtmlList(mismatchLines, formatComparisonLineHtml)}</ul>
      </div>`
  };
}

async function sendDatabaseComparisonEmailIfNeeded(comparison = {}) {
  const result = comparison?.result || {};
  if (result.pending || result.needsReview) return { skipped: true, reason: 'comparison_not_final' };

  const payload = buildDatabaseComparisonEmailPayload(comparison);
  const invoice = comparison?.invoice || {};
  return sendDedupedEmail({
    notificationType: payload.notificationType,
    documentType: 'factura',
    invoiceId: invoice.id || comparison.invoiceId || null,
    driveFileId: invoice.driveFileId || comparison.driveFileId || null,
    sourceFileName: payload.fileName,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    metadata: {
      dedupeKey: {
        invoiceId: invoice.id || comparison.invoiceId || null,
        status: result.warning ? 'warning' : (result.ok ? 'matched' : 'mismatch'),
        facturaTotal: result.facturaTotal ?? null,
        sumatoriaTotalesAlbaranes: result.sumatoriaTotalesAlbaranes ?? null,
        issues: result.issues || [],
        albaranTotalsComparison: result.albaranTotalsComparison || []
      }
    }
  });
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const databaseViewerState = {
  tables: [],
  selectedTable: null,
  columns: [],
  rows: [],
  totalRows: 0,
  limit: 100
};

function stringifyDatabaseValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function compactDatabaseValue(value, maxLength = 120) {
  const text = stringifyDatabaseValue(value).replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

async function moveDatabaseComparisonDocuments(comparison = {}, folders = {}) {
  const result = comparison.result || {};
  if (result.pending || result.needsReview) return;

  const invoiceDriveFileId = comparison.invoice?.driveFileId || comparison.driveFileId || null;
  if (invoiceDriveFileId && folders.facturasDocumentosFolderId && folders.facturasNoComparadoFolderId) {
    await ipcRenderer.invoke(
      'move-file',
      invoiceDriveFileId,
      [folders.facturasDocumentosFolderId],
      [folders.facturasNoComparadoFolderId]
    );
  }

  const documents = [
    ...(Array.isArray(result.congruentAlbaranDocs) ? result.congruentAlbaranDocs : []),
    ...(Array.isArray(result.incongruentAlbaranDocs) ? result.incongruentAlbaranDocs : [])
  ];
  const movedFileIds = new Set();
  for (const document of documents) {
    const fileId = document?.fileId || null;
    if (!fileId || movedFileIds.has(fileId)) continue;
    movedFileIds.add(fileId);
    if (folders.albaranesDocumentosFolderId && folders.albaranesNoComparadoFolderId) {
      await ipcRenderer.invoke(
        'move-file',
        fileId,
        [folders.albaranesDocumentosFolderId],
        [folders.albaranesNoComparadoFolderId]
      );
    }
  }
}

async function comparePendingInvoicesByDatabaseAndMove(folders = {}) {
  const response = await ipcRenderer.invoke('compare-pending-invoices-database', { limit: 200 });
  const comparedItems = Array.isArray(response?.comparedItems) ? response.comparedItems : [];
  for (const comparison of comparedItems) {
    try {
      await sendDatabaseComparisonEmailIfNeeded(comparison);
    } catch (emailError) {
      console.warn('No se pudo enviar email de comparación pendiente:', emailError);
    }
    await moveDatabaseComparisonDocuments(comparison, folders);
  }
  return response;
}

async function compareSelectedInvoicesByDatabaseAndMove(invoiceIds = [], folders = {}) {
  const uniqueInvoiceIds = [...new Set(
    (Array.isArray(invoiceIds) ? invoiceIds : [])
      .map((invoiceId) => String(invoiceId || '').trim())
      .filter(Boolean)
  )];
  if (!uniqueInvoiceIds.length) return { total: 0, comparedItems: [] };

  const response = await ipcRenderer.invoke('compare-selected-invoices-database', {
    invoiceIds: uniqueInvoiceIds
  });
  const comparedItems = Array.isArray(response?.comparedItems) ? response.comparedItems : [];
  for (const comparison of comparedItems) {
    try {
      await sendDatabaseComparisonEmailIfNeeded(comparison);
    } catch (emailError) {
      console.warn('No se pudo enviar email de comparación seleccionada:', emailError);
    }
    await moveDatabaseComparisonDocuments(comparison, folders);
  }
  return response;
}

function setDatabasePanelVisible(isVisible) {
  if (databaseView) {
    databaseView.classList.toggle('active', Boolean(isVisible));
  }

  ['folder-summary', 'files-list', 'upload-queue-panel'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.style.display = isVisible ? 'none' : '';
  });

  if (!isVisible && databaseRowDetail) {
    databaseRowDetail.style.display = 'none';
    databaseRowDetail.innerHTML = '';
  }
}

const foodOrderState = {
  categories: [],
  suppliers: [],
  products: [],
  selectedCategoryId: null,
  quantities: new Map(),
  selectedProducts: new Map(),
  currentOrder: null,
  searchTimer: null
};

function setFoodOrderPanelVisible(isVisible) {
  if (foodOrderView) foodOrderView.classList.toggle('active', Boolean(isVisible));
  if (isVisible) setDatabasePanelVisible(false);
  ['folder-summary', 'files-list', 'upload-queue-panel'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.style.display = isVisible ? 'none' : '';
  });
}

function openFoodModal(modal) {
  if (!modal) return;
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
}

function closeFoodModal(modal) {
  if (!modal) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
}

function renderFoodCategories() {
  if (!foodCategoryList) return;
  foodCategoryList.innerHTML = '';
  const allButton = document.createElement('button');
  allButton.type = 'button';
  allButton.className = 'food-category-btn';
  allButton.classList.toggle('active', !foodOrderState.selectedCategoryId);
  allButton.textContent = 'Todos';
  allButton.addEventListener('click', () => {
    foodOrderState.selectedCategoryId = null;
    renderFoodCategories();
    loadFoodProducts();
  });
  foodCategoryList.appendChild(allButton);
  foodOrderState.categories.forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'food-category-btn';
    button.classList.toggle('active', category.id === foodOrderState.selectedCategoryId);
    button.textContent = category.name;
    button.addEventListener('click', () => {
      foodOrderState.selectedCategoryId = category.id;
      renderFoodCategories();
      loadFoodProducts();
    });
    foodCategoryList.appendChild(button);
  });
}

function getFoodQuantity(productId) {
  return foodOrderState.quantities.get(productId) || '';
}

function renderFoodProducts() {
  if (!foodProductsGrid) return;
  if (!foodOrderState.products.length) {
    foodProductsGrid.innerHTML = '<div class="food-empty">No hay productos que coincidan. Usa “Añadir producto” para crear el primero.</div>';
    return;
  }
  foodProductsGrid.innerHTML = '';
  foodOrderState.products.forEach((product) => {
    const card = document.createElement('article');
    card.className = 'food-product-card';
    const name = document.createElement('div');
    name.className = 'food-product-name';
    name.textContent = product.name;
    const meta = document.createElement('div');
    meta.className = 'food-product-meta';
    const categoryText = (product.categories || []).map((category) => category.name).join(' · ');
    meta.textContent = `Proveedor: ${product.supplierName || 'Sin proveedor'}\nMétrica: ${product.metric}${categoryText ? `\n${categoryText}` : ''}`;
    meta.style.whiteSpace = 'pre-line';
    const quantityRow = document.createElement('label');
    quantityRow.className = 'food-quantity-row';
    quantityRow.textContent = 'Cantidad:';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.001';
    input.inputMode = 'decimal';
    input.className = 'food-quantity-input';
    input.value = getFoodQuantity(product.id);
    input.setAttribute('aria-label', `Cantidad de ${product.name}`);
    input.addEventListener('input', () => {
      const rawValue = input.value.trim();
      const value = Number(rawValue.replace(',', '.'));
      if (!rawValue || !Number.isFinite(value) || value <= 0) {
        foodOrderState.quantities.delete(product.id);
        foodOrderState.selectedProducts.delete(product.id);
      } else {
        foodOrderState.quantities.set(product.id, Math.round(value * 1000) / 1000);
        foodOrderState.selectedProducts.set(product.id, product);
      }
    });
    const metric = document.createElement('span');
    metric.textContent = product.metric;
    quantityRow.append(input, metric);
    card.append(name, meta, quantityRow);
    foodProductsGrid.appendChild(card);
  });
}

async function loadFoodProducts() {
  if (!foodProductsGrid) return;
  foodProductsGrid.innerHTML = '<div class="food-empty">Cargando productos...</div>';
  try {
    const payload = await ipcRenderer.invoke('food-products-list', {
      search: foodProductSearch?.value || '',
      categoryIds: foodOrderState.selectedCategoryId ? [foodOrderState.selectedCategoryId] : []
    });
    foodOrderState.products = payload.products || [];
    renderFoodProducts();
  } catch (error) {
    foodProductsGrid.innerHTML = `<div class="food-empty">${escapeHtml(error.message || 'No se pudieron cargar los productos.')}</div>`;
    showStatus(`Error cargando productos: ${error.message || error}`, 'error');
  }
}

async function loadFoodOrderView() {
  if (!foodOrderView) return;
  setFoodOrderPanelVisible(true);
  try {
    const [categoriesPayload, suppliersPayload] = await Promise.all([
      ipcRenderer.invoke('food-categories-list'),
      ipcRenderer.invoke('food-suppliers-list')
    ]);
    foodOrderState.categories = categoriesPayload.categories || [];
    foodOrderState.suppliers = suppliersPayload.suppliers || [];
    renderFoodCategories();
    await loadFoodProducts();
    breadcrumb = [{ id: null, name: 'Mi unidad' }, { id: '__food_orders__', name: 'Pedir' }];
    renderBreadcrumbs();
  } catch (error) {
    showStatus(`Error cargando pedidos: ${error.message || error}`, 'error');
  }
}

function populateFoodProductForm() {
  if (foodProductSupplier) {
    foodProductSupplier.innerHTML = '';
    if (!foodOrderState.suppliers.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Primero añade un proveedor';
      foodProductSupplier.appendChild(option);
    } else {
      foodOrderState.suppliers.forEach((supplier) => {
        const option = document.createElement('option');
        option.value = supplier.id;
        option.textContent = supplier.name || supplier.orderEmail || supplier.email || 'Proveedor sin nombre';
        foodProductSupplier.appendChild(option);
      });
    }
  }
  if (foodProductCategoryChecks) {
    foodProductCategoryChecks.innerHTML = '';
    foodOrderState.categories.forEach((category) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = category.id;
      label.append(checkbox, document.createTextNode(category.name));
      foodProductCategoryChecks.appendChild(label);
    });
  }
}

function openFoodProductModal() {
  if (!foodOrderState.suppliers.length) {
    showStatus('Añade primero un proveedor para poder asociar el producto.', 'error');
    openFoodSupplierModal();
    return;
  }
  foodProductForm?.reset();
  populateFoodProductForm();
  openFoodModal(foodProductModal);
}

function openFoodSupplierModal() {
  foodSupplierForm?.reset();
  openFoodModal(foodSupplierModal);
}

function getSelectedFoodOrderItems() {
  return [...foodOrderState.quantities.entries()]
    .map(([productId, quantity]) => ({ product: foodOrderState.selectedProducts.get(productId), quantity }))
    .filter(({ product, quantity }) => product && Number(quantity) > 0);
}

function openFoodSummaryModal() {
  const selectedItems = getSelectedFoodOrderItems();
  if (!selectedItems.length) {
    showStatus('Introduce una cantidad mayor que cero en al menos un producto.', 'error');
    return;
  }
  const groups = new Map();
  selectedItems.forEach(({ product, quantity }) => {
    const key = product.supplierId || product.supplierName || 'sin-proveedor';
    if (!groups.has(key)) groups.set(key, { supplierName: product.supplierName || 'Proveedor sin nombre', items: [] });
    groups.get(key).items.push({ product, quantity });
  });
  foodSummaryContent.innerHTML = '';
  groups.forEach((group) => {
    const container = document.createElement('div');
    container.className = 'food-order-summary-group';
    const title = document.createElement('h4');
    title.textContent = group.supplierName;
    const list = document.createElement('ul');
    group.items.forEach(({ product, quantity }) => {
      const item = document.createElement('li');
      item.textContent = `${product.name}: ${quantity} ${product.metric}`;
      list.appendChild(item);
    });
    container.append(title, list);
    foodSummaryContent.appendChild(container);
  });
  openFoodModal(foodSummaryModal);
}

function renderFoodOrderEmails() {
  const currentOrder = foodOrderState.currentOrder;
  if (!currentOrder || !foodEmailsContent) return;
  const emails = currentOrder.emails || [];
  if (foodEmailCounter) foodEmailCounter.textContent = `${currentOrder.sentEmails || 0}/${currentOrder.totalEmails || emails.length} enviados`;
  foodEmailsContent.innerHTML = '';
  emails.forEach((email) => {
    const card = document.createElement('article');
    card.className = `food-email-card ${email.status === 'sent' ? 'sent' : ''} ${email.status === 'error' ? 'error' : ''}`;
    const header = document.createElement('div');
    header.className = 'food-email-header';
    const supplier = document.createElement('div');
    supplier.className = 'food-email-supplier';
    supplier.textContent = email.supplierName || email.toEmail;
    const status = document.createElement('span');
    status.className = 'food-email-status';
    status.textContent = email.status === 'sent' ? 'Enviado ✓' : (email.status === 'error' ? 'Error de envío' : 'Borrador');
    header.append(supplier, status);
    const to = document.createElement('div');
    to.className = 'food-product-meta';
    to.textContent = `Para: ${email.toEmail}\nAsunto: ${email.subject}`;
    to.style.whiteSpace = 'pre-line';
    const preview = document.createElement('div');
    preview.className = 'food-email-preview';
    preview.textContent = email.bodyText;
    card.append(header, to, preview);
    if (email.errorMessage) {
      const error = document.createElement('div');
      error.className = 'food-email-error';
      error.textContent = email.errorMessage;
      card.appendChild(error);
    }
    if (email.status !== 'sent') {
      const actions = document.createElement('div');
      actions.className = 'food-modal-actions';
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'btn btn-secondary small';
      editButton.textContent = 'Editar';
      editButton.addEventListener('click', () => editFoodOrderEmail(email, card));
      const sendButton = document.createElement('button');
      sendButton.type = 'button';
      sendButton.className = 'btn small';
      sendButton.textContent = email.status === 'error' ? 'Reintentar envío' : 'Enviar';
      sendButton.addEventListener('click', () => sendFoodOrderEmail(email, sendButton));
      actions.append(editButton, sendButton);
      card.appendChild(actions);
    }
    foodEmailsContent.appendChild(card);
  });
}

async function refreshFoodOrderStatus() {
  const orderId = foodOrderState.currentOrder?.order?.id;
  if (!orderId) return;
  const payload = await ipcRenderer.invoke('food-order-status', { orderId });
  foodOrderState.currentOrder = payload;
  renderFoodOrderEmails();
}

async function createFoodOrderDrafts() {
  const selectedItems = getSelectedFoodOrderItems();
  if (!selectedItems.length) return;
  try {
    foodCreateOrderBtn.disabled = true;
    foodCreateOrderBtn.textContent = 'Preparando...';
    const payload = await ipcRenderer.invoke('food-order-create', {
      items: selectedItems.map(({ product, quantity }) => ({ productId: product.id, quantity }))
    });
    foodOrderState.currentOrder = payload;
    closeFoodModal(foodSummaryModal);
    foodOrderState.quantities.clear();
    foodOrderState.selectedProducts.clear();
    renderFoodProducts();
    renderFoodOrderEmails();
    openFoodModal(foodEmailsModal);
    showStatus('Borradores de email preparados para revisar.', 'success');
  } catch (error) {
    showStatus(`No se pudieron preparar los emails: ${error.message || error}`, 'error');
  } finally {
    foodCreateOrderBtn.disabled = false;
    foodCreateOrderBtn.textContent = 'Preparar emails';
  }
}

async function editFoodOrderEmail(email, card) {
  const existing = card.querySelector('.food-email-edit-form');
  if (existing) return;
  const form = document.createElement('form');
  form.className = 'food-email-edit-form';
  form.innerHTML = `
    <div class="food-form-grid" style="margin-top:12px;">
      <label class="food-form-field full">Para<input name="toEmail" type="email" required maxlength="320" value="${escapeHtml(email.toEmail)}" /></label>
      <label class="food-form-field full">Asunto<input name="subject" required maxlength="500" value="${escapeHtml(email.subject)}" /></label>
      <label class="food-form-field full">Cuerpo<textarea name="bodyText" required maxlength="20000"></textarea></label>
    </div>
    <div class="food-modal-actions"><button class="btn btn-secondary small" type="button">Cancelar edición</button><button class="btn small" type="submit">Guardar cambios</button></div>`;
  form.elements.bodyText.value = email.bodyText;
  form.querySelector('button[type="button"]').addEventListener('click', () => form.remove());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    try {
      submitButton.disabled = true;
      await ipcRenderer.invoke('food-order-email-update', {
        emailId: email.id,
        toEmail: form.elements.toEmail.value,
        subject: form.elements.subject.value,
        bodyText: form.elements.bodyText.value
      });
      await refreshFoodOrderStatus();
      showStatus('Borrador actualizado.', 'success');
    } catch (error) {
      showStatus(`No se pudo actualizar el borrador: ${error.message || error}`, 'error');
      submitButton.disabled = false;
    }
  });
  card.appendChild(form);
}

async function sendFoodOrderEmail(email, button) {
  if (!confirm(`¿Enviar ahora el pedido a ${email.toEmail}?`)) return;
  try {
    button.disabled = true;
    button.textContent = 'Enviando...';
    const payload = await ipcRenderer.invoke('food-order-email-send', { emailId: email.id });
    foodOrderState.currentOrder = payload;
    renderFoodOrderEmails();
    showStatus(`Email enviado a ${email.toEmail}.`, 'success');
  } catch (error) {
    await refreshFoodOrderStatus().catch(() => {});
    showStatus(`No se pudo enviar el email: ${error.message || error}`, 'error');
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = 'Enviar';
    }
  }
}

if (foodRefreshBtn) foodRefreshBtn.addEventListener('click', loadFoodOrderView);
if (foodProductSearch) {
  foodProductSearch.addEventListener('input', () => {
    clearTimeout(foodOrderState.searchTimer);
    foodOrderState.searchTimer = setTimeout(loadFoodProducts, 250);
  });
}
if (foodAddProductBtn) foodAddProductBtn.addEventListener('click', openFoodProductModal);
if (foodAddSupplierBtn) foodAddSupplierBtn.addEventListener('click', openFoodSupplierModal);
if (foodOrderAddBtn) foodOrderAddBtn.addEventListener('click', openFoodSummaryModal);
if (foodCreateOrderBtn) foodCreateOrderBtn.addEventListener('click', createFoodOrderDrafts);

if (foodSupplierForm) {
  foodSupplierForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const supplier = await ipcRenderer.invoke('food-supplier-create', {
        name: document.getElementById('food-supplier-name').value,
        email: document.getElementById('food-supplier-email').value,
        orderEmail: document.getElementById('food-supplier-order-email').value,
        contactName: document.getElementById('food-supplier-contact-name').value,
        phone: document.getElementById('food-supplier-phone').value,
        cif: document.getElementById('food-supplier-cif').value,
        address: document.getElementById('food-supplier-address').value
      });
      const index = foodOrderState.suppliers.findIndex((item) => item.id === supplier.supplier.id);
      if (index >= 0) foodOrderState.suppliers[index] = supplier.supplier;
      else foodOrderState.suppliers.push(supplier.supplier);
      foodOrderState.suppliers.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
      closeFoodModal(foodSupplierModal);
      showStatus('Proveedor guardado.', 'success');
      if (foodProductModal?.classList.contains('active')) populateFoodProductForm();
    } catch (error) {
      showStatus(`No se pudo guardar el proveedor: ${error.message || error}`, 'error');
    }
  });
}

if (foodProductForm) {
  foodProductForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const categoryIds = [...foodProductCategoryChecks.querySelectorAll('input:checked')].map((input) => input.value);
      await ipcRenderer.invoke('food-product-create', {
        name: document.getElementById('food-product-name').value,
        metric: document.getElementById('food-product-metric').value,
        supplierId: foodProductSupplier.value,
        supplierEmailOverride: document.getElementById('food-product-email-override').value,
        categoryIds,
        notes: document.getElementById('food-product-notes').value
      });
      closeFoodModal(foodProductModal);
      await loadFoodProducts();
      showStatus('Producto guardado.', 'success');
    } catch (error) {
      showStatus(`No se pudo guardar el producto: ${error.message || error}`, 'error');
    }
  });
}

document.querySelectorAll('[data-food-close]').forEach((button) => {
  button.addEventListener('click', () => closeFoodModal(document.getElementById(button.dataset.foodClose)));
});
[foodSupplierModal, foodProductModal, foodSummaryModal, foodEmailsModal].forEach((modal) => {
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeFoodModal(modal);
  });
});

function renderDatabaseTableButtons() {
  if (!databaseTableList) return;
  databaseTableList.innerHTML = '';

  databaseViewerState.tables.forEach((table) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'database-table-btn';
    button.classList.toggle('active', table.name === databaseViewerState.selectedTable?.name);
    button.textContent = table.label || table.name;
    button.title = table.description || table.name;
    button.addEventListener('click', () => loadDatabaseView(table.name));
    databaseTableList.appendChild(button);
  });
}

function renderDatabaseDetail(row, rowIndex) {
  if (!databaseRowDetail || !databaseViewerState.selectedTable) return;

  const title = `${databaseViewerState.selectedTable.label || databaseViewerState.selectedTable.name} · fila ${rowIndex + 1}`;
  const rowsHtml = databaseViewerState.columns.map((column) => `
    <tr>
      <th>${escapeHtml(column.name)}</th>
      <td><div class="database-detail-value">${escapeHtml(stringifyDatabaseValue(row[column.name]))}</div></td>
    </tr>
  `).join('');

  databaseRowDetail.innerHTML = `
    <div class="database-detail-header">
      <span>${escapeHtml(title)}</span>
      <button class="database-detail-close" type="button" aria-label="Cerrar detalle">×</button>
    </div>
    <table class="database-detail-table"><tbody>${rowsHtml}</tbody></table>
  `;

  databaseRowDetail.querySelector('.database-detail-close')?.addEventListener('click', () => {
    databaseRowDetail.style.display = 'none';
    databaseRowDetail.innerHTML = '';
  });

  databaseRowDetail.style.display = 'block';
  databaseRowDetail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderDatabaseTable() {
  if (!databaseTableContent) return;
  renderDatabaseTableButtons();

  const table = databaseViewerState.selectedTable;
  if (!table) {
    databaseTableContent.innerHTML = '<div class="database-empty">Selecciona una tabla para ver sus filas.</div>';
    return;
  }

  if (databaseSubtitle) {
    databaseSubtitle.textContent = `${table.description || ''} Doble click en una fila para ver todos sus campos ordenados.`;
  }
  if (databaseTableMeta) {
    databaseTableMeta.textContent = `${table.label || table.name}: ${databaseViewerState.rows.length} de ${databaseViewerState.totalRows} filas mostradas (límite ${databaseViewerState.limit}).`;
  }
  if (!databaseViewerState.rows.length) {
    databaseTableContent.innerHTML = '<div class="database-empty">No hay filas guardadas en esta tabla para tu organización.</div>';
    return;
  }

  const headersHtml = databaseViewerState.columns
    .map((column) => `<th title="${escapeHtml(column.type || '')}">${escapeHtml(column.name)}</th>`)
    .join('');
  const bodyHtml = databaseViewerState.rows.map((row, rowIndex) => {
    const cells = databaseViewerState.columns.map((column) => {
      const fullValue = stringifyDatabaseValue(row[column.name]);
      return `<td title="${escapeHtml(fullValue)}">${escapeHtml(compactDatabaseValue(row[column.name]))}</td>`;
    }).join('');
    return `<tr data-row-index="${rowIndex}" title="Doble click para ver el detalle completo">${cells}</tr>`;
  }).join('');

  databaseTableContent.innerHTML = `
    <table class="database-grid">
      <thead><tr>${headersHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  `;

  databaseTableContent.querySelectorAll('tbody tr').forEach((rowElement) => {
    rowElement.addEventListener('dblclick', () => {
      const rowIndex = Number(rowElement.dataset.rowIndex);
      const row = databaseViewerState.rows[rowIndex];
      if (row) renderDatabaseDetail(row, rowIndex);
    });
  });
}

async function loadDatabaseView(tableName = null) {
  if (!databaseView) return;

  setDatabasePanelVisible(true);
  if (databaseTableContent) {
    databaseTableContent.innerHTML = '<div class="database-loading">Cargando datos guardados...</div>';
  }
  if (databaseTableMeta) databaseTableMeta.textContent = 'Cargando base de datos...';
  if (databaseRowDetail) {
    databaseRowDetail.style.display = 'none';
    databaseRowDetail.innerHTML = '';
  }

  try {
    const payload = await ipcRenderer.invoke('get-database-view', tableName, databaseViewerState.limit);
    databaseViewerState.tables = payload.tables || [];
    databaseViewerState.selectedTable = payload.selectedTable || null;
    databaseViewerState.columns = payload.columns || [];
    databaseViewerState.rows = payload.rows || [];
    databaseViewerState.totalRows = Number(payload.totalRows || 0);
    databaseViewerState.limit = Number(payload.limit || databaseViewerState.limit);

    breadcrumb = [{ id: null, name: 'Mi unidad' }, { id: '__database__', name: 'Bases de datos' }];
    renderBreadcrumbs();
    renderDatabaseTable();
  } catch (error) {
    uiLog('error', 'loadDatabaseView:error', serializeUiError(error));
    if (databaseTableContent) {
      databaseTableContent.innerHTML = `<div class="database-error">${escapeHtml(error.message || 'No se pudo cargar la base de datos.')}</div>`;
    }
    if (databaseTableMeta) databaseTableMeta.textContent = 'Error cargando base de datos.';
    showStatus(`Error cargando base de datos: ${error.message || error}`, 'error');
  }
}

if (databaseRefreshBtn) {
  databaseRefreshBtn.addEventListener('click', () => {
    loadDatabaseView(databaseViewerState.selectedTable?.name || null);
  });
}

if (databaseClearTestBtn) {
  databaseClearTestBtn.addEventListener('click', async () => {
    const confirmation = 'Desea borrar el conenido de las bases de datos?';
    if (!confirm(confirmation)) return;

    try {
      databaseClearTestBtn.disabled = true;
      showStatus('Vaciando base de datos. La aplicación se cerrará...', 'loading');
      await ipcRenderer.invoke('clear-database-test-data', confirmation);
    } catch (error) {
      showStatus(`Error vaciando base de datos: ${error.message || error}`, 'error');
      databaseClearTestBtn.disabled = false;
    }
  });
}

function formatIncongruentAlbaranLineHtml(line = '') {
  const cleaned = String(line || '').replace(/^\-\s*/, '').trim();
  const match = cleaned.match(/^Albar[aá]n\s+(.+?)\s+\((.+?)\):\s*(.+)$/i);
  if (!match) return escapeHtml(cleaned);

  const [, num, fileName, urlRaw] = match;
  const safeNum = escapeHtml(num);
  const safeName = escapeHtml(fileName);
  const safeUrl = escapeHtml(urlRaw);
  const hasLink = /^https?:\/\//i.test(String(urlRaw || '').trim());
  const urlHtml = hasLink ? `<a href="${safeUrl}">Abrir en Drive</a>` : safeUrl;

  return `Albarán <strong>${safeNum}</strong> (<strong>${safeName}</strong>): ${urlHtml}`;
}

function formatCongruentAlbaranLineHtml(line = '') {
  const cleaned = String(line || '').replace(/^\-\s*/, '').trim();
  const match = cleaned.match(/^Albar[aá]n\s+(.+?):\s*(.+)$/i);
  if (!match) return escapeHtml(cleaned);

  const [, num, fileName] = match;
  return `Albarán <strong>${escapeHtml(num)}</strong>: <strong>${escapeHtml(fileName)}</strong>`;
}

function toHtmlList(lines = [], formatter = (line) => escapeHtml(line), emptyText = 'No disponible') {
  if (!Array.isArray(lines) || !lines.length) {
    return `<li>${escapeHtml(emptyText)}</li>`;
  }

  return lines
    .map((line) => `<li>${formatter(line)}</li>`)
    .join('');
}

function buildCongruentAlbaranesSummary(compareResult = {}) {
  const docs = Array.isArray(compareResult?.congruentAlbaranDocs)
    ? compareResult.congruentAlbaranDocs
    : [];

  if (docs.length) {
    return docs.map((doc) => {
      const num = doc?.albaranNum || 'N/A';
      const fileName = doc?.fileName || 'Nombre no disponible';
      const totalDetectedLabel = formatAmountEuro(doc?.totalDetected);
      return `- Albarán ${num}: ${fileName} (total detectado: ${totalDetectedLabel})`;
    });
  }

  const matched = Array.isArray(compareResult?.matchedAlbaranes)
    ? compareResult.matchedAlbaranes
    : [];
  const incongruent = new Set(
    (Array.isArray(compareResult?.incongruentAlbaranes) ? compareResult.incongruentAlbaranes : [])
      .map((num) => String(num || '').trim())
      .filter(Boolean)
  );

  const congruentNums = matched
    .map((num) => String(num || '').trim())
    .filter((num) => num && !incongruent.has(num));

  if (!congruentNums.length) {
    return ['- No disponible'];
  }

  return congruentNums.map((num) => `- Albarán ${num}: nombre no disponible (total detectado: No disponible)`);
}

function parseComparableNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let text = String(value).trim();
  if (!text || text.toLowerCase() === 'nan') return null;
  text = text.replace(/[€\s]/g, '');

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (hasComma) {
    text = text.replace(',', '.');
  }

  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function formatAmountEuro(value) {
  if (value === null || value === undefined || value === '') return 'No disponible';
  const numeric = typeof value === 'number' ? value : parseComparableNumber(value);
  if (!Number.isFinite(numeric)) {
    const raw = String(value || '').trim();
    if (!raw) return 'No disponible';
    return raw.includes('€') ? raw : `${raw}€`;
  }
  return `${numeric.toFixed(2)}€`;
}

function addEuroSymbolToAmounts(text = '') {
  const input = String(text || '');
  return input
    .replace(/(factura=)([-+]?\d*\.?\d+)(?!€)/gi, '$1$2€')
    .replace(/(albar[aá]n=)([-+]?\d*\.?\d+)(?!€)/gi, '$1$2€')
    .replace(/(suma_albaranes=)([-+]?\d*\.?\d+)(?!€)/gi, '$1$2€');
}

function extractFacturaTotalFromAnalysis(analysisText) {
  try {
    const sections = extractAnalysisSections(analysisText);
    if (!sections?.resumenRaw) return null;
    const resumenLine = sections.resumenRaw.split(/\r?\n/).find(line => line.trim());
    if (!resumenLine) return null;
    const resumenObj = JSON.parse(resumenLine);
    return parseComparableNumber(resumenObj?.total);
  } catch (e) {
    return null;
  }
}

async function getCurrentSessionEmail() {
  const info = await ipcRenderer.invoke('get-user-info');
  const email = info?.email || null;
  if (!email) {
    throw new Error('No se pudo obtener el email del usuario en sesión');
  }
  return email;
}

async function uploadGeneratedTxtFiles(targetFolderId, analysisText, sourceFileName = null) {
  if (!targetFolderId) return;
  const payload = buildTxtFilesFromAnalysis(analysisText, sourceFileName);
  if (!payload || !payload.files.length) return;

  const tempDir = path.join(require('os').tmpdir(), 'ia-json');
  fs.mkdirSync(tempDir, { recursive: true });

  for (const file of payload.files) {
    const safeName = sanitizeFileName(file.name);
    const tempPath = path.join(tempDir, safeName);
    fs.writeFileSync(tempPath, file.content || '', 'utf8');

    try {
      await ipcRenderer.invoke('upload-file', tempPath, targetFolderId);
    } finally {
      try { fs.unlinkSync(tempPath); } catch (e) {}
    }
  }
}

function showSection(sectionName) {
  const login = sectionName === 'login';
  const billing = sectionName === 'billing';
  const upload = sectionName === 'upload';

  loginSection.classList.toggle('active', login);
  if (billingSetupSection) {
    billingSetupSection.classList.toggle('active', billing);
  }
  uploadSection.classList.toggle('active', upload);
}

function setBillingEmailLabel(email) {
  if (!billingEmailLabel) return;
  if (email) {
    billingEmailLabel.textContent = email;
    billingEmailLabel.classList.remove('placeholder');
    return;
  }
  billingEmailLabel.textContent = 'Pendiente';
  billingEmailLabel.classList.add('placeholder');
}

async function ensureBillingSetup(info, { forceSetup = false } = {}) {
  const driveEmail = info?.email || 'este email';
  uiLog('log', 'ensureBillingSetup:start', { driveEmail, forceSetup });
  const billingConfig = await ipcRenderer.invoke('get-billing-config');

  if (billingConfig?.configured && !forceSetup) {
    uiLog('log', 'ensureBillingSetup:already-configured', billingConfig);
    setBillingEmailLabel(billingConfig.email || null);
    // Solicitud cliente: monitor automático desactivado.
    // await ipcRenderer.invoke('start-billing-monitor');
    return billingConfig;
  }

  if (billingQuestionText) {
    billingQuestionText.textContent = `Has iniciado sesión en Drive con ${driveEmail}. ¿Quieres recibir las facturas en este mismo email o en otro?`;
  }
  if (billingDifferentActions) {
    billingDifferentActions.style.display = 'none';
  }

  showSection('billing');

  return new Promise((resolve, reject) => {
    let resolved = false;

    const cleanUp = () => {
      if (billingSameBtn) billingSameBtn.onclick = null;
      if (billingDifferentBtn) billingDifferentBtn.onclick = null;
      if (billingLoginBtn) billingLoginBtn.onclick = null;
    };

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      cleanUp();
      resolve(value);
    };

    if (billingSameBtn) {
      billingSameBtn.onclick = async () => {
        try {
          billingSameBtn.disabled = true;
          showStatus('Guardando email de facturas...', 'loading');
          const result = await ipcRenderer.invoke('set-billing-email-same');
          uiLog('log', 'ensureBillingSetup:set-billing-email-same:ok', result);
          setBillingEmailLabel(result?.email || driveEmail || null);
          // Solicitud cliente: monitor automático desactivado.
          // await ipcRenderer.invoke('start-billing-monitor');
          showStatus('Email de facturas configurado.', 'success');
          finish(result || { configured: true, mode: 'same', email: driveEmail });
        } catch (error) {
          uiLog('error', 'ensureBillingSetup:set-billing-email-same:error', serializeUiError(error));
          billingSameBtn.disabled = false;
          showStatus(`Error al configurar email de facturas: ${error.message || error}`, 'error');
        }
      };
    }

    if (billingDifferentBtn) {
      billingDifferentBtn.onclick = () => {
        if (billingDifferentActions) {
          billingDifferentActions.style.display = 'block';
        }
      };
    }

    if (billingLoginBtn) {
      billingLoginBtn.onclick = async () => {
        try {
          billingLoginBtn.disabled = true;
          showStatus('Inicia sesión con el email que recibirá facturas...', 'loading');
          const billingUser = await ipcRenderer.invoke('google-login', false, 'billing');
          const billingEmail = billingUser?.email || null;
          uiLog('log', 'ensureBillingSetup:billing-login:ok', { billingEmail });
          setBillingEmailLabel(billingEmail);
          // Solicitud cliente: monitor automático desactivado.
          // await ipcRenderer.invoke('start-billing-monitor');
          showStatus('Email de facturas alternativo configurado.', 'success');
          finish({ configured: true, mode: 'separate', email: billingEmail });
        } catch (error) {
          uiLog('error', 'ensureBillingSetup:billing-login:error', serializeUiError(error));
          billingLoginBtn.disabled = false;
          showStatus(`Error en login del email de facturas: ${error.message || error}`, 'error');
        }
      };
    }
  });
}

// Verificar si ya hay sesión (se lanza tras login o recarga)
checkSession();

// Login con Google
loginBtn.addEventListener('click', async () => {
  uiLog('log', 'login button:click');
  try {
    loginBtn.textContent = 'Abriendo navegador...';
    loginBtn.disabled = true;
    showStatus('Se abrirá tu navegador para iniciar sesión con Google. Autoriza la app y vuelve aquí.', 'loading');

    await ipcRenderer.invoke('google-login', false);
    uiLog('log', 'login button:google-login:ok');
    checkSession({ forceBillingSetup: true });

  } catch (error) {
    uiLog('error', 'login button:google-login:error', serializeUiError(error));
    alert('Error al iniciar sesión: ' + error.message);
    loginBtn.textContent = 'Iniciar sesión con Google';
    loginBtn.disabled = false;
    document.getElementById('status').style.display = 'none';
  }
});

async function checkSession({ forceBillingSetup = false } = {}) {
  uiLog('log', 'checkSession:start', { forceBillingSetup });
  const info = await ipcRenderer.invoke('get-user-info');

  if (info && info.email) {
    uiLog('log', 'checkSession:session-found', { email: info.email });
    try {
      toggleStartupOverlay(true, 'Comprobando carpetas estándar en Drive...');
      showStatus('Comprobando carpetas estándar en Drive...', 'loading');
      await ipcRenderer.invoke('ensure-standard-folders');
      uiLog('log', 'checkSession:ensure-standard-folders:ok');
      showStatus('Carpetas estándar verificadas en Drive.', 'success');
    } catch (folderError) {
      uiLog('error', 'checkSession:ensure-standard-folders:error', serializeUiError(folderError));
      showStatus(
        'Error al verificar carpetas estándar en Drive.',
        'error',
        folderError?.message || String(folderError || '')
      );
      console.warn('No se pudieron crear carpetas estándar:', folderError);
    }
    // Solicitud cliente: desactivar procesos automáticos no ligados a Subir Albarán/Factura.
    // Se omiten setup de monitor de facturas por email y escaneo inicial de carpetas.
    toggleStartupOverlay(false);
    setBillingEmailLabel(info?.email || null);
    showUploadSection(info);
  } else {
    uiLog('warn', 'checkSession:no-active-session');
    showSection('login');
    toggleStartupOverlay(false);
  }
}

// Nota: el login se gestiona en user.html. Esta página solo muestra la UI principal.

// Subir archivo a carpeta específica (albaranes o facturas) dentro de "No procesado"
async function uploadFilesToFolder(parentFolderName, selectedFilePaths = null) {
  uiLog('log', 'uploadFilesToFolder:start', { parentFolderName });
  try {
    const preQueuedItems = (Array.isArray(selectedFilePaths) && selectedFilePaths.length > 0
      && selectedFilePaths.every(item => item && typeof item === 'object' && item.filePath))
      ? selectedFilePaths
      : null;

    const filePaths = preQueuedItems
      ? preQueuedItems.map(item => item.filePath)
      : ((Array.isArray(selectedFilePaths) && selectedFilePaths.length > 0)
        ? selectedFilePaths
        : await ipcRenderer.invoke('select-file'));
    uiLog('log', 'uploadFilesToFolder:selected-files', { count: filePaths?.length || 0 });

    if (filePaths && filePaths.length > 0) {
      try {
        showStatus('Comprobando carpetas estándar en Drive...', 'loading');
        await ipcRenderer.invoke('ensure-standard-folders');
        showStatus('Carpetas estándar verificadas en Drive.', 'success');
      } catch (folderError) {
        showStatus(
          'Error al verificar carpetas estándar en Drive.',
          'error',
          folderError?.message || String(folderError || '')
        );
        console.warn('No se pudieron crear carpetas estándar:', folderError);
      }
      const docType = 'auto';
      const parentFolder = await findFolderByName('Albaranes', true);
      if (!parentFolder) {
        showStatus('No se encontró la estructura de documentos en Drive.', 'error');
        return;
      }

      const target = await getOrCreateNoProcesadoFolder(parentFolder.id);
      uiLog('log', 'uploadFilesToFolder:target-folder', {
        parentFolderName,
        targetId: target?.id
      });
      const targetLabel = 'Documentos pendientes de clasificar';

      let noComparadoFolder = null;
      let documentosFolder = null;
      let facturasNoComparadoFolder = null;
      let facturasDocumentosFolder = null;
      try {
        noComparadoFolder = await getOrCreateChildFolder(parentFolder.id, 'No comparado');
        documentosFolder = await getOrCreateChildFolder(parentFolder.id, 'Documentos');
        const facturasFolder = await findFolderByName('Facturas', true);
        if (!facturasFolder) throw new Error('No se encontró la carpeta Facturas');
        facturasNoComparadoFolder = await getOrCreateChildFolder(facturasFolder.id, 'No comparado');
        facturasDocumentosFolder = await getOrCreateChildFolder(facturasFolder.id, 'Documentos');
      } catch (folderError) {
        console.warn('No se pudo preparar la estructura de documentos:', folderError);
        showStatus('No se pudo preparar la estructura de documentos en Drive.', 'error', folderError?.message || '');
        return;
      }

      const preparedItems = [];

      for (let fileIndex = 0; fileIndex < filePaths.length; fileIndex += 1) {
        const p = filePaths[fileIndex];
        const fileName = pathBasename(p);
        const queueId = preQueuedItems?.[fileIndex]?.queueId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        if (!preQueuedItems?.[fileIndex]) {
          initQueueItem(queueId, fileName, { docType });
        }

        if (canceledQueueIds.has(queueId)) {
          markQueueCancelled(queueId);
          showStatus(`${fileName} cancelado antes de subir.`, 'success');
          continue;
        }

        try {
          const mimeType = guessMimeTypeFromPath(p);
          updateQueueStep(queueId, 'Comprobando duplicado');
          showStatus(`Comprobando si ${fileName} ya fue procesado...`, 'loading');
          const fileHashMeta = await ipcRenderer.invoke('calculate-file-hash', p, fileName, mimeType);
          const duplicateCheck = await ipcRenderer.invoke('check-duplicate-file', fileHashMeta);
          if (duplicateCheck?.duplicate) {
            const shouldProcessAgain = await showDuplicateProcessedConfirm(fileName, duplicateCheck);
            if (!shouldProcessAgain) {
              markQueueCancelled(queueId, 'Omitido por duplicado');
              showStatus(`${fileName} ya estaba procesado y se ha omitido.`, 'success');
              continue;
            }
          }

          updateQueueStep(queueId, 'Subiendo');
          showStatus(`Subiendo ${fileName}...`, 'loading');
          const uploadResult = await ipcRenderer.invoke('upload-file', p, target.id);
          if (!uploadResult || !uploadResult.success) {
            throw new Error('Error al subir archivo');
          }

          preparedItems.push({
            filePath: p,
            fileName,
            queueId,
            mimeType,
            fileSha256: fileHashMeta.fileSha256,
            fileSize: fileHashMeta.fileSize,
            uploadResult,
            uploadedFileId: uploadResult?.file?.id || uploadResult?.fileId || uploadResult?.id
          });
        } catch (error) {
          markQueueError(queueId, error.message || 'Error desconocido');
          showStatus(`Error al subir ${fileName}: ${error.message}`, 'error');
        }
      }

      if (preparedItems.length > 0) {
        uiLog('log', 'uploadFilesToFolder:analyzing-items', {
          parentFolderName,
          count: preparedItems.length,
          docType
        });
        // Registrar el ID del archivo subido en Drive (no ruta local) para poder
        // borrar exactamente ese archivo si se cancela antes de finalizar la IA.
        // Además, filtrar cancelados justo antes de enviar al batch de IA.
        const itemsForIA = [];
        preparedItems.forEach(item => {
          if (item.uploadedFileId) queueFilePathMap.set(item.queueId, item.uploadedFileId);

          if (canceledQueueIds.has(item.queueId)) {
            markQueueCancelled(item.queueId, 'Cancelado por el usuario');
            return;
          }

          updateQueueStep(item.queueId, 'IA');
          itemsForIA.push(item);
        });

        const batchResults = await invokeAnalyzeFilesBatchWithFallback(
          itemsForIA.map(item => ({
            filePath: item.filePath,
            mimeType: item.mimeType,
            originalName: item.fileName,
            queueId: item.queueId,
            postProcess: {
              sourceDriveFileId: item.uploadedFileId || null,
              sourceDriveFromFolderId: target?.id || null,
              sourceFileName: item.fileName,
              fileSha256: item.fileSha256 || null,
              fileSize: item.fileSize ?? null,
              facturaSourceDriveToFolderId: facturasNoComparadoFolder?.id || null,
              albaranSourceDriveToFolderId: noComparadoFolder?.id || null
            }
          })),
          docType
        );

        for (let idx = 0; idx < itemsForIA.length; idx += 1) {
          const item = itemsForIA[idx];
          const analysisResult = batchResults[idx] || null;

          try {
            // Si fue cancelado durante la IA (resultado devuelto como cancelled)
            if (analysisResult?.cancelled) {
              markQueueCancelled(item.queueId, 'Cancelado por el usuario');
              showStatus(`${item.fileName} cancelado.`, 'success');
              queueFilePathMap.delete(item.queueId);
              continue;
            }

            if (canceledQueueIds.has(item.queueId)) {
              markQueueCancelled(item.queueId);
              showStatus(`${item.fileName} cancelado.`, 'success');
              queueFilePathMap.delete(item.queueId);
              continue;
            }

            const analysisSuccess = Boolean(
              analysisResult
              && analysisResult.success !== false
              && (analysisResult.analysis || analysisResult?.raw?.analysis)
            );
            if (!analysisSuccess) {
              throw new Error(analysisResult?.error || 'Error al analizar archivo');
            }

            const detectedDocType = analysisResult?.raw?.documentType || analysisResult?.documentType || docType;
            uiLog('log', 'uploadFilesToFolder:item-analysis-ok', {
              fileName: item.fileName,
              docType: detectedDocType
            });

            const analysisText = analysisResult.analysis || analysisResult?.raw?.analysis || '';

            if (canceledQueueIds.has(item.queueId)) {
              markQueueCancelled(item.queueId);
              showStatus(`${item.fileName} cancelado.`, 'success');
              continue;
            }

            try {
              const qualityEmail = await sendExtractionQualityEmailIfNeeded({
                item,
                detectedDocType,
                analysisResult,
                analysisText
              });
              if (qualityEmail?.skipped === false) {
                showStatus(`Aviso de errores de extracción enviado para ${item.fileName}.`, 'loading');
              }
            } catch (emailError) {
              console.warn('No se pudo enviar email de errores de extracción:', emailError);
              showStatus(`No se pudo enviar aviso de errores para ${item.fileName}.`, 'error');
            }

            if (detectedDocType === 'factura') {
              try {
                updateQueueStep(item.queueId, 'Comparando');
                const comparison = await ipcRenderer.invoke('compare-invoice-database', {
                  driveFileId: item.uploadedFileId || null
                });
                const result = comparison?.result || {};
                if (result.pending || result.needsReview) {
                  updateQueueStep(item.queueId, 'Finalizado');
                  showStatus(`${item.fileName} se ha procesado y queda en No comparado hasta que BBDD tenga los albaranes relacionados.`, 'success');
                  continue;
                }

                try {
                  const comparisonEmail = await sendDatabaseComparisonEmailIfNeeded(comparison);
                  if (comparisonEmail?.skipped === false) {
                    showStatus(`Email de comparación enviado para ${item.fileName}.`, 'loading');
                  }
                } catch (emailError) {
                  console.warn('No se pudo enviar email de comparación de factura:', emailError);
                  showStatus(`No se pudo enviar email de comparación para ${item.fileName}.`, 'error');
                }

                await moveDatabaseComparisonDocuments(comparison, {
                  facturasDocumentosFolderId: facturasDocumentosFolder?.id || null,
                  facturasNoComparadoFolderId: facturasNoComparadoFolder?.id || null,
                  albaranesDocumentosFolderId: documentosFolder?.id || null,
                  albaranesNoComparadoFolderId: noComparadoFolder?.id || null
                });
                updateQueueStep(item.queueId, 'Comparado');
                updateQueueStep(item.queueId, 'Finalizado');
                showStatus(
                  result.ok
                    ? `${item.fileName} comparada correctamente por BBDD.`
                    : `${item.fileName} comparada por BBDD con incongruencias.`,
                  result.ok ? 'success' : 'error'
                );
                continue;

                // Flujo TXT/Drive sustituido por la comparación anterior en BBDD.
                updateQueueStep(item.queueId, 'Comparando');
                const compareResult = await ipcRenderer.invoke('compare-factura-albaranes', {
                  facturaAnalysisText: analysisText,
                  rootFolderName: parentFolderName,
                  // SOLICITUD CLIENTE: forzar compare por totales.
                  // compareMode: currentCompareMode
                  compareMode: 'totales'
                });
                updateQueueStep(item.queueId, 'comparado');

                uiLog('log', 'uploadFilesToFolder:factura-compare-result', {
                  fileName: item.fileName,
                  ok: compareResult?.ok,
                  issues: compareResult?.issues?.length || 0,
                  matchedAlbaranes: compareResult?.matchedAlbaranes?.length || 0
                });

                updateQueueStep(item.queueId, 'email');

                const facturaRef = getFacturaReferenceForEmail(analysisText, item.fileName || 'XX');
                const albaranesLabel = getComparedAlbaranesLabel(compareResult);
                // SOLICITUD CLIENTE: email solo por totales (sin bloques de IA extra).
                // const confidenceLines = buildModelConfidenceEmailLines(analysisText);
                // const extractionWarningsLines = buildExtractionWarningsEmailLines(analysisText);
                const recipientEmail = await getCurrentSessionEmail();
                // const criticalAlert = buildCriticalAlertContext(compareResult, analysisText);
                const facturaTotalValue = parseComparableNumber(compareResult?.facturaTotal ?? extractFacturaTotalFromAnalysis(analysisText));
                const albaranesTotalValue = parseComparableNumber(compareResult?.sumatoriaTotalesAlbaranes);
                const facturaTotalLabel = formatAmountEuro(facturaTotalValue);
                const albaranesTotalLabel = formatAmountEuro(albaranesTotalValue);
                const totalsByAlbaranLines = buildAlbaranTotalsComparisonLines(compareResult, item.fileName || '');
                const htmlTotalsByAlbaran = toHtmlList(
                  totalsByAlbaranLines,
                  formatAlbaranTotalComparisonLineHtml,
                  'No disponible'
                );

                if (compareResult && !compareResult.ok) {
                  try {
                    const facturaDriveLink = buildDriveFileLink(item.uploadedFileId);
                    const incongruentAlbaranLinks = buildIncongruentAlbaranesLinks(compareResult);
                    const congruentAlbaranSummary = buildCongruentAlbaranesSummary(compareResult);
                    // SOLICITUD CLIENTE: no incluir detalles no-totales en email.
                    // const compareIssues = buildPrimaryEmailIssueLines(compareResult, criticalAlert.severeAlbaranes)
                    //   .map(addEuroSymbolToAmounts);
                    const compareMessage = addEuroSymbolToAmounts(compareResult.message || 'Se encontraron incongruencias.');
                    const htmlIncongruentLinks = toHtmlList(
                      incongruentAlbaranLinks,
                      formatIncongruentAlbaranLineHtml,
                      'No disponible'
                    );
                    const htmlCongruentSummary = toHtmlList(
                      congruentAlbaranSummary,
                      formatCongruentAlbaranLineHtml,
                      'No disponible'
                    );
                    // const htmlIssues = compareIssues.length
                    //   ? compareIssues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')
                    //   : '<li>Sin detalle adicional</li>';

                    await ipcRenderer.invoke('send-email', {
                      to: recipientEmail,
                      subject: `⚠️ ${item.fileName || 'Factura'} Incongruencias encontradas en factura ${facturaRef}`,
                      text: [
                        'ALERTA DE COMPARACIÓN: FACTURA CON INCONGRUENCIAS',
                        '',
                        `Factura comparada: ${facturaRef}`,
                        `Nombre archivo factura: ${item.fileName || 'N/A'}`,
                        `Albaranes comparados: ${albaranesLabel}`,
                        `Total factura: ${facturaTotalLabel}`,
                        `Total albaranes: ${albaranesTotalLabel}`,
                        '',
                        '=== TOTALES POR ALBARÁN (CON ARCHIVOS ORIGEN) ===',
                        ...totalsByAlbaranLines,
                        '',
                        '=== FACTURA ORIGINAL ===',
                        `Link factura original: ${facturaDriveLink || 'No disponible'}`,
                        '',
                        '=== ALBARANES CON INCONGRUENCIAS (número y nombre) ===',
                        'Links albaranes con incongruencias:',
                        ...incongruentAlbaranLinks,
                        '',
                        '=== ALBARANES CORRECTOS (número y nombre) ===',
                        'Albaranes correctos (número y nombre guardado):',
                        ...congruentAlbaranSummary,
                        '',
                        '=== RESUMEN DE COMPARACIÓN ===',
                        compareMessage,
                      ].join('\n'),
                      html: `
                        <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5; max-width: 760px;">
                          <h2 style="margin: 0 0 12px; color: #8a1c1c;">⚠️ <strong>Incongruencias encontradas</strong></h2>

                          <div style="background:#f8f9fb; border:1px solid #e6e9ef; border-radius:8px; padding:12px; margin-bottom:12px;">
                            <p style="margin:0 0 6px;"><strong>Factura comparada:</strong> <strong>${escapeHtml(facturaRef)}</strong></p>
                            <p style="margin:0 0 6px;"><strong>Nombre archivo factura:</strong> <strong>${escapeHtml(item.fileName || 'N/A')}</strong></p>
                            <p style="margin:0 0 6px;"><strong>Albaranes comparados:</strong> <strong>${escapeHtml(albaranesLabel)}</strong></p>
                            <p style="margin:0 0 6px;"><strong>Total factura:</strong> <strong>${escapeHtml(facturaTotalLabel)}</strong></p>
                            <p style="margin:0;"><strong>Total albaranes:</strong> <strong>${escapeHtml(albaranesTotalLabel)}</strong></p>
                          </div>

                          <h3 style="margin:14px 0 8px; font-size:15px;">📊 Totales por albarán (con archivos origen)</h3>
                          <ul style="margin-top:0;">${htmlTotalsByAlbaran}</ul>

                          <div style="margin: 14px 0;">
                            <h3 style="margin:0 0 8px; font-size:15px;">📄 Factura original</h3>
                            <p style="margin:0;">${facturaDriveLink ? `<a href="${escapeHtml(facturaDriveLink)}">Abrir factura en Drive</a>` : 'No disponible'}</p>
                          </div>

                          <hr style="border:none; border-top:1px solid #eceff3; margin:16px 0;" />

                          <h3 style="margin:0 0 8px; font-size:15px;">❌ Albaranes con incongruencias</h3>
                          <ul style="margin-top:0;">${htmlIncongruentLinks}</ul>

                          <h3 style="margin:14px 0 8px; font-size:15px;">✅ Albaranes correctos</h3>
                          <ul style="margin-top:0;">${htmlCongruentSummary}</ul>

                          <div style="margin: 14px 0;">
                            <h3 style="margin:0 0 8px; font-size:15px;">📌 Resumen</h3>
                            <p style="margin:0;">${escapeHtml(compareMessage)}</p>
                          </div>
                        </div>
                      `
                    });
                    showStatus(`Email de incongruencias enviado para ${item.fileName}`, 'success');
                    // SOLICITUD CLIENTE: no enviar email adicional basado en confianza IA / reglas no-totales.
                  } catch (emailError) {
                    console.error('Error enviando email de incongruencias:', emailError);
                    showStatus(`No se pudo enviar email de incongruencias: ${emailError.message || emailError}`, 'error');
                    throw emailError;
                  }
                } else if (compareResult?.ok) {
                  try {
                    const congruentAlbaranSummary = buildCongruentAlbaranesSummary(compareResult);
                    const htmlCongruentSummary = toHtmlList(
                      congruentAlbaranSummary,
                      formatCongruentAlbaranLineHtml,
                      'No disponible'
                    );
                    const subjectOk = `✅ ${item.fileName || 'Factura'} Sin incongruencias en factura ${facturaRef}`;
                    await ipcRenderer.invoke('send-email', {
                      to: recipientEmail,
                      subject: subjectOk,
                      text: [
                        'VALIDACIÓN COMPLETADA: FACTURA CORRECTA',
                        '',
                        `Factura comparada: ${facturaRef}`,
                        `Nombre archivo factura: ${item.fileName || 'N/A'}`,
                        `Albaranes comparados: ${albaranesLabel}`,
                        `Total factura: ${facturaTotalLabel}`,
                        `Total albaranes: ${albaranesTotalLabel}`,
                        '',
                        '=== TOTALES POR ALBARÁN (CON ARCHIVOS ORIGEN) ===',
                        ...totalsByAlbaranLines,
                        '',
                        '=== ALBARANES CORRECTOS (número y nombre) ===',
                        'Albaranes correctos (número y nombre guardado):',
                        ...congruentAlbaranSummary,
                        'Se han comparado correctamente y todo bien.'
                      ].join('\n'),
                      html: `
                        <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5; max-width: 760px;">
                          <h2 style="margin: 0 0 12px; color: #17693a;">✅ <strong>Factura validada correctamente</strong></h2>

                          <div style="background:#f6fbf8; border:1px solid #dcefe3; border-radius:8px; padding:12px; margin-bottom:12px;">
                            <p style="margin:0 0 6px;"><strong>Factura comparada:</strong> <strong>${escapeHtml(facturaRef)}</strong></p>
                            <p style="margin:0 0 6px;"><strong>Nombre archivo factura:</strong> <strong>${escapeHtml(item.fileName || 'N/A')}</strong></p>
                            <p style="margin:0 0 6px;"><strong>Albaranes comparados:</strong> <strong>${escapeHtml(albaranesLabel)}</strong></p>
                            <p style="margin:0 0 6px;"><strong>Total factura:</strong> <strong>${escapeHtml(facturaTotalLabel)}</strong></p>
                            <p style="margin:0;"><strong>Total albaranes:</strong> <strong>${escapeHtml(albaranesTotalLabel)}</strong></p>
                          </div>

                          <h3 style="margin:14px 0 8px; font-size:15px;">✅ Albaranes correctos</h3>
                          <ul style="margin-top:0;">${htmlCongruentSummary}</ul>

                          <h3 style="margin:14px 0 8px; font-size:15px;">📊 Totales por albarán (con archivos origen)</h3>
                          <ul style="margin-top:0;">${htmlTotalsByAlbaran}</ul>

                          <p style="margin-top:12px;"><em>Se han comparado correctamente y todo bien.</em></p>
                        </div>
                      `
                    });
                    showStatus(`Email de validación enviado para ${item.fileName}`, 'success');
                    // SOLICITUD CLIENTE: no enviar email adicional por baja confianza IA.
                  } catch (emailOkError) {
                    console.error('Error enviando email de validación:', emailOkError);
                    showStatus(`No se pudo enviar email de validación: ${emailOkError.message || emailOkError}`, 'error');
                    throw emailOkError;
                  }
                }

                if (documentosFolder?.id) {
                  const shouldMoveFactura = compareResult?.ok
                    || (compareResult?.matchedAlbaranes && compareResult.matchedAlbaranes.length > 0);
                  if (shouldMoveFactura) {
                    const targetId = documentosFolder.id;
                    const removeId = noComparadoFolder?.id || target.id;
                    if (item.uploadedFileId) {
                      await ipcRenderer.invoke('move-file', item.uploadedFileId, [targetId], removeId ? [removeId] : []);
                    }
                  }
                }
              } catch (compareError) {
                uiLog('error', 'uploadFilesToFolder:compare-error', {
                  fileName: item.fileName,
                  error: serializeUiError(compareError)
                });
                console.warn('Error comparando factura con albaranes:', compareError);
                throw compareError;
              }
            }

            if (detectedDocType === 'albaran') {
              const affectedInvoiceIds = analysisResult?.raw?.persistence?.invoicesReadyForComparison
                ?.map((invoice) => invoice?.id)
                .filter(Boolean) || [];
              if (affectedInvoiceIds.length) {
                updateQueueStep(item.queueId, 'Comparando');
                const selectedComparison = await compareSelectedInvoicesByDatabaseAndMove(affectedInvoiceIds, {
                  facturasDocumentosFolderId: facturasDocumentosFolder?.id || null,
                  facturasNoComparadoFolderId: facturasNoComparadoFolder?.id || null,
                  albaranesDocumentosFolderId: documentosFolder?.id || null,
                  albaranesNoComparadoFolderId: noComparadoFolder?.id || null
                });
                if (selectedComparison?.failed) {
                  console.warn('Algunas facturas afectadas por el albarán no pudieron compararse por BBDD:', selectedComparison.failedItems);
                }
                updateQueueStep(item.queueId, 'Comparado');
              }
            }

            updateQueueStep(item.queueId, 'Finalizado');
            showStatus(`${item.fileName} se ha procesado correctamente.`, 'success');

          } catch (error) {
            uiLog('error', 'uploadFilesToFolder:item-error', {
              fileName: item.fileName,
              error: serializeUiError(error)
            });
            markQueueError(item.queueId, error.message || 'Error desconocido');
            showStatus(`Error al procesar ${item.fileName}: ${error.message}`, 'error');
          }
        }

      }
    }
  } catch (error) {
    uiLog('error', 'uploadFilesToFolder:error', serializeUiError(error));
    showStatus('Error al subir archivo: ' + error.message, 'error');
  }
}

function queueUploadsAsWaiting(parentFolderName, filePaths = []) {
  const docType = 'auto';
  return filePaths.map((filePath) => {
    const fileName = pathBasename(filePath);
    const queueId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    initQueueItem(queueId, fileName, { docType });
    return { filePath, fileName, queueId };
  });
}

async function scheduleUploadFlow(parentFolderName, selectedFilePaths = null, sourceMode = 'auto') {
  const rawPaths = (Array.isArray(selectedFilePaths) && selectedFilePaths.length > 0)
    ? selectedFilePaths
    : (sourceMode === 'folder'
      ? await ipcRenderer.invoke('select-folder')
      : await ipcRenderer.invoke('select-file'));

  const filePaths = expandPathsRecursively(rawPaths || []);

  if (!filePaths || !filePaths.length) {
    showStatus('No se detectaron archivos válidos en la selección (carpeta o archivos).', 'error');
    return;
  }

  const queuedItems = queueUploadsAsWaiting(parentFolderName, filePaths);
  await enqueueUploadFlow(
    () => uploadFilesToFolder(parentFolderName, queuedItems),
    { label: parentFolderName }
  );
}

if (fileUpload) {
  fileUpload.addEventListener('click', async () => {
    await scheduleUploadFlow('Albaranes');
  });
}

let searchDebounce = null;

function renderSearchResults(items = [], query = '') {
  if (!searchResults) return;

  const trimmed = query.trim();
  if (!trimmed) {
    searchResults.classList.remove('active');
    searchResults.innerHTML = '';
    return;
  }

  searchResults.classList.add('active');
  searchResults.innerHTML = '';

  if (!items.length) {
    searchResults.innerHTML = '<p style="color:#666">No se encontraron documentos.</p>';
    return;
  }

  items.forEach(item => {
    const wrapper = document.createElement('div');
    wrapper.className = 'search-result-item';

    const title = document.createElement('div');
    title.className = 'search-result-title';
    title.textContent = item.name || 'Documento';

    const path = document.createElement('div');
    path.className = 'search-result-path';
    const folderPath = item.folderPath || 'Mi unidad';
    path.textContent = folderPath;

    const actions = document.createElement('div');
    actions.className = 'search-result-actions';

    const openFileBtn = document.createElement('button');
    openFileBtn.className = 'btn small';
    openFileBtn.textContent = 'Abrir archivo';
    openFileBtn.addEventListener('click', () => {
      if (!item.id) return;
      const url = `https://drive.google.com/file/d/${item.id}/view`;
      ipcRenderer.invoke('open-external', url);
    });

    const openFolderBtn = document.createElement('button');
    openFolderBtn.className = 'btn small btn-secondary';
    openFolderBtn.textContent = 'Abrir carpeta';
    openFolderBtn.addEventListener('click', async () => {
      if (!item.parentId) return;
      await loadFolderContents(item.parentId, true, item.parentName || 'Carpeta');
    });

    actions.appendChild(openFileBtn);
    actions.appendChild(openFolderBtn);

    wrapper.appendChild(title);
    wrapper.appendChild(path);
    wrapper.appendChild(actions);
    searchResults.appendChild(wrapper);
  });
}

async function performSearch(query) {
  const trimmed = query.trim();
  uiLog('log', 'performSearch:start', { query: trimmed });
  if (!trimmed) {
    renderSearchResults([], '');
    return;
  }

  try {
    const response = await ipcRenderer.invoke('search-drive-files', trimmed);
    const items = Array.isArray(response?.files) ? response.files : [];
    uiLog('log', 'performSearch:ok', { query: trimmed, results: items.length });
    renderSearchResults(items, trimmed);
  } catch (error) {
    uiLog('error', 'performSearch:error', {
      query: trimmed,
      error: serializeUiError(error)
    });
    console.error('Error en búsqueda:', error);
    renderSearchResults([], trimmed);
    showStatus('No se pudo completar la búsqueda', 'error');
  }
}

if (searchInput) {
  searchInput.addEventListener('input', (event) => {
    const value = event.target.value || '';
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      performSearch(value);
    }, 350);
  });
}

// Crear carpeta en Drive (desde UI)
const createFolderBtn = document.getElementById('create-folder-btn');
const createFolderNameInput = document.getElementById('create-folder-name');
const shareBtn = document.getElementById('share-btn');
const shareEmailsInput = document.getElementById('share-emails');

if (createFolderBtn) {
  createFolderBtn.addEventListener('click', async () => {
    const name = createFolderNameInput.value.trim();
    if (!name) { showStatus('Por favor ingresa un nombre de carpeta', 'error'); return; }

    try {
      createFolderBtn.textContent = 'Creando...';
      createFolderBtn.disabled = true;
      const res = await ipcRenderer.invoke('create-folder', name, null);
      showStatus('Carpeta creada: ' + (res.folderName || res.folderId), 'success');
      createFolderNameInput.value = '';
      // Reload folder tree and current contents
      await loadFolderTree();
      await loadFolderContents(currentFolderId, false);
    } catch (err) {
      showStatus('Error al crear carpeta: ' + err.message, 'error');
    } finally {
      createFolderBtn.textContent = 'Crear carpeta';
      createFolderBtn.disabled = false;
    }
  });
}

if (shareBtn) {
  shareBtn.addEventListener('click', async () => {
    const emailsText = shareEmailsInput.value.trim();
    if (!emailsText) { showStatus('Por favor ingresa al menos un email', 'error'); return; }
    const emails = emailsText.split(',').map(e => e.trim()).filter(e => e);
    if (emails.length === 0) { showStatus('Emails inválidos', 'error'); return; }

    try {
      shareBtn.textContent = 'Compartiendo...';
      shareBtn.disabled = true;
      // compartir la carpeta actualmente seleccionada
      const folderToShare = currentFolderId || null;
      await ipcRenderer.invoke('share-folder', emails, folderToShare);
      showStatus('Carpeta compartida exitosamente', 'success');
      shareEmailsInput.value = '';
    } catch (err) {
      showStatus('Error al compartir: ' + err.message, 'error');
    } finally {
      shareBtn.textContent = 'Compartir acceso';
      shareBtn.disabled = false;
    }
  });
}

// Navegación de carpetas y listado de archivos (mejorado)
let currentFolderId = null;
let breadcrumb = [];
let folderTreeData = null;

async function loadFolderTree() {
  uiLog('log', 'loadFolderTree:start');
  try {
    const res = await ipcRenderer.invoke('list-folders');
    const folders = Array.isArray(res) ? res : (res.folders || []);

    // Build tree structure
    const tree = {};
    const nodes = {};

    // Create nodes
    folders.forEach(f => {
      nodes[f.id] = { ...f, children: [], expanded: false };
    });

    // Build hierarchy
    folders.forEach(f => {
      const parentId = f.parents && f.parents[0];
      if (parentId && nodes[parentId]) {
        nodes[parentId].children.push(nodes[f.id]);
      } else {
        // Root level
        tree[f.id] = nodes[f.id];
      }
    });
    // Sort children of every node alphabetically for consistent order
    Object.values(nodes).forEach(n => {
      if (n.children && n.children.length > 0) {
        n.children.sort((a, b) => (a.name || '').toString().localeCompare((b.name || '').toString()));
      }
    });

    folderTreeData = tree;
    uiLog('log', 'loadFolderTree:ok', {
      totalFolders: Object.keys(nodes).length,
      rootFolders: Object.keys(tree).length
    });
    return tree;
  } catch (err) {
    uiLog('error', 'loadFolderTree:error', serializeUiError(err));
    console.error('Error loading folder tree:', err);
    return {};
  }
}

async function findFolderByName(targetName, rootOnly = false) {
  try {
    if (rootOnly) {
      const res = await ipcRenderer.invoke('list-contents', null);
      const items = res.files || [];
      return items.find(item => item.mimeType === 'application/vnd.google-apps.folder'
        && (item.name || '').toLowerCase() === targetName.toLowerCase()) || null;
    }

    const res = await ipcRenderer.invoke('list-folders');
    const folders = Array.isArray(res) ? res : (res.folders || []);
    return folders.find(f => (f.name || '').toLowerCase() === targetName.toLowerCase()) || null;
  } catch (err) {
    console.error('Error buscando carpeta:', err);
    return null;
  }
}

async function getOrCreateNoProcesadoFolder(parentId) {
  try {
    const res = await ipcRenderer.invoke('list-contents', parentId);
    const folders = (res.files || []).filter(item => item.mimeType === 'application/vnd.google-apps.folder');
    let noProcesado = folders.find(folder => (folder.name || '').toLowerCase() === 'no procesado');

    if (!noProcesado) {
      const created = await ipcRenderer.invoke('create-folder', 'No procesado', parentId);
      noProcesado = { id: created.folderId, name: created.folderName || 'No procesado' };
    }

    return noProcesado;
  } catch (error) {
    console.error('Error obteniendo/creando No procesado:', error);
    throw new Error('Error al encontrar o crear carpeta No procesado');
  }
}

async function getOrCreateChildFolder(parentId, childName) {
  const res = await ipcRenderer.invoke('list-contents', parentId);
  const folders = (res.files || []).filter(item => item.mimeType === 'application/vnd.google-apps.folder');
  let target = folders.find(folder => (folder.name || '').toLowerCase() === childName.toLowerCase());

  if (!target) {
    const created = await ipcRenderer.invoke('create-folder', childName, parentId);
    target = { id: created.folderId, name: created.folderName || childName };
  }

  return target;
}

async function getOrCreateInformesNoComparadoFolder(parentFolderName) {
  let informesRoot = await findFolderByName('Informes - No tocar', true);
  if (!informesRoot) {
    const createdInformesRoot = await ipcRenderer.invoke('create-folder', 'Informes - No tocar', null);
    informesRoot = {
      id: createdInformesRoot.folderId,
      name: createdInformesRoot.folderName || 'Informes - No tocar'
    };
  }

  const informesSubfolderName = (parentFolderName || '').toLowerCase().includes('factura')
    ? 'Facturas-Informes'
    : 'Albaranes-Informes';

  const informesSubfolder = await getOrCreateChildFolder(informesRoot.id, informesSubfolderName);
  await getOrCreateChildFolder(informesSubfolder.id, 'No Procesado');
  await getOrCreateChildFolder(informesSubfolder.id, 'Documentos-Informes');
  return getOrCreateChildFolder(informesSubfolder.id, 'No Comparado');
}

async function navigateToFolderByName(targetName, rootOnly = false) {
  const folder = await findFolderByName(targetName, rootOnly);
  if (!folder) {
    showStatus(`No se encontró la carpeta "${targetName}" en Drive`, 'error');
    return;
  }
  await loadFolderContents(folder.id, true, folder.name);
}

function renderFolderTree(container, tree, currentFolderId, level = 0) {
  container.innerHTML = '';

  // Add "Mi unidad" root
  const rootEl = document.createElement('div');
  rootEl.style.paddingLeft = '0px';
  rootEl.style.cursor = 'pointer';
  rootEl.style.fontWeight = (!currentFolderId) ? 'bold' : 'normal';
  rootEl.textContent = '📁 Mi unidad';
  rootEl.addEventListener('click', () => loadFolderContents(null, true, 'Mi unidad'));
  container.appendChild(rootEl);

  // Render tree roots in sorted order for stable UI
  const roots = Object.values(tree || {}).sort((a, b) => (a.name || '').toString().localeCompare((b.name || '').toString()));
  roots.forEach(node => {
    renderTreeNode(container, node, currentFolderId, level + 1);
  });
}

// Helper: check if a node (or any descendant) has id === targetId
function nodeContains(node, targetId) {
  if (!targetId) return false;
  if (node.id === targetId) return true;
  for (const child of node.children || []) {
    if (nodeContains(child, targetId)) return true;
  }
  return false;
}

function renderTreeNode(container, node, currentFolderId, level) {
  const el = document.createElement('div');
  el.style.paddingLeft = (level * 20) + 'px';
  el.style.cursor = 'pointer';
  el.style.fontWeight = (node.id === currentFolderId) ? 'bold' : 'normal';

  const toggleIcon = node.children.length > 0 ? (node.expanded ? '📂' : '📁') : '📄';
  el.innerHTML = `${toggleIcon} ${node.name}`;
  // Auto-expand this branch if it contains the current folder
  if (currentFolderId && nodeContains(node, currentFolderId)) {
    node.expanded = true;
  }
  // Open folder on click. If it has children, expand it and navigate into it.
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    node.expanded = true;
    loadFolderContents(node.id, true, node.name);
  });

  container.appendChild(el);

  if (node.expanded && node.children.length > 0) {
    node.children.forEach(child => {
      renderTreeNode(container, child, currentFolderId, level + 1);
    });
  }
}

async function loadFolderContents(folderId = null, pushToBreadcrumb = true, folderName = null) {
  uiLog('log', 'loadFolderContents:start', {
    folderId,
    pushToBreadcrumb,
    folderName
  });
  setDatabasePanelVisible(false);
  setFoodOrderPanelVisible(false);
  try {
    const res = await ipcRenderer.invoke('list-contents', folderId);
    const files = res.files || [];
    const folderIdUsed = res.folderId || folderId || null;
    currentFolderId = folderIdUsed;

    // actualizar breadcrumbs
    if (pushToBreadcrumb) {
      // If navigating to root, reset breadcrumb to single root entry
      if (!folderIdUsed) {
        breadcrumb = [{ id: null, name: 'Mi unidad' }];
      } else {
        // If this folder already exists in breadcrumb, trim to it
        const existingIndex = breadcrumb.findIndex(b => b && b.id === folderIdUsed);
        if (existingIndex >= 0) {
          breadcrumb = breadcrumb.slice(0, existingIndex + 1);
        } else {
          breadcrumb.push({ id: folderIdUsed, name: folderName || 'Carpeta' });
        }
      }
    }
    renderBreadcrumbs();

    // Ocultar la opción de compartir cuando estamos en la raíz de Drive ('root' o null)
    try {
      const shareBtnEl = document.getElementById('share-btn');
      const shareInputEl = document.getElementById('share-emails');
      if (shareBtnEl && shareInputEl) {
        if (folderIdUsed === 'root' || folderIdUsed === null) {
          shareBtnEl.style.display = 'none';
          shareInputEl.style.display = 'none';
        } else {
          shareBtnEl.style.display = '';
          shareInputEl.style.display = '';
        }
      }
    } catch (e) {
      console.warn('No se pudo ajustar visibilidad de compartir:', e);
    }

    const folders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
    const docs = files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
    uiLog('log', 'loadFolderContents:ok', {
      folderId: folderIdUsed,
      total: files.length,
      folders: folders.length,
      files: docs.length
    });

    const folderTree = document.getElementById('folder-tree');
    const folderSummary = document.getElementById('folder-summary');
    const filesList = document.getElementById('files-list');

    // Render full folder tree (if present)
    if (folderTree && folderTreeData) {
      renderFolderTree(folderTree, folderTreeData, currentFolderId);
    }

    // Render lightweight summary instead of full file list
    const currentName = (breadcrumb[breadcrumb.length - 1] && breadcrumb[breadcrumb.length - 1].name)
      ? breadcrumb[breadcrumb.length - 1].name
      : (folderName || 'Mi unidad');
    const total = files.length;
    const folderCount = folders.length;
    const fileCount = docs.length;
    if (folderSummary) {
      const summaryHtml = `
        <h4 style="margin-bottom:8px;">${currentName}</h4>
        <p style="color:#555; margin-bottom:6px;">Contenido total: <strong>${total}</strong></p>
        <p style="color:#666; margin-bottom:4px;">Carpetas: <strong>${folderCount}</strong></p>
        <p style="color:#666;">Archivos: <strong>${fileCount}</strong></p>
      `;

      folderSummary.innerHTML = summaryHtml;
    }

    const currentNameLower = (currentName || '').toLowerCase();
    const showFiles = currentNameLower !== 'mi unidad';

    if (filesList) {
      if (!showFiles) {
        filesList.innerHTML = '';
        filesList.style.display = 'none';
      } else {
        filesList.style.display = '';
        filesList.innerHTML = '';
        const items = [...folders, ...docs];
        if (items.length === 0) {
          filesList.innerHTML = '<p style="color:#666">Esta carpeta está vacía</p>';
        }

        items.forEach(item => {
          const tile = document.createElement('div');
          tile.className = 'file-tile';
          const isFolder = item.mimeType === 'application/vnd.google-apps.folder';

          const icon = document.createElement('div');
          icon.textContent = isFolder ? '📁' : '📄';
          icon.style.fontSize = '20px';

          const name = document.createElement('div');
          name.className = 'name';
          name.textContent = item.name;

          const meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = isFolder ? 'Carpeta' : `${item.mimeType || ''} ${formatBytes(item.size)}`;

          const actions = document.createElement('div');
          actions.style.marginTop = 'auto';
          if (isFolder) {
            const openBtn = document.createElement('button');
            openBtn.className = 'btn small';
            openBtn.textContent = 'Abrir';
            openBtn.addEventListener('click', () => loadFolderContents(item.id, true, item.name));
            actions.appendChild(openBtn);
          } else {
            const openBtn = document.createElement('button');
            openBtn.className = 'btn small';
            openBtn.textContent = 'Abrir';
            openBtn.addEventListener('click', () => {
              const url = `https://drive.google.com/file/d/${item.id}/view`;
              ipcRenderer.invoke('open-external', url);
            });
            actions.appendChild(openBtn);
          }

          tile.appendChild(icon);
          tile.appendChild(name);
          tile.appendChild(meta);
          tile.appendChild(actions);
          filesList.appendChild(tile);
        });
      }
    }

  } catch (err) {
    uiLog('error', 'loadFolderContents:error', serializeUiError(err));
    showStatus('Error cargando carpeta: ' + (err.message || err), 'error');
  }
}

function renderBreadcrumbs() {
  const bc = document.getElementById('breadcrumbs');
  if (!bc) return;
  bc.innerHTML = '';
  breadcrumb.forEach((b, idx) => {
    const span = document.createElement('span');
    span.style.cursor = 'pointer';
    span.style.marginRight = '8px';
    span.textContent = (b.name || 'Carpeta') + (idx < breadcrumb.length - 1 ? ' /' : '');
    span.addEventListener('click', () => {
      if (b.id === '__database__') {
        loadDatabaseView(databaseViewerState.selectedTable?.name || null);
        return;
      }
      if (b.id === '__food_orders__') {
        loadFoodOrderView();
        return;
      }
      // go to this breadcrumb
      breadcrumb = breadcrumb.slice(0, idx + 1);
      loadFolderContents(b.id, false, b.name);
    });
    bc.appendChild(span);
  });

  // Also update sidebar path if present so user can jump from the left panel
  const sp = document.getElementById('sidebar-path');
  if (sp) {
    sp.innerHTML = '';
    breadcrumb.forEach((b, idx) => {
      const s = document.createElement('span');
      s.style.cursor = 'pointer';
      s.style.marginRight = '6px';
      s.style.color = '#333';
      s.textContent = b.name || 'Carpeta';
      s.addEventListener('click', () => {
        if (b.id === '__database__') {
          loadDatabaseView(databaseViewerState.selectedTable?.name || null);
          return;
        }
        if (b.id === '__food_orders__') {
          loadFoodOrderView();
          return;
        }
        breadcrumb = breadcrumb.slice(0, idx + 1);
        loadFolderContents(b.id, false, b.name);
      });
      sp.appendChild(s);
      if (idx < breadcrumb.length - 1) {
        const sep = document.createElement('span');
        sep.textContent = ' / ';
        sep.style.color = '#777';
        sp.appendChild(sep);
      }
    });
  }
}

// When showing upload section initially, load root or session.folderId
async function showUploadSection(info) {
  uiLog('log', 'showUploadSection:start', { email: info?.email });
  showSection('upload');
  document.getElementById('user-email').textContent = info.email;
  try {
    const appVersion = await ipcRenderer.invoke('get-app-version');
    if (appVersionEl) {
      appVersionEl.textContent = `Versión ${appVersion || '--'}`;
    }
  } catch {
    if (appVersionEl) {
      appVersionEl.textContent = 'Versión --';
    }
  }

  await refreshUpdaterStatus();

  const billingConfig = await ipcRenderer.invoke('get-billing-config');
  setBillingEmailLabel(billingConfig?.email || null);

  // Load the full folder tree
  await loadFolderTree();

  // start breadcrumb with root
  breadcrumb = [];
  // Use Drive root as "Mi unidad" (null) so the breadcrumb represents the real root
  const rootId = null;
  breadcrumb.push({ id: rootId, name: 'Mi unidad' });
  await loadFolderContents(null, false, 'Mi unidad');
  uiLog('log', 'showUploadSection:done');
}

// Enlazar botones de menú lateral
menuButtons.forEach(button => {
  button.addEventListener('click', async () => {
    const action = button.dataset.action;
    if (action === 'open-albaranes') {
      await navigateToFolderByName('Albaranes', true);
      return;
    }
    if (action === 'open-facturas') {
      await navigateToFolderByName('Facturas', true);
      return;
    }
    if (action === 'upload-documents') {
      openUploadDropModal('Documentos');
      return;
    }
  });
});

// Enlazar tarjetas principales
tileButtons.forEach(tile => {
  tile.addEventListener('click', async () => {
    const action = tile.dataset.action;
    if (tile.classList.contains('disabled')) {
      return;
    }
    if (action === 'bases-datos') {
      await loadDatabaseView(databaseViewerState.selectedTable?.name || null);
      return;
    }
    if (action === 'pedir') {
      await loadFoodOrderView();
      return;
    }

    if (action === 'facturas') {
      await navigateToFolderByName('Facturas', true);
      return;
    }
    if (action === 'albaranes') {
      await navigateToFolderByName('Albaranes', true);
      return;
    }
  });
});

function pathBasename(p) {
  try { return p.split(/[\\/]/).pop(); } catch (e) { return p; }
}

function extractFilePathsFromDataTransfer(dataTransfer) {
  if (!dataTransfer || !dataTransfer.files) return [];
  const rawPaths = Array.from(dataTransfer.files)
    .map(file => file?.path)
    .filter(Boolean);
  return expandPathsRecursively(rawPaths);
}

function bindDropHandlers(element, onDrop) {
  if (!element) return;
  const preventDefaults = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  element.addEventListener('dragenter', (event) => {
    preventDefaults(event);
    element.classList.add('drag-over');
  });

  element.addEventListener('dragover', (event) => {
    preventDefaults(event);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    element.classList.add('drag-over');
  });

  element.addEventListener('dragleave', (event) => {
    preventDefaults(event);
    element.classList.remove('drag-over');
  });

  element.addEventListener('drop', async (event) => {
    preventDefaults(event);
    element.classList.remove('drag-over');

    const droppedFilePaths = extractFilePathsFromDataTransfer(event.dataTransfer);
    if (!droppedFilePaths.length) {
      showStatus('No se detectaron archivos válidos para subir.', 'error');
      return;
    }

    if (typeof onDrop === 'function') {
      await onDrop(droppedFilePaths);
    }
  });
}

function openUploadDropModal(parentFolderName) {
  if (!uploadDropModal || !uploadDropZone) {
    scheduleUploadFlow(parentFolderName);
    return;
  }

  currentUploadTargetFolder = parentFolderName;
  if (uploadDropTitle) {
    uploadDropTitle.textContent = 'Subir documentos';
  }
  uploadDropZone.classList.remove('drag-over');
  uploadDropZoneFiles?.classList.remove('drag-over');
  uploadDropModal.classList.add('active');
}

function closeUploadDropModal() {
  if (!uploadDropModal) return;
  uploadDropModal.classList.remove('active');
  currentUploadTargetFolder = null;
}

if (uploadDropClose) {
  uploadDropClose.addEventListener('click', closeUploadDropModal);
}

if (uploadDropModal) {
  uploadDropModal.addEventListener('click', (event) => {
    if (event.target === uploadDropModal) {
      closeUploadDropModal();
    }
  });
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && uploadDropModal?.classList.contains('active')) {
    closeUploadDropModal();
  }
});

if (uploadDropZone) {
  uploadDropZone.addEventListener('click', async () => {
    const target = currentUploadTargetFolder;
    if (!target) return;
    closeUploadDropModal();
    await scheduleUploadFlow(target, null, 'folder');
  });

  bindDropHandlers(uploadDropZone, async (droppedFilePaths) => {
    const target = currentUploadTargetFolder;
    if (!target) return;
    closeUploadDropModal();
    await scheduleUploadFlow(target, droppedFilePaths);
  });
}

if (uploadDropZoneFiles) {
  uploadDropZoneFiles.addEventListener('click', async () => {
    const target = currentUploadTargetFolder;
    if (!target) return;
    closeUploadDropModal();
    await scheduleUploadFlow(target, null, 'file');
  });

  bindDropHandlers(uploadDropZoneFiles, async (droppedFilePaths) => {
    const target = currentUploadTargetFolder;
    if (!target) return;
    closeUploadDropModal();
    await scheduleUploadFlow(target, droppedFilePaths);
  });
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed( (i===0)?0:1 ) + ' ' + sizes[i];
}

async function chooseFolderForFile(filePath) {
  const name = pathBasename(filePath);
  const folderId = await ipcRenderer.invoke('choose-folder', name);
  if (!folderId) throw new Error('Operación cancelada o sin selección');
  return folderId;
}

// Botón atrás
const backBtn = document.getElementById('back-btn');
if (backBtn) {
  backBtn.addEventListener('click', () => {
    if (breadcrumb.length > 1) {
      breadcrumb.pop();
      const prev = breadcrumb[breadcrumb.length - 1];
      loadFolderContents(prev.id, false, prev.name);
    }
  });
}

// Cerrar sesión
logoutBtn.addEventListener('click', async () => {
  uiLog('log', 'logout button:click');
  if (confirm('¿Estás seguro de que quieres cerrar sesión?')) {
    uiLog('log', 'logout confirmed');
    await ipcRenderer.invoke('logout');
  }
});

// (showUploadSection está implementada arriba con navegación mejorada)


function showStatus(message, type, details = '') {
  uiLog(type === 'error' ? 'error' : 'log', 'showStatus', { message, type });
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${type}`;
  status.style.display = 'block';

  if (type === 'error') {
    showBackendAlert(message, details || 'showStatus');
  }

  if (type === 'success' || type === 'error') {
    setTimeout(() => { status.style.display = 'none'; }, 5000);
  }
}

function toggleStartupOverlay(isVisible, message) {
  if (!startupOverlay) return;
  if (message && startupOverlayMessage) {
    startupOverlayMessage.textContent = message;
  }
  startupOverlay.classList.toggle('active', Boolean(isVisible));
}

ipcRenderer.on('startup-status', (event, payload) => {
  if (!startupStatusEl) return;
  const message = payload?.message || 'Estado de inicio: esperando...';
  uiLog('log', 'event:startup-status', { message });
  startupStatusEl.textContent = message;
  // Mantener el indicador pequeño dentro de la UI durante el escaneo
  toggleStartupOverlay(false);
});

ipcRenderer.on('updater-status', (event, payload) => {
  renderUpdaterStatus(payload || {});
});

ipcRenderer.on('queue-event', (event, payload) => {
  if (!payload || !payload.id) return;
  uiLog('log', 'event:queue-event', {
    id: payload.id,
    type: payload.type,
    step: payload.step,
    fileName: payload.fileName,
    message: payload.message
  });

  if (payload.type === 'init') {
    initQueueItem(payload.id, payload.fileName || 'Archivo', {
      source: payload.source,
      docType: payload.docType,
      steps: payload.steps
    });
    return;
  }

  if (payload.type === 'step') {
    updateQueueStep(payload.id, payload.step);
    return;
  }

  if (payload.type === 'error') {
    markQueueError(payload.id, payload.message || 'Error');
  }
});

function initQueueItem(id, fileName, options = {}) {
  const steps = resolveQueueSteps(options);
  uploadQueue.set(id, { fileName, status: 'En cola', error: null, steps });
  renderQueue();
}

function updateQueueStep(id, step) {
  const item = uploadQueue.get(id);
  if (!item) return;
  if (item.status === 'Cancelado') return;
  const normalizedStep = normalizeQueueStep(step);

  item.status = normalizedStep;
  item.error = null;
  uploadQueue.set(id, item);
  if (!canQueueItemBeSelectedForBulkCancel(item)) {
    selectedQueueIds.delete(id);
  }
  renderQueue();
}

function markQueueCancelled(id, message = 'Cancelado por el usuario') {
  const item = uploadQueue.get(id);
  if (!item) return;
  item.status = 'Cancelado';
  item.error = message;
  uploadQueue.set(id, item);
  canceledQueueIds.add(id);
  selectedQueueIds.delete(id);

  // Señalar al proceso principal que cancele el job de IA si estaba en curso
  try { ipcRenderer.send('cancel-queue-item', id); } catch (e) {}

  // Eliminar el archivo de Drive (No procesado) si fue subido y el proceso se canceló
  // antes de que el pipeline de IA lo procesara. Se usa el ID exacto del archivo (nunca
  // el nombre) para evitar borrar un archivo con el mismo nombre pero diferente.
  const driveFileId = queueFilePathMap.get(id);
  if (driveFileId) {
    ipcRenderer.invoke('delete-drive-file', driveFileId).catch((e) => {
      uiLog('error', 'markQueueCancelled:delete-drive-file:error', serializeUiError(e));
    });
  }
  queueFilePathMap.delete(id);

  renderQueue();
}

function requestCancelQueueItem(id) {
  const item = uploadQueue.get(id);
  if (!item) return;

  if (!canQueueItemBeCancelled(item)) {
    return;
  }

  const confirmed = confirm(`¿Seguro que quieres cancelar ${item.fileName}?`);
  if (!confirmed) return;

  markQueueCancelled(id);
}

function markQueueError(id, message) {
  const item = uploadQueue.get(id);
  if (!item) return;
  item.status = 'Error';
  item.error = message || 'Error';
  uploadQueue.set(id, item);
  selectedQueueIds.delete(id);
  renderQueue();
}

function toggleQueueItemSelection(id) {
  const item = uploadQueue.get(id);
  if (!canQueueItemBeSelectedForBulkCancel(item)) {
    selectedQueueIds.delete(id);
    renderQueue();
    return;
  }

  if (selectedQueueIds.has(id)) {
    selectedQueueIds.delete(id);
  } else {
    selectedQueueIds.add(id);
  }
  renderQueue();
}

function toggleSelectAllEligibleQueueItems() {
  const eligibleIds = Array.from(uploadQueue.entries())
    .filter(([, item]) => canQueueItemBeSelectedForBulkCancel(item))
    .map(([id]) => id);

  if (!eligibleIds.length) return;

  const allSelected = eligibleIds.every((id) => selectedQueueIds.has(id));
  if (allSelected) {
    eligibleIds.forEach((id) => selectedQueueIds.delete(id));
  } else {
    eligibleIds.forEach((id) => selectedQueueIds.add(id));
  }

  renderQueue();
}

function requestCancelSelectedQueueItems() {
  const idsToCancel = Array.from(selectedQueueIds)
    .filter((id) => canQueueItemBeSelectedForBulkCancel(uploadQueue.get(id)));

  if (!idsToCancel.length) {
    showStatus('No hay archivos seleccionados para cancelar.', 'error');
    return;
  }

  const confirmed = confirm(`¿Seguro que quieres cancelar ${idsToCancel.length} archivo(s) seleccionados?`);
  if (!confirmed) return;

  idsToCancel.forEach((id) => markQueueCancelled(id));
  showStatus(`${idsToCancel.length} archivo(s) cancelado(s).`, 'success');
}

function renderQueue() {
  if (!queueList) return;

  const eligibleIds = Array.from(uploadQueue.entries())
    .filter(([, item]) => canQueueItemBeSelectedForBulkCancel(item))
    .map(([id]) => id);

  if (queueBulkControls) {
    queueBulkControls.classList.toggle('hidden', eligibleIds.length === 0);
  }

  if (queueSelectAllBtn) {
    const allEligibleSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selectedQueueIds.has(id));
    queueSelectAllBtn.textContent = allEligibleSelected ? 'Deseleccionar todo' : 'Seleccionar todo';
  }

  Array.from(selectedQueueIds).forEach((id) => {
    if (!canQueueItemBeSelectedForBulkCancel(uploadQueue.get(id))) {
      selectedQueueIds.delete(id);
    }
  });

  if (uploadQueue.size === 0) {
    queueList.innerHTML = '<p style="color:#666">Aún no has subido documentos.</p>';
    queueCompletionNotified = false;
    selectedQueueIds.clear();
    refreshQueueTimeEstimate();
    return;
  }

  queueList.innerHTML = '';
  Array.from(uploadQueue.entries()).forEach(([id, item]) => {
    const steps = Array.isArray(item.steps) && item.steps.length > 0
      ? item.steps
      : DEFAULT_QUEUE_STEPS;
    const currentIndex = steps.indexOf(item.status);
    const isTerminalSuccess = isQueueTerminalSuccessStatus(item.status);

    const wrapper = document.createElement('div');
    wrapper.className = 'queue-item';

    const headerRow = document.createElement('div');
    headerRow.className = 'queue-item-header';

    const leftRow = document.createElement('div');
    leftRow.className = 'queue-item-left';

    const canSelectForBulk = canQueueItemBeSelectedForBulkCancel(item);
    if (canSelectForBulk) {
      const selectCb = document.createElement('input');
      selectCb.type = 'checkbox';
      selectCb.className = 'queue-select-checkbox';
      selectCb.checked = selectedQueueIds.has(id);
      selectCb.title = `Seleccionar ${item.fileName}`;
      selectCb.setAttribute('aria-label', `Seleccionar ${item.fileName}`);
      selectCb.addEventListener('change', () => toggleQueueItemSelection(id));
      leftRow.appendChild(selectCb);
    }

    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = item.fileName;
    leftRow.appendChild(name);
    headerRow.appendChild(leftRow);

    const statusRow = document.createElement('div');
    statusRow.className = 'status-row';

    steps.forEach(step => {
      const stepEl = document.createElement('div');
      stepEl.className = 'queue-step';
      stepEl.textContent = step;

      if (item.status === 'Error') {
        stepEl.classList.add('error');
      } else if (item.status === 'Cancelado') {
        stepEl.classList.add('error');
      } else if (isTerminalSuccess) {
        stepEl.classList.add('done');
      } else if (item.status === step) {
        stepEl.classList.add('active');
      } else if (currentIndex >= 0 && steps.indexOf(step) < currentIndex) {
        stepEl.classList.add('done');
      }

      statusRow.appendChild(stepEl);
    });

    if (item.error) {
      const errorText = document.createElement('div');
      errorText.style.color = item.status === 'Cancelado' ? '#856404' : '#721c24';
      errorText.style.fontSize = '12px';
      errorText.textContent = `${item.status === 'Cancelado' ? 'Cancelado' : 'Error'}: ${item.error}`;
      wrapper.appendChild(errorText);
    }

    const canCancel = canQueueItemBeCancelled(item);
    if (canCancel) {
      const controls = document.createElement('div');
      controls.style.display = 'flex';
      controls.style.justifyContent = 'flex-end';
      controls.style.alignItems = 'center';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.title = `Cancelar ${item.fileName}`;
      cancelBtn.setAttribute('aria-label', `Cancelar ${item.fileName}`);
      cancelBtn.textContent = '✕';
      cancelBtn.style.width = '28px';
      cancelBtn.style.height = '28px';
      cancelBtn.style.minWidth = '28px';
      cancelBtn.style.borderRadius = '50%';
      cancelBtn.style.border = '2px solid #dc3545';
      cancelBtn.style.background = '#dc3545';
      cancelBtn.style.color = '#fff';
      cancelBtn.style.cursor = 'pointer';
      cancelBtn.style.fontSize = '15px';
      cancelBtn.style.fontWeight = '700';
      cancelBtn.style.lineHeight = '1';
      cancelBtn.style.display = 'inline-flex';
      cancelBtn.style.alignItems = 'center';
      cancelBtn.style.justifyContent = 'center';
      cancelBtn.style.padding = '0';
      cancelBtn.addEventListener('click', () => requestCancelQueueItem(id));
      cancelBtn.addEventListener('mouseenter', () => {
        cancelBtn.style.background = '#bb2d3b';
        cancelBtn.style.borderColor = '#bb2d3b';
      });
      cancelBtn.addEventListener('mouseleave', () => {
        cancelBtn.style.background = '#dc3545';
        cancelBtn.style.borderColor = '#dc3545';
      });

      controls.appendChild(cancelBtn);
      headerRow.appendChild(controls);
    }

    wrapper.appendChild(headerRow);
    wrapper.appendChild(statusRow);

    queueList.appendChild(wrapper);
  });

  const allFinished = Array.from(uploadQueue.values()).every((item) => TERMINAL_QUEUE_STATUSES.has(item.status));
  if (allFinished && !queueCompletionNotified) {
    queueCompletionNotified = true;
    ipcRenderer.invoke('notify-tasks-completed').catch((error) => {
      uiLog('error', 'notify-tasks-completed:error', serializeUiError(error));
    });
  } else if (!allFinished) {
    queueCompletionNotified = false;
  }

  refreshQueueTimeEstimate();
}

if (queueSelectAllBtn) {
  queueSelectAllBtn.addEventListener('click', toggleSelectAllEligibleQueueItems);
}

if (queueCancelSelectedBtn) {
  queueCancelSelectedBtn.addEventListener('click', requestCancelSelectedQueueItems);
}
