let ws = null;
let username = '';
let reconnectDelay = 1000; // Backoff inicial: 1 segundo
const MAX_RECONNECT_DELAY = 30000; // Límite de backoff: 30 segundos
let typingTimeout = null;
let activeTypers = new Set();

// Referencias al DOM
const loginModal = document.getElementById('login-modal');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const loginError = document.getElementById('login-error');

const statusSpan = document.getElementById('connection-status');
const userList = document.getElementById('user-list');
const userCount = document.getElementById('user-count');
const messagesBox = document.getElementById('messages-box');
const typingIndicator = document.getElementById('typing-indicator');

const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');

// Mapeo textual de WebSocket.readyState
const READY_STATES = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];

function updateStatus() {
  if (!ws) {
    statusSpan.textContent = 'CLOSED';
    return;
  }
  statusSpan.textContent = READY_STATES[ws.readyState] || 'UNKNOWN';
}

function connect() {
  ws = new WebSocket(CONFIG.WS_URL);
  updateStatus();

  ws.onopen = () => {
    updateStatus();
    reconnectDelay = 1000; // Reiniciar delay al conectar exitosamente

    // Si ya teníamos usuario (caso de reconexión automática), volvemos a unirme
    if (username) {
      ws.send(JSON.stringify({ type: 'join', username }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.error('Error parseando mensaje:', e);
    }
  };

  ws.onclose = (event) => {
    updateStatus();
    disableChatUI();

    // Reconexión automática con espera creciente (Exponential Backoff)
    console.log(`Conexión perdida. Reintentando en ${reconnectDelay / 1000}s...`);
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay);
  };

  ws.onerror = (err) => {
    updateStatus();
  };
}

function handleServerMessage(data) {
  switch (data.type) {
    case 'join_ack':
      loginModal.style.display = 'none';
      enableChatUI();
      break;

    case 'history':
      messagesBox.innerHTML = ''; // Limpiar previo
      data.messages.forEach(msg => renderMessage(msg));
      break;

    case 'message':
      renderMessage(data);
      break;

    case 'system':
      renderSystemMessage(data.text);
      break;

    case 'user_list':
      renderUserList(data.users);
      break;

    case 'typing':
      handleTypingNotification(data);
      break;

    case 'error':
      if (loginModal.style.display !== 'none') {
        loginError.textContent = data.message;
      } else {
        alert(data.message);
      }
      break;
  }
}

// Prevenir XSS: usar textContent para renderizar texto seguro
function renderMessage(msg) {
  const msgDiv = document.createElement('div');
  const isMe = msg.username === username;
  msgDiv.className = `msg ${isMe ? 'user' : 'other'}`;

  const authorDiv = document.createElement('div');
  authorDiv.className = 'msg-author';
  authorDiv.textContent = msg.username; // Seguro contra XSS

  const textSpan = document.createElement('span');
  textSpan.textContent = msg.text; // Seguro contra XSS

  const timeSpan = document.createElement('span');
  timeSpan.className = 'msg-time';
  timeSpan.textContent = msg.timestamp;

  msgDiv.appendChild(authorDiv);
  msgDiv.appendChild(textSpan);
  msgDiv.appendChild(timeSpan);

  messagesBox.appendChild(msgDiv);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function renderSystemMessage(text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'msg system';
  msgDiv.textContent = text; // Seguro contra XSS

  messagesBox.appendChild(msgDiv);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function renderUserList(users) {
  userList.innerHTML = '';
  userCount.textContent = users.length;

  users.forEach(u => {
    const li = document.createElement('li');
    li.textContent = u; // Seguro contra XSS
    if (u === username) li.textContent += ' (Tú)';
    userList.appendChild(li);
  });
}

function handleTypingNotification(data) {
  if (data.username === username) return;

  if (data.isTyping) {
    activeTypers.add(data.username);
  } else {
    activeTypers.delete(data.username);
  }

  if (activeTypers.size > 0) {
    const names = Array.from(activeTypers).join(', ');
    typingIndicator.textContent = `${names} está(n) escribiendo...`;
  } else {
    typingIndicator.textContent = '';
  }
}

function enableChatUI() {
  messageInput.disabled = false;
  sendBtn.disabled = false;
  messageInput.focus();
}

function disableChatUI() {
  messageInput.disabled = true;
  sendBtn.disabled = true;
}

// Manejo de Eventos UI

joinBtn.addEventListener('click', () => {
  const val = usernameInput.value.trim();
  if (val) {
    username = val;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'join', username }));
    } else {
      loginError.textContent = 'Sin conexión con el servidor.';
    }
  }
});

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (text && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'message', text }));
    messageInput.value = '';

    // Cancelar indicador de escribiendo
    sendTypingSignal(false);
  }
});

// Emisión del evento "Está escribiendo..."
messageInput.addEventListener('input', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendTypingSignal(true);

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      sendTypingSignal(false);
    }, 2000);
  }
});

function sendTypingSignal(isTyping) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'typing', isTyping }));
  }
}

// Iniciar conexión al cargar script
connect();