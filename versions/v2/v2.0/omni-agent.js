class OmniAgent extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        // ==========================================
        // YOUR CLOUDFLARE PROXY URL HERE
        // Example: 'https://omni-proxy.my-name.workers.dev'
        // Do NOT include a trailing slash or query parameters here.
        // ==========================================
        const WORKER_URL = 'https://omni-proxy.sidorokarcaria.workers.dev';
        this.proxyUrl = WORKER_URL + '/?url=';

        // Core State
        this.profiles = JSON.parse(localStorage.getItem('omniagent_profiles')) || [];
        this.activeProfileId = localStorage.getItem('omniagent_active_profile') || null;
        this.messages = [];
        this.availableModels = [];

        // UI State
        this.isOpen = false;
        this.currentTab = this.profiles.length > 0 ? 'chat' : 'settings';
        this.isWorking = false;
        this.isDragging = false;

        this.render();
        this.bindEvents();
        this.initLoad();
    }

    // ==========================================
    // AGENTIC PROTOCOL & EXECUTION ENGINE
    // ==========================================

    getSystemPrompt() {
        const pageSnapshot = this.getDOMSnapshot(document.body, 0);

        return `You are OmniAgent, an advanced AI embedded in the user's webpage. You have "God Mode" access to the DOM and Javascript execution environment.

CURRENT WEBPAGE SNAPSHOT (Simplified):
\`\`\`html
${pageSnapshot}
\`\`\`

YOUR DIRECTIVE:
You have ONE powerful tool at your disposal: the ability to execute vanilla JavaScript in the browser.
To interact with the page, wrap your code EXACTLY in these tags:
<run_js>
// Your JS code here
return document.title;
</run_js>

EXECUTION RULES:
1. The code runs inside an async function. You MUST use the \`return\` statement to pass data back to yourself. 
2. Only output ONE <run_js> block per message.
3. Once you output a <run_js> block, I will execute it and reply with <js_result>...result...</js_result> or <js_error>...error...</js_error>.
4. You can chain actions iteratively! Check the result, then output another <run_js> block if needed.
5. Do NOT navigate away from the page or reload it.
6. If the user asks a conversational question, answer normally. If they ask you to do something to the page, write the JS to do it!
7. Keep your conversational responses concise.`;
    }

    getDOMSnapshot(element, depth = 0) {
        if (depth > 6) return "...";
        if (!element) return "";
        if (element.nodeType === 3) {
            const text = element.textContent.trim();
            return text.length > 40 ? text.substring(0, 40) + "..." : text;
        }
        if (element.nodeType !== 1) return "";

        const tag = element.tagName.toLowerCase();
        if (['script', 'style', 'svg', 'omni-agent', 'iframe', 'noscript'].includes(tag)) return `<${tag}>...</${tag}>`;

        let str = `<${tag}`;
        if (element.id) str += ` id="${element.id}"`;
        if (element.className) str += ` class="${element.className}"`;
        str += `>`;

        let hasChildren = false;
        for (let child of element.childNodes) {
            const childStr = this.getDOMSnapshot(child, depth + 1);
            if (childStr) {
                str += childStr;
                hasChildren = true;
            }
        }
        return str + `</${tag}>`;
    }

    // ==========================================
    // API INTEGRATION (Proxied)
    // ==========================================

    getActiveProfile() {
        return this.profiles.find(p => p.id === this.activeProfileId);
    }

    async fetchModelsForProfile(profile) {
        let models = [];
        try {
            if (profile.provider === 'openai') {
                const targetUrl = 'https://api.openai.com/v1/models';
                const res = await fetch(this.proxyUrl + encodeURIComponent(targetUrl), {
                    headers: { 'Authorization': `Bearer ${profile.apiKey}` }
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                models = data.data.filter(m => m.id.includes('gpt')).map(m => m.id).sort().reverse();
            }
            else if (profile.provider === 'gemini') {
                const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${profile.apiKey}`;
                const res = await fetch(this.proxyUrl + encodeURIComponent(targetUrl));
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                models = data.models
                    .filter(m => m.supportedGenerationMethods.includes('generateContent') && m.name.includes('gemini'))
                    .map(m => m.name.replace('models/', ''))
                    .sort().reverse();
            }
            else if (profile.provider === 'claude') {
                const targetUrl = 'https://api.anthropic.com/v1/models';
                const res = await fetch(this.proxyUrl + encodeURIComponent(targetUrl), {
                    headers: {
                        'x-api-key': profile.apiKey,
                        'anthropic-version': '2023-06-01',
                        'anthropic-dangerous-direct-browser-access': 'true'
                    }
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                models = data.data.map(m => m.id);
            }
            return models.length > 0 ? models : this.getFallbackModels(profile.provider);
        } catch (e) {
            console.warn(`Failed to fetch models for ${profile.provider}. Using fallbacks.`, e);
            return this.getFallbackModels(profile.provider);
        }
    }

    getFallbackModels(provider) {
        if (provider === 'openai') return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
        if (provider === 'gemini') return ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro', 'gemini-1.5-flash'];
        if (provider === 'claude') return ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'];
        return [];
    }

    async callLLM(history) {
        const p = this.getActiveProfile();
        if (!p) throw new Error("No active profile.");

        const sysPrompt = this.getSystemPrompt();

        if (p.provider === 'openai') {
            const targetUrl = 'https://api.openai.com/v1/chat/completions';
            const messages = [{ role: 'system', content: sysPrompt }, ...history];
            const res = await fetch(this.proxyUrl + encodeURIComponent(targetUrl), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p.apiKey}` },
                body: JSON.stringify({ model: p.model, messages })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.choices[0].message.content;
        }
        else if (p.provider === 'gemini') {
            const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent?key=${p.apiKey}`;
            const contents = history.map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            }));
            const res = await fetch(this.proxyUrl + encodeURIComponent(targetUrl), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: sysPrompt }] },
                    contents: contents
                })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.candidates[0].content.parts[0].text;
        }
        else if (p.provider === 'claude') {
            const targetUrl = 'https://api.anthropic.com/v1/messages';
            const normalized = [];
            for (let m of history) {
                if (normalized.length > 0 && normalized[normalized.length - 1].role === m.role) {
                    normalized[normalized.length - 1].content += "\n\n" + m.content;
                } else {
                    normalized.push({ role: m.role, content: m.content });
                }
            }

            const res = await fetch(this.proxyUrl + encodeURIComponent(targetUrl), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': p.apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: p.model,
                    system: sysPrompt,
                    messages: normalized,
                    max_tokens: 4000
                })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.content[0].text;
        }
    }

    // ==========================================
    // CHAT LOOP & EXECUTION
    // ==========================================

    async submitChat() {
        const input = this.shadowRoot.getElementById('chat-input');
        const text = input.value.trim();
        if (!text || this.isWorking) return;

        if (!this.getActiveProfile()) {
            this.appendMessage('system', "Please set up an API profile in settings first.");
            this.switchTab('settings');
            return;
        }

        input.value = '';
        this.appendMessage('user', text);
        this.messages.push({ role: 'user', content: text });

        this.setWorkingState(true);
        await this.agentExecutionLoop();
    }

    async agentExecutionLoop() {
        let loopActive = true;
        let iterations = 0;
        const MAX_ITERATIONS = 5;

        while (loopActive && iterations < MAX_ITERATIONS) {
            iterations++;
            const loaderId = this.appendLoader();

            try {
                const responseRaw = await this.callLLM(this.messages);
                this.removeMessage(loaderId);

                this.messages.push({ role: 'assistant', content: responseRaw });

                const jsMatch = responseRaw.match(/<run_js>([\s\S]*?)<\/run_js>/);

                if (jsMatch) {
                    const rawCode = jsMatch[1];
                    const displayContent = responseRaw.replace(jsMatch[0], '').trim();

                    if (displayContent) this.appendMessage('assistant', displayContent);

                    this.appendMessage('assistant', `<div class="code-exec-block"><div class="code-exec-title">⚡ Agent Executing Code</div><pre><code>${this.escapeHTML(rawCode)}</code></pre></div>`, true);

                    let jsResult;
                    try {
                        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
                        const executor = new AsyncFunction(rawCode);
                        const result = await executor();

                        jsResult = typeof result === 'object' ? JSON.stringify(result) : String(result);
                        this.appendMessage('system', `Result: ${jsResult.substring(0, 100)}${jsResult.length > 100 ? '...' : ''}`);

                        this.messages.push({ role: 'user', content: `<js_result>\n${jsResult}\n</js_result>` });
                    } catch (err) {
                        jsResult = err.toString();
                        this.appendMessage('system', `Error: ${jsResult}`);
                        this.messages.push({ role: 'user', content: `<js_error>\n${jsResult}\n</js_error>` });
                    }
                } else {
                    this.appendMessage('assistant', responseRaw);
                    loopActive = false;
                }

            } catch (error) {
                this.removeMessage(loaderId);
                this.appendMessage('system', `API Error: ${error.message}`);
                loopActive = false;
            }
        }

        if (iterations >= MAX_ITERATIONS) {
            this.appendMessage('system', "Agent paused to prevent infinite execution loop.");
        }

        this.setWorkingState(false);
    }

    // ==========================================
    // UI RENDERING & DOM MANIPULATION
    // ==========================================

    render() {
        let template = `
            <style>
                :host {
                    --bg: #ffffff; --panel-bg: #f8fafc; --border: #e2e8f0;
                    --text: #0f172a; --text-muted: #64748b;
                    --primary: #6366f1; --primary-hover: #4f46e5;
                    --user-msg: #e0e7ff; --bot-msg: #f1f5f9;
                    --shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    font-size: 14px; line-height: 1.5;
                    position: fixed; z-index: 2147483647;
                }
                #fab {
                    position: fixed; bottom: 24px; right: 24px;
                    width: 60px; height: 60px; border-radius: 50%;
                    background: var(--primary); color: white;
                    display: flex; align-items: center; justify-content: center;
                    box-shadow: var(--shadow); cursor: pointer;
                    transition: transform 0.2s, background 0.2s;
                }
                #fab:hover { transform: scale(1.05); background: var(--primary-hover); }
                #fab svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
                #panel {
                    position: fixed; bottom: 100px; right: 24px;
                    width: 400px; height: 650px; max-height: calc(100vh - 120px);
                    background: var(--bg); border-radius: 16px;
                    box-shadow: var(--shadow); border: 1px solid var(--border);
                    display: flex; flex-direction: column; overflow: hidden;
                    opacity: 0; pointer-events: none; transform: translateY(20px) scale(0.95);
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }
                #panel.open { opacity: 1; pointer-events: auto; transform: translateY(0) scale(1); }
                header {
                    background: var(--bg); padding: 14px 20px;
                    border-bottom: 1px solid var(--border);
                    display: flex; justify-content: space-between; align-items: center;
                    cursor: grab; user-select: none;
                }
                header:active { cursor: grabbing; }
                .title-area { display: flex; flex-direction: column; }
                .title { font-weight: 700; color: var(--text); font-size: 16px; display: flex; align-items: center; gap: 8px;}
                .status { font-size: 11px; color: #10b981; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;}
                .actions button {
                    background: none; border: none; padding: 6px; border-radius: 6px;
                    cursor: pointer; color: var(--text-muted); transition: all 0.2s;
                    display: inline-flex; align-items: center; justify-content: center;
                }
                .actions button:hover { background: var(--panel-bg); color: var(--text); }
                .actions svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; }
                .view { flex: 1; overflow-y: auto; display: none; flex-direction: column; background: var(--bg); }
                .view.active { display: flex; }
                #chat-history { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
                .msg { max-width: 88%; padding: 12px 16px; border-radius: 12px; word-wrap: break-word; }
                .msg p { margin: 0 0 8px 0; }
                .msg p:last-child { margin: 0; }
                .msg-user { align-self: flex-end; background: var(--user-msg); color: var(--text); border-bottom-right-radius: 4px; }
                .msg-assistant { align-self: flex-start; background: var(--bot-msg); color: var(--text); border-bottom-left-radius: 4px; border: 1px solid var(--border); }
                .msg-system { align-self: center; background: none; color: var(--text-muted); font-size: 12px; font-weight: 500; }
                .code-exec-block { background: #1e293b; border-radius: 8px; overflow: hidden; margin-top: 8px; }
                .code-exec-title { background: #0f172a; color: #fbbf24; font-size: 11px; font-weight: 700; padding: 6px 12px; text-transform: uppercase; letter-spacing: 0.5px; }
                .code-exec-block pre { margin: 0; padding: 12px; overflow-x: auto; font-family: monospace; font-size: 12px; color: #e2e8f0; }
                .input-wrapper { padding: 16px; background: var(--bg); border-top: 1px solid var(--border); display: flex; gap: 10px; align-items: flex-end; }
                textarea {
                    flex: 1; padding: 12px; border-radius: 12px; border: 1px solid var(--border);
                    background: var(--panel-bg); color: var(--text); font-family: inherit; font-size: 14px;
                    resize: none; outline: none; transition: border-color 0.2s; max-height: 120px;
                }
                textarea:focus { border-color: var(--primary); background: var(--bg); }
                .send-btn {
                    width: 44px; height: 44px; border-radius: 12px; background: var(--primary); color: white;
                    border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
                    transition: background 0.2s; flex-shrink: 0;
                }
                .send-btn:hover { background: var(--primary-hover); }
                .send-btn:disabled { background: var(--border); color: var(--text-muted); cursor: not-allowed; }
                #settings-view { padding: 20px; gap: 20px; }
                h3 { margin: 0 0 16px 0; color: var(--text); font-size: 16px; }
                .form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
                label { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }
                input, select {
                    padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px;
                    font-size: 14px; background: var(--panel-bg); color: var(--text); outline: none;
                }
                input:focus, select:focus { border-color: var(--primary); background: var(--bg); }
                .helper-link { font-size: 11px; color: var(--primary); text-decoration: none; align-self: flex-start; }
                .helper-link:hover { text-decoration: underline; }
                .btn-block {
                    width: 100%; padding: 12px; background: var(--primary); color: white;
                    border: none; border-radius: 8px; font-weight: 600; cursor: pointer;
                }
                .btn-block:hover { background: var(--primary-hover); }
                .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
                .btn-outline:hover { background: var(--panel-bg); }
                .profile-card {
                    padding: 12px; border: 1px solid var(--border); border-radius: 8px;
                    margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;
                    cursor: pointer; transition: all 0.2s;
                }
                .profile-card:hover { border-color: var(--primary); }
                .profile-card.active { border: 2px solid var(--primary); background: var(--user-msg); }
                .profile-info { display: flex; flex-direction: column; gap: 4px; }
                .profile-name { font-weight: 600; font-size: 14px; }
                .profile-meta { font-size: 12px; color: var(--text-muted); }
                .del-btn { color: #ef4444; background: none; border: none; cursor: pointer; padding: 4px; }
                hr { border: 0; border-top: 1px solid var(--border); margin: 0; }
                .loader { display: flex; gap: 4px; padding: 16px; align-self: flex-start; }
                .dot { width: 8px; height: 8px; background: var(--primary); border-radius: 50%; animation: bounce 1.4s infinite ease-in-out both; }
                .dot:nth-child(1) { animation-delay: -0.32s; }
                .dot:nth-child(2) { animation-delay: -0.16s; }
                @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
            </style>
            <div id="fab">
                <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><path d="M21 9a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            </div>
            <div id="panel">
                <header id="drag-handle">
                    <div class="title-area">
                        <div class="title">OmniAgent</div>
                        <div class="status" id="agent-status">● Ready</div>
                    </div>
                    <div class="actions">
                        <button id="btn-chat" title="Chat"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></button>
                        <button id="btn-settings" title="Settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button>
                        <button id="btn-close" title="Minimize"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                    </div>
                </header>
                <div id="chat-view" class="view">
                    <div id="chat-history"></div>
                    <div class="input-wrapper">
                        <textarea id="chat-input" placeholder="Instruct the agent..." rows="1"></textarea>
                        <button id="send-btn" class="send-btn"><svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:white;fill:none;stroke-width:2;"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg></button>
                    </div>
                </div>
                <div id="settings-view" class="view">
                    <div>
                        <h3>API Profiles</h3>
                        <div id="profiles-list"></div>
                    </div>
                    <hr>
                    <div>
                        <h3>Add New Profile</h3>
                        <div class="form-group">
                            <label>Provider</label>
                            <select id="set-provider">
                                <option value="gemini">Google Gemini</option>
                                <option value="openai">OpenAI (ChatGPT)</option>
                                <option value="claude">Anthropic (Claude)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Profile Name</label>
                            <input type="text" id="set-name" placeholder="e.g. Work API">
                        </div>
                        <div class="form-group">
                            <label>API Key</label>
                            <input type="password" id="set-key" placeholder="Paste your API key here">
                            <a id="api-link" class="helper-link" href="https://aistudio.google.com/app/apikey" target="_blank">Get a Google Gemini API Key</a>
                        </div>
                        <button class="btn-block btn-outline" id="btn-save-profile">+ Save Profile</button>
                    </div>
                    <hr>
                    <div id="model-config-area" style="display:none;">
                        <h3>Active Model</h3>
                        <div class="form-group">
                            <label style="display:flex; justify-content:space-between; align-items:center;">
                                Select Model 
                                <button id="btn-refresh-models" style="background:none;border:none;cursor:pointer;color:var(--primary);font-size:14px;" title="Refresh list">🔄</button>
                            </label>
                            <select id="set-model"></select>
                        </div>
                        <div class="form-group">
                            <label>Or type a custom model ID:</label>
                            <input type="text" id="set-custom-model" placeholder="e.g. gpt-4-turbo">
                        </div>
                        <button class="btn-block" id="btn-update-model">Update Active Model</button>
                    </div>
                </div>
            </div>
        `;

        // Trusted Types Bypass for ultra-secure hostile sites (like Discord)
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
            try {
                if (!window.omniAgentPolicy) {
                    window.omniAgentPolicy = window.trustedTypes.createPolicy('omni-agent-policy', {
                        createHTML: (string) => string
                    });
                }
                template = window.omniAgentPolicy.createHTML(template);
            } catch (e) {
                console.warn("OmniAgent: TrustedTypes policy creation blocked, falling back to raw injection.", e);
            }
        }

        this.shadowRoot.innerHTML = template;
    }

    bindEvents() {
        const sr = this.shadowRoot;

        sr.getElementById('fab').addEventListener('click', () => this.togglePanel(true));
        sr.getElementById('btn-close').addEventListener('click', () => this.togglePanel(false));

        sr.getElementById('btn-chat').addEventListener('click', () => this.switchTab('chat'));
        sr.getElementById('btn-settings').addEventListener('click', () => this.switchTab('settings'));

        const chatInput = sr.getElementById('chat-input');
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submitChat(); }
        });
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = (chatInput.scrollHeight) + 'px';
        });
        sr.getElementById('send-btn').addEventListener('click', () => this.submitChat());

        sr.getElementById('set-provider').addEventListener('change', (e) => {
            const link = sr.getElementById('api-link');
            if (e.target.value === 'openai') { link.href = 'https://platform.openai.com/api-keys'; link.innerText = 'Get an OpenAI API Key'; }
            else if (e.target.value === 'claude') { link.href = 'https://console.anthropic.com/settings/keys'; link.innerText = 'Get an Anthropic API Key'; }
            else { link.href = 'https://aistudio.google.com/app/apikey'; link.innerText = 'Get a Google Gemini API Key'; }
        });

        sr.getElementById('btn-save-profile').addEventListener('click', () => {
            const provider = sr.getElementById('set-provider').value;
            const name = sr.getElementById('set-name').value.trim() || provider.toUpperCase();
            const key = sr.getElementById('set-key').value.trim();

            if (!key) return alert("API Key is required.");

            const newProfile = { id: 'prof_' + Date.now(), name, provider, apiKey: key, model: '' };
            this.profiles.push(newProfile);
            this.activeProfileId = newProfile.id;

            sr.getElementById('set-name').value = '';
            sr.getElementById('set-key').value = '';

            this.saveData();
            this.renderProfilesList();
            this.initActiveProfile();
        });

        sr.getElementById('btn-refresh-models').addEventListener('click', () => this.initActiveProfile(true));

        sr.getElementById('btn-update-model').addEventListener('click', () => {
            const active = this.getActiveProfile();
            if (!active) return;
            const customModel = sr.getElementById('set-custom-model').value.trim();
            const dropdownModel = sr.getElementById('set-model').value;
            active.model = customModel || dropdownModel;
            this.saveData();
            alert(`Model updated to ${active.model}`);
        });

        const panel = sr.getElementById('panel');
        const handle = sr.getElementById('drag-handle');
        let offsetX, offsetY;

        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            this.isDragging = true;
            const rect = panel.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            panel.style.bottom = 'auto';
            panel.style.right = 'auto';
            panel.style.left = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - panel.offsetWidth)) + 'px';
            panel.style.top = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - panel.offsetHeight)) + 'px';
        });

        document.addEventListener('mouseup', () => this.isDragging = false);
    }

    async initLoad() {
        this.renderProfilesList();
        this.switchTab(this.currentTab);
        if (this.profiles.length > 0) {
            await this.initActiveProfile();
            if (this.messages.length === 0) {
                this.appendMessage('system', "OmniAgent initialized with 'God Mode' access to the DOM. How can I modify this page for you?");
            }
        }
    }

    async initActiveProfile(forceFetch = false) {
        const active = this.getActiveProfile();
        const configArea = this.shadowRoot.getElementById('model-config-area');

        if (!active) {
            configArea.style.display = 'none';
            return;
        }

        configArea.style.display = 'block';
        const select = this.shadowRoot.getElementById('set-model');

        if (forceFetch || this.availableModels.length === 0) {
            select.innerHTML = '<option>Fetching available models...</option>';
            this.availableModels = await this.fetchModelsForProfile(active);
        }

        select.innerHTML = this.availableModels.map(m =>
            `<option value="${m}" ${active.model === m ? 'selected' : ''}>${m}</option>`
        ).join('');

        if (!active.model && this.availableModels.length > 0) {
            active.model = this.availableModels[0];
            this.saveData();
        }
    }

    saveData() {
        localStorage.setItem('omniagent_profiles', JSON.stringify(this.profiles));
        localStorage.setItem('omniagent_active_profile', this.activeProfileId);
    }

    togglePanel(show) {
        const panel = this.shadowRoot.getElementById('panel');
        if (show) {
            panel.classList.add('open');
            this.shadowRoot.getElementById('chat-input').focus();
        } else {
            panel.classList.remove('open');
        }
    }

    switchTab(tabId) {
        this.currentTab = tabId;
        const sr = this.shadowRoot;
        sr.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        sr.getElementById(`${tabId}-view`).classList.add('active');

        sr.getElementById('btn-chat').style.color = tabId === 'chat' ? 'var(--primary)' : '';
        sr.getElementById('btn-settings').style.color = tabId === 'settings' ? 'var(--primary)' : '';
    }

    renderProfilesList() {
        const list = this.shadowRoot.getElementById('profiles-list');
        list.innerHTML = '';

        if (this.profiles.length === 0) {
            list.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">No profiles found. Create one below.</p>';
            return;
        }

        this.profiles.forEach(p => {
            const card = document.createElement('div');
            card.className = `profile-card ${p.id === this.activeProfileId ? 'active' : ''}`;
            card.innerHTML = `
                <div class="profile-info">
                    <span class="profile-name">${p.name}</span>
                    <span class="profile-meta">${p.provider.toUpperCase()} • ${p.model || 'No model set'}</span>
                </div>
                <button class="del-btn" title="Delete">✖</button>
            `;

            card.addEventListener('click', (e) => {
                if (e.target.classList.contains('del-btn')) {
                    this.profiles = this.profiles.filter(prof => prof.id !== p.id);
                    if (this.activeProfileId === p.id) this.activeProfileId = this.profiles[0]?.id || null;
                } else {
                    this.activeProfileId = p.id;
                }
                this.saveData();
                this.renderProfilesList();
                this.initActiveProfile();
            });

            list.appendChild(card);
        });
    }

    setWorkingState(isWorking) {
        this.isWorking = isWorking;
        const sr = this.shadowRoot;
        sr.getElementById('send-btn').disabled = isWorking;
        sr.getElementById('chat-input').disabled = isWorking;
        sr.getElementById('agent-status').innerText = isWorking ? '⚙️ Working...' : '● Ready';
        sr.getElementById('agent-status').style.color = isWorking ? '#fbbf24' : '#10b981';

        if (!isWorking) sr.getElementById('chat-input').focus();
    }

    appendMessage(role, content, isHtml = false) {
        const history = this.shadowRoot.getElementById('chat-history');
        const msgDiv = document.createElement('div');
        msgDiv.className = `msg msg-${role}`;

        if (isHtml) {
            msgDiv.innerHTML = content;
        } else {
            let formatted = this.escapeHTML(content);
            formatted = formatted.replace(/```([\s\S]*?)```/g, '<div class="code-exec-block"><pre><code>$1</code></pre></div>');
            formatted = formatted.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.1);padding:2px 4px;border-radius:4px;font-family:monospace;">$1</code>');
            formatted = formatted.replace(/\n/g, '<br>');
            msgDiv.innerHTML = formatted;
        }

        history.appendChild(msgDiv);
        history.scrollTop = history.scrollHeight;
    }

    appendLoader() {
        const history = this.shadowRoot.getElementById('chat-history');
        const div = document.createElement('div');
        div.id = 'loader_' + Date.now();
        div.className = 'loader msg-assistant';
        div.innerHTML = `<div class="dot"></div><div class="dot"></div><div class="dot"></div>`;
        history.appendChild(div);
        history.scrollTop = history.scrollHeight;
        return div.id;
    }

    removeMessage(id) {
        const el = this.shadowRoot.getElementById(id);
        if (el) el.remove();
    }

    escapeHTML(str) {
        return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag]));
    }
}

// Ensure safe definition and auto-injection on page load
if (!customElements.get('omni-agent')) {
    customElements.define('omni-agent', OmniAgent);
}
if (!document.querySelector('omni-agent')) {
    document.body.appendChild(document.createElement('omni-agent'));
}