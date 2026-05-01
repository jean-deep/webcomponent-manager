class ChatbotDemo extends HTMLElement {
    constructor() {
        super();
        // Attach a shadow root to encapsulate styles and markup
        this.attachShadow({ mode: 'open' });

        // Define the HTML and CSS for the component
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
          transition: transform 0.3s ease;
          transform-origin: bottom right;
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
          border-bottom-left-radius: 2px;
        }

        .user-message {
          background: var(--theme-color);
          color: white;
          align-self: flex-end;
          border-bottom-right-radius: 2px;
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
          border: 1px solid #ccc;
          border-radius: 4px;
          outline: none;
        }

        button {
          background: var(--theme-color);
          color: white;
          border: none;
          padding: 8px 15px;
          margin-left: 5px;
          border-radius: 4px;
          cursor: pointer;
        }

        button:hover {
          background: #0056b3;
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
          <div class="message bot-message">Hello! I am a Web Component chatbot. Try saying something!</div>
        </div>
        <div class="chat-input-area">
          <input type="text" id="userInput" placeholder="Type a message..." />
          <button id="sendBtn">Send</button>
        </div>
      </div>
    `;
    }

    // This runs when the element is added to the DOM
    connectedCallback() {
        this.shadowRoot.getElementById('toggleChat').addEventListener('click', () => this.toggleChat());
        this.shadowRoot.getElementById('sendBtn').addEventListener('click', () => this.sendMessage());
        this.shadowRoot.getElementById('userInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
    }

    toggleChat() {
        const chatWindow = this.shadowRoot.getElementById('chatWindow');
        chatWindow.classList.toggle('collapsed');
    }

    sendMessage() {
        const inputField = this.shadowRoot.getElementById('userInput');
        const text = inputField.value.trim();
        if (!text) return;

        this.addMessage(text, 'user-message');
        inputField.value = '';

        // Simulate a fake bot response after a short delay
        setTimeout(() => {
            this.addMessage(`You said: "${text}". Web Components are cool, right?`, 'bot-message');
        }, 600);
    }

    addMessage(text, className) {
        const chatBody = this.shadowRoot.getElementById('chatBody');
        const messageEl = document.createElement('div');
        messageEl.className = `message ${className}`;
        messageEl.textContent = text;
        chatBody.appendChild(messageEl);
        chatBody.scrollTop = chatBody.scrollHeight; // Auto-scroll to bottom
    }
}

// Register the custom element with the browser
customElements.define('chatbot-demo', ChatbotDemo);