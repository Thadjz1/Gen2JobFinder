// ============================================================
// CONFIG — your deployed Apps Script Web App URL
// ============================================================
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzG74xFfSUfgcQt4VuMNnp84HjUptvYGVadgop0efzHaVhcODafcq92m1pbvnJ6oOk/exec';

const board = document.getElementById('board');
const batchTracker = document.getElementById('batchTracker');
const queueDepthEl = document.getElementById('queueDepth');
const reasonOverlay = document.getElementById('reasonOverlay');
const reasonCancel = document.getElementById('reasonCancel');

let pendingSkipJobId = null;
let currentJobs = [];   // the batch currently on screen
let jobStates = {};     // jobId -> 'pending' | 'completed' | 'skipped'
let openCoverLetterJobId = null; // which card (if any) has its editor panel expanded
let customSkipReasons = []; // learned reasons from past "Other" submissions
const autosaveTimers = {}; // jobId -> debounce timer handle

// ---- Batch progress tracker (cups fill in as cards get completed/skipped) ----
function renderTracker(totalSlots, filledCount) {
  batchTracker.innerHTML = '';
  for (let i = 0; i < totalSlots; i++) {
    const cup = document.createElement('div');
    cup.className = 'cup' + (i < filledCount ? ' filled' : '');
    cup.innerHTML = `
      <svg viewBox="0 0 24 24">
        <clipPath id="clip${i}"><rect x="4" y="8" width="16" height="12" rx="2"/></clipPath>
        <rect class="cup-fill" x="4" y="8" width="16" height="12" clip-path="url(#clip${i})"/>
        <path class="cup-outline" d="M5 8h14v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8z"/>
        <path class="cup-outline" d="M19 10h1.5a2 2 0 0 1 0 4H19"/>
      </svg>`;
    batchTracker.appendChild(cup);
  }
}

function updateTracker() {
  const doneCount = currentJobs.filter(j => jobStates[j.JobID] !== 'pending').length;
  renderTracker(Math.max(currentJobs.length, 1), doneCount);
}

// ---- Fetch current batch from the backend (via JSONP — see note in Code.gs) ----
function fetchJobs() {
  board.innerHTML = `<div class="state-message">Brewing today's batch…</div>`;
  const callbackName = 'jobsCallback_' + Date.now();
  window[callbackName] = function (data) {
    currentJobs = data.jobs || [];
    jobStates = {};
    currentJobs.forEach(j => { jobStates[j.JobID] = 'pending'; });
    openCoverLetterJobId = null;
    updateQueueDepth_(data.queueCount);
    customSkipReasons = data.customReasons || [];
    renderCustomReasonChips_();
    renderBoard();
    cleanupJsonpScript_(callbackName, script);
  };

  const script = document.createElement('script');
  script.src = `${WEB_APP_URL}?callback=${callbackName}`;
  script.onerror = () => {
    board.innerHTML = `<div class="state-message">Couldn't load today's batch. Check back shortly.</div>`;
    cleanupJsonpScript_(callbackName, script);
  };
  document.body.appendChild(script);
}

function updateQueueDepth_(count) {
  if (typeof count !== 'number') {
    queueDepthEl.textContent = '';
    return;
  }
  queueDepthEl.textContent = count === 1 ? '1 more waiting' : `${count} more waiting`;
}

function cleanupJsonpScript_(callbackName, script) {
  delete window[callbackName];
  if (script && script.parentNode) script.parentNode.removeChild(script);
}

// General-purpose JSONP call for actions that need a response back
// (proofread/redraft/download), not just fire-and-forget like apply/skip.
function callBackend_(params, onSuccess, onError) {
  const callbackName = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  window[callbackName] = function (data) {
    cleanupJsonpScript_(callbackName, script);
    onSuccess(data);
  };
  const fullParams = new URLSearchParams(Object.assign({}, params, { callback: callbackName }));
  const script = document.createElement('script');
  script.src = `${WEB_APP_URL}?${fullParams.toString()}`;
  script.onerror = () => {
    cleanupJsonpScript_(callbackName, script);
    if (onError) onError();
  };
  document.body.appendChild(script);
}

// ---- Render all cards in the current batch ----
function renderBoard() {
  updateTracker();

  if (currentJobs.length === 0) {
    board.innerHTML = `<div class="state-message">All done for now — check back for the next batch.</div>`;
    return;
  }

  board.innerHTML = '';
  currentJobs.forEach(job => board.appendChild(buildCard(job)));
}

function buildCard(job) {
  const card = document.createElement('div');
  const state = jobStates[job.JobID];
  card.className = 'job-card' + (state !== 'pending' ? ` state-${state}` : '');
  card.dataset.jobId = job.JobID;

  const isTruncated = String(job.DescriptionTruncated).toLowerCase() === 'true';
  const excerptNote = isTruncated
    ? `<p class="excerpt-note">This may be an excerpt — <a href="${job.ApplyURL}" target="_blank" rel="noopener">view the full posting</a>.</p>`
    : '';

  const scoreLabel = job.Score ? `<span class="match-score">${escapeHtml(String(job.Score))}% match</span>` : '';
  const salaryLabel = job.SalaryRange ? ` (${escapeHtml(job.SalaryRange)})` : '';
  const dateLabel = formatDate_(job.PostedDate);

  const resumeBtn = job.ResumePdfUrl
    ? `<a class="btn btn-secondary" href="${job.ResumePdfUrl}" target="_blank" rel="noopener">Download Resume</a>`
    : `<span class="btn btn-secondary" style="opacity:.5;cursor:default;">Preparing…</span>`;

  const statusBadge = state === 'completed'
    ? `<div class="status-badge badge-completed">✓ Applied</div>`
    : state === 'skipped'
      ? `<div class="status-badge badge-skipped">Skipped${job._skipReason ? ' — ' + escapeHtml(job._skipReason) : ''}</div>`
      : '';

  const isEditorOpen = openCoverLetterJobId === job.JobID;

  card.innerHTML = `
    ${statusBadge}
    <div class="card-row title-row">
      <h2 class="job-title">${escapeHtml(job.Title || 'Untitled role')}</h2>
      ${scoreLabel}
    </div>
    <div class="job-company">Company Name: ${escapeHtml(job.Company || 'Unknown')} <span class="source-tag">${escapeHtml(formatSource_(job.Source))}</span></div>
    <div class="card-row meta-row">
      <span>${escapeHtml(job.Location || 'Location not listed')}${salaryLabel}</span>
      <span class="meta-date">${dateLabel}</span>
    </div>
    <div class="job-description">${escapeHtml(job.FullDescription || 'No description available.')}</div>
    <button class="desc-toggle">Read more</button>
    ${excerptNote}
    <div class="card-row resume-row">
      <span class="resume-label">Tailored from your master resume</span>
      ${resumeBtn}
    </div>
    <div class="card-row action-row">
      <button class="btn btn-secondary cover-toggle-btn">${isEditorOpen ? 'Hide Cover Letter' : 'Draft Cover Letter'}</button>
      <a class="btn btn-primary apply-btn" href="${job.ApplyURL}" target="_blank" rel="noopener">Apply</a>
      <button class="btn btn-ghost skip-btn">Skip</button>
    </div>
    ${isEditorOpen ? buildCoverLetterEditorHtml_(job) : ''}
    <label class="complete-check">
      <input type="checkbox" class="complete-checkbox">
      Mark as completed
    </label>
  `;

  // Expand/collapse full description
  const descEl = card.querySelector('.job-description');
  const toggleBtn = card.querySelector('.desc-toggle');
  toggleBtn.addEventListener('click', () => {
    descEl.classList.toggle('expanded');
    toggleBtn.textContent = descEl.classList.contains('expanded') ? 'Show less' : 'Read more';
  });

  // Apply is just a plain link — no side effects. Progress is only
  // recorded when you come back and check the box yourself.
  const completeCheckbox = card.querySelector('.complete-checkbox');
  if (state === 'completed') completeCheckbox.checked = true;
  if (state !== 'pending') completeCheckbox.disabled = true;

  completeCheckbox.addEventListener('change', () => {
    if (completeCheckbox.checked) {
      sendAction(job.JobID, 'apply', '');
      markJobState(job.JobID, 'completed');
    }
  });

  // Skip — open the reason picker
  card.querySelector('.skip-btn').addEventListener('click', () => {
    if (jobStates[job.JobID] !== 'pending') return;
    pendingSkipJobId = job.JobID;
    reasonOverlay.hidden = false;
  });

  // Draft Cover Letter — toggle the inline editor panel
  card.querySelector('.cover-toggle-btn').addEventListener('click', () => {
    openCoverLetterJobId = isEditorOpen ? null : job.JobID;
    const newCard = buildCard(job);
    card.replaceWith(newCard);
  });

  if (isEditorOpen) wireCoverLetterEditor_(card, job);

  return card;
}

// ---- Cover letter editor panel ----
function buildCoverLetterEditorHtml_(job) {
  const text = job.CoverLetterText || '';
  return `
    <div class="cover-editor">
      <textarea class="cover-textarea" placeholder="Generating your draft…">${escapeHtml(text)}</textarea>
      <div class="cover-editor-footer">
        <span class="save-status" data-state="idle">Saved</span>
        <div class="cover-editor-buttons">
          <button class="btn btn-secondary proof-btn">Proofread</button>
          <button class="btn btn-secondary redraft-btn">Redraft</button>
          <button class="btn btn-primary download-cover-btn">Download as PDF</button>
        </div>
      </div>
    </div>
  `;
}

function wireCoverLetterEditor_(card, job) {
  const textarea = card.querySelector('.cover-textarea');
  const saveStatus = card.querySelector('.save-status');
  const proofBtn = card.querySelector('.proof-btn');
  const redraftBtn = card.querySelector('.redraft-btn');
  const downloadBtn = card.querySelector('.download-cover-btn');

  function setStatus(state, label) {
    saveStatus.dataset.state = state;
    saveStatus.textContent = label;
  }

  function setBusy(busy) {
    [proofBtn, redraftBtn, downloadBtn].forEach(b => b.disabled = busy);
    textarea.disabled = busy;
  }

  // Autosave — debounced so it doesn't fire on every keystroke
  textarea.addEventListener('input', () => {
    setStatus('unsaved', 'Unsaved changes…');
    clearTimeout(autosaveTimers[job.JobID]);
    autosaveTimers[job.JobID] = setTimeout(() => {
      setStatus('saving', 'Saving…');
      callBackend_(
        { action: 'saveCoverLetterText', jobId: job.JobID, text: textarea.value },
        () => {
          job.CoverLetterText = textarea.value;
          setStatus('idle', 'Saved');
        },
        () => setStatus('error', 'Save failed — will retry on next edit')
      );
    }, 1500);
  });

  proofBtn.addEventListener('click', () => {
    setBusy(true);
    setStatus('saving', 'Checking spelling & grammar…');
    callBackend_(
      { action: 'proofreadCoverLetter', jobId: job.JobID, text: textarea.value },
      (data) => {
        textarea.value = data.text || textarea.value;
        job.CoverLetterText = textarea.value;
        setBusy(false);
        setStatus('idle', 'Saved');
      },
      () => { setBusy(false); setStatus('error', 'Proofread failed — try again'); }
    );
  });

  redraftBtn.addEventListener('click', () => {
    setBusy(true);
    setStatus('saving', 'Drafting a fresh version…');
    callBackend_(
      { action: 'redraftCoverLetter', jobId: job.JobID },
      (data) => {
        textarea.value = data.text || textarea.value;
        job.CoverLetterText = textarea.value;
        setBusy(false);
        setStatus('idle', 'Saved');
      },
      () => { setBusy(false); setStatus('error', 'Redraft failed — try again'); }
    );
  });

  downloadBtn.addEventListener('click', () => {
    setBusy(true);
    const originalLabel = downloadBtn.textContent;
    downloadBtn.textContent = 'Preparing PDF…';
    callBackend_(
      { action: 'downloadCoverLetterPdf', jobId: job.JobID, text: textarea.value },
      (data) => {
        setBusy(false);
        downloadBtn.textContent = originalLabel;
        if (data.url) window.open(data.url, '_blank', 'noopener');
      },
      () => {
        setBusy(false);
        downloadBtn.textContent = originalLabel;
        setStatus('error', 'PDF generation failed — try again');
      }
    );
  });
}

function formatDate_(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatSource_(source) {
  const names = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', adzuna: 'Adzuna' };
  return names[(source || '').toLowerCase()] || source || 'Unknown source';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Skip reason picker ----
const otherReasonWrap = document.getElementById('otherReasonWrap');
const otherReasonText = document.getElementById('otherReasonText');
const otherReasonSubmit = document.getElementById('otherReasonSubmit');
const reasonChipsContainer = document.querySelector('.reason-chips');

// Learned reasons render as real chips, inserted right before "Other" so
// that stays last. Uses event delegation on the container so newly-added
// chips work without any extra wiring.
function renderCustomReasonChips_() {
  reasonChipsContainer.querySelectorAll('.chip-custom').forEach(el => el.remove());
  const otherBtn = reasonChipsContainer.querySelector('[data-reason="Other"]');

  customSkipReasons.forEach(reason => {
    const btn = document.createElement('button');
    btn.className = 'chip chip-custom';
    btn.dataset.reason = reason;
    btn.textContent = reason;
    reasonChipsContainer.insertBefore(btn, otherBtn);
  });
}

reasonChipsContainer.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;

  if (chip.dataset.reason === 'Other') {
    // Reveal the text box instead of submitting immediately — the actual
    // reason gets captured on explicit submit below.
    otherReasonWrap.hidden = false;
    otherReasonText.value = '';
    otherReasonText.focus();
    return;
  }
  submitSkip_(chip.dataset.reason);
});

otherReasonSubmit.addEventListener('click', () => {
  const customReason = otherReasonText.value.trim();
  if (!customReason) {
    otherReasonText.focus();
    return;
  }
  submitSkip_(customReason);
});

function submitSkip_(reason) {
  try {
    if (pendingSkipJobId) {
      const job = currentJobs.find(j => j.JobID === pendingSkipJobId);
      if (job) job._skipReason = reason;
      sendAction(pendingSkipJobId, 'skip', reason);
      markJobState(pendingSkipJobId, 'skipped');
    }
  } catch (err) {
    console.error('Skip action failed:', err);
  } finally {
    closeReasonOverlay();
  }
}

reasonCancel.addEventListener('click', closeReasonOverlay);

reasonOverlay.addEventListener('click', (e) => {
  if (e.target === reasonOverlay) closeReasonOverlay();
});

function closeReasonOverlay() {
  reasonOverlay.hidden = true;
  pendingSkipJobId = null;
  otherReasonWrap.hidden = true;
  otherReasonText.value = '';
}

// ---- Mark a card's state locally, re-render just that card, check if the batch is done ----
function markJobState(jobId, state) {
  jobStates[jobId] = state;
  const job = currentJobs.find(j => j.JobID === jobId);
  const oldCard = board.querySelector(`[data-job-id="${jobId}"]`);
  if (job && oldCard) {
    const newCard = buildCard(job);
    oldCard.replaceWith(newCard);
  }
  updateTracker();
  checkBatchComplete();
}

// ---- Once every card in view is completed or skipped, load the next batch ----
function checkBatchComplete() {
  const allDone = currentJobs.length > 0 && currentJobs.every(j => jobStates[j.JobID] !== 'pending');
  if (allDone) {
    setTimeout(fetchJobs, 1200); // brief pause so the final checkmark/badge is visible first
  }
}

// ---- Send apply/skip action to the backend (fire-and-forget via JSONP) ----
function sendAction(jobId, action, reason) {
  callBackend_(
    { action: action, jobId: jobId, reason: reason || '' },
    function () {},
    function () { console.error('Failed to record action for job', jobId); }
  );
}

fetchJobs();
