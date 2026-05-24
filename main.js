import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { 
  createIcons, 
  Cpu, 
  MessageSquare, 
  Plus, 
  Settings, 
  Trash2, 
  Send, 
  Paperclip, 
  Download, 
  Upload, 
  X, 
  Check, 
  Copy, 
  Edit2, 
  Play, 
  Sliders, 
  Menu, 
  Thermometer, 
  Eye, 
  EyeOff, 
  FileVideo,
  CornerDownLeft
} from 'lucide';

// --- CONSTANTS & CONFIGS ---
const DB_NAME = 'OmniChatDB';
const DB_VERSION = 1;
const DEFAULT_SETTINGS = {
  provider: 'gemini',
  apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiKey: '',
  modelName: 'gemini-2.5-flash',
  temperature: 0.7,
  topP: 0.95,
  maxTokens: 4096,
  stream: true,
  presencePenalty: 0.0,
  frequencyPenalty: 0.0,
  systemPrompt: 'You are a helpful assistant. Respond using clear markdown, tables, and lists where appropriate.'
};

const PROVIDER_PRESETS = {
  gemini: {
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelName: 'gemini-2.5-flash'
  },
  qwen: {
    apiUrl: 'http://localhost:8000/v1', // LiteLLM standard port
    modelName: 'qwen-vl-plus'
  },
  ollama: {
    apiUrl: 'http://localhost:11434/v1',
    modelName: 'qwen2.5'
  },
  mock: {
    apiUrl: 'http://localhost:3000/v1',
    modelName: 'qwen-3.5-mock'
  },
  custom: {
    apiUrl: '',
    modelName: ''
  }
};

// --- APP STATE ---
let db = null;
let activeSessionId = null;
let currentSettings = { ...DEFAULT_SETTINGS };
let activeAttachments = []; // { name, type, base64 }
let activeAbortController = null;
let isGenerating = false;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  // Load settings first
  loadSettingsFromStorage();
  
  // Init DB
  await initIndexedDB();

  // Load active icons
  renderIcons();

  // Bind settings modal and inputs
  initSettingsUI();

  // Load chat sessions from DB
  await loadSessions();

  // Setup Event Listeners
  initEventListeners();

  // Setup Markdown Render Options
  setupMarkdownRenderer();
});

function renderIcons() {
  createIcons({
    icons: {
      Cpu,
      MessageSquare,
      Plus,
      Settings,
      Trash2,
      Send,
      Paperclip,
      Download,
      Upload,
      X,
      Check,
      Copy,
      Edit2,
      Play,
      Sliders,
      Menu,
      Thermometer,
      Eye,
      EyeOff,
      FileVideo,
      CornerDownLeft
    }
  });
}

// --- INDEXED DB ENGINE ---
function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const dbInstance = event.target.result;
      
      // Store 1: Chat Sessions
      if (!dbInstance.objectStoreNames.contains('sessions')) {
        const sessionStore = dbInstance.createObjectStore('sessions', { keyPath: 'id' });
        sessionStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // Store 2: Messages log
      if (!dbInstance.objectStoreNames.contains('messages')) {
        const messageStore = dbInstance.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
        messageStore.createIndex('sessionId', 'sessionId', { unique: false });
        messageStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

// DB Operations
function dbGetSessions() {
  return new Promise((resolve) => {
    if (!db) return resolve([]);
    const transaction = db.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore(transaction.objectStoreNames[0]);
    const index = store.index('updatedAt');
    const request = index.openCursor(null, 'prev'); // Most recent first
    const sessions = [];

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        sessions.push(cursor.value);
        cursor.continue();
      } else {
        resolve(sessions);
      }
    };
    request.onerror = () => resolve([]);
  });
}

function dbSaveSession(session) {
  return new Promise((resolve) => {
    if (!db) return resolve();
    const transaction = db.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    const request = store.put(session);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

function dbDeleteSession(sessionId) {
  return new Promise((resolve) => {
    if (!db) return resolve();
    const transaction = db.transaction(['sessions', 'messages'], 'readwrite');
    
    // Delete session
    transaction.objectStore('sessions').delete(sessionId);
    
    // Delete all messages associated with session
    const messageStore = transaction.objectStore('messages');
    const index = messageStore.index('sessionId');
    const request = index.openCursor(IDBKeyRange.only(sessionId));

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => resolve();
  });
}

function dbGetMessages(sessionId) {
  return new Promise((resolve) => {
    if (!db) return resolve([]);
    const transaction = db.transaction(['messages'], 'readonly');
    const store = transaction.objectStore('messages');
    const index = store.index('sessionId');
    const request = index.openCursor(IDBKeyRange.only(sessionId));
    const messages = [];

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        messages.push(cursor.value);
        cursor.continue();
      } else {
        // Sort chronologically by timestamp
        messages.sort((a, b) => a.timestamp - b.timestamp);
        resolve(messages);
      }
    };
    request.onerror = () => resolve([]);
  });
}

function dbAddMessage(message) {
  return new Promise((resolve) => {
    if (!db) return resolve();
    const transaction = db.transaction(['messages'], 'readwrite');
    const store = transaction.objectStore('messages');
    const request = store.add(message);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function dbClearAll() {
  return new Promise((resolve) => {
    if (!db) return resolve();
    const transaction = db.transaction(['sessions', 'messages'], 'readwrite');
    transaction.objectStore('sessions').clear();
    transaction.objectStore('messages').clear();
    transaction.oncomplete = () => resolve();
  });
}

// --- LOCAL STORAGE SETTINGS MANAGEMENT ---
function loadSettingsFromStorage() {
  const saved = localStorage.getItem('omnichat_settings');
  if (saved) {
    try {
      currentSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch (e) {
      currentSettings = { ...DEFAULT_SETTINGS };
    }
  } else {
    currentSettings = { ...DEFAULT_SETTINGS };
  }
  updateModelInfoPills();
}

function saveSettingsToStorage() {
  localStorage.setItem('omnichat_settings', JSON.stringify(currentSettings));
  updateModelInfoPills();
}

function updateModelInfoPills() {
  const modelPill = document.getElementById('model-name-display');
  const tempPill = document.getElementById('temp-display');
  if (modelPill) modelPill.textContent = currentSettings.modelName || 'unconfigured';
  if (tempPill) tempPill.textContent = `Temp: ${currentSettings.temperature}`;
}

// --- MARKDOWN & SYNTAX HIGHLIGHT CONFIG ---
function setupMarkdownRenderer() {
  const renderer = new marked.Renderer();
  
  // Custom code renderer to wrap in a header with copy code actions
  renderer.code = (code, lang) => {
    const cleanLang = lang ? lang.split(':')[0] : 'text';
    let highlighted;
    try {
      highlighted = hljs.getLanguage(cleanLang) 
        ? hljs.highlight(code, { language: cleanLang }).value 
        : hljs.highlightAuto(code).value;
    } catch (err) {
      highlighted = code;
    }

    return `
      <div class="code-block-container">
        <div class="code-block-header">
          <span class="code-lang">${cleanLang}</span>
          <button class="copy-code-btn" data-code="${encodeURIComponent(code)}">
            <i data-lucide="copy" style="width: 12px; height: 12px;"></i>
            <span>Copy</span>
          </button>
        </div>
        <pre><code class="hljs language-${cleanLang}">${highlighted}</code></pre>
      </div>
    `;
  };

  marked.setOptions({
    renderer,
    gfm: true,
    breaks: true
  });
}

// --- UI STATE CONTROLLERS ---
async function loadSessions() {
  const sessions = await dbGetSessions();
  const container = document.getElementById('sessions-container');
  container.innerHTML = '';

  if (sessions.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-dark); font-size: 0.85rem; padding: 20px;">No histories yet</div>`;
    return;
  }

  sessions.forEach(session => {
    const item = document.createElement('div');
    item.className = `session-item ${session.id === activeSessionId ? 'active' : ''}`;
    item.setAttribute('data-id', session.id);
    
    item.innerHTML = `
      <a class="session-link" href="#">
        <i data-lucide="message-square" class="session-icon"></i>
        <span class="session-title-text">${escapeHtml(session.title)}</span>
      </a>
      <div class="session-actions">
        <button class="action-btn rename-btn" title="Rename Session">
          <i data-lucide="edit-2" style="width: 12px; height: 12px;"></i>
        </button>
        <button class="action-btn delete-btn" title="Delete Session">
          <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
        </button>
      </div>
    `;

    // Click handler for session switch
    item.querySelector('.session-link').addEventListener('click', (e) => {
      e.preventDefault();
      switchSession(session.id);
    });

    // Rename Click handler
    item.querySelector('.rename-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      renameSessionPrompt(session.id, session.title);
    });

    // Delete Click handler
    item.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSessionConfirm(session.id);
    });

    container.appendChild(item);
  });

  renderIcons();
}

async function createNewSession(initialTitle = 'New Conversation') {
  const newSession = {
    id: generateUUID(),
    title: initialTitle,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await dbSaveSession(newSession);
  activeSessionId = newSession.id;
  await loadSessions();
  await switchSession(activeSessionId);
}

async function switchSession(sessionId) {
  activeSessionId = sessionId;
  
  // Highlight active session item
  document.querySelectorAll('.session-item').forEach(item => {
    if (item.getAttribute('data-id') === sessionId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Get and render messages
  const messages = await dbGetMessages(sessionId);
  const titleDisplay = document.getElementById('active-chat-title');
  
  // Update header title
  const activeSession = await getSessionFromDb(sessionId);
  if (activeSession) {
    titleDisplay.textContent = activeSession.title;
  }

  renderMessages(messages);
  
  // Hide sidebar on mobile
  document.getElementById('sidebar').classList.remove('show');
}

function getSessionFromDb(sessionId) {
  return new Promise((resolve) => {
    if (!db) return resolve(null);
    const transaction = db.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    const request = store.get(sessionId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function renderMessages(messages) {
  const heroScreen = document.getElementById('welcome-hero');
  const thread = document.getElementById('chat-thread');
  
  thread.innerHTML = '';

  if (messages.length === 0) {
    heroScreen.style.display = 'flex';
    thread.style.display = 'none';
    return;
  }

  heroScreen.style.display = 'none';
  thread.style.display = 'flex';

  messages.forEach(msg => {
    appendMessageToThread(msg.role, msg.content, msg.mediaFiles, msg.id);
  });

  scrollChatToBottom();
}

function appendMessageToThread(role, content, mediaFiles = [], msgId = null) {
  const thread = document.getElementById('chat-thread');
  document.getElementById('welcome-hero').style.display = 'none';
  thread.style.display = 'flex';

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${role}`;
  if (msgId) bubble.setAttribute('data-msg-id', msgId);

  const avatarChar = role === 'user' ? 'U' : 'AI';
  
  // Build message HTML
  let contentHtml = '';
  if (role === 'user') {
    contentHtml = `<div class="message-body">${escapeHtml(content)}</div>`;
  } else {
    // Compile Markdown for assistant
    contentHtml = `<div class="message-body markdown-content">${marked.parse(content)}</div>`;
  }

  // Render media attachments inside the bubble if present
  let mediaHtml = '';
  if (mediaFiles && mediaFiles.length > 0) {
    mediaHtml = `<div class="message-attachments">`;
    mediaFiles.forEach(file => {
      if (file.type.startsWith('image/')) {
        mediaHtml += `
          <div class="message-media-preview">
            <img src="${file.data}" alt="${escapeHtml(file.name)}" onclick="openFullscreenMedia('${file.data}')">
          </div>
        `;
      } else if (file.type.startsWith('video/')) {
        mediaHtml += `
          <div class="message-media-preview">
            <video src="${file.data}" controls></video>
          </div>
        `;
      }
    });
    mediaHtml += `</div>`;
  }

  bubble.innerHTML = `
    <div class="message-avatar">${avatarChar}</div>
    <div class="message-content-wrapper">
      ${contentHtml}
      ${mediaHtml}
    </div>
  `;

  thread.appendChild(bubble);
  
  // Wire up dynamic copy buttons within the assistant markdown
  bindCopyButtons(bubble);
  
  renderIcons();
  scrollChatToBottom();
  return bubble;
}

function bindCopyButtons(container) {
  container.querySelectorAll('.copy-code-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const code = decodeURIComponent(btn.getAttribute('data-code'));
      try {
        await navigator.clipboard.writeText(code);
        const btnText = btn.querySelector('span');
        const btnIcon = btn.querySelector('i');
        
        btnText.textContent = 'Copied!';
        btn.style.color = 'var(--accent-teal)';
        btn.style.borderColor = 'var(--accent-teal)';
        
        setTimeout(() => {
          btnText.textContent = 'Copy';
          btn.style.color = '';
          btn.style.borderColor = '';
        }, 2000);
      } catch (err) {
        console.error('Copy to clipboard failed:', err);
      }
    });
  });
}

function scrollChatToBottom() {
  const container = document.getElementById('messages-container');
  container.scrollTop = container.scrollHeight;
}

// --- FILE ATTACHMENTS AND BASE64 READER ---
async function handleFileSelect(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  const previewStrip = document.getElementById('attachments-preview-strip');
  previewStrip.style.display = 'flex';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    // Read file as Base64
    try {
      const base64Data = await readFileAsBase64(file);
      const attachmentItem = {
        id: generateUUID(),
        name: file.name,
        type: file.type,
        data: base64Data
      };
      
      activeAttachments.push(attachmentItem);
      renderAttachmentThumbnail(attachmentItem);
    } catch (err) {
      console.error('File read error:', err);
      alert(`Could not upload ${file.name}: file read error.`);
    }
  }

  // Clear file input so same file can be uploaded again if deleted
  e.target.value = '';
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

function renderAttachmentThumbnail(item) {
  const strip = document.getElementById('attachments-preview-strip');
  const bubble = document.createElement('div');
  bubble.className = 'attachment-bubble';
  bubble.setAttribute('data-attachment-id', item.id);

  if (item.type.startsWith('image/')) {
    bubble.innerHTML = `
      <img src="${item.data}" alt="${escapeHtml(item.name)}">
      <button class="remove-attachment-btn">&times;</button>
    `;
  } else if (item.type.startsWith('video/')) {
    bubble.innerHTML = `
      <div class="video-overlay"><i data-lucide="file-video"></i></div>
      <button class="remove-attachment-btn">&times;</button>
    `;
  }

  bubble.querySelector('.remove-attachment-btn').addEventListener('click', () => {
    removeAttachment(item.id);
  });

  strip.appendChild(bubble);
  renderIcons();
}

function removeAttachment(id) {
  activeAttachments = activeAttachments.filter(item => item.id !== id);
  const bubble = document.querySelector(`[data-attachment-id="${id}"]`);
  if (bubble) bubble.remove();

  if (activeAttachments.length === 0) {
    document.getElementById('attachments-preview-strip').style.display = 'none';
  }
}

function clearAllAttachments() {
  activeAttachments = [];
  document.getElementById('attachments-preview-strip').innerHTML = '';
  document.getElementById('attachments-preview-strip').style.display = 'none';
}

// --- CONVERSATION SESSIONS ACTIONS ---
async function renameSessionPrompt(sessionId, currentTitle) {
  const newTitle = prompt('Enter a new title for this conversation:', currentTitle);
  if (newTitle === null) return;
  const trimmed = newTitle.trim();
  if (trimmed === '') return;

  const session = await getSessionFromDb(sessionId);
  if (session) {
    session.title = trimmed;
    session.updatedAt = Date.now();
    await dbSaveSession(session);
    await loadSessions();
    if (activeSessionId === sessionId) {
      document.getElementById('active-chat-title').textContent = trimmed;
    }
  }
}

async function deleteSessionConfirm(sessionId) {
  if (confirm('Are you sure you want to delete this chat history? This cannot be undone.')) {
    await dbDeleteSession(sessionId);
    if (activeSessionId === sessionId) {
      activeSessionId = null;
      document.getElementById('active-chat-title').textContent = 'New Conversation';
      renderMessages([]);
    }
    await loadSessions();
  }
}

// --- API COMMUNICATIONS (STREAMING SSE FETCH) ---
async function sendMessage() {
  const inputArea = document.getElementById('chat-input');
  const userText = inputArea.value.trim();

  if (!userText && activeAttachments.length === 0) return;
  if (isGenerating) {
    stopGeneration();
    return;
  }

  // Ensure active session exists
  if (!activeSessionId) {
    const sessionTitle = userText ? (userText.length > 25 ? userText.substring(0, 25) + '...' : userText) : 'Media Upload Chat';
    await createNewSession(sessionTitle);
  } else {
    // If it's a new session that was empty, auto-rename title using first text prompt
    const messages = await dbGetMessages(activeSessionId);
    if (messages.length === 0 && userText) {
      const activeSession = await getSessionFromDb(activeSessionId);
      if (activeSession) {
        activeSession.title = userText.length > 30 ? userText.substring(0, 30) + '...' : userText;
        await dbSaveSession(activeSession);
        document.getElementById('active-chat-title').textContent = activeSession.title;
        await loadSessions();
      }
    }
  }

  // Package attachments copy to store in DB
  const mediaToStore = [...activeAttachments];
  clearAllAttachments();
  inputArea.value = '';
  inputArea.style.height = 'auto';

  // 1. Add and render User Message in DB and UI
  const userMsg = {
    sessionId: activeSessionId,
    role: 'user',
    content: userText,
    mediaFiles: mediaToStore.map(m => ({ name: m.name, type: m.type, data: m.data })),
    timestamp: Date.now()
  };
  await dbAddMessage(userMsg);
  appendMessageToThread(userMsg.role, userMsg.content, userMsg.mediaFiles);

  // Set visual states
  setGeneratingState(true);

  // 2. Fetch past conversation context
  const fullHistory = await dbGetMessages(activeSessionId);
  const formattedMessages = constructApiMessagesPayload(fullHistory);

  // 3. Setup Response DOM Element
  const assistantBubble = appendMessageToThread('assistant', '...');
  const textBodyElement = assistantBubble.querySelector('.markdown-content');

  // 4. Fire Fetch Call
  activeAbortController = new AbortController();
  let fullResponseText = '';

  try {
    const { apiUrl, apiKey, modelName, temperature, topP, maxTokens, presencePenalty, frequencyPenalty, stream } = currentSettings;

    if (!apiUrl) {
      throw new Error("API URL is not configured. Please open Settings and enter the URL.");
    }

    const headers = {
      'Content-Type': 'application/json'
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const requestBody = {
      model: modelName,
      messages: formattedMessages,
      temperature: parseFloat(temperature),
      top_p: parseFloat(topP),
      max_tokens: parseInt(maxTokens) || 2048,
      presence_penalty: parseFloat(presencePenalty),
      frequency_penalty: parseFloat(frequencyPenalty),
      stream: stream
    };

    const response = await fetch(apiUrl + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: activeAbortController.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error (${response.status}): ${errorText || response.statusText}`);
    }

    if (stream) {
      // HANDLE STREAMING
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      textBodyElement.innerHTML = ''; // Clear loading indicators

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Save the last partial line back to the buffer
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === 'data: [DONE]') continue;
          
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.substring(6);
            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices[0].delta.content || '';
              fullResponseText += delta;
              
              // Render current accumulated response
              textBodyElement.innerHTML = marked.parse(fullResponseText);
              bindCopyButtons(assistantBubble);
              scrollChatToBottom();
            } catch (e) {
              // Ignore lines that aren't fully formed JSON chunks
            }
          }
        }
      }
    } else {
      // HANDLE NON-STREAMING
      const data = await response.json();
      fullResponseText = data.choices[0].message.content || '';
      textBodyElement.innerHTML = marked.parse(fullResponseText);
      bindCopyButtons(assistantBubble);
      scrollChatToBottom();
    }

    // Save Assistant response in IndexedDB
    const assistantMsg = {
      sessionId: activeSessionId,
      role: 'assistant',
      content: fullResponseText,
      mediaFiles: [],
      timestamp: Date.now()
    };
    await dbAddMessage(assistantMsg);

    // Update session timestamp
    const session = await getSessionFromDb(activeSessionId);
    if (session) {
      session.updatedAt = Date.now();
      await dbSaveSession(session);
      await loadSessions();
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      textBodyElement.innerHTML += `<p class="generation-notice" style="color: var(--text-dark); margin-top: 10px; font-style: italic;">Response streaming aborted by user.</p>`;
      
      // Save partial response to DB if there was one
      if (fullResponseText.trim()) {
        const assistantMsg = {
          sessionId: activeSessionId,
          role: 'assistant',
          content: fullResponseText + ' [Generation Stopped]',
          mediaFiles: [],
          timestamp: Date.now()
        };
        await dbAddMessage(assistantMsg);
      }
    } else {
      console.error(err);
      textBodyElement.innerHTML = `
        <div style="color: hsl(0, 80%, 65%); padding: 12px; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; background: rgba(239, 68, 68, 0.05); display: flex; align-items: flex-start; gap: 10px;">
          <i data-lucide="alert-triangle" style="flex-shrink: 0; width: 20px; height: 20px; margin-top: 2px;"></i>
          <div>
            <strong>API Fetch Error:</strong> ${escapeHtml(err.message)}
          </div>
        </div>
      `;
      renderIcons();
    }
  } finally {
    setGeneratingState(false);
  }
}

function constructApiMessagesPayload(history) {
  const payload = [];

  // Add system instruction prompt if configured
  if (currentSettings.systemPrompt && currentSettings.systemPrompt.trim()) {
    payload.push({
      role: 'system',
      content: currentSettings.systemPrompt.trim()
    });
  }

  history.forEach(msg => {
    // If there are media attachments, we construct a multimodal OpenAI schema
    if (msg.mediaFiles && msg.mediaFiles.length > 0) {
      const parts = [{ type: 'text', text: msg.content || '' }];
      
      msg.mediaFiles.forEach(file => {
        if (file.type.startsWith('image/')) {
          parts.push({
            type: 'image_url',
            image_url: {
              url: file.data // contains base64 data url
            }
          });
        } else if (file.type.startsWith('video/')) {
          // Send video as a multimodal URL type. Supported by Qwen 2.5/3.5 VLM and some custom Litellm setups
          parts.push({
            type: 'video_url',
            video_url: {
              url: file.data
            }
          });
        }
      });

      payload.push({
        role: msg.role,
        content: parts
      });
    } else {
      // Standard text-only payload
      payload.push({
        role: msg.role,
        content: msg.content
      });
    }
  });

  return payload;
}

function setGeneratingState(generating) {
  isGenerating = generating;
  const sendBtn = document.getElementById('send-btn');
  const sendIcon = document.getElementById('send-icon');
  const connStatus = document.getElementById('conn-status');
  const connStatusText = document.getElementById('conn-status-text');

  if (generating) {
    sendBtn.classList.add('stop-btn');
    sendBtn.title = 'Stop response';
    sendIcon.setAttribute('data-lucide', 'x');
    connStatus.className = 'conn-status busy';
    connStatusText.textContent = 'Generating...';
  } else {
    sendBtn.classList.remove('stop-btn');
    sendBtn.title = 'Send message';
    sendIcon.setAttribute('data-lucide', 'send');
    connStatus.className = 'conn-status online';
    connStatusText.textContent = 'Ready';
    activeAbortController = null;
  }
  renderIcons();
}

function stopGeneration() {
  if (activeAbortController) {
    activeAbortController.abort();
  }
}

// --- SETTINGS MODAL BINDINGS ---
function initSettingsUI() {
  const modal = document.getElementById('settings-modal');
  const providerSelect = document.getElementById('provider-select');
  const urlInput = document.getElementById('api-url-input');
  const keyInput = document.getElementById('api-key-input');
  const modelInput = document.getElementById('model-name-input');
  const systemInput = document.getElementById('system-prompt');
  
  // Hyperparameters
  const tempSlider = document.getElementById('temperature-slider');
  const tempVal = document.getElementById('temperature-val');
  const toppSlider = document.getElementById('topp-slider');
  const toppVal = document.getElementById('topp-val');
  const maxTokensInput = document.getElementById('max-tokens-input');
  const streamToggle = document.getElementById('stream-toggle');
  const presenceSlider = document.getElementById('presence-slider');
  const presenceVal = document.getElementById('presence-val');
  const freqSlider = document.getElementById('frequency-slider');
  const freqVal = document.getElementById('frequency-val');

  // Synchronize UI values with currentSettings state
  function syncUIFromState() {
    providerSelect.value = currentSettings.provider;
    urlInput.value = currentSettings.apiUrl;
    keyInput.value = currentSettings.apiKey;
    modelInput.value = currentSettings.modelName;
    systemInput.value = currentSettings.systemPrompt;
    
    tempSlider.value = currentSettings.temperature;
    tempVal.textContent = currentSettings.temperature;
    toppSlider.value = currentSettings.topP;
    toppVal.textContent = currentSettings.topP;
    maxTokensInput.value = currentSettings.maxTokens;
    streamToggle.checked = currentSettings.stream;
    
    presenceSlider.value = currentSettings.presencePenalty;
    presenceVal.textContent = currentSettings.presencePenalty;
    freqSlider.value = currentSettings.frequencyPenalty;
    freqVal.textContent = currentSettings.frequencyPenalty;
  }

  // Toggle visible settings fields based on provider presets
  providerSelect.addEventListener('change', () => {
    const preset = PROVIDER_PRESETS[providerSelect.value];
    if (preset) {
      if (providerSelect.value !== 'custom') {
        urlInput.value = preset.apiUrl;
        modelInput.value = preset.modelName;
      }
    }
  });

  // Slider visual updates
  tempSlider.addEventListener('input', (e) => tempVal.textContent = e.target.value);
  toppSlider.addEventListener('input', (e) => toppVal.textContent = e.target.value);
  presenceSlider.addEventListener('input', (e) => presenceVal.textContent = e.target.value);
  freqSlider.addEventListener('input', (e) => freqVal.textContent = e.target.value);

  // API Secret Eye toggle
  const toggleKeyBtn = document.getElementById('toggle-key-visibility');
  const toggleKeyIcon = document.getElementById('key-visibility-icon');
  toggleKeyBtn.addEventListener('click', () => {
    if (keyInput.type === 'password') {
      keyInput.type = 'text';
      toggleKeyIcon.setAttribute('data-lucide', 'eye-off');
    } else {
      keyInput.type = 'password';
      toggleKeyIcon.setAttribute('data-lucide', 'eye');
    }
    renderIcons();
  });

  // Reset Button
  document.getElementById('reset-settings-btn').addEventListener('click', () => {
    if (confirm('Reset all parameters and connections to defaults?')) {
      currentSettings = { ...DEFAULT_SETTINGS };
      syncUIFromState();
    }
  });

  // Save Button
  document.getElementById('save-settings-btn').addEventListener('click', () => {
    currentSettings = {
      provider: providerSelect.value,
      apiUrl: urlInput.value.trim(),
      apiKey: keyInput.value.trim(),
      modelName: modelInput.value.trim(),
      temperature: parseFloat(tempSlider.value),
      topP: parseFloat(toppSlider.value),
      maxTokens: parseInt(maxTokensInput.value) || 2048,
      stream: streamToggle.checked,
      presencePenalty: parseFloat(presenceSlider.value),
      frequencyPenalty: parseFloat(freqSlider.value),
      systemPrompt: systemInput.value
    };
    saveSettingsToStorage();
    modal.style.display = 'none';
  });

  // Export Settings Trigger
  syncUIFromState();
}

// --- WORKSPACE EXPORT & IMPORT BACKUP CONTROLLERS ---
async function exportWorkspace() {
  const sessions = await dbGetSessions();
  const allMessages = [];
  
  for (const session of sessions) {
    const messages = await dbGetMessages(session.id);
    allMessages.push(...messages);
  }

  const exportData = {
    version: 'omnichat-v1',
    timestamp: Date.now(),
    settings: currentSettings,
    sessions: sessions,
    messages: allMessages
  };

  // Trigger JSON download file in browser
  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `omnichat-workspace-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(link);
  link.click();
  
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function handleWorkspaceImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const data = JSON.parse(event.target.result);
      
      if (data.version !== 'omnichat-v1') {
        throw new Error('Unsupported JSON file version structure.');
      }

      if (!confirm('Importing will merge settings and chats into your current database. Proceed?')) {
        return;
      }

      // 1. Restore settings if present
      if (data.settings) {
        currentSettings = { ...currentSettings, ...data.settings };
        saveSettingsToStorage();
      }

      // 2. Insert sessions in IndexedDB
      if (data.sessions && Array.isArray(data.sessions)) {
        for (const session of data.sessions) {
          await dbSaveSession(session);
        }
      }

      // 3. Insert messages in IndexedDB
      if (data.messages && Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          // Put will update or insert messages
          await dbAddMessage(msg);
        }
      }

      // Reload Sidebar
      await loadSessions();
      alert('Workspace backup imported successfully!');

      if (data.sessions && data.sessions.length > 0) {
        switchSession(data.sessions[0].id);
      }

    } catch (err) {
      console.error(err);
      alert('Failed to parse and import backup file: ' + err.message);
    }
  };

  reader.readAsText(file);
  e.target.value = ''; // Reset input trigger
}

// --- GLOBAL EVENT LISTENERS BINDING ---
function initEventListeners() {
  const modal = document.getElementById('settings-modal');
  const inputArea = document.getElementById('chat-input');
  
  // Settings buttons
  document.getElementById('settings-btn').addEventListener('click', () => {
    // Open settings and synch UI
    const providerSelect = document.getElementById('provider-select');
    const urlInput = document.getElementById('api-url-input');
    const keyInput = document.getElementById('api-key-input');
    const modelInput = document.getElementById('model-name-input');
    const systemInput = document.getElementById('system-prompt');
    const tempSlider = document.getElementById('temperature-slider');
    const tempVal = document.getElementById('temperature-val');
    const toppSlider = document.getElementById('topp-slider');
    const toppVal = document.getElementById('topp-val');
    const maxTokensInput = document.getElementById('max-tokens-input');
    const streamToggle = document.getElementById('stream-toggle');
    const presenceSlider = document.getElementById('presence-slider');
    const presenceVal = document.getElementById('presence-val');
    const freqSlider = document.getElementById('frequency-slider');
    const freqVal = document.getElementById('frequency-val');

    providerSelect.value = currentSettings.provider;
    urlInput.value = currentSettings.apiUrl;
    keyInput.value = currentSettings.apiKey;
    modelInput.value = currentSettings.modelName;
    systemInput.value = currentSettings.systemPrompt;
    tempSlider.value = currentSettings.temperature;
    tempVal.textContent = currentSettings.temperature;
    toppSlider.value = currentSettings.topP;
    toppVal.textContent = currentSettings.topP;
    maxTokensInput.value = currentSettings.maxTokens;
    streamToggle.checked = currentSettings.stream;
    presenceSlider.value = currentSettings.presencePenalty;
    presenceVal.textContent = currentSettings.presencePenalty;
    freqSlider.value = currentSettings.frequencyPenalty;
    freqVal.textContent = currentSettings.frequencyPenalty;

    modal.style.display = 'flex';
  });

  document.getElementById('close-settings-btn').addEventListener('click', () => {
    modal.style.display = 'none';
  });

  // Modal overlay click closure
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  // New Chat Click
  document.getElementById('new-chat-btn').addEventListener('click', () => {
    createNewSession();
  });

  // Input textarea Auto-resize heights
  inputArea.addEventListener('input', () => {
    inputArea.style.height = 'auto';
    inputArea.style.height = (inputArea.scrollHeight - 6) + 'px';
  });

  // Keypress in inputs: Enter to send, Shift+Enter for new line
  inputArea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Click send button
  document.getElementById('send-btn').addEventListener('click', () => {
    sendMessage();
  });

  // Mobile sidebar burger toggle button
  document.getElementById('mobile-toggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('show');
  });

  // File Inputs
  document.getElementById('file-input').addEventListener('change', handleFileSelect);

  // Backup Export/Import
  document.getElementById('export-btn').addEventListener('click', exportWorkspace);
  document.getElementById('import-input').addEventListener('change', handleWorkspaceImport);
}

// --- HELPERS ---
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function escapeHtml(string) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(string).replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Fullscreen Media viewer helper
window.openFullscreenMedia = function(dataUrl) {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.95)';
  overlay.style.zIndex = '1000';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.cursor = 'zoom-out';
  overlay.innerHTML = `<img src="${dataUrl}" style="max-width: 90%; max-height: 90%; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">`;
  
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
};
