if (typeof CONFIG === 'undefined') {
  console.error('MinuteHand: config.js not found. Copy config.example.js to config.js and fill in your Supabase credentials.');
}

// ── Supabase client ───────────────────────────────────────────────────────────

const supabaseClient = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
});

// ── Element refs ──────────────────────────────────────────────────────────────

// Sections
const signinSection     = document.getElementById('signin-section');
const buyCreditsSection = document.getElementById('buy-credits-section');
const formSection       = document.getElementById('form-section');
const speakerSection    = document.getElementById('speaker-section');
const resultSection     = document.getElementById('result-section');

// Form
const generateBtn      = document.getElementById('generate-btn');
const notesInput       = document.getElementById('notes-input');
const notesLabel       = document.getElementById('notes-label');
const notesHint        = document.getElementById('notes-hint');
const templateSelect   = document.getElementById('template-select');
const errorMsg         = document.getElementById('error-msg');

// Account bar
const accountBar          = document.getElementById('account-bar');
const accountBarSignedout = accountBar.querySelector('.account-bar__signedout');
const accountBarSignedin  = accountBar.querySelector('.account-bar__signedin');
const creditsDisplay      = document.getElementById('credits-display');
const userEmailDisplay    = document.getElementById('user-email-display');
const showSigninBtn       = document.getElementById('show-signin-btn');
const buyCreditsBtn       = document.getElementById('buy-credits-btn');
const signoutBtn          = document.getElementById('signout-btn');

// Sign-in section
const signinEmailInput   = document.getElementById('signin-email');
const signinPasswordInput = document.getElementById('signin-password');
const authSubmitBtn      = document.getElementById('auth-submit-btn');
const backFromSigninBtn  = document.getElementById('back-from-signin-btn');
const signinMessage      = document.getElementById('signin-message');
const signinError        = document.getElementById('signin-error');
const tabSignin          = document.getElementById('tab-signin');
const tabSignup          = document.getElementById('tab-signup');
const forgotWrap         = document.getElementById('forgot-wrap');
const forgotPasswordBtn  = document.getElementById('forgot-password-btn');
const googleSigninBtn    = document.getElementById('google-signin-btn');

let authMode = 'signin'; // 'signin' | 'signup'

// Buy credits section
const checkoutError      = document.getElementById('checkout-error');
const backFromCreditsBtn = document.getElementById('back-from-credits-btn');

// .docx upload
const dropZone         = document.getElementById('drop-zone');
const docxInput        = document.getElementById('docx-input');
const browseBtn        = document.getElementById('browse-btn');
const fileStatus       = document.getElementById('file-status');

// Audio upload
const audioDropZone        = document.getElementById('audio-drop-zone');
const audioInput           = document.getElementById('audio-input');
const audioBrowseBtn       = document.getElementById('audio-browse-btn');
const audioStatus          = document.getElementById('audio-status');
const uploadProgressWrap   = document.getElementById('upload-progress-wrap');
const uploadBar            = document.getElementById('upload-bar');
const uploadLabel          = document.getElementById('upload-label');

// Speaker confirmation
const speakerCount       = document.getElementById('speaker-count');
const speakerList        = document.getElementById('speaker-list');
const confirmSpeakersBtn = document.getElementById('confirm-speakers-btn');
const backToFormBtn      = document.getElementById('back-to-form-btn');

// Result
const minutesPreview = document.getElementById('minutes-preview');
const downloadBtn    = document.getElementById('download-btn');
const resetBtn       = document.getElementById('reset-btn');

// ── App state ─────────────────────────────────────────────────────────────────

let currentUser            = null;
let creditBalance          = null;
let audioFile              = null;
let pendingRawTranscript   = '';
let pendingSpeakers        = [];
let currentMinutesMarkdown = '';

// ── Auth state management ─────────────────────────────────────────────────────

supabaseClient.auth.onAuthStateChange(async (event, session) => {
  currentUser = session?.user ?? null;
  if (event === 'PASSWORD_RECOVERY') {
    const newPassword = prompt('Enter your new password:');
    if (newPassword) {
      const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
      if (error) showToast('Could not update password: ' + error.message, 'error');
      else showToast('Password updated — you\'re signed in!', 'success');
    }
    return;
  }
  if (currentUser) {
    await refreshCreditBalance();
    updateAuthBar();
    if (!signinSection.classList.contains('hidden')) showSection(formSection);
  } else {
    creditBalance = null;
    updateAuthBar();
  }
});

// On page load: handle returning from PayPal
(async () => {
  const params  = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  const orderId = params.get('token'); // PayPal passes the order ID as ?token=

  if (payment === 'approved' && orderId) {
    window.history.replaceState({}, '', window.location.pathname);
    const toast = showToast('Processing payment…', 'info');
    try {
      await callEdgeFunction('capture-payment', { orderId });
      toast.remove();
      await refreshCreditBalance();
      showPaymentSuccessToast();
    } catch (err) {
      toast.remove();
      showToast(`Payment error: ${err.message || 'Please contact support.'}`, 'error');
    }
  } else if (payment === 'cancelled') {
    window.history.replaceState({}, '', window.location.pathname);
  }
})();

async function refreshCreditBalance() {
  const { data } = await supabaseClient
    .from('credits')
    .select('balance')
    .eq('user_id', currentUser.id)
    .single();
  creditBalance = data?.balance ?? 0;
  renderCreditsDisplay();
}

function updateAuthBar() {
  if (currentUser) {
    accountBar.className = 'account-bar account-bar--signedin';
    accountBarSignedout.classList.add('hidden');
    accountBarSignedin.classList.remove('hidden');
    userEmailDisplay.textContent = currentUser.email;
    renderCreditsDisplay();
  } else {
    accountBar.className = 'account-bar account-bar--signedout';
    accountBarSignedout.classList.remove('hidden');
    accountBarSignedin.classList.add('hidden');
  }
}

function renderCreditsDisplay() {
  if (creditBalance === null) return;
  creditsDisplay.textContent = creditBalance === 1 ? '1 credit' : `${creditBalance} credits`;
  creditsDisplay.className = 'credits-badge' + (creditBalance === 0 ? ' empty' : '');
}

function showPaymentSuccessToast() {
  showToast(`Payment confirmed — you now have ${creditBalance} credit${creditBalance !== 1 ? 's' : ''}.`, 'success');
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  if (type !== 'info') setTimeout(() => toast.remove(), 4000);
  return toast;
}

// ── Auth UI event handlers ────────────────────────────────────────────────────

showSigninBtn.addEventListener('click', () => {
  setAuthMode('signin');
  showSection(signinSection);
});

backFromSigninBtn.addEventListener('click', () => showSection(formSection));

tabSignin.addEventListener('click', () => setAuthMode('signin'));
tabSignup.addEventListener('click', () => setAuthMode('signup'));

function setAuthMode(mode) {
  authMode = mode;
  const isSignin = mode === 'signin';
  tabSignin.className = 'auth-tab' + (isSignin ? ' auth-tab--active' : '');
  tabSignup.className = 'auth-tab' + (!isSignin ? ' auth-tab--active' : '');
  authSubmitBtn.textContent = isSignin ? 'Sign In' : 'Create Account';
  signinPasswordInput.autocomplete = isSignin ? 'current-password' : 'new-password';
  forgotWrap.classList.toggle('hidden', !isSignin);
  signinError.classList.add('hidden');
  signinMessage.classList.add('hidden');
}

authSubmitBtn.addEventListener('click', async () => {
  const email    = signinEmailInput.value.trim();
  const password = signinPasswordInput.value;
  if (!email)    { showSigninError('Please enter your email address.'); return; }
  if (!password) { showSigninError('Please enter your password.'); return; }
  if (authMode === 'signup' && password.length < 6) {
    showSigninError('Password must be at least 6 characters.'); return;
  }

  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = 'Working…';
  signinError.classList.add('hidden');
  signinMessage.classList.add('hidden');

  try {
    if (authMode === 'signup') {
      const { error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      signinMessage.textContent = 'Account created — you\'re signed in!';
      signinMessage.classList.remove('hidden');
    } else {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    showSigninError(err.message || 'Something went wrong. Please try again.');
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
  }
});

forgotPasswordBtn.addEventListener('click', async () => {
  const email = signinEmailInput.value.trim();
  if (!email) { showSigninError('Enter your email address above first.'); return; }

  forgotPasswordBtn.disabled = true;
  signinError.classList.add('hidden');
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: pageOrigin(),
    });
    if (error) throw error;
    signinMessage.textContent = `Password reset email sent to ${email}.`;
    signinMessage.classList.remove('hidden');
  } catch (err) {
    showSigninError(err.message || 'Could not send reset email.');
  } finally {
    forgotPasswordBtn.disabled = false;
  }
});

googleSigninBtn.addEventListener('click', async () => {
  googleSigninBtn.disabled = true;
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: pageOrigin() },
  });
  if (error) {
    showSigninError(error.message || 'Google sign-in failed.');
    googleSigninBtn.disabled = false;
  }
});

signoutBtn.addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
});

buyCreditsBtn.addEventListener('click', () => showSection(buyCreditsSection));

backFromCreditsBtn.addEventListener('click', () => showSection(formSection));

// ── Buy credits ───────────────────────────────────────────────────────────────

buyCreditsSection.addEventListener('click', async (e) => {
  const packBtn = e.target.closest('.credit-pack');
  if (!packBtn || packBtn.disabled) return;

  const pack = packBtn.dataset.pack;
  const allPacks = buyCreditsSection.querySelectorAll('.credit-pack');
  allPacks.forEach((b) => { b.disabled = true; });
  checkoutError.classList.add('hidden');

  try {
    const data = await callEdgeFunction('create-checkout', { pack, origin: pageOrigin() });
    window.location.href = data.url;
  } catch (err) {
    showCheckoutError(err.message || 'Failed to start checkout. Please try again.');
    allPacks.forEach((b) => { b.disabled = false; });
  }
});

// ── .docx upload ──────────────────────────────────────────────────────────────

browseBtn.addEventListener('click', () => docxInput.click());
dropZone.addEventListener('click', (e) => { if (e.target !== browseBtn) docxInput.click(); });
docxInput.addEventListener('change', () => { if (docxInput.files[0]) loadDocx(docxInput.files[0]); });
dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) loadDocx(e.dataTransfer.files[0]);
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

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

audioBrowseBtn.addEventListener('click', () => audioInput.click());
audioDropZone.addEventListener('click', (e) => { if (e.target !== audioBrowseBtn) audioInput.click(); });
audioInput.addEventListener('change', () => { if (audioInput.files[0]) selectAudioFile(audioInput.files[0]); });
audioDropZone.addEventListener('dragover',  (e) => { e.preventDefault(); audioDropZone.classList.add('drag-over'); });
audioDropZone.addEventListener('dragleave', () => audioDropZone.classList.remove('drag-over'));
audioDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  audioDropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) selectAudioFile(e.dataTransfer.files[0]);
});

function selectAudioFile(file) {
  const allowed = ['audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/webm','video/mp4'];
  const byExt = /\.(mp3|m4a|wav|ogg|webm|mp4)$/i.test(file.name);
  if (!allowed.includes(file.type) && !byExt) {
    setFileStatus(audioStatus, 'Unsupported file type. Use .mp3, .m4a, or .wav.', 'error');
    return;
  }
  if (file.size > MAX_AUDIO_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(0);
    setFileStatus(audioStatus, `File is ${mb} MB — maximum is 50 MB. Re-export at a lower bitrate (64 kbps MP3 fits ~90 min).`, 'error');
    return;
  }
  audioFile = file;
  const mb = (file.size / 1024 / 1024).toFixed(1);
  setFileStatus(audioStatus, `✓ ${file.name} (${mb} MB) — ready`, 'success');
  notesLabel.textContent = 'Additional notes or agenda (optional)';
  notesHint.textContent  = 'Anything not captured in the recording — e.g. a pre-meeting agenda or written notes.';
  notesInput.placeholder = 'Paste any supplementary notes or agenda here… (optional)';
}

// ── Generate flow ─────────────────────────────────────────────────────────────

generateBtn.addEventListener('click', async () => {
  const notes = notesInput.value.trim();
  if (!audioFile && !notes) {
    showError('Please add meeting notes or upload an audio recording.');
    return;
  }
  hideError();

  // Require sign-in before proceeding
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    showSection(signinSection);
    return;
  }

  if (audioFile) {
    await runAudioFlow(notes);
  } else {
    await runGenerateFlow(notes);
  }
});

async function runAudioFlow(supplementaryNotes) {
  let filename;

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

  try {
    setLoadingBtn(generateBtn, true, 'Transcribing…');
    addStatusRow(generateBtn, 'spinner', 'This may take a minute or two for longer recordings…');
    const audioUrl = `${CONFIG.supabaseUrl}/storage/v1/object/public/audio/${filename}`;
    const data = await callEdgeFunction('transcribe', { audioUrl });
    removeStatusRow();
    pendingRawTranscript = data.rawTranscript;
    pendingSpeakers = data.speakers;
    speakerSection.dataset.supplementaryNotes = supplementaryNotes;
    showSpeakerSection(data.speakers);
  } catch (err) {
    removeStatusRow();
    setLoadingBtn(generateBtn, false);
    showError(err.message || 'Transcription failed. Please try again.');
  }
}

// ── Speaker confirmation ──────────────────────────────────────────────────────

function showSpeakerSection(speakers) {
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
  showSection(speakerSection);
}

confirmSpeakersBtn.addEventListener('click', async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { showSection(signinSection); return; }

  const namedTranscript = applyConfirmedNames(pendingRawTranscript);
  const supplementaryNotes = speakerSection.dataset.supplementaryNotes || '';
  let combined = `[TRANSCRIPT]\n${namedTranscript}`;
  if (supplementaryNotes) combined += `\n\n[ADDITIONAL NOTES]\n${supplementaryNotes}`;

  showSection(formSection);   // hide speaker section while generating
  await runGenerateFlow(combined);
});

backToFormBtn.addEventListener('click', () => showSection(formSection));

function applyConfirmedNames(rawTranscript) {
  let t = rawTranscript;
  speakerList.querySelectorAll('.speaker-name-input').forEach((input) => {
    const label = input.dataset.speakerLabel;
    const name  = input.value.trim() || label;
    t = t.replace(new RegExp(`^${label}:`, 'gm'), `${name}:`);
  });
  return t;
}

// ── Minutes generation ────────────────────────────────────────────────────────

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
    if (currentUser) await refreshCreditBalance(); // update balance display
    minutesPreview.innerHTML = marked.parse(data.minutes);
    showSection(resultSection);
  } catch (err) {
    removeStatusRow();
    setLoadingBtn(generateBtn, false);
    if (err.status === 402) {
      showSection(buyCreditsSection);
    } else if (err.status === 401) {
      showSection(signinSection);
    } else {
      showError(err.message || 'Something went wrong. Please try again.');
    }
  }
}

// ── Download .docx ────────────────────────────────────────────────────────────

downloadBtn.addEventListener('click', () => {
  if (!currentMinutesMarkdown) return;
  const fullHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.6;color:#000}
  h1{font-size:13pt;text-align:center;text-transform:uppercase;margin-bottom:4pt}
  h2{font-size:11pt;text-transform:uppercase;border-bottom:1px solid #ccc;padding-bottom:2pt;margin-top:14pt;margin-bottom:4pt}
  h3{font-size:11pt;font-weight:bold;margin-top:8pt;margin-bottom:2pt}
  p{margin-bottom:6pt}
  table{width:100%;border-collapse:collapse;margin:8pt 0}
  th,td{border:1px solid #aaa;padding:4pt 6pt;font-size:10pt;vertical-align:top}
  th{background:#f0f0f0;font-weight:bold}
  ul,ol{margin:4pt 0 6pt 18pt}
</style></head><body>${marked.parse(currentMinutesMarkdown)}</body></html>`;

  const blob = htmlDocx.asBlob(fullHtml);
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `meeting-minutes-${today()}.docx` });
  a.click();
  URL.revokeObjectURL(url);
});

// ── Reset ─────────────────────────────────────────────────────────────────────

resetBtn.addEventListener('click', () => {
  currentMinutesMarkdown = '';
  pendingRawTranscript   = '';
  pendingSpeakers        = [];
  audioFile              = null;
  audioInput.value       = '';
  docxInput.value        = '';
  fileStatus.classList.add('hidden');
  audioStatus.classList.add('hidden');
  uploadProgressWrap.classList.add('hidden');
  notesLabel.textContent = 'Meeting notes or transcript';
  notesHint.textContent  = 'Include date, location, attendees, and any motions made if you have them.';
  notesInput.placeholder = 'Paste your meeting notes, rough transcript, or any combination of both here…';
  showSection(formSection);
});

// ── Storage upload ────────────────────────────────────────────────────────────

function uploadAudioToStorage(file) {
  return new Promise((resolve, reject) => {
    const ext      = file.name.split('.').pop() || 'mp3';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const url      = `${CONFIG.supabaseUrl}/storage/v1/object/audio/${filename}`;
    const xhr      = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        uploadBar.style.width  = `${pct}%`;
        uploadLabel.textContent = `Uploading… ${pct}%`;
      }
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(filename);
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText).message || msg; } catch { /* ignore */ }
        reject(new Error(msg));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed — check your connection.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));

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
  const { data: { session } } = await supabaseClient.auth.getSession();
  const jwt = session?.access_token ?? CONFIG.supabaseAnonKey;

  const resp = await fetch(`${CONFIG.supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
      'apikey': CONFIG.supabaseAnonKey,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const error = new Error(err.error || `Server error (${resp.status})`);
    error.status = resp.status;
    throw error;
  }

  return resp.json();
}

// ── UI helpers ────────────────────────────────────────────────────────────────

const SECTIONS = [signinSection, buyCreditsSection, formSection, speakerSection, resultSection];

function showSection(section) {
  SECTIONS.forEach((s) => s.classList.add('hidden'));
  section.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setLoadingBtn(btn, on, label) {
  btn.disabled     = on;
  btn.textContent  = on ? (label || 'Working…') : 'Generate Minutes';
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

function removeStatusRow() { document.getElementById('status-row')?.remove(); }

function setFileStatus(el, msg, type) {
  el.textContent = msg;
  el.className   = `file-status${type ? ' ' + type : ''}`;
  el.classList.remove('hidden');
}

function showError(msg)         { errorMsg.textContent = msg; errorMsg.classList.remove('hidden'); }
function hideError()            { errorMsg.classList.add('hidden'); }
function showSigninError(msg)   { signinError.textContent = msg; signinError.classList.remove('hidden'); }
function showCheckoutError(msg) { checkoutError.textContent = msg; checkoutError.classList.remove('hidden'); }

function escHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function today()      { return new Date().toISOString().slice(0, 10); }
function pageOrigin() { return window.location.href.split('?')[0]; }
