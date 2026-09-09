if (typeof CONFIG === 'undefined') {
  console.error('MinuteHand: config.js not found. Copy config.example.js to config.js and fill in your Supabase credentials.');
}

const generateBtn    = document.getElementById('generate-btn');
const notesInput     = document.getElementById('notes-input');
const templateSelect = document.getElementById('template-select');
const formSection    = document.getElementById('form-section');
const resultSection  = document.getElementById('result-section');
const minutesPreview = document.getElementById('minutes-preview');
const downloadBtn    = document.getElementById('download-btn');
const resetBtn       = document.getElementById('reset-btn');
const errorMsg       = document.getElementById('error-msg');
const dropZone       = document.getElementById('drop-zone');
const docxInput      = document.getElementById('docx-input');
const browseBtn      = document.getElementById('browse-btn');
const fileStatus     = document.getElementById('file-status');

let currentMinutesMarkdown = '';

// ── .docx upload ──────────────────────────────────────────────────────────────

browseBtn.addEventListener('click', () => docxInput.click());
dropZone.addEventListener('click', (e) => { if (e.target !== browseBtn) docxInput.click(); });

docxInput.addEventListener('change', () => {
  if (docxInput.files[0]) loadDocx(docxInput.files[0]);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadDocx(file);
});

async function loadDocx(file) {
  if (!file.name.endsWith('.docx')) {
    setFileStatus('Only .docx files are supported.', 'error');
    return;
  }

  setFileStatus('Reading…', '');

  try {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    notesInput.value = result.value.trim();
    setFileStatus(`✓ ${file.name} imported`, 'success');
  } catch {
    setFileStatus('Could not read file. Is it a valid .docx?', 'error');
  }
}

function setFileStatus(msg, type) {
  fileStatus.textContent = msg;
  fileStatus.className = `file-status ${type}`;
  fileStatus.classList.remove('hidden');
}

// ── Generate ──────────────────────────────────────────────────────────────────

generateBtn.addEventListener('click', async () => {
  const notes = notesInput.value.trim();
  if (!notes) {
    showError('Please paste your meeting notes before generating.');
    return;
  }

  setLoading(true);
  hideError();

  try {
    const resp = await fetch(`${CONFIG.supabaseUrl}/functions/v1/generate-minutes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.supabaseAnonKey}`,
        'apikey': CONFIG.supabaseAnonKey,
      },
      body: JSON.stringify({ notes, template: templateSelect.value }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Server error (${resp.status})`);
    }

    const data = await resp.json();
    currentMinutesMarkdown = data.minutes;
    renderMinutes(data.minutes);
    showResult();
  } catch (err) {
    showError(err.message || 'Something went wrong. Please try again.');
  } finally {
    setLoading(false);
  }
});

// ── Download .docx ────────────────────────────────────────────────────────────

downloadBtn.addEventListener('click', () => {
  if (!currentMinutesMarkdown) return;

  const bodyHtml = marked.parse(currentMinutesMarkdown);
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body        { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.6; color: #000; }
  h1          { font-size: 13pt; text-align: center; text-transform: uppercase; margin-bottom: 4pt; }
  h2          { font-size: 11pt; text-transform: uppercase; border-bottom: 1px solid #ccc; padding-bottom: 2pt; margin-top: 14pt; margin-bottom: 4pt; }
  h3          { font-size: 11pt; font-weight: bold; margin-top: 8pt; margin-bottom: 2pt; }
  p           { margin-bottom: 6pt; }
  table       { width: 100%; border-collapse: collapse; margin: 8pt 0; }
  th, td      { border: 1px solid #aaa; padding: 4pt 6pt; font-size: 10pt; vertical-align: top; }
  th          { background: #f0f0f0; font-weight: bold; }
  ul, ol      { margin: 4pt 0 6pt 18pt; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;

  const blob = htmlDocx.asBlob(fullHtml);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `meeting-minutes-${today()}.docx`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── Reset ─────────────────────────────────────────────────────────────────────

resetBtn.addEventListener('click', () => {
  resultSection.classList.add('hidden');
  formSection.classList.remove('hidden');
  currentMinutesMarkdown = '';
  fileStatus.classList.add('hidden');
  docxInput.value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderMinutes(markdown) {
  minutesPreview.innerHTML = marked.parse(markdown);
}

function showResult() {
  formSection.classList.add('hidden');
  resultSection.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setLoading(on) {
  generateBtn.disabled = on;
  generateBtn.textContent = on ? 'Generating…' : 'Generate Minutes';

  const existing = document.getElementById('loading-row');
  if (on && !existing) {
    const row = document.createElement('div');
    row.id = 'loading-row';
    row.className = 'loading-row';
    row.innerHTML = '<div class="spinner"></div><span>This usually takes 15–30 seconds…</span>';
    generateBtn.insertAdjacentElement('afterend', row);
  } else if (!on && existing) {
    existing.remove();
  }
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.classList.add('hidden');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
