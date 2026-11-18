const crypto = require('crypto');

const TERMINAL_STATUSES = new Set(['Completado', 'Error', 'Cancelado']);

function progressScope(backend, organizationId, email) {
  if (!organizationId || !email) throw new Error('No se pudo identificar la organización de la cola');
  return crypto.createHash('sha256').update(JSON.stringify([backend, organizationId, email])).digest('hex');
}

function createAnalysisProgress(store) {
  function list(scope) {
    return store.get(`queues.${scope}`, []);
  }

  function get(scope, id) {
    return list(scope).find(item => item.queueId === id) || null;
  }

  function save(scope, id, patch) {
    if (!scope || !id) throw new Error('Cola sin identificar');
    const items = list(scope);
    const index = items.findIndex(item => item.queueId === id);
    const current = index < 0 ? {} : items[index];
    const next = { ...current, ...patch, queueId: id, updatedAt: Date.now() };
    // Nunca guardar tokens de sesión incluidos en respuestas antiguas del backend.
    if (next.analysisResult?.raw) {
      const { sessionId, ...raw } = next.analysisResult.raw;
      next.analysisResult = { ...next.analysisResult, raw };
    }
    if (index < 0) items.push(next);
    else items[index] = next;
    store.set(`queues.${scope}`, items);
    return next;
  }

  return { list, get, save };
}

function queueStepForJob(status) {
  if (status === 'pending') return 'En cola';
  if (status === 'processing') return 'Analizando';
  // La comparación y el movimiento aún pueden estar pendientes en Electron.
  if (status === 'done') return 'Comparando';
  if (status === 'error') return 'Error';
  if (status === 'cancelled') return 'Cancelado';
  return null;
}

module.exports = { createAnalysisProgress, progressScope, queueStepForJob, TERMINAL_STATUSES };