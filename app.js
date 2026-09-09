if (typeof CONFIG === 'undefined') {
  console.error('MinuteHand: config.js not found. Copy config.example.js to config.js and fill in your Supabase credentials.');
}

// ── Element refs ──────────────────────────────────────────────────────────────

const generateBtn      = document.getElementById('generate-btn');
const notesInput       = document.getElementById('notes-input');
const notesLabel       = document.getElementById('notes-label');
const notesHint        = document.getElementById('notes-hint');
const templateSelect   = document.getElementById('template-select');
const formSection      = document.getElementById('form-section');
const speakerSection   = document.getElementById('speaker-section');
const resultSection    = document.getElementById('result-section');
const minutesPreview   = document.getElementById('minutes-preview');
const downloadBtn      = document.getElementById('download-btn');
const resetBtn         = document.getElementById('reset-btn');
const errorMsg         = document.getElementById('error-msg');

// .docx upload
const dropZone         = document.getElementById('drop-zone');
const docxInput        = document.getElementById('docx-input');
const browseBtn        = document.getElementById('browse-btn');
const fileStatus       = document.getElementById('file-status');

// audio upload
const audioDropZone    = document.getElementById('audio-drop-zone');
const audioInput       = document.getElementById('audio-input');
const audioBrowseBtn   = document.getElementById('audio-browse-btn');
const audioStatus      = document.getElementById('audio-status');
const uploadProgressWrap = document.getElementById('upload-progress-wrap');
const uploadBar        = document.getElementById('upload-bar');
const uploadLabel      = document.getElementById('upload-label');

// speaker confirmation
const speakerSection_  = speakerSection; // alias for clarity
const speakerCount     = document.getElementById('speaker-count');
const speakerList      = document.getElementById('speaker-list');
const confirmSpeakersBtn = document.getElementById('confirm-speakers-btn');
const backToFormBtn    = document.getElementById('back-to-form-btn');
const speakerErrorMsg  = document.getElementById('speaker-error-msg');

// ── State ─────────────────────────────────────────────────────────────────────

let audioFile              = null; // File object
let pendingRawTranscript   = '';   // transcript with "Speaker N:" labels
let pendingSpeakers        = [];   // [{id, label, guessedName}]
let currentMinutesMarkdown = '';

// ── .docx upload ──────────────────────────────────────────────────────────────

browseBtn.addEventListener('click', () => docxInput.click());
dropZone.addEventListener('click', (e) => { if (e.target !== browseBtn) docxInput.click(); });
docxInput.addEventListener('change', () => { if (docxInput.files[0]) loadDocx(docxInput.files[0]); });

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadDocx(file);
});

async function loadDocx(file) {
  if (!file.name.endsWith('.docx')) {
    setFileStatus(fileStatus, 'Only .docx files are supported.', 'error');
    return;
  }
  setFileStatus(fileStatus, 'Reading…', '');
  try {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    notesInput.value = result.value.trim();
    setFileStatus(fileStatus, `✓ ${file.name} imported`, 'success');
  } catch {
    setFileStatus(fileStatus, 'Could not read file. Is it a valid .docx?', 'error');
  }
}

// ── Audio upload ──────────────────────────────────────────────────────────────

audioBrowseBtn.addEventListener('click', () => audioInput.click());
audioDropZone.addEventListener('click', (e) => { if (e.target !== audioBrowseBtn) audioInput.click(); });
audioInput.addEventListener('change', () => {
  if (audioInput.files[0]) selectAudioFile(audioInput.files[0]);
});

audioDropZone.addEventListener('dragover', (e) => { e.preventDefault(); audioDropZone.classList.add('drag-over'); });
audioDropZone.addEventListener('dragleave', () => audioDropZone.classList.remove('drag-over'));
audioDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  audioDropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) selectAudioFile(file);
});

function selectAudioFile(file) {
  const allowed = ['audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/webm','video/mp4'];
  const byExt = /\.(mp3|m4a|wav|ogg|webm|mp4)$/i.test(file.name);
  if (!allowed.includes(file.type) && !byExt) {
    setFileStatus(audioStatus, 'Unsupported file type. Use .mp3, .m4a, or .wav.', 'error');
    return;
  }
  audioFile = file;
  const mb = (file.size / 1024 / 1024).toFixed(1);
  setFileStatus(audioStatus, `✓ ${file.name} (${mb} MB) — ready`, 'success');

  // Adjust notes textarea to be supplementary
  notesLabel.textContent = 'Additional notes or agenda (optional)';
  notesHint.textContent = 'Anything not captured in the recording — e.g. a pre-meeting agenda .docx or written notes.';
  notesInput.placeholder = 'Paste any supplementary notes or agenda here… (optional)';
}

// ── Main generate flow ────────────────────────────────────────────────────────

generateBtn.addEventListener('click', async () => {
  const notes = notesInput.value.trim();

  if (!audioFile && !notes) {
    showError('Please add meeting notes or upload an audio recording.');
    return;
  }

  hideError();

  if (audioFile) {
    await runAudioFlow(notes);
  } else {
    await runGenerateFlow(notes);
  }
});

async function runAudioFlow(supplementaryNotes) {
  let filename;

  // 1. Upload to Supabase Storage
  try {
    setLoadingBtn(generateBtn, true, 'Uploading…');
    uploadProgressWrap.classList.remove('hidden');
    filename = await uploadAudioToStorage(audioFile);
    uploadProgressWrap.classList.add('hidden');
  } catch (err) {
    uploadProgressWrap.classList.add('hidden');
    setLoadingBtn(generateBtn, false);
    showError(err.message || 'Upload failed. Please try again.');
    return;
  }

  // 2. Transcribe
  try {
    setLoadingBtn(generateBtn, true, 'Transcribing…');
    addStatusRow(generateBtn, 'spinner', 'This may take a minute or two for longer recordings…');
    const audioUrl = `${CONFIG.supabaseUrl}/storage/v1/object/public/audio/${filename}`;
    const data = await callEdgeFunction('transcribe', { audioUrl });
    removeStatusRow();

    pendingRawTranscript = data.rawTranscript;
    pendingSpeakers = data.speakers;
    showSpeakerSection(data.speakers, supplementaryNotes);
  } catch (err) {
    removeStatusRow();
    setLoadingBtn(generateBtn, false);
    showError(err.message || 'Transcription failed. Please try again.');
  }
}

// ── Speaker confirmation ──────────────────────────────────────────────────────

function showSpeakerSection(speakers, supplementaryNotes) {
  setLoadingBtn(generateBtn, false);
  speakerCount.textContent = speakers.length;

  speakerList.innerHTML = speakers.map((s) => `
    <div class="speaker-row">
      <label for="spk-${s.id}">${s.label}</label>
      <input
        type="text"
        id="spk-${s.id}"
        class="speaker-name-input${s.guessedName ? ' guessed' : ''}"
        data-speaker-id="${s.id}"
        data-speaker-label="${s.label}"
        placeholder="Name (leave blank to keep '${s.label}')"
        value="${escHtml(s.guessedName)}"
      >
    </div>
  `).join('');

  formSection.classList.add('hidden');
  speakerSection_.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Store supplementary notes so confirm handler can reach them
  speakerSection_.dataset.supplementaryNotes = supplementaryNotes;
}

confirmSpeakersBtn.addEventListener('click', async () => {
  hideSpeakerError();
  const namedTranscript = applyConfirmedNames(pendingRawTranscript);
  const supplementaryNotes = speakerSection_.dataset.supplementaryNotes || '';

  let combined = `[TRANSCRIPT]\n${namedTranscript}`;
  if (supplementaryNotes) combined += `\n\n[ADDITIONAL NOTES]\n${supplementaryNotes}`;

  speakerSection_.classList.add('hidden');
  await runGenerateFlow(combined);
});

backToFormBtn.addEventListener('click', () => {
  speakerSection_.classList.add('hidden');
  formSection.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

function applyConfirmedNames(rawTranscript) {
  let transcript = rawTranscript;
  const inputs = speakerList.querySelectorAll('.speaker-name-input');
  inputs.forEach((input) => {
    const label = input.dataset.speakerLabel;
    const confirmedName = input.value.trim() || label;
    // Replace "Speaker N:" at start of line
    transcript = transcript.replace(new RegExp(`^${label}:`, 'gm'), `${confirmedName}:`);
  });
  return transcript;
}

// ── Generate minutes ──────────────────────────────────────────────────────────

async function runGenerateFlow(notes) {
  setLoadingBtn(generateBtn, true, 'Generating…');
  addStatusRow(generateBtn, 'spinner', 'This usually takes 15–30 seconds…');

  try {
    const data = await callEdgeFunction('generate-minutes', {
      notes,
      template: templateSelect.value,
    });
    removeStatusRow();
    currentMinutesMarkdown = data.minutes;
    renderMinutes(data.minutes);
    showResultSection();
  } catch (err) {
    removeStatusRow();
    setLoadingBtn(generateBtn, false);
    showError(err.message || 'Something went wrong. Please try again.');
  }
}

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
  speakerSection_.classList.add('hidden');
  formSection.classList.remove('hidden');

  currentMinutesMarkdown = '';
  pendingRawTranscript   = '';
  pendingSpeakers        = [];
  audioFile              = null;
  audioInput.value       = '';
  docxInput.value        = '';

  fileStatus.classList.add('hidden');
  audioStatus.classList.add('hidden');
  uploadProgressWrap.classList.add('hidden');

  notesLabel.textContent   = 'Meeting notes or transcript';
  notesHint.textContent    = 'Include date, location, attendees, and any motions made if you have them.';
  notesInput.placeholder   = 'Paste your meeting notes, rough transcript, or any combination of both here…';

  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── Storage upload with progress ──────────────────────────────────────────────

function uploadAudioToStorage(file) {
  return new Promise((resolve, reject) => {
    const ext      = file.name.split('.').pop() || 'mp3';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const url      = `${CONFIG.supabaseUrl}/storage/v1/object/audio/${filename}`;

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        uploadBar.style.width = `${pct}%`;
        uploadLabel.textContent = `Uploading… ${pct}%`;
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(filename);
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body.message) msg = body.message;
        } catch { /* ignore */ }
        reject(new Error(msg));
      }
    });

    xhr.addEventListener('error',  () => reject(new Error('Upload failed — check your connection.')));
    xhr.addEventListener('abort',  () => reject(new Error('Upload was cancelled.')));

    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${CONFIG.supabaseAnonKey}`);
    xhr.setRequestHeader('apikey', CONFIG.supabaseAnonKey);
    xhr.setRequestHeader('x-upsert', 'false');
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

// ── Edge Function helper ──────────────────────────────────────────────────────

async function callEdgeFunction(name, payload) {
  const resp = await fetch(`${CONFIG.supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.supabaseAnonKey}`,
      'apikey': CONFIG.supabaseAnonKey,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Server error (${resp.status})`);
  }

  return resp.json();
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function renderMinutes(markdown) {
  minutesPreview.innerHTML = marked.parse(markdown);
}

function showResultSection() {
  formSection.classList.add('hidden');
  speakerSection_.classList.add('hidden');
  resultSection.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setLoadingBtn(btn, on, label) {
  btn.disabled = on;
  if (label) btn.textContent = label;
  if (!on) btn.textContent = btn === generateBtn ? 'Generate Minutes' : 'Generate Minutes';
}

function addStatusRow(afterEl, type, text) {
  removeStatusRow();
  const row = document.createElement('div');
  row.id = 'status-row';
  row.className = 'loading-row';
  row.innerHTML = type === 'spinner'
    ? `<div class="spinner"></div><span>${text}</span>`
    : `<span>${text}</span>`;
  afterEl.insertAdjacentElement('afterend', row);
}

function removeStatusRow() {
  document.getElementById('status-row')?.remove();
}

function setFileStatus(el, msg, type) {
  el.textContent = msg;
  el.className = `file-status${type ? ' ' + type : ''}`;
  el.classList.remove('hidden');
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.classList.add('hidden');
}

function hideSpeakerError() {
  speakerErrorMsg.classList.add('hidden');
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
