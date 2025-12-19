// static/dashboard.js

// --- CONFIGURATION ---
const API_URL = '/api/status';
const CALENDAR_REFRESH_URL = '/api/refresh_calendar';
const BURN_IN_INTERVAL = 30000; // 30 seconds (30000 milliseconds)

// --- SOCKETIO SETUP ---
const socket = io();

socket.on('connect', function () {
    console.log('Connected to dashboard server via WebSocket.');
});

socket.on('status_update', function (data) {
    console.log('Server pushed status update. Fetching new data from cache...');
    updateDashboard();
});


// --- Status Conversion and DOM Update ---

/**
 * Maps a status word to the corresponding CSS class.
 * This is primarily used for the ESO boxes, as calendar classes are provided by the poller.
 */
function getStatusClass(status) {
    status = status.toUpperCase();
    if (status === 'UP' || status === 'FREE') {
        return 'status-green';
    } else if (status === 'DOWN' || status === 'MAINTENANCE' || status === 'BUSY') {
        return 'status-red';
    } else if (status === 'SOON') {
        return 'status-yellow';
    } else if (status === 'ERROR' || status === 'N/A') {
        return 'status-orange';
    } else {
        return 'status-orange';
    }
}

/**
 * Updates a single box's appearance (color and text).
 */
function updateBoxDisplay(boxId, status, cssClass, textContent) {
    const box = document.getElementById(boxId);

    if (!box) {
        return;
    }

    const textElement = document.getElementById(boxId.replace('-box', '-text'));

    const isCalendarBox = box.classList.contains('calendar-box');
    const clickableClass = isCalendarBox ? ' clickable' : '';

    // Preserve the structural class 'status-box' and apply the new color class.
    box.className = 'status-box ' + cssClass + clickableClass;

    if (textContent !== undefined && textElement) {
        textElement.textContent = textContent;
    }
}

/**
 * BURN-IN FIX: Randomly reorders the children of the dashboard container.
 */
function shuffleChildren() {
    const container = document.querySelector('.dashboard-container');
    if (!container) return;

    // Convert HTMLCollection of children to an Array of status boxes
    let boxesToShuffle = Array.from(container.children).filter(node =>
        node.classList.contains('status-box')
    );

    // Store the non-shuffled elements (like the hidden span)
    let nonStatusNodes = Array.from(container.children).filter(node =>
        !node.classList.contains('status-box')
    );

    // Fisher-Yates shuffle algorithm on the status boxes
    for (let i = boxesToShuffle.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [boxesToShuffle[i], boxesToShuffle[j]] = [boxesToShuffle[j], boxesToShuffle[i]];
    }

    // Remove all current children from the container
    container.innerHTML = '';

    // Re-append the shuffled status boxes
    boxesToShuffle.forEach(box => container.appendChild(box));

    // Re-append the non-status elements (like the hidden span) at the end
    nonStatusNodes.forEach(node => container.appendChild(node));
}

/**
 * BURN-IN FIX: Subtly shifts the text position within the box container.
 */
function randomizeTextPosition() {
    const textElements = document.querySelectorAll('.status-box h2');

    // Shift range: -1px to +1px (a very subtle sub-pixel shift)
    const maxOffset = 1;

    textElements.forEach(text => {
        // Generate random offsets
        const offsetX = Math.floor(Math.random() * (2 * maxOffset + 1)) - maxOffset;
        const offsetY = Math.floor(Math.random() * (2 * maxOffset + 1)) - maxOffset;

        // Apply translation to the text element
        text.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    });
}

/**
 * Dynamically calculates and applies optimal circle sizing based on actual viewport.
 * Uses window.innerHeight/innerWidth which represent the ACTUAL visible area,
 * automatically excluding browser chrome (address bar, status bar, etc.).
 */
function updateCircleSizing() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Determine orientation
    const isPortrait = viewportHeight > viewportWidth;

    // Find all status boxes to determine N
    const statusBoxes = document.querySelectorAll('.status-box');
    // Ensure we count at least 5 to prevent accidental huge sizing if DOM isn't ready
    const numBoxes = Math.max(statusBoxes.length, 5);

    // Calculate dimensions
    const longDimension = Math.max(viewportWidth, viewportHeight);
    const shortDimension = Math.min(viewportWidth, viewportHeight);

    // CONSTRAINT 1: Stacking Limit (Vertical fit in portrait / Horizontal fit in landscape)
    // We need to fit 'numBoxes' in the long dimension.
    // Reserve 20% total for edge padding and inter-item margins.
    // Using 0.80 factor.
    const maxSizeStacking = (longDimension * 0.80) / numBoxes;

    // CONSTRAINT 2: Cross-Axis Limit (Width fit in portrait / Height fit in landscape)
    // The circle cannot be wider than the short dimension (minus some padding).
    // Reserve ~25% for padding and BURN-IN SHIFTS (+/- 10%).
    // With 0.75 factor, we have 25% slack. +/- 10% shift uses 20% range. 
    // Leaves 5% safety margin (2.5% on each side).
    const maxSizeCrossAxis = shortDimension * 0.75;

    // The optimal size is the smaller of the two constraints
    const circleSize = Math.min(maxSizeStacking, maxSizeCrossAxis);

    // INTELLIGENT BURN-IN AXIS SELECTION:
    // We should shift in the direction that has MORE free space to avoid clipping.
    // If maxSizeStacking < maxSizeCrossAxis, the Main Axis (Stacking) is the bottleneck. Shift Cross-Axis.
    // If maxSizeCrossAxis < maxSizeStacking, the Cross Axis is the bottleneck. Shift Main Axis.

    const mainAxisTight = maxSizeStacking < maxSizeCrossAxis;

    if (isPortrait) {
        // Portrait: Main=Y (Vertical), Cross=X (Horizontal)
        // If Y is tight, shift X. If X is tight, shift Y.
        window.burnInShiftAxis = mainAxisTight ? 'x' : 'y';
    } else {
        // Landscape: Main=X (Horizontal), Cross=Y (Vertical)
        // If X is tight (width limited), shift Y.
        // If Y is tight (height limited), shift X.
        window.burnInShiftAxis = mainAxisTight ? 'y' : 'x';
    }

    // Font is ~28% of circle size
    const fontSize = circleSize * 0.28;

    // Set CSS custom properties acting as a global override
    document.documentElement.style.setProperty('--dynamic-circle-size', `${circleSize}px`);
    document.documentElement.style.setProperty('--dynamic-font-size', `${fontSize}px`);

    // RESET TRANSFORM to avoid sticky shifts when sizing changes
    const container = document.querySelector('.dashboard-container');
    if (container) {
        container.style.transform = 'none';

        // CRITICAL FIX: Enforce the container to match the JS-calculated viewport exactly
        // This prevents the "Unused space" issue where CSS 100vh > innerHeight.
        container.style.height = `${viewportHeight}px`;
        container.style.width = `${viewportWidth}px`; // Explicit width too
    }

    console.log(`Sizing update: ${isPortrait ? 'Portrait' : 'Landscape'}. ` +
        `Limits: Stack=${maxSizeStacking.toFixed(1)}, Cross=${maxSizeCrossAxis.toFixed(1)}. ` +
        `Bottleneck: ${mainAxisTight ? 'Main' : 'Cross'}. ` +
        `Safe Shift Axis: ${window.burnInShiftAxis.toUpperCase()}. ` +
        `Final Size: ${circleSize.toFixed(1)}px`);
}

/**
 * BURN-IN FIX: Shifts the entire container either vertically (Landscape) or 
 * horizontally (Portrait) for anti-burn-in uniform movement.
 */
function randomizeBurnInPosition() {
    const container = document.querySelector('.dashboard-container');
    if (!container) return;

    // 1. RE-CALCULATE BOTTLENECK LIVE (Don't rely on stale globals)
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const isPortrait = viewportHeight > viewportWidth;

    // Default N=5 if not found
    const numBoxes = Math.max(document.querySelectorAll('.status-box').length, 5);

    const longDimension = Math.max(viewportWidth, viewportHeight);
    const shortDimension = Math.min(viewportWidth, viewportHeight);

    // Calculate theoretical limits again to find the tightest constraint
    // Using the same factors as updateCircleSizing (0.80 and 0.75)
    const stackingLimit = (longDimension * 0.80) / numBoxes;
    const crossLimit = shortDimension * 0.75; // This leaves 25% free space

    // If Stack limit < Cross limit, Stack is tight.
    const mainAxisTight = stackingLimit < crossLimit;

    // Determine Safe Axis: Shift in the "Look" (Loose) direction
    let safeAxis;
    if (isPortrait) {
        // Portrait: Main=Y, Cross=X. If Y tight, shift X.
        safeAxis = mainAxisTight ? 'x' : 'y';
    } else {
        // Landscape: Main=X, Cross=Y. If X tight, shift Y.
        safeAxis = mainAxisTight ? 'y' : 'x';
    }

    // 2. DEFINE SHIFT
    // 3% is EXTREMELY safe given 25% free space in the cross axis.
    const maxOffset = 3;

    // Generate random integer between -maxOffset and +maxOffset
    const offset = Math.floor(Math.random() * (2 * maxOffset + 1)) - maxOffset;

    // 3. APPLY TRANSFORM
    if (safeAxis === 'x') {
        container.style.transform = `translateX(${offset}%)`;
    } else {
        container.style.transform = `translateY(${offset}%)`;
    }

    // Debug log to confirm behavior (can be removed later)
    // console.log(`BurnIn: Axis=${safeAxis}, Offset=${offset}%`);
}


/**
 * Fetches data from the server's cache API and updates the DOM.
 */
async function updateDashboard() {

    // 1. GET FALLBACKS (DRY Principle)
    // Read the initial fallback names from the hidden HTML element rendered by Jinja.
    const fallbackElement = document.getElementById('eso-fallbacks');

    // Initialize hoisted variables with the fallbacks read from the DOM.
    // If the element fails to read (very unlikely), fall back to hardcoded defaults.
    let naDisplayName = fallbackElement ? fallbackElement.dataset.naDefault : 'PC-NA';
    let euDisplayName = fallbackElement ? fallbackElement.dataset.euDefault : 'PC-EU';

    // Default status for failure
    const errorStatus = 'ERROR';
    const errorCssClass = 'status-orange';

    try {
        const response = await fetch(API_URL);
        const data = await response.json();

        // BURN-IN FIXES: Apply randomization on data update
        shuffleChildren();
        randomizeTextPosition();
        randomizeBurnInPosition();

        // 2. OVERWRITE HOISTED VARIABLES
        // If the fetch is successful, use the actual configured names from the server payload.
        if (data.eso_config) {
            // Use the configured name if available, otherwise keep the hoisted default
            naDisplayName = data.eso_config.NA_DISPLAY_NAME || naDisplayName;
            euDisplayName = data.eso_config.EU_DISPLAY_NAME || euDisplayName;
        }

        // --- 3. Update ESO NA Status ---
        const naStatus = data.eso_status.NA || data.eso_status['PC NA'] || errorStatus;
        const naCssClass = getStatusClass(naStatus);
        updateBoxDisplay('na-box', naStatus, naCssClass, naDisplayName);

        // --- 4. Update ESO EU Status ---
        const euStatus = data.eso_status.EU || data.eso_status['PC EU'] || errorStatus;
        const euCssClass = getStatusClass(euStatus);
        updateBoxDisplay('eu-box', euStatus, euCssClass, euDisplayName);

        // --- 5. Update ALL Calendar Statuses (Fix for display_text remains) ---
        const calendarStatuses = data.calendar_statuses || [];

        calendarStatuses.forEach(cal => {
            const boxId = `${cal.id}-calendar-box`;

            // To ensure medical-free remains invisible, we check the CSS class.
            let statusText = String(cal.display_text || cal.status).toUpperCase();
            if (cal.css_class === 'medical-free' || cal.css_class === 'status-transparent') {
                statusText = '';
            }

            updateBoxDisplay(boxId, cal.status, cal.css_class, statusText);
        });

        // DYNAMIC SIZING RE-CHECK: Ensure layout is correct after DOM manipulation
        updateCircleSizing();

    } catch (error) {
        console.error("Failed to fetch dashboard data:", error);

        // 6. FALLBACK: Use the hoisted variables (which retain the safe fallback value)
        updateBoxDisplay('na-box', errorStatus, errorCssClass, naDisplayName);
        updateBoxDisplay('eu-box', errorStatus, errorCssClass, euDisplayName);
    }
}

/**
 * ADD THIS FUNCTION
 * Toggles fullscreen mode for the entire document.
 */
function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen()
            .catch(err => console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`));
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

/**
 * ADD THIS FUNCTION
 * Updates the fullscreen icon visibility based on the current state.
 */
function updateFullscreenIcons() {
    const enterIcon = document.getElementById('fs-icon-enter');
    const exitIcon = document.getElementById('fs-icon-exit');
    if (!enterIcon || !exitIcon) return;

    if (document.fullscreenElement) {
        enterIcon.style.display = 'none';
        exitIcon.style.display = 'block';
    } else {
        enterIcon.style.display = 'block';
        exitIcon.style.display = 'none';
    }
}

/**
 * Handles the click event to manually refresh the Calendar status.
 */
async function handleCalendarRefresh(event) {
    try {
        const response = await fetch(CALENDAR_REFRESH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (response.status === 429) {
            alert(data.message);
            updateDashboard();
        } else if (data.success) {
            console.log("Manual refresh successful. Waiting for server push.");
        } else {
            alert(`Refresh failed: ${data.message || 'Unknown Error'}`);
            updateDashboard();
        }

    } catch (error) {
        console.error("Calendar Refresh API call failed:", error);
        alert("A network error occurred while refreshing the calendar.");
        updateDashboard();
    }
}


// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Disable the click listener for the NA box 
    const naBox = document.getElementById('na-box');
    if (naBox) { naBox.style.cursor = 'default'; }

    // Find all calendar boxes and enable the click listener
    const calendarBoxes = document.querySelectorAll('.calendar-box');
    calendarBoxes.forEach(box => {
        box.addEventListener('click', handleCalendarRefresh);
    });

    // --- ADD THESE LINES FOR FULLSCREEN ---
    const fsButton = document.getElementById('fullscreen-button');
    if (fsButton) {
        fsButton.addEventListener('click', toggleFullScreen);
    }
    // Listen for changes to fullscreen state (e.g., user pressing ESC)
    document.addEventListener('fullscreenchange', updateFullscreenIcons);
    // Set initial icon state on load
    updateFullscreenIcons();
    // --- END OF ADDED LINES --- 

    // DYNAMIC SIZING: Calculate optimal circle sizes on load
    updateCircleSizing();

    // Recalculate on resize (orientation change, fullscreen toggle, etc.)
    window.addEventListener('resize', updateCircleSizing);

    // Start Dashboard with initial load
    updateDashboard();

    // BURN-IN FIX: Periodically trigger burn-in prevention functions every 30 seconds
    setInterval(() => {
        console.log('Client-side burn-in prevention running...');
        randomizeTextPosition();
        shuffleChildren();
        randomizeBurnInPosition();
    }, BURN_IN_INTERVAL);
});