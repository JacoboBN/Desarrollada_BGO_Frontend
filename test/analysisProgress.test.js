const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createAnalysisProgress, progressScope, queueStepForJob, TERMINAL_STATUSES } = require('../lib/analysisProgress');

function memoryStore() {
  const data = new Map();
  return {
    get: (key, fallback) => JSON.parse(JSON.stringify(data.get(key) ?? fallback)),
    set: (key, value) => data.set(key, JSON.parse(JSON.stringify(value)))
  };
}

test('100 documentos: solo el activo analiza y cada resultado sobrevive a una interrupción', () => {
  const store = memoryStore();
  let progress = createAnalysisProgress(store);
  for (let i = 0; i < 100; i += 1) progress.save('org', String(i), { status: 'En cola' });
  for (let i = 0; i < 37; i += 1) {
    progress.save('org', String(i), { status: queueStepForJob('processing') });
    assert.equal(progress.list('org').filter(item => item.status === 'Analizando').length, 1);
    progress.save('org', String(i), { status: i === 5 ? 'Error' : 'Completado' });
    progress = createAnalysisProgress(store);
  }
  assert.equal(progress.list('org').filter(item => !TERMINAL_STATUSES.has(item.status)).length, 63);
  assert.equal(progress.list('org').filter(item => item.status === 'Completado').length, 36);
});

test('checkpoint conserva subida, job y resultado sin tokens entre reinicios', () => {
  const store = memoryStore();
  const progress = createAnalysisProgress(store);
  progress.save('org', 'doc', { preparedItem: { uploadedFileId: 'drive' }, jobId: 'job' });
  progress.save('org', 'doc', {
    analysisResult: { success: true, raw: { sessionId: 'no-guardar', analysis: 'resultado' } }
  });
  const recovered = createAnalysisProgress(store).get('org', 'doc');
  assert.equal(recovered.jobId, 'job');
  assert.equal(recovered.preparedItem.uploadedFileId, 'drive');
  assert.equal(recovered.analysisResult.raw.analysis, 'resultado');
  assert.equal(recovered.analysisResult.raw.sessionId, undefined);
});

test('la cola queda aislada por backend, organización y usuario', () => {
  const scope = progressScope('backend', 'org', 'usuario');
  assert.notEqual(scope, progressScope('otro', 'org', 'usuario'));
  assert.notEqual(scope, progressScope('backend', 'otra', 'usuario'));
  assert.notEqual(scope, progressScope('backend', 'org', 'otro'));
  assert.throws(() => progressScope('backend', null, 'usuario'));
  const progress = createAnalysisProgress(memoryStore());
  progress.save(scope, 'doc', { status: 'Completado' });
  assert.deepEqual(progress.list('otra'), []);
});

test('un fallo de persistencia no se oculta', () => {
  const progress = createAnalysisProgress({ get: () => [], set: () => { throw new Error('disco'); } });
  assert.throws(() => progress.save('org', 'doc', { status: 'Completado' }), /disco/);
});

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
function mainFunction(name, next, mocks) {
  const start = mainSource.indexOf(`async function ${name}(`);
  const end = mainSource.indexOf(`\n${next}`, start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext(mocks);
  vm.runInContext(`${mainSource.slice(start, end)}\nthis.run = ${name};`, context);
  return context.run;
}

test('polling real: pending no analiza, processing sí y done guarda antes de devolver', async () => {
  const jobs = [{ status: 'pending' }, { status: 'processing' }, { status: 'done', result: { analysis: 'ok' } }];
  const events = [];
  const progress = createAnalysisProgress(memoryStore());
  const poll = mainFunction('pollJobResult', 'async function moveDriveFileWithBackoff', {
    JOB_POLL_INTERVAL_MS: 1, JOB_POLL_MAX_ATTEMPTS: 5, DEFAULT_TIMEOUT_MS: 1,
    BACKEND_URL: 'test', store: { get: () => 'session' }, sleep: async () => {}, mainLog: () => {},
    axios: { get: async () => ({ data: jobs.shift() }) }, queueStepForJob, analysisProgress: progress,
    emitToRenderer: (channel, payload) => events.push(payload)
  });
  assert.equal((await poll('job', { queueId: 'doc', scope: 'org' })).analysis, 'ok');
  assert.deepEqual(events.map(event => event.step), ['En cola', 'Analizando', 'Comparando']);
  assert.equal(progress.get('org', 'doc').analysisResult.raw.analysis, 'ok');
});

test('recuperación real reutiliza el resultado o consulta el job sin reenviar archivo', async () => {
  const progress = createAnalysisProgress(memoryStore());
  let polls = 0;
  const analyze = mainFunction('analyzeFileWithBackendIA', 'function sleep', {
    store: { get: () => 'session' }, analysisProgress: progress, mainLog: () => {},
    activeJobsByQueueId: new Map(), pollJobResult: async () => { polls += 1; return { analysis: 'job existente' }; }
  });
  progress.save('org', 'doc', { jobId: 'job' });
  assert.equal((await analyze('ausente.pdf', '', '', 'auto', null, 'doc', 'org')).analysis, 'job existente');
  progress.save('org', 'doc', { analysisResult: { success: true, raw: { analysis: 'guardado' } } });
  assert.equal((await analyze('ausente.pdf', '', '', 'auto', null, 'doc', 'org')).analysis, 'guardado');
  assert.equal(polls, 1);
});

test('el planificador de interfaz termina y guarda cada documento antes de iniciar el siguiente', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'user.js'), 'utf8');
  const start = source.indexOf('async function scheduleUploadFlow(');
  const end = source.indexOf('\nif (fileUpload)', start);
  const paths = Array.from({ length: 100 }, (_, i) => `documento-${i}.pdf`);
  const events = [];
  const context = vm.createContext({
    expandPathsRecursively: value => value,
    queueUploadsAsWaiting: (folder, values) => values.map(filePath => ({ filePath })),
    progressWriteTail: Promise.resolve(),
    enqueueUploadFlow: task => task(),
    uploadFilesToFolder: async (folder, items) => {
      assert.equal(items.length, 1);
      events.push(`inicio:${items[0].filePath}`);
      context.progressWriteTail = new Promise(resolve => setImmediate(() => {
        events.push(`guardado:${items[0].filePath}`);
        resolve();
      }));
    }
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.run = scheduleUploadFlow;`, context);
  await context.run('Albaranes', paths);
  assert.deepEqual(events, paths.flatMap(file => [`inicio:${file}`, `guardado:${file}`]));
});

test('polling distingue error y cancelación y persiste ambos sin marcarlos completados', async () => {
  for (const status of ['error', 'cancelled']) {
    const progress = createAnalysisProgress(memoryStore());
    const poll = mainFunction('pollJobResult', 'async function moveDriveFileWithBackoff', {
      JOB_POLL_INTERVAL_MS: 1, JOB_POLL_MAX_ATTEMPTS: 1, DEFAULT_TIMEOUT_MS: 1,
      BACKEND_URL: 'test', store: { get: () => 'session' }, sleep: async () => {}, mainLog: () => {},
      axios: { get: async () => ({ data: { status, error: 'incidencia' } }) },
      queueStepForJob, analysisProgress: progress, emitToRenderer: () => {}
    });
    await assert.rejects(() => poll('job', { scope: 'org', queueId: 'doc' }), /incidencia/);
    assert.equal(progress.get('org', 'doc').status, status === 'error' ? 'Error' : 'Cancelado');
  }
});