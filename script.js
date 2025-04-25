const notesGrid = document.getElementById('notes-grid');
const addNoteBtn = document.getElementById('add-note-btn');
const searchInput = document.getElementById('search-input');
const noteEditor = document.getElementById('note-editor');
const editorTitleInput = document.getElementById('editor-title-input');
const editorContentTextarea = document.getElementById('editor-content-textarea');
const editorColorPalette = document.getElementById('editor-color-palette');
const editorDeleteBtn = document.getElementById('editor-delete-btn');
const editorFixBtn = document.getElementById('editor-fix-btn');
const mainHeading = document.getElementById('main-heading');
const backButton = document.getElementById('back-button');
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menu-toggle');
const connectionStatus = document.getElementById('connection-status');

const SERVER_ADDRESS = 'localhost';
const WEBSOCKET_URL = `ws://${SERVER_ADDRESS}:8765`;
const GEMINI_API_KEY = 'AIzaSyCGsEW6Hv0pSLtC3uMe_caM0A7XTlJh_I8';

let ws;
let allNotes = [];
let currentEditingNoteId = null;
let notesUnderReview = new Set();
let connectInterval = null;
let connectionAttemptActive = false;

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

function debounce(func, wait) { let t; return function(...a) { const l = () => { clearTimeout(t); func.apply(this, a); }; clearTimeout(t); t = setTimeout(l, wait); }; }

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
        ws.send(JSON.stringify({ type: 'fetch_notes' }));
        if (connectInterval) { clearInterval(connectInterval); connectInterval = null; }
    };
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);


            if (data.type === 'notes') {
                allNotes = data.notes || [];
                const serverNoteIds = new Set(allNotes.map(n => n.id));
                const serverPendingIds = new Set(allNotes.filter(n => n.status === 'pending_deletion').map(n => n.id));
                notesUnderReview.clear();
                serverPendingIds.forEach(id => notesUnderReview.add(id));

                if (currentEditingNoteId && noteEditor.classList.contains('active')) {
                    const currentNoteData = allNotes.find(n => n.id === currentEditingNoteId);
                    if (currentNoteData) {
                        if (editorTitleInput.value !== currentNoteData.name) editorTitleInput.value = currentNoteData.name;
                        if (editorContentTextarea.value !== currentNoteData.content) editorContentTextarea.value = currentNoteData.content;
                        if (noteEditor.style.backgroundColor !== (currentNoteData.color || defaultColorHex)) updateEditorAppearance(currentNoteData);
                        updateSelectedColorVisual(editorColorPalette, currentNoteData.color || defaultColorHex);

                        if (notesUnderReview.has(currentEditingNoteId)) {
                             showGridView();
                             alert('The note you were editing is now pending deletion.');
                         }
                    } else {
                        showGridView();
                        alert('The note you were editing was deleted or is no longer available.');
                    }
                }
                 handleSearch();
            } else if (data.type === 'error') {
                 console.error("Server Error:", data.message);
                 alert(`Server error: ${data.message}`);
            } else {

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
         if (!connectInterval) {

             connectInterval = setInterval(() => {
                 if (!ws || ws.readyState === WebSocket.CLOSED) {
                    connectWebSocket();
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
}

function sendWebSocketMessage(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        if ('name' in data) {
            data.name = (data.name || '').trim();
        }
        ws.send(JSON.stringify(data));
        return true;
    } else {
        console.error("WebSocket is not connected. Cannot send message:", data);
        updateConnectionStatus('Disconnected', 'disconnected');
        alert("Cannot save changes: Connection lost. Please wait for reconnection.");
        return false;
    }
}

function createColorPaletteElement(selectedColorHex, targetElement) {
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
    const { id, content, color, status } = noteData;
    const noteElement = document.createElement('div');
    noteElement.classList.add('note');
    noteElement.dataset.id = id;
    const bgColor = color || defaultColorHex;
    noteElement.style.backgroundColor = bgColor;
    noteElement.classList.toggle('note-dark', bgColor === blackColorHex);

    const isPending = status === 'pending_deletion' || notesUnderReview.has(id);
    noteElement.classList.toggle('pending-deletion', isPending);

    const titleDiv = document.createElement('div');
    titleDiv.classList.add('note-title');
    titleDiv.textContent = getDisplayTitle(noteData);
    if (!noteData?.name?.trim()) {
         titleDiv.classList.add('placeholder');
    }

    const contentPreview = document.createElement('div');
    contentPreview.classList.add('note-content-preview');
    contentPreview.textContent = content?.substring(0, 150) || ' ';

    const footer = document.createElement('div');
    footer.classList.add('note-footer');

    const statusOverlay = document.createElement('div');
    statusOverlay.classList.add('status-overlay');
    statusOverlay.textContent = 'Deletion under review';
    statusOverlay.style.display = isPending ? 'block' : 'none';

    noteElement.appendChild(titleDiv);
    noteElement.appendChild(contentPreview);
    noteElement.appendChild(footer);
    noteElement.appendChild(statusOverlay);

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
         saveCurrentNoteChanges.flush();
    }
    notesGrid.style.display = 'grid'; // Show grid using display
    noteEditor.style.display = 'none'; // Hide editor using display
    mainHeading.style.opacity = '1';
    backButton.classList.remove('visible');
    currentEditingNoteId = null;
    handleSearch();
    if (window.innerWidth <= 768 && sidebar.classList.contains('active')) {
         sidebar.classList.remove('active');
    }
}

function updateEditorAppearance(noteData) {
     const editorColor = noteData.color || defaultColorHex;
     noteEditor.style.backgroundColor = editorColor;
     noteEditor.classList.toggle('editor-dark', editorColor === blackColorHex);
     createColorPaletteElement(editorColor, editorColorPalette);
     editorColorPalette.querySelectorAll('.color-option.selected').forEach(option => {
         option.style.borderColor = (editorColor === blackColorHex) ? 'var(--text-light)' : 'var(--button-primary-bg)';
     });
}

function showEditorView(noteData) {
    if (!noteData) return;
    if (currentEditingNoteId && currentEditingNoteId !== noteData.id) {
        saveCurrentNoteChanges.flush();
    }
    currentEditingNoteId = noteData.id;
    editorTitleInput.value = noteData.name || '';
    editorContentTextarea.value = noteData.content || '';
    updateEditorAppearance(noteData);
    mainHeading.style.opacity = '0';
    backButton.classList.add('visible');
    notesGrid.style.display = 'none'; // Hide grid using display
    noteEditor.style.display = 'flex'; // Show editor using display (flex because it's a flex container)
    const refreshButton = document.getElementById('refresh-button');
    if (refreshButton) {
        refreshButton.style.display = 'none'; // Hide refresh button
    }
    editorTitleInput.focus();
    setTimeout(() => editorTitleInput.select(), 0);
    if (window.innerWidth <= 768 && sidebar.classList.contains('active')) {
         sidebar.classList.remove('active');
    }
}

 function renderNotes(notesToRender = allNotes) {
     notesGrid.innerHTML = '';
     const sortedNotes = [...notesToRender].sort((a, b) => parseInt(b.id || 0) - parseInt(a.id || 0));

     if (sortedNotes.length === 0 && searchInput.value) {
         notesGrid.innerHTML = '<p style="color: var(--text-secondary); grid-column: 1 / -1; text-align: center; margin-top: 20px;">No notes match your search.</p>';
     } else if (sortedNotes.length === 0) {
         notesGrid.innerHTML = '<p style="color: var(--text-secondary); grid-column: 1 / -1; text-align: center; margin-top: 20px;">No notes yet. Click <i class="fa-solid fa-plus"></i> to add one!</p>';
     } else {
         sortedNotes.forEach(note => {
             const noteElement = createNoteElement(note);
             notesGrid.appendChild(noteElement);
         });
     }
 }
function addNote() {

    const newNoteData = {
        type: 'add_note',
        id: Date.now().toString(),
        name: '',
        content: '',
        color: defaultColorHex
    };
    if (sendWebSocketMessage(newNoteData)) {
        if (searchInput.value) searchInput.value = '';
    }
}

const saveCurrentNoteChanges = debounce(() => {
     if (!currentEditingNoteId) return;
     const currentNoteInState = allNotes.find(n => n.id === currentEditingNoteId);
     if (!currentNoteInState) return;

     const updatedTitle = editorTitleInput.value.trim();
     const updatedContent = editorContentTextarea.value;
     if ((currentNoteInState.name || '') !== updatedTitle || currentNoteInState.content !== updatedContent) {

         sendWebSocketMessage({
             type: 'update_note',
             id: currentEditingNoteId,
             name: updatedTitle,
             content: updatedContent,
             color: currentNoteInState.color
         });
     }
}, 500);

saveCurrentNoteChanges.flush = () => {
    const currentNoteInState = allNotes.find(n => n.id === currentEditingNoteId);
     if (!currentNoteInState) return;
      const updatedTitle = editorTitleInput.value.trim();
      const updatedContent = editorContentTextarea.value;
       if ((currentNoteInState.name || '') !== updatedTitle || currentNoteInState.content !== updatedContent) {

           sendWebSocketMessage({
                type: 'update_note',
                id: currentEditingNoteId,
                name: updatedTitle,
                content: updatedContent,
                color: currentNoteInState.color
           });
       }
};

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
            showGridView();
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

         const currentName = note.name || '';
         const currentContent = note.content || '';
         const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({
                 contents: [{ parts: [{
                     text: `Correct the spelling and grammar in the following title and content, keeping the original meaning and tone intact. Return ONLY the corrected title and content in strict JSON format like {"title": "corrected title", "content": "corrected content"}. If the original title was blank, the corrected title should also be blank. Do not include introductory text:\n\nTitle: ${currentName}\nContent: ${currentContent}`
                 }] }]
             })
         });
         if (!response.ok) {
            const errorText = await response.text(); console.error("API Error:", errorText);
            try { const d=JSON.parse(errorText); throw new Error(`API Error: ${d?.error?.message||response.statusText}`); }
            catch(e){ throw new Error(`API Error ${response.status}: ${errorText}`); }
         }
         const data = await response.json();

         if (!data.candidates?.[0]?.content?.parts?.[0]?.text) throw new Error('Invalid API structure');
         const correctedText = data.candidates[0].content.parts[0].text;
         let corrected;
         try { corrected = JSON.parse(correctedText); }
         catch (parseError) {
             const jsonMatch = correctedText.match(/\{[\s\S]*\}/);
             if (jsonMatch) { try { corrected = JSON.parse(jsonMatch[0]); } catch (e){throw new Error("Cannot parse API response");} }
             else { throw new Error("Cannot parse API response");}
         }
         // Add check for null/undefined title/content before using them
         if (!corrected || typeof corrected.title === 'undefined' || typeof corrected.content === 'undefined' || corrected.title === null || corrected.content === null) {
             throw new Error('Parsed JSON structure incorrect or contains null values.');
         }


         editorTitleInput.value = corrected.title;
         editorContentTextarea.value = corrected.content;
         sendWebSocketMessage({ type: 'update_note', id: note.id, name: corrected.title, content: corrected.content, color: note.color });
     } catch (error) { console.error('Error fixing note:', error); alert(`Failed to fix note: ${error.message}.`);
     } finally { editorFixBtn.disabled = false; editorFixBtn.style.opacity = '1'; editorFixBtn.style.cursor = 'pointer'; }
 }
const handleSearch = debounce(() => {
    // Only render the grid if the editor is NOT active
    if (noteEditor.style.display !== 'flex') {
        const searchTerm = searchInput.value.toLowerCase().trim();
        const filteredNotes = !searchTerm ? allNotes : allNotes.filter(note =>
            (getDisplayTitle(note) || '').toLowerCase().includes(searchTerm) ||
            (note.content || '').toLowerCase().includes(searchTerm)
        );
        renderNotes(filteredNotes);
    }
}, 250);

function setupEventListeners() {
     addNoteBtn.addEventListener('click', addNote);
     searchInput.addEventListener('input', handleSearch);
     menuToggle.addEventListener('click', () => sidebar.classList.toggle('active'));
     backButton.addEventListener('click', showGridView);

     const refreshButton = document.getElementById('refresh-button');
     refreshButton.addEventListener('click', () => {
         if (ws && ws.readyState === WebSocket.OPEN) {
             ws.send(JSON.stringify({ type: 'fetch_notes' }));
         } else {
             alert("Cannot refresh: Connection is not open.");
             connectWebSocket(); // Attempt to reconnect if not open
         }
     });

     editorTitleInput.addEventListener('input', saveCurrentNoteChanges);
     editorContentTextarea.addEventListener('input', saveCurrentNoteChanges);
     editorDeleteBtn.addEventListener('click', requestNoteDeletion);
     editorFixBtn.addEventListener('click', fixNoteContent);

     editorColorPalette.addEventListener('click', (e) => {
         const colorButton = e.target.closest('.color-option');
         if (colorButton && currentEditingNoteId) {
             const newColorHex = colorButton.dataset.color;
             const currentNoteData = allNotes.find(n => n.id === currentEditingNoteId);
              if (currentNoteData && currentNoteData.color !== newColorHex) {
                 updateEditorAppearance({...currentNoteData, color: newColorHex});
                 updateSelectedColorVisual(editorColorPalette, newColorHex);
                 sendWebSocketMessage({
                     type: 'update_note', id: currentEditingNoteId, color: newColorHex,
                     name: currentNoteData.name, content: currentNoteData.content
                 });
              }
         }
     });

     window.addEventListener('keydown', (e) => {
         if (e.key === 'Escape' && noteEditor.style.display === 'flex') showGridView(); // Check display style instead of class
     });

     const checkMobileToggle = () => {
         const isMobile = window.innerWidth <= 768;
         menuToggle.style.display = isMobile ? 'flex' : 'none';
         if (!isMobile && sidebar.classList.contains('active')) sidebar.classList.remove('active');
     };
     window.addEventListener('resize', checkMobileToggle);
     checkMobileToggle();
}
document.addEventListener('DOMContentLoaded', () => {

    renderNotes();
    setupEventListeners();
    connectWebSocket();
});
