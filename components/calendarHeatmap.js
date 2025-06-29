// components/calendarHeatmap.js
// Renders the activity heatmap into #heatmap-tile once the user is authenticated.

import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, getDocs, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// --- configuration ---------------------------------------------------------
// Adjust these paths if your Firestore structure differs.
const COLLECTION_ROOT = 'userDailyTotals';      // top-level collection
const SUBCOLLECTION  = 'days';                  // per-user sub-collection

// --- utility: distance → CSS class ----------------------------------------
function scaleKm(km) {
  if (km === 0) return 'heat-0';
  if (km < 5)   return 'heat-1';    // short
  if (km < 15)  return 'heat-2';    // medium
  if (km < 30)  return 'heat-3';    // long
  return 'heat-4';                  // ultra
}

// --- fetch daily totals from Firestore ------------------------------------
async function fetchDailyTotals(uid) {
  const db = getFirestore();
  const colRef = collection(db, COLLECTION_ROOT, uid, SUBCOLLECTION);
  const q = query(colRef, orderBy('__name__'));
  const snap = await getDocs(q);
  const days = {};
  snap.forEach(doc => days[doc.id] = doc.data()); // id is YYYY-MM-DD
  return days;
}

// --- modal helpers ---------------------------------------------------------
function buildModal() {
  const modal = document.createElement('div');
  modal.id = 'heatmap-activity-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center z-50';

  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-lg p-4 w-80 shadow-lg">
      <h3 id="heatmap-modal-date" class="font-semibold text-lg mb-3 text-gray-800 dark:text-gray-200 text-center"></h3>
      <ul id="heatmap-modal-list" class="space-y-2 max-h-60 overflow-y-auto"></ul>
      <button id="heatmap-modal-close" class="mt-4 w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded py-2">Close</button>
    </div>`;

  document.body.appendChild(modal);

  const close = () => modal.classList.add('hidden');
  modal.querySelector('#heatmap-modal-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  return modal;
}

let modalEl = null;
function showModal(dateStr, activities) {
  if (!modalEl) modalEl = buildModal();
  const dateEl  = modalEl.querySelector('#heatmap-modal-date');
  const listEl  = modalEl.querySelector('#heatmap-modal-list');
  dateEl.textContent = dateStr;
  listEl.innerHTML = '';
  activities.forEach(act => {
    const li   = document.createElement('li');
    const link = document.createElement('a');
    link.href   = `https://www.strava.com/activities/${act.id}`;
    link.target = '_blank';
    link.className = 'text-emerald-600 hover:underline';
    link.textContent = `${act.distance.toFixed(1)} km`;
    li.appendChild(link);
    listEl.appendChild(li);
  });
  modalEl.classList.remove('hidden');
}

// --- main builder ----------------------------------------------------------
function buildHeatmap(container, data) {
  // Clear previous
  container.innerHTML = '';

  // --- constants
  const CELL_SIZE = 18; // px
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Determine date range
  const dates = Object.keys(data);
  if (dates.length === 0) {
    container.textContent = 'No activity data yet.';
    return;
  }
  const earliestDate = new Date(dates[0]);
  const today        = new Date();

  // Align to Monday weeks
  const currentMonday  = new Date(today);
  currentMonday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const firstMonday    = new Date(earliestDate);
  firstMonday.setDate(earliestDate.getDate() - ((earliestDate.getDay() + 6) % 7));
  const millisPerWeek  = 7 * 24 * 60 * 60 * 1000;
  const observedWeeks  = Math.floor((currentMonday - firstMonday) / millisPerWeek) + 1;
  // Ensure the grid is wider than the tile so horizontal scrolling is always possible.
  // Compute how many weeks would fill the visible area and add a small buffer.
  const tileWidth      = container.clientWidth || 0;
  const cellTotal      = CELL_SIZE + 4; // cell plus gap (approx)
  const minWeeks       = Math.ceil(tileWidth / cellTotal) + 4; // 4-week buffer
  const totalWeeks     = Math.max(observedWeeks, minWeeks);

  // --- layout wrappers -----------------------------------------------------
  const wrapperFlex = document.createElement('div');
  wrapperFlex.className = 'flex';

  const dayLabelCol = document.createElement('div');
  dayLabelCol.className = 'flex flex-col space-y-1 mr-2 flex-none';
  // top spacer
  const spacer = document.createElement('span');
  spacer.style.height = `${CELL_SIZE}px`;
  dayLabelCol.appendChild(spacer);
  dayNames.forEach(name => {
    const span = document.createElement('span');
    span.textContent = name;
    span.style.height = `${CELL_SIZE}px`;
    span.style.lineHeight = `${CELL_SIZE}px`;
    span.style.fontSize = '12px';
    span.className = 'text-gray-600 dark:text-gray-300';
    dayLabelCol.appendChild(span);
  });

  const scrollArea = document.createElement('div');
  scrollArea.id = 'heatmap-scroll-area';
  scrollArea.className = 'flex-1 overflow-x-auto min-w-0 no-scrollbar';

  const monthRow = document.createElement('div');
  monthRow.id = 'heatmap-month-row';
  monthRow.className = 'flex space-x-1 text-xs mb-1 pl-[2px]';

  const gridRow = document.createElement('div');
  gridRow.id = 'heatmap-grid-row';
  gridRow.className = 'flex space-x-1';

  scrollArea.appendChild(monthRow);
  scrollArea.appendChild(gridRow);

  wrapperFlex.appendChild(dayLabelCol);
  wrapperFlex.appendChild(scrollArea);
  container.appendChild(wrapperFlex);

  // --- build columns -------------------------------------------------------
  let prevMonth = -1;
  for (let col = totalWeeks - 1; col >= 0; col--) {
    const weekStart = new Date(currentMonday);
    weekStart.setDate(currentMonday.getDate() - col * 7);

    // month label
    const monthSpan = document.createElement('span');
    monthSpan.style.width = `${CELL_SIZE}px`;
    monthSpan.className = 'text-center text-gray-600 dark:text-gray-300';
    monthSpan.style.fontSize = '12px';
    if (weekStart.getMonth() !== prevMonth) {
      monthSpan.textContent = weekStart.toLocaleString('default', { month: 'short' });
      prevMonth = weekStart.getMonth();
    }
    monthRow.appendChild(monthSpan);

    // week column
    const weekCol = document.createElement('div');
    weekCol.className = 'flex flex-col space-y-1';

    for (let row = 0; row < 7; row++) {
      const cellDate = new Date(weekStart);
      cellDate.setDate(weekStart.getDate() + row);
      const key      = cellDate.toISOString().slice(0, 10);
      const info     = data[key] || { totalKm: 0, activities: [] };

      const cell = document.createElement('div');
      cell.className = `rounded heat-cell ${scaleKm(info.totalKm)}`;
      cell.style.width = `${CELL_SIZE}px`;
      cell.style.height = `${CELL_SIZE}px`;
      cell.title = `${key}: ${info.totalKm.toFixed(1)} km`;

      if (info.activities.length) {
        cell.classList.add('cursor-pointer');
        cell.addEventListener('click', () => {
          if (info.activities.length === 1) {
            window.open(`https://www.strava.com/activities/${info.activities[0].id}`, '_blank');
          } else {
            showModal(key, info.activities);
          }
        });
      }

      weekCol.appendChild(cell);
    }
    gridRow.appendChild(weekCol);
  }

  // Force the row to keep its full width so it can overflow and scroll
  const colWidth = CELL_SIZE + 4; // cell width + gap (space-x-1 = 4px)
  gridRow.style.width = `${totalWeeks * colWidth}px`;
  gridRow.style.flex = '0 0 auto';
  gridRow.style.flexShrink = '0';

  // wheel -> horizontal scroll helper
  const wheelHandler = (e) => {
    const move = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (move !== 0) {
      e.preventDefault();
      scrollArea.scrollLeft += move;
    }
  };

  // Enable wheel scrolling when pointer is over the grid or the label column
  scrollArea.addEventListener('wheel', wheelHandler, { passive: false });
  container.addEventListener('wheel', wheelHandler, { passive: false });

  // --- pointer / drag to scroll ---------------------------------------
  let dragging = false;
  let startX   = 0;

  scrollArea.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX   = e.pageX + scrollArea.scrollLeft;
    scrollArea.setPointerCapture(e.pointerId);
  });

  scrollArea.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    scrollArea.scrollLeft = startX - e.pageX;
  });

  const endDrag = () => { dragging = false; };
  scrollArea.addEventListener('pointerup', endDrag);
  scrollArea.addEventListener('pointercancel', endDrag);
  scrollArea.addEventListener('pointerleave', endDrag);
}

// --- entry point -----------------------------------------------------------
async function initHeatmap(uid) {
  const tile = document.getElementById('heatmap-tile');
  if (!tile) return;

  // simple loader safety: if already rendered, skip
  if (tile.dataset.rendered) return;

  try {
    const data = await fetchDailyTotals(uid);
    buildHeatmap(tile, data);
    tile.dataset.rendered = '1';
  } catch (err) {
    console.error('Heatmap failed:', err);
    tile.innerHTML = '<p class="text-red-600">Heatmap failed to load.</p>';
  }
}

// Wait for auth & DOM -------------------------------------------------------
const auth = getAuth();

// Inject heatmap colour styles once
if (!document.getElementById('heatmap-style')) {
  const style = document.createElement('style');
  style.id = 'heatmap-style';
  style.textContent = `
    .heat-0 { background:#e5e7eb; } /* gray-200 */
    .heat-1 { background:#bbf7d0; } /* emerald-200 */
    .heat-2 { background:#4ade80; } /* emerald-400 */
    .heat-3 { background:#16a34a; } /* emerald-600 */
    .heat-4 { background:#166534; } /* emerald-800 */
    @media (prefers-color-scheme: dark) {
      .heat-0 { background:#374151; }
      .heat-1 { background:#166534; }
      .heat-2 { background:#16a34a; }
      .heat-3 { background:#4ade80; }
      .heat-4 { background:#bbf7d0; }
    }
    .no-scrollbar { -ms-overflow-style:none; scrollbar-width:none; }
    .no-scrollbar::-webkit-scrollbar { display:none; }
  `;
  document.head.appendChild(style);
}

function maybeStart(user) {
  if (user && document.readyState !== 'loading') initHeatmap(user.uid);
}

document.addEventListener('DOMContentLoaded', () => maybeStart(auth.currentUser));
onAuthStateChanged(auth, maybeStart); 