// static/dashboard.js

// --- CONFIGURATION ---
const API_URL = '/api/status';
const CALENDAR_REFRESH_URL = '/api/refresh_calendar';

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
            
            // FIX: Remove .toUpperCase() to correctly honor the configured display_text.
            // If display_text is empty ('') and cal.status is 'FREE', statusText will be 'FREE'.
            // To ensure medical-free remains invisible, we check the CSS class first.
            let statusText = String(cal.display_text || cal.status); 
            
            // If the CSS class indicates the hidden state, force the text to be empty.
            if (cal.css_class === 'medical-free') {
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
});