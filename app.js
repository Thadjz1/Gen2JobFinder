// ============================================================
// CONFIG — paste your deployed Apps Script Web App URL here
// (Deploy > New deployment > Web app > copy the URL ending in /exec)
// ============================================================
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzG74xFfSUfgcQt4VuMNnp84HjUptvYGVadgop0efzHaVhcODafcq92m1pbvnJ6oOk/exec';

const board = document.getElementById('board');
const batchTracker = document.getElementById('batchTracker');
const reasonOverlay = document.getElementById('reasonOverlay');
const reasonCancel = document.getElementById('reasonCancel');

let pendingSkipJobId = null;

// ---- Batch progress tracker (5 cups) ----
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

// ---- Fetch current batch from the backend ----
async function fetchJobs() {
  try {
    const res = await fetch(WEB_APP_URL);
    const data = await res.json();
    renderBoard(data.jobs || []);
  } catch (err) {
    board.innerHTML = `<div class="state-message">Couldn't load today's batch. Check back shortly.</div>`;
    console.error(err);
  }
}

// ---- Render job cards ----
function renderBoard(jobs) {
  renderTracker(5, 5 - jobs.length);

  if (jobs.length === 0) {
    board.innerHTML = `<div class="state-message">All done for now — check back for the next batch.</div>`;
    return;
  }

  board.innerHTML = '';
  jobs.forEach(job => board.appendChild(buildCard(job)));
}

function buildCard(job) {
  const card = document.createElement('div');
  card.className = 'job-card';
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

  card.innerHTML = `
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
  `;

  // Expand/collapse full description
  const descEl = card.querySelector('.job-description');
  const toggleBtn = card.querySelector('.desc-toggle');
  toggleBtn.addEventListener('click', () => {
    descEl.classList.toggle('expanded');
    toggleBtn.textContent = descEl.classList.contains('expanded') ? 'Show less' : 'Read full description';
  });

  // Apply — record the action once they actually click through
  card.querySelector('.apply-btn').addEventListener('click', () => {
    sendAction(job.JobID, 'apply', '');
    removeCard(card);
  });

  // Skip — open the reason picker
  card.querySelector('.skip-btn').addEventListener('click', () => {
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
    if (pendingSkipJobId) {
      sendAction(pendingSkipJobId, 'skip', reason);
      const card = board.querySelector(`[data-job-id="${pendingSkipJobId}"]`);
      if (card) removeCard(card);
    }
    closeReasonOverlay();
  });
});

reasonCancel.addEventListener('click', closeReasonOverlay);

function closeReasonOverlay() {
  reasonOverlay.hidden = true;
  pendingSkipJobId = null;
}

// ---- Remove a card from view, then refresh from the server ----
function removeCard(card) {
  card.classList.add('removing');
  setTimeout(() => {
    card.remove();
    fetchJobs(); // server is the source of truth — re-sync (handles batch refill too)
  }, 300);
}

// ---- Send apply/skip action to the backend ----
// NOTE: sent as text/plain (not application/json) so the browser treats this
// as a "simple request" and skips the CORS preflight, which Apps Script web
// apps don't handle. The backend still JSON.parses the body normally.
function sendAction(jobId, action, reason) {
  fetch(WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ jobId, action, reason })
  }).catch(err => console.error('Failed to record action:', err));
}

fetchJobs();
