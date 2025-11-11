// static/dashboard.js

// --- CONFIGURATION ---
const API_URL = '/api/status';
const CALENDAR_REFRESH_URL = '/api/refresh_calendar';
const BURN_IN_INTERVAL = 30000; // 30 seconds (30000 milliseconds)

// --- SOCKETIO SETUP ---
const socket = io(); 

socket.on('connect', function() {
    console.log('Connected to dashboard server via WebSocket.');
});

socket.on('status_update', function(data) {
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
 * BURN-IN FIX: Shifts the entire container vertically for uniform movement.
 * Uses the full range (±10%) to break up static vertical lines over time.
 */
function randomizeVerticalPosition() {
    const container = document.querySelector('.dashboard-container');
    if (!container) return;
    
    // Shift range: -10% to +10% of the container's height.
    // Since the container is 100vh, this utilizes the maximum safe space.
    const maxOffset = 10; 
    
    // Generate random offset for Y-axis
    const offsetY = Math.floor(Math.random() * (2 * maxOffset + 1)) - maxOffset;

    // Apply only vertical translation to the container element
    container.style.transform = `translateY(${offsetY}%)`;
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
        randomizeVerticalPosition();
        
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
        console.log('EU Server Status Received:', euStatus); // Check what this prints!
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

    } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
        
        // 6. FALLBACK: Use the hoisted variables (which retain the safe fallback value)
        updateBoxDisplay('na-box', errorStatus, errorCssClass, naDisplayName);
        updateBoxDisplay('eu-box', errorStatus, errorCssClass, euDisplayName);
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
    
    // Start Dashboard with initial load
    updateDashboard();

    // BURN-IN FIX: Periodically trigger burn-in prevention functions every 30 seconds
    setInterval(() => {
        console.log('Client-side burn-in prevention running...');
        randomizeTextPosition(); 
        shuffleChildren();       
        randomizeVerticalPosition(); // NEW: Uniform vertical shift
    }, BURN_IN_INTERVAL);
});