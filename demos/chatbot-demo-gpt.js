class ChatbotDemoGPT extends HTMLElement {
  constructor() {
    super();

    // 1. Setup
    this.attachShadow({ mode: 'open' });

    // Bind handlers ONCE (critical for cleanup)
    this._onToggle = this._onToggle.bind(this);
    this._onSend = this._onSend.bind(this);
    this._onKeyPress = this._onKeyPress.bind(this);

    // Internal state (optional but scalable)
    this.state = {
      messages: []
    };
  }

  // 2. Lifecycle: added to DOM
  connectedCallback() {
    this.render();
    this.cacheDOM();
    this.attachEvents();
    this.init();
  }

  // 3. Lifecycle: removed from DOM
  disconnectedCallback() {
    this.detachEvents();
    this.cleanup();
  }

  // ------------------------
  // 🔧 Core Structure
  // ------------------------

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --theme-color: #007bff;
          font-family: system-ui, -apple-system, sans-serif;
        }

        .chat-container {
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 300px;
          background: white;
          border-radius: 10px;
          box-shadow: 0 5px 15px rgba(0,0,0,0.2);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .chat-header {
          background: var(--theme-color);
          color: white;
          padding: 15px;
          font-weight: bold;
          text-align: center;
          cursor: pointer;
        }

        .chat-body {
          height: 300px;
          padding: 15px;
          overflow-y: auto;
          background: #f9f9f9;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .message {
          padding: 8px 12px;
          border-radius: 15px;
          max-width: 80%;
          font-size: 14px;
        }

        .bot-message {
          background: #e0e0e0;
          align-self: flex-start;
        }

        .user-message {
          background: var(--theme-color);
          color: white;
          align-self: flex-end;
        }

        .chat-input-area {
          display: flex;
          padding: 10px;
          border-top: 1px solid #ddd;
          background: white;
        }

        input {
          flex: 1;
          padding: 8px;
        }

        button {
          margin-left: 5px;
          padding: 8px 15px;
          background: var(--theme-color);
          color: white;
          border: none;
          cursor: pointer;
        }

        .collapsed .chat-body,
        .collapsed .chat-input-area {
          display: none;
        }
      </style>

      <div class="chat-container collapsed" id="chatWindow">
        <div class="chat-header" id="toggleChat">
          💬 Chat with us!
        </div>
        <div class="chat-body" id="chatBody">
          <div class="message bot-message">
            Hello! I am a Web Component chatbot.
          </div>
        </div>
        <div class="chat-input-area">
          <input type="text" id="userInput" placeholder="Type a message..." />
          <button id="sendBtn">Send</button>
        </div>
      </div>
    `;
  }

  cacheDOM() {
    this.$ = {
      chatWindow: this.shadowRoot.getElementById('chatWindow'),
      toggleChat: this.shadowRoot.getElementById('toggleChat'),
      chatBody: this.shadowRoot.getElementById('chatBody'),
      userInput: this.shadowRoot.getElementById('userInput'),
      sendBtn: this.shadowRoot.getElementById('sendBtn')
    };
  }

  attachEvents() {
    this.$.toggleChat.addEventListener('click', this._onToggle);
    this.$.sendBtn.addEventListener('click', this._onSend);
    this.$.userInput.addEventListener('keypress', this._onKeyPress);
  }

  detachEvents() {
    this.$.toggleChat.removeEventListener('click', this._onToggle);
    this.$.sendBtn.removeEventListener('click', this._onSend);
    this.$.userInput.removeEventListener('keypress', this._onKeyPress);
  }

  init() {
    // Future: load saved messages, connect API, etc.
  }

  cleanup() {
    // Future: cancel timers, abort requests, etc.
  }

  // ------------------------
  // 💬 Chat Logic
  // ------------------------

  sendMessage(text) {
    this.addMessage(text, 'user-message');

    // Fake bot response
    setTimeout(() => {
      this.addMessage(`You said: "${text}"`, 'bot-message');
    }, 600);
  }

  addMessage(text, className) {
    const el = document.createElement('div');
    el.className = `message ${className}`;
    el.textContent = text;

    this.$.chatBody.appendChild(el);
    this.$.chatBody.scrollTop = this.$.chatBody.scrollHeight;
  }

  // ------------------------
  // 🎯 Event Handlers
  // ------------------------

  _onToggle() {
    this.$.chatWindow.classList.toggle('collapsed');
  }

  _onSend() {
    const text = this.$.userInput.value.trim();
    if (!text) return;

    this.$.userInput.value = '';
    this.sendMessage(text);
  }

  _onKeyPress(e) {
    if (e.key === 'Enter') {
      this._onSend();
    }
  }
}

customElements.define('chatbot-demo-gpt', ChatbotDemoGPT);