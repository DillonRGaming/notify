const notesGrid = document.getElementById('notes-grid');
const addNoteBtn = document.getElementById('add-note-btn');
const searchInput = document.getElementById('search-input');
const noteEditor = document.getElementById('note-editor');
const editorTitleInput = document.getElementById('editor-title-input');
const editorContentArea = document.getElementById('editor-content-area'); // Contenteditable div
const editorColorPalette = document.getElementById('editor-color-palette'); // The palette element already in HTML
const editorDeleteBtn = document.getElementById('editor-delete-btn');
const editorFixBtn = document.getElementById('editor-fix-btn');
const editorSyncButton = document.getElementById('editor-sync-button'); // New sync button
const mainHeading = document.getElementById('main-heading');
const backButton = document.getElementById('back-button');
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menu-toggle');
const connectionStatus = document.getElementById('connection-status');

const SERVER_ADDRESS = 'localhost';
const WEBSOCKET_URL = `ws://${SERVER_ADDRESS}:8765`;
const GEMINI_API_KEY = 'AIzaSyCGsEW6Hv0pSLtC3uMe_caM0A7XTlJh_I8'; // REMINDER: Replace or remove if not used

let ws;
let allNotes = [];
let currentEditingNoteId = null;
let notesUnderReview = new Set();
let connectInterval = null;
let connectionAttemptActive = false;

// --- NEW: Client ID and Typing State ---
const myClientId = crypto.randomUUID(); // Generate a unique ID for this client
const otherUsersTyping = new Map(); // Map noteId -> Set<clientIds>
let isTyping = false; // Flag to track if *this* client is typing in the current note
const TYPING_STOP_DELAY = 1500; // ms without input before sending typing_stop
const TYPING_START_DELAY = 250; // ms of input before sending typing_start (if not already typing)
// --- END NEW ---


const noteColorMap = {
    '#ffffff': 'var(--note-color-white)',
    '#2a2a2a': 'var(--note-color-black)',
    '#ffcccc': 'var(--note-color-1)',
    '#ccffcc': 'var(--note-color-2)',
    '#ccccff': 'var(--note-color-3)',
    '#ffffcc': 'var(--note-color-4)',
    '#ffccff': 'var(--note-color-5)',
};
const noteColorHexes = Object.keys(noteColorMap);
const defaultColorHex = '#2a2a2a';
const blackColorHex = '#2a2a2a';
const UNTITLED_PLACEHOLDER = '(Untitled Note)';

// Debounce utility - enhanced to allow scheduling
function debounce(func, wait) {
    let timeout;
    let scheduledArgs = null;

    const later = () => {
        timeout = null;
        if (scheduledArgs) {
             func.apply(this, scheduledArgs);
             scheduledArgs = null;
        }
    };

    const debounced = function(...args) {
        scheduledArgs = args; // Store latest args
        if (!timeout) {
            timeout = setTimeout(later, wait);
        }
    };

    debounced.cancel = () => {
        clearTimeout(timeout);
        timeout = null;
        scheduledArgs = null; // Clear args if cancelled
    };

    debounced.flush = function(...args) {
        clearTimeout(timeout);
        timeout = null;
        const currentArgs = args.length > 0 ? args : scheduledArgs;
        if (currentArgs) { // Only call func if there were scheduled args or args provided to flush
             func.apply(this, currentArgs);
        }
        scheduledArgs = null;
    };

     debounced.schedule = function(...args) {
         scheduledArgs = args; // Store latest args
         if (!timeout) {
             timeout = setTimeout(later, wait);
         }
     }


    return debounced;
}


function getDisplayTitle(noteData) {
    const name = noteData?.name || '';
    return name.trim() ? name : UNTITLED_PLACEHOLDER;
}

function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) || connectionAttemptActive) {
        return;
    }
    connectionAttemptActive = true;
    updateConnectionStatus('Connecting...', 'connecting');
    if (connectInterval) { clearInterval(connectInterval); connectInterval = null; }
    ws = new WebSocket(WEBSOCKET_URL);

    ws.onopen = () => {
        connectionAttemptActive = false;
        updateConnectionStatus('Connected', 'connected');
        ws.send(JSON.stringify({ type: 'fetch_notes', clientId: myClientId })); // Send client ID with fetch
        if (connectInterval) { clearInterval(connectInterval); connectInterval = null; }
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            // console.log('Message from server:', data); // Debugging

            if (data.type === 'notes') {
                allNotes = data.notes || [];
                const serverPendingIds = new Set(allNotes.filter(n => n.status === 'pending_deletion').map(n => n.id));
                notesUnderReview.clear();
                serverPendingIds.forEach(id => notesUnderReview.add(id));

                if (currentEditingNoteId && noteEditor.style.display === 'flex') {
                    const currentNoteData = allNotes.find(n => n.id === currentEditingNoteId);
                    if (currentNoteData) {
                        // Only update if the content is different to avoid disrupting typing
                        if (editorTitleInput.value !== currentNoteData.name) editorTitleInput.value = currentNoteData.name;
                        if (editorContentArea.textContent !== currentNoteData.content) editorContentArea.textContent = currentNoteData.content; // Use textContent
                         // Update color if it changed - uses the existing palette element
                        if (noteEditor.style.backgroundColor !== (currentNoteData.color || defaultColorHex)) updateEditorAppearance(currentNoteData);
                        // Color palette visual update is handled within updateEditorAppearance

                        if (notesUnderReview.has(currentEditingNoteId)) {
                             showGridView();
                             alert('The note you were editing is now pending deletion.');
                         }
                    } else {
                        showGridView();
                        alert('The note you were editing was deleted or is no longer available.');
                    }
                }
                 handleSearch(); // Re-render grid - this will update typing indicators
            } else if (data.type === 'typing_start') {
                 if (data.clientId && data.clientId !== myClientId && data.id) {
                     if (!otherUsersTyping.has(data.id)) {
                         otherUsersTyping.set(data.id, new Set());
                     }
                     if (!otherUsersTyping.get(data.id).has(data.clientId)) {
                         otherUsersTyping.get(data.id).add(data.clientId);
                          // Find the specific note element and update its typing indicator
                         const noteElement = notesGrid.querySelector(`.note[data-id="${data.id}"]`);
                         if (noteElement) {
                            const indicator = noteElement.querySelector('.typing-indicator');
                            if (indicator) indicator.classList.add('visible');
                         }
                     }
                 }
            } else if (data.type === 'typing_stop') {
                 if (data.clientId && data.clientId !== myClientId && data.id) {
                     if (otherUsersTyping.has(data.id)) {
                          otherUsersTyping.get(data.id).delete(data.clientId);
                          if (otherUsersTyping.get(data.id).size === 0) {
                              otherUsersTyping.delete(data.id); // Remove note entry if no users are typing
                              // Find the specific note element and update its typing indicator
                              const noteElement = notesGrid.querySelector(`.note[data-id="${data.id}"]`);
                              if (noteElement) {
                                 const indicator = noteElement.querySelector('.typing-indicator');
                                 if (indicator) indicator.classList.remove('visible');
                              }
                          }
                     }
                 }
            }
             else if (data.type === 'error') {
                 console.error("Server Error:", data.message);
                 alert(`Server error: ${data.message}`);
            } else {
                // console.warn("Received unknown message type:", data.type);
            }
        } catch (e) {
            console.error("Error processing message:", e);
        }
    };
    ws.onerror = (error) => {
        connectionAttemptActive = false;
        console.error('WebSocket Error:', error);
        updateConnectionStatus('Error', 'disconnected');
        if(ws) ws.close();
    };
    ws.onclose = (event) => {
        connectionAttemptActive = false;
         updateConnectionStatus('Disconnected', 'disconnected');
         // Clear typing indicators from other users on disconnect
         otherUsersTyping.clear(); // Clear the map
         renderNotes(getFilteredNotes()); // Re-render to hide indicators
         if (!connectInterval) {
             connectInterval = setInterval(() => {
                 if (!ws || ws.readyState === WebSocket.CLOSED) {
                    connectWebSocket(); // Attempt to connect
                 } else {
                     clearInterval(connectInterval);
                     connectInterval = null;
                 }
             }, 5000);
         }
    };
}

function updateConnectionStatus(text, statusClass) {
    connectionStatus.textContent = text;
    connectionStatus.classList.remove('connected', 'disconnected', 'connecting', 'hidden');
    if (statusClass) connectionStatus.classList.add(statusClass);
    connectionStatus.style.opacity = '1';
    connectionStatus.style.pointerEvents = 'auto';

    if (statusClass === 'connected') {
        setTimeout(() => {
            connectionStatus.style.opacity = '0';
            connectionStatus.style.pointerEvents = 'none';
        }, 3000);
    }
}

function sendWebSocketMessage(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        if ('name' in data) {
            data.name = (data.name || '').trim();
        }
         // Add client ID to all outgoing messages (useful for server)
         data.clientId = myClientId;
        ws.send(JSON.stringify(data));
        return true;
    } else {
        console.error("WebSocket is not connected. Cannot send message:", data);
        updateConnectionStatus('Disconnected', 'disconnected');
        alert("Cannot save changes: Connection lost. Please wait for reconnection.");
        return false;
    }
}

// --- NEW: Debounced typing messages ---
const sendTypingStart = debounce((noteId) => {
    // Only send start if connection is open and we are not already flagged as typing
    if (ws && ws.readyState === WebSocket.OPEN && noteId && !isTyping) {
        ws.send(JSON.stringify({ type: 'typing_start', id: noteId, clientId: myClientId }));
        isTyping = true;
         // console.log(`Sent typing_start for note ${noteId}`); // Debugging
    }
     // Always schedule stop after a delay when input occurs
     sendTypingStop.schedule(noteId);
}, TYPING_START_DELAY);


const sendTypingStop = debounce((noteId) => {
     // Only send stop if connection is open and we are currently flagged as typing
     if (ws && ws.readyState === WebSocket.OPEN && noteId && isTyping) {
         ws.send(JSON.stringify({ type: 'typing_stop', id: noteId, clientId: myClientId }));
         isTyping = false;
         // console.log(`Sent typing_stop for note ${noteId}`); // Debugging
     }
}, TYPING_STOP_DELAY);

// Function triggered on editor input (title or content)
function handleEditorInput() {
    if (currentEditingNoteId) {
        // Schedule typing_start message (will be sent if user pauses briefly)
        sendTypingStart.schedule(currentEditingNoteId);
        // The typing_stop is automatically scheduled by sendTypingStart
    }
}
// --- END NEW ---


function createColorPaletteElement(selectedColorHex, targetElement) {
    // This function is only used for the palette INSIDE the editor
    targetElement.innerHTML = '';
    noteColorHexes.forEach(hexColor => {
        const colorOption = document.createElement('button');
        colorOption.classList.add('color-option');
        colorOption.style.backgroundColor = hexColor;
        colorOption.dataset.color = hexColor;
        colorOption.setAttribute('aria-label', `Set color to ${hexColor}`);
        if (hexColor === selectedColorHex) colorOption.classList.add('selected');
        targetElement.appendChild(colorOption);
    });
}

function updateSelectedColorVisual(paletteContainer, newSelectedColorHex) {
    paletteContainer.querySelectorAll('.color-option').forEach(option => {
        option.classList.toggle('selected', option.dataset.color === newSelectedColorHex);
    });
}

function createNoteElement(noteData) {
    // console.log("Creating note element for:", noteData.id); // Debugging
    const { id, content, color, status } = noteData;
    const noteElement = document.createElement('div');
    noteElement.classList.add('note');
    noteElement.dataset.id = id;
    const bgColor = color || defaultColorHex;
    noteElement.style.backgroundColor = bgColor;
    noteElement.classList.toggle('note-dark', bgColor === blackColorHex);

    // --- DEFINING statusOverlay HERE ---
    const statusOverlay = document.createElement('div');
    statusOverlay.classList.add('status-overlay');
    statusOverlay.textContent = 'Deletion under review';
    // --- END DEFINING statusOverlay ---

    const isPending = status === 'pending_deletion' || notesUnderReview.has(id);
    noteElement.classList.toggle('pending-deletion', isPending);
    statusOverlay.style.display = isPending ? 'block' : 'none'; // Set display after isPending is determined


    const titleDiv = document.createElement('div');
    titleDiv.classList.add('note-title');
    titleDiv.textContent = getDisplayTitle(noteData);
    if (!noteData?.name?.trim()) {
         titleDiv.classList.add('placeholder');
    }

    const contentPreview = document.createElement('div');
    contentPreview.classList.add('note-content-preview');
    contentPreview.textContent = content?.substring(0, 150) || ' ';
    if (content && content.length > 150) {
        contentPreview.textContent += '...';
    }

    const footer = document.createElement('div');
    footer.classList.add('note-footer');


    // --- Add typing indicator to footer ---
    const typingIndicator = document.createElement('div');
    typingIndicator.classList.add('typing-indicator');
    typingIndicator.innerHTML = '<span>.</span><span>.</span><span>.</span>'; // The dots
     // Check if *any* other user is typing in this note more robustly
    const isTypingVisible = (otherUsersTyping.get(id)?.size || 0) > 0;
    typingIndicator.classList.toggle('visible', isTypingVisible);
    footer.appendChild(typingIndicator);
    // --- End Add typing indicator ---

    // The color palette is NOT created here; it's only in the editor HTML

    noteElement.appendChild(titleDiv);
    noteElement.appendChild(contentPreview);
    noteElement.appendChild(footer); // Add the footer containing typing indicator etc.
    noteElement.appendChild(statusOverlay); // Add status overlay (deletion pending)


    if (!isPending) {
         noteElement.addEventListener('click', () => showEditorView(noteData));
         noteElement.style.cursor = 'pointer';
    } else {
         noteElement.style.cursor = 'not-allowed';
    }
    return noteElement;
}

function showGridView() {
    if (currentEditingNoteId) {
         saveCurrentNoteChanges.flush(); // Save any pending changes on leave
         // --- NEW: Send typing_stop when leaving editor ---
         sendTypingStop.flush(currentEditingNoteId); // Ensure typing stop is sent immediately
         sendTypingStart.cancel(); // Cancel any pending start message
         isTyping = false; // Ensure client side flag is correct
         // --- END NEW ---
    }

    notesGrid.style.display = 'grid';
    noteEditor.style.display = 'none';
    mainHeading.style.opacity = '1';
    backButton.classList.remove('visible');
    currentEditingNoteId = null;
    handleSearch(); // Re-render notes grid
    const refreshButton = document.getElementById('refresh-button');
    if (refreshButton) {
        refreshButton.style.display = 'flex';
    }

    if (window.innerWidth <= 768 && sidebar.classList.contains('active')) {
         sidebar.classList.remove('active');
    }
}

function updateEditorAppearance(noteData) {
     const editorColor = noteData.color || defaultColorHex;
     noteEditor.style.backgroundColor = editorColor;
     noteEditor.classList.toggle('editor-dark', editorColor === blackColorHex);
     // Use the existing editorColorPalette element
     createColorPaletteElement(editorColor, editorColorPalette); // Update the color options' selected state

     // Update border color for the selected option in the editor palette
     editorColorPalette.querySelectorAll('.color-option.selected').forEach(option => {
         option.style.borderColor = (editorColor === blackColorHex) ? 'var(--text-light)' : 'var(--button-primary-bg)';
     });
}

function showEditorView(noteData) {
    if (!noteData) return;
    if (currentEditingNoteId && currentEditingNoteId !== noteData.id) {
        saveCurrentNoteChanges.flush(); // Save changes of the *previously* edited note
        sendTypingStop.flush(currentEditingNoteId); // Stop typing for the previous note
        sendTypingStart.cancel(); // Cancel any pending start for the previous note
        isTyping = false; // Ensure client side flag is correct
    }

    currentEditingNoteId = noteData.id;
    editorTitleInput.value = noteData.name || '';
    editorContentArea.textContent = noteData.content || ''; // Use textContent for div

    updateEditorAppearance(noteData); // Set editor color and palette state
    mainHeading.style.opacity = '0';
    backButton.classList.add('visible');
    notesGrid.style.display = 'none';
    noteEditor.style.display = 'flex';

    const refreshButton = document.getElementById('refresh-button');
    if (refreshButton) {
        refreshButton.style.display = 'none';
    }

    // --- NEW: Send typing_start when entering editor ---
    // Assume typing starts when editor opens for this user
    isTyping = true;
    // Schedule the first typing start message - it will send after DELAY if no input happens immediately,
    // or be reset and resent by handleEditorInput if typing starts quickly.
    sendTypingStart.schedule(currentEditingNoteId);
    // --- END NEW ---


    editorTitleInput.focus();
    // Need a slight delay to select text after focus in some browsers/conditions
    setTimeout(() => {
        try { // Use try/catch in case select() fails on some elements/browsers
           editorTitleInput.select();
        } catch (e) {
            console.warn("Failed to select title text:", e);
        }
    }, 0);

    if (window.innerWidth <= 768 && sidebar.classList.contains('active')) {
         sidebar.classList.remove('active');
    }
}

// Helper to get filtered notes based on current search
function getFilteredNotes() {
     const searchTerm = searchInput.value.toLowerCase().trim();
     if (!searchTerm) return allNotes;
     return allNotes.filter(note =>
         // Check title and content for search term (case-insensitive)
         (getDisplayTitle(note) || '').toLowerCase().includes(searchTerm) ||
         (note.content || '').toLowerCase().includes(searchTerm)
     );
}


 function renderNotes(notesToRender = allNotes) {
     // console.log(`Rendering ${notesToRender.length} notes.`); // Debugging
     notesGrid.innerHTML = '';
     // Sort notes by ID descending (newest first)
     const sortedNotes = [...notesToRender].sort((a, b) => parseInt(b.id || 0) - parseInt(a.id || 0));

     if (sortedNotes.length === 0 && searchInput.value) {
         notesGrid.innerHTML = '<p style="color: var(--text-secondary); grid-column: 1 / -1; text-align: center; margin-top: 20px;">No notes match your search.</p>';
     } else if (sortedNotes.length === 0) {
         notesGrid.innerHTML = '<p style="color: var(--text-secondary); grid-column: 1 / -1; text-align: center; margin-top: 20px;">No notes yet. Click <i class="fa-solid fa-plus"></i> to add one!</p>';
     } else {
         sortedNotes.forEach(note => {
             // console.log("Creating element for note ID:", note.id); // Debugging
             const noteElement = createNoteElement(note);
             if (noteElement) { // Check if creation was successful
                  notesGrid.appendChild(noteElement);
             } else {
                 console.error("Failed to create note element for note:", note);
             }
         });
     }
 }

// MANUAL SAVE FUNCTION (triggered by button or leaving editor)
// Removed debounce around the saving logic itself. The input handling debounces the *typing indicators*.
// Actual saving is triggered explicitly by flush or the sync button.
function saveCurrentNoteChangesLogic() {
     if (!currentEditingNoteId) return;
     const currentNoteInState = allNotes.find(n => n.id === currentEditingNoteId);
     if (!currentNoteInState) return;

     const updatedTitle = editorTitleInput.value.trim();
     const updatedContent = editorContentArea.textContent; // Use textContent

     // Only send update if there's a change in title or content
     if ((currentNoteInState.name || '') !== updatedTitle || currentNoteInState.content !== updatedContent) {
           console.log(`Saving changes for note ${currentEditingNoteId}`);
           sendWebSocketMessage({
                type: 'update_note',
                id: currentEditingNoteId,
                name: updatedTitle,
                content: updatedContent,
                color: currentNoteInState.color // Include color
           });
       }
      // Cancel any pending typing messages related to this save
      sendTypingStart.cancel();
      sendTypingStop.flush(currentEditingNoteId); // Ensure typing stop is sent after saving/manual sync
      isTyping = false; // Ensure client side flag is correct
};

// saveCurrentNoteChanges.flush now just calls the logic directly
const saveCurrentNoteChanges = {
    flush: saveCurrentNoteChangesLogic
};

// Function to add a new note
function addNote() {
    // Generate a client-side temporary ID (Timestamp)
    const newNoteData = {
        type: 'add_note',
        id: Date.now().toString(), // Use timestamp as temp ID
        name: '',
        content: '',
        color: defaultColorHex
    };
    // Send message to server to add the note
    if (sendWebSocketMessage(newNoteData)) {
        // Clear search if active, so the new note is visible in the grid immediately (assuming server sends updated list back)
        if (searchInput.value) searchInput.value = '';
        // The server should send back the updated list which will trigger renderNotes
    }
}

 // Function to request note deletion (sends message to server for approval)
 function requestNoteDeletion() {
     if (!currentEditingNoteId) return;
      if (notesUnderReview.has(currentEditingNoteId)) {
         alert("Deletion request already sent for this note.");
         return;
      }
     const noteToRequest = allNotes.find(n => n.id === currentEditingNoteId);
     if (!noteToRequest) return;

     const displayTitle = getDisplayTitle(noteToRequest);
     if (confirm(`Request deletion for note "${displayTitle}"?\nThis requires confirmation in Discord.`)) {
         if (sendWebSocketMessage({ type: 'request_delete', id: currentEditingNoteId })) {
            notesUnderReview.add(currentEditingNoteId);
            showGridView(); // Go back to grid view after requesting deletion
         }
     }
 }

async function fixNoteContent() {
     if (!currentEditingNoteId) return;
     const note = allNotes.find(n => n.id === currentEditingNoteId);
     if (!note) return;
     if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
         alert("Gemini API Key is not configured in script.js"); return;
     }
     editorFixBtn.disabled = true; editorFixBtn.style.opacity = '0.5'; editorFixBtn.style.cursor = 'wait';
     try {
         const currentName = editorTitleInput.value || '';
         const currentContent = editorContentArea.textContent || ''; // Use textContent

         const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({
                 contents: [{ parts: [{
                     text: `Correct the spelling and grammar in the following title and content, keeping the original meaning and tone intact. Return ONLY the corrected title and content in strict JSON format like {"title": "corrected title", "content": "corrected content"}. If the original title was blank, the corrected title should also be blank. Do not include any introductory or explanatory text:\n\nTitle: ${currentName}\nContent: ${currentContent}`
                 }] }]
             })
         });
         if (!response.ok) {
            const errorText = await response.text(); console.error("API Error:", errorText);
            try { const d=JSON.parse(errorText); throw new Error(`API Error: ${d?.error?.message||response.statusText}`); }
            catch(e){ throw new Error(`API Error ${response.status}: ${errorText}`); }
         }
         const data = await response.json();

         if (!data.candidates?.[0]?.content?.parts?.[0]?.text) throw new Error('Invalid API response structure.');
         const correctedText = data.candidates[0].content.parts[0].text;
         let corrected;
         try { corrected = JSON.parse(correctedText); }
         catch (parseError) {
             const jsonMatch = correctedText.match(/\{[\s\S]*\}/);
             if (jsonMatch) { try { corrected = JSON.parse(jsonMatch[0]); } catch (e){throw new Error("Cannot parse API response content.");} }
             else { throw new Error("Cannot parse API response content.");}
         }

         if (!corrected || typeof corrected.title === 'undefined' || typeof corrected.content === 'undefined' || corrected.content === null) { // Check for null content too
             throw new Error('Parsed JSON structure incorrect or contains null/undefined values.');
         }
          // Ensure title is not null/undefined if content exists, default to empty string
         const correctedTitle = corrected.title === null || typeof corrected.title === 'undefined' ? '' : corrected.title;
         const correctedContent = corrected.content === null || typeof corrected.content === 'undefined' ? '' : corrected.content;

         editorTitleInput.value = correctedTitle;
         editorContentArea.textContent = correctedContent; // Use textContent

         // Send updated note to server immediately after AI fix
         sendWebSocketMessage({ type: 'update_note', id: note.id, name: correctedTitle, content: correctedContent, color: note.color });
         // Ensure typing stops after AI edit and save
         sendTypingStop.flush(currentEditingNoteId);
         sendTypingStart.cancel();
         isTyping = false;

     } catch (error) { console.error('Error fixing note:', error); alert(`Failed to fix note: ${error.message}.`);
     } finally { editorFixBtn.disabled = false; editorFixBtn.style.opacity = '1'; editorFixBtn.style.cursor = 'pointer'; }
 }

const handleSearch = debounce(() => {
    if (noteEditor.style.display !== 'flex') { // Only filter/render search results if NOT in editor view
        renderNotes(getFilteredNotes());
    }
}, 250);

// Setup all event listeners
function setupEventListeners() {
     addNoteBtn.addEventListener('click', addNote);
     searchInput.addEventListener('input', handleSearch);
     menuToggle.addEventListener('click', () => sidebar.classList.toggle('active'));
     backButton.addEventListener('click', showGridView);

     const refreshButton = document.getElementById('refresh-button');
     if (refreshButton) {
         refreshButton.addEventListener('click', () => {
             if (ws && ws.readyState === WebSocket.OPEN) {
                 ws.send(JSON.stringify({ type: 'fetch_notes' }));
             } else {
                 alert("Cannot refresh: Connection is not open. Attempting to reconnect.");
                 connectWebSocket();
             }
         });
     }

     // Input listeners now ONLY trigger typing messages
     editorTitleInput.addEventListener('input', handleEditorInput);
     editorContentArea.addEventListener('input', handleEditorInput);

     // --- Manual sync button listener ---
     editorSyncButton.addEventListener('click', () => {
         saveCurrentNoteChanges.flush(); // Calls the actual save logic
     });

     editorDeleteBtn.addEventListener('click', requestNoteDeletion);
     editorFixBtn.addEventListener('click', fixNoteContent);

     editorColorPalette.addEventListener('click', (e) => {
         const colorButton = e.target.closest('.color-option');
         if (colorButton && currentEditingNoteId) {
             const newColorHex = colorButton.dataset.color;
             const currentNoteData = allNotes.find(n => n.id === currentEditingNoteId);
              if (currentNoteData && currentNoteData.color !== newColorHex) {
                 updateEditorAppearance({...currentNoteData, color: newColorHex}); // Update editor colors immediately visually
                 // The visual palette update is inside updateEditorAppearance now

                 // Send color update immediately
                 sendWebSocketMessage({
                     type: 'update_note', id: currentEditingNoteId, color: newColorHex,
                      name: editorTitleInput.value.trim(), content: editorContentArea.textContent // Include current title/content
                 });
                  // Note: Changing color is not considered 'typing', so don't send typing message here.
              }
         }
     });

     window.addEventListener('keydown', (e) => {
         // Check if Escape is pressed AND the editor is currently displayed
         if (e.key === 'Escape' && noteEditor.style.display === 'flex') {
             e.preventDefault(); // Prevent default browser escape behavior if any
             showGridView(); // Go back to grid view
         }
     });

     // Handle sidebar visibility on window resize for mobile
     const checkMobileToggle = () => {
         const isMobile = window.innerWidth <= 768;
         menuToggle.style.display = isMobile ? 'flex' : 'none'; // Show/hide menu toggle based on width
         // Hide sidebar if open on desktop widths
         if (!isMobile && sidebar.classList.contains('active')) sidebar.classList.remove('active');
     };
     window.addEventListener('resize', checkMobileToggle);
     // Initial check on load
     checkMobileToggle();
}

// Initialize application on DOM load
document.addEventListener('DOMContentLoaded', () => {
    renderNotes(); // Initial render (will be empty until notes are fetched)
    setupEventListeners(); // Setup all event listeners
    connectWebSocket(); // Attempt to connect to WebSocket server
});