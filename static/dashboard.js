// static/dashboard.js

// --- CONFIGURATION ---
const API_URL = '/api/status';
const CALENDAR_REFRESH_URL = '/api/refresh_calendar';
const BURN_IN_INTERVAL = 30000; // 30 seconds (30000 milliseconds)

// --- GLOBAL STATE ---
let possibleTexts = []; // Stores all possible status strings for font scaling
let isFirstLoad = true;

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
    if (!box) return;

    const textElement = document.getElementById(boxId.replace('-box', '-text'));
    const isCalendarBox = box.classList.contains('calendar-box');
    const clickableClass = isCalendarBox ? ' clickable' : '';

    box.className = 'status-box ' + cssClass + clickableClass;

    if (textContent !== undefined && textElement) {
        textElement.textContent = textContent;
    }
}

/**
 * Shuffles the children of the dashboard container to prevent burn-in.
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
 * Uniformly shifts the text position across all boxes.
 */
function randomizeTextPosition() {
    const textElements = document.querySelectorAll('.status-box h2');
    const maxOffset = 1;

    const offsetX = Math.floor(Math.random() * (2 * maxOffset + 1)) - maxOffset;
    const offsetY = Math.floor(Math.random() * (2 * maxOffset + 1)) - maxOffset;

    textElements.forEach(text => {
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

    // --- DYNAMIC FONT SCALING ---
    // Start with a base font size (~28% of circle size)
    let fontSize = circleSize * 0.28;

    // --- BIDIRECTIONAL DUAL-AXIS SCALING ---
    // Identify words to measure (master list or currently visible)
    let textsToMeasure = [...possibleTexts];
    if (textsToMeasure.length === 0) {
        textsToMeasure = Array.from(document.querySelectorAll('.status-box h2'))
            .map(el => el.textContent.trim())
            .filter(t => t);
    }

    if (textsToMeasure.length > 0) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const measurementBaseSize = 100;
        context.font = `bold ${measurementBaseSize}px Arial, sans-serif`;

        let maxBoxWidth = 0;
        let maxBoxHeight = 0;

        textsToMeasure.forEach(text => {
            const metrics = context.measureText(text);
            const w = metrics.width;
            const h = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
            if (w > maxBoxWidth) maxBoxWidth = w;
            if (h > maxBoxHeight) maxBoxHeight = h;
        });

        const targetSize = circleSize * 0.85; // 85% threshold leaves 7.5% margin on top and bottom
        const fontSizeForWidth = maxBoxWidth > 0 ? (targetSize / maxBoxWidth) * measurementBaseSize : 100;
        const fontSizeForHeight = maxBoxHeight > 0 ? (targetSize / maxBoxHeight) * measurementBaseSize : 100;

        fontSize = Math.min(fontSizeForWidth, fontSizeForHeight);

        console.log(`Scaling: Constrained by ${fontSizeForWidth < fontSizeForHeight ? 'width' : 'height'}. Threshold: 85%. Final font-size: ${fontSize.toFixed(1)}px`);
    }

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

    // Font is ~28% of circle size (already calculated and potentially scaled above)

    // Set CSS custom properties acting as a global override
    document.documentElement.style.setProperty('--dynamic-circle-size', `${circleSize}px`);
    document.documentElement.style.setProperty('--dynamic-font-size', `${fontSize}px`);

    // RESET ALL TRANSFORMS to avoid sticky offsets
    const container = document.querySelector('.dashboard-container');
    if (container) {
        container.style.transform = 'none';
        container.style.height = `${viewportHeight}px`;
        container.style.width = `${viewportWidth}px`;
    }
    document.querySelectorAll('.status-box h2').forEach(text => {
        text.style.transform = 'none';
    });

    console.log(`Sizing update: ${isPortrait ? 'Portrait' : 'Landscape'}. Size: ${circleSize.toFixed(1)}px`);
}

/**
 * Shifts the entire container for anti-burn-in.
 */
function randomizeBurnInPosition() {
    const container = document.querySelector('.dashboard-container');
    if (!container) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const isPortrait = viewportHeight > viewportWidth;

    const numBoxes = Math.max(document.querySelectorAll('.status-box').length, 5);

    const longDimension = Math.max(viewportWidth, viewportHeight);
    const shortDimension = Math.min(viewportWidth, viewportHeight);

    const stackingLimit = (longDimension * 0.80) / numBoxes;
    const crossLimit = shortDimension * 0.75;
    const mainAxisTight = stackingLimit < crossLimit;

    let safeAxis;
    if (isPortrait) {
        safeAxis = mainAxisTight ? 'x' : 'y';
    } else {
        safeAxis = mainAxisTight ? 'y' : 'x';
    }

    const maxOffset = 3;
    const offset = Math.floor(Math.random() * (2 * maxOffset + 1)) - maxOffset;

    if (safeAxis === 'x') {
        container.style.transform = `translateX(${offset}%)`;
    } else {
        container.style.transform = `translateY(${offset}%)`;
    }
}

/**
 * Fetches data from the server's cache API and updates the DOM.
 */
async function updateDashboard() {
    const fallbackElement = document.getElementById('eso-fallbacks');
    let naDisplayName = fallbackElement ? fallbackElement.dataset.naDefault : 'PC-NA';
    let euDisplayName = fallbackElement ? fallbackElement.dataset.euDefault : 'PC-EU';

    const errorStatus = 'ERROR';
    const errorCssClass = 'status-orange';

    try {
        const response = await fetch(API_URL);
        const data = await response.json();

        if (data.all_possible_texts) {
            possibleTexts = data.all_possible_texts;
        }

        if (data.eso_config) {
            naDisplayName = data.eso_config.NA_DISPLAY_NAME || naDisplayName;
            euDisplayName = data.eso_config.EU_DISPLAY_NAME || euDisplayName;
        }

        const naStatus = data.eso_status.NA || data.eso_status['PC NA'] || errorStatus;
        const naCssClass = getStatusClass(naStatus);
        updateBoxDisplay('na-box', naStatus, naCssClass, naDisplayName);

        const euStatus = data.eso_status.EU || data.eso_status['PC EU'] || errorStatus;
        const euCssClass = getStatusClass(euStatus);
        updateBoxDisplay('eu-box', euStatus, euCssClass, euDisplayName);

        const calendarStatuses = data.calendar_statuses || [];
        calendarStatuses.forEach(cal => {
            const boxId = `${cal.id}-calendar-box`;
            let statusText = String(cal.display_text || cal.status).toUpperCase();
            if (cal.css_class === 'medical-free' || cal.css_class === 'status-transparent') {
                statusText = '';
            }
            updateBoxDisplay(boxId, cal.status, cal.css_class, statusText);
        });

        updateCircleSizing();

    } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
        updateBoxDisplay('na-box', errorStatus, errorCssClass, naDisplayName);
        updateBoxDisplay('eu-box', errorStatus, errorCssClass, euDisplayName);
    } finally {
        const container = document.querySelector('.dashboard-container');
        if (container) {
            if (isFirstLoad) {
                shuffleChildren();
                randomizeTextPosition();
                randomizeBurnInPosition();
                isFirstLoad = false;
            }
            container.classList.add('visible');
        }
    }
}

/**
 * Toggles fullscreen mode.
 */
function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen()
            .catch(err => console.error(`Error attempting to enable full-screen mode: ${err.message}`));
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

/**
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
 * Manually refreshes the Calendar status.
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
            console.log("Manual refresh successful.");
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

document.addEventListener('DOMContentLoaded', () => {
    const naBox = document.getElementById('na-box');
    if (naBox) { naBox.style.cursor = 'default'; }

    const calendarBoxes = document.querySelectorAll('.calendar-box');
    calendarBoxes.forEach(box => {
        box.addEventListener('click', handleCalendarRefresh);
    });

    const fsButton = document.getElementById('fullscreen-button');
    if (fsButton) {
        fsButton.addEventListener('click', toggleFullScreen);
    }
    document.addEventListener('fullscreenchange', updateFullscreenIcons);
    updateFullscreenIcons();

    updateCircleSizing();
    window.addEventListener('resize', updateCircleSizing);

    updateDashboard();

    setInterval(() => {
        randomizeTextPosition();
        shuffleChildren();
        randomizeBurnInPosition();
    }, BURN_IN_INTERVAL);

    let cursorTimer;
    const hideDelay = 200;

    function hideCursor() {
        document.body.classList.add('hide-cursor');
    }

    function showCursor() {
        if (document.body.classList.contains('hide-cursor')) {
            document.body.classList.remove('hide-cursor');
        }
        clearTimeout(cursorTimer);
        cursorTimer = setTimeout(hideCursor, hideDelay);
    }

    document.addEventListener('mousemove', showCursor);
    document.addEventListener('mousedown', showCursor);
    document.addEventListener('keydown', showCursor);
    document.addEventListener('touchstart', showCursor);

    cursorTimer = setTimeout(hideCursor, hideDelay);
});
