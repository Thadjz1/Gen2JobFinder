// ============================================================
// CONFIG — your deployed Apps Script Web App URL
// ============================================================
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzG74xFfSUfgcQt4VuMNnp84HjUptvYGVadgop0efzHaVhcODafcq92m1pbvnJ6oOk/exec';

const board = document.getElementById('board');
const batchTracker = document.getElementById('batchTracker');
const reasonOverlay = document.getElementById('reasonOverlay');
const reasonCancel = document.getElementById('reasonCancel');

let pendingSkipJobId = null;
let currentJobs = [];   // the batch currently on screen
let jobStates = {};     // jobId -> 'pending' | 'completed' | 'skipped'

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

function cleanupJsonpScript_(callbackName, script) {
  delete window[callbackName];
  if (script && script.parentNode) script.parentNode.removeChild(script);
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

  const resumeBtn = job.ResumePdfUrl
    ? `<a class="btn btn-secondary" href="${job.ResumePdfUrl}" target="_blank" rel="noopener">Resume</a>`
    : `<span class="btn btn-secondary" style="opacity:.5;cursor:default;">Resume (preparing…)</span>`;

  const coverBtn = job.CoverLetterPdfUrl
    ? `<a class="btn btn-secondary" href="${job.CoverLetterPdfUrl}" target="_blank" rel="noopener">Cover Letter</a>`
    : `<span class="btn btn-secondary" style="opacity:.5;cursor:default;">Cover Letter (preparing…)</span>`;

  const statusBadge = state === 'completed'
    ? `<div class="status-badge badge-completed">✓ Applied</div>`
    : state === 'skipped'
      ? `<div class="status-badge badge-skipped">Skipped${job._skipReason ? ' — ' + escapeHtml(job._skipReason) : ''}</div>`
      : '';

  card.innerHTML = `
    ${statusBadge}
    <div class="job-eyebrow">${escapeHtml(job.Company || 'Unknown company')}</div>
    <h2 class="job-title">${escapeHtml(job.Title || 'Untitled role')}</h2>
    <div class="job-meta">${escapeHtml(job.Location || '')}</div>
    <div class="job-description">${escapeHtml(job.FullDescription || 'No description available.')}</div>
    <button class="desc-toggle">Read full description</button>
    ${excerptNote}
    <div class="job-actions">
      <a class="btn btn-primary apply-btn" href="${job.ApplyURL}" target="_blank" rel="noopener">Apply</a>
      ${resumeBtn}
      ${coverBtn}
      <button class="btn btn-ghost skip-btn">Skip</button>
    </div>
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
    toggleBtn.textContent = descEl.classList.contains('expanded') ? 'Show less' : 'Read full description';
  });

  // Apply is just a plain link now — no side effects. Progress is only
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

  return card;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Skip reason picker ----
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const reason = chip.dataset.reason;
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
  });
});

reasonCancel.addEventListener('click', closeReasonOverlay);

// Clicking the dark backdrop itself also closes it, as a fallback
reasonOverlay.addEventListener('click', (e) => {
  if (e.target === reasonOverlay) closeReasonOverlay();
});

function closeReasonOverlay() {
  reasonOverlay.hidden = true;
  pendingSkipJobId = null;
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

// ---- Send apply/skip action to the backend (via JSONP — see note in Code.gs) ----
function sendAction(jobId, action, reason) {
  const callbackName = 'actionCallback_' + Date.now();
  window[callbackName] = function () {
    cleanupJsonpScript_(callbackName, script);
  };

  const params = new URLSearchParams({ action, jobId, reason: reason || '', callback: callbackName });
  const script = document.createElement('script');
  script.src = `${WEB_APP_URL}?${params.toString()}`;
  script.onerror = () => {
    console.error('Failed to record action for job', jobId);
    cleanupJsonpScript_(callbackName, script);
  };
  document.body.appendChild(script);
}

fetchJobs();
