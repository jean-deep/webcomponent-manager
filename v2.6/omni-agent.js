class OmniAgent extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        // ==========================================
        // ⚙️ OMNIAGENT CONFIGURATION
        // ==========================================

        // 1. Cloudflare Proxy URL (to bypass CORS)
        const WORKER_URL = 'https://omni-proxy.sidorokarcaria.workers.dev';
        this.proxyUrl = WORKER_URL + '/?url=';

        // ==========================================

        // Core State
        this.isVaultSetup = !!localStorage.getItem('omniagent_vault');
        this.profiles = this.isVaultSetup ? [] : (JSON.parse(localStorage.getItem('omniagent_profiles')) || []);
        this.activeProfileId = localStorage.getItem('omniagent_active_profile') || null;
        this.messages = [];
        this.availableModels = [];

        // Sync State
        this.pat = null;
        this.GIST_ID = null;
        this.vaultKey = null; // Stored in volatile memory only
        this.isSynced = false;

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
    // ☁️ VAULT SYNC & CRYPTO ENGINE (Zero-Knowledge)
    // ==========================================

    async unlockCrypto(password) {
        const vaultStr = localStorage.getItem('omniagent_vault');
        if (!vaultStr) throw new Error("Vault not set up.");
        const vault = JSON.parse(vaultStr);

        const salt = this.base64ToBuffer(vault.salt);
        this.vaultSalt = salt;
        const iv = this.base64ToBuffer(vault.iv);
        const data = this.base64ToBuffer(vault.data);

        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
        this.vaultKey = await crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
            keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
        );

        try {
            const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, this.vaultKey, data);
            const payload = JSON.parse(new TextDecoder().decode(decrypted));
            this.pat = payload.pat;
            this.profiles = payload.profiles || [];
            this.GIST_ID = vault.gistId;
        } catch (e) {
            throw new Error("Incorrect Master Password.");
        }
    }

    bufferToBase64(buffer) {
        return btoa(String.fromCharCode.apply(null, new Uint8Array(buffer)));
    }

    base64ToBuffer(b64) {
        return new Uint8Array(atob(b64).split("").map(c => c.charCodeAt(0)));
    }

    async saveEncryptedLocalData() {
        if (!this.vaultKey || !this.pat || !this.GIST_ID || !this.vaultSalt) return;

        const enc = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const payload = JSON.stringify({ pat: this.pat, profiles: this.profiles });

        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, this.vaultKey, enc.encode(payload));

        localStorage.setItem('omniagent_vault', JSON.stringify({
            salt: this.bufferToBase64(this.vaultSalt),
            iv: this.bufferToBase64(iv),
            data: this.bufferToBase64(ciphertext),
            gistId: this.GIST_ID
        }));

        localStorage.removeItem('omniagent_profiles'); // Clean up plain text
    }

    async setupVault(pat, password, explicitGistId = '') {
        const status = this.shadowRoot.getElementById('vault-status');
        status.innerText = "Searching for existing Vault...";
        status.style.color = "#fbbf24";

        try {
            let gistId = explicitGistId;
            let existingSaltStr = null;

            if (!gistId) {
                let page = 1;
                let foundGist = null;
                while (true) {
                    const res = await fetch(`https://api.github.com/gists?per_page=100&page=${page}`, {
                        headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json' }
                    });
                    if (!res.ok) throw new Error("Invalid GitHub PAT or missing gist permissions.");
                    const gists = await res.json();
                    if (gists.length === 0) break;
                    
                    foundGist = gists.find(g => g.files['profiles.json'] && g.description && g.description.includes('OmniAgent'));
                    if (!foundGist) foundGist = gists.find(g => g.files['profiles.json']);
                    if (foundGist) break;
                    page++;
                }
                if (foundGist) {
                    gistId = foundGist.id;
                }
            }

            if (gistId) {
                status.innerText = "Existing Vault found. Linking...";

                // Fetch the existing gist to extract the salt
                const resGist = await fetch(`https://api.github.com/gists/${gistId}`, {
                    headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json' }
                });
                if (!resGist.ok) throw new Error("Failed to fetch the specified Gist.");
                const gistData = await resGist.json();
                const fileContent = gistData.files['profiles.json']?.content;
                if (fileContent && fileContent.trim() !== '' && fileContent !== '{}') {
                    try {
                        const parsed = JSON.parse(fileContent);
                        if (parsed.salt) existingSaltStr = parsed.salt;
                    } catch (e) { }
                }
            } else {
                status.innerText = "Creating new Vault...";
                const createRes = await fetch('https://api.github.com/gists', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json' },
                    body: JSON.stringify({
                        description: 'OmniAgent Cloud Vault',
                        public: false,
                        files: { 'profiles.json': { content: '{}' } }
                    })
                });
                const createData = await createRes.json();
                gistId = createData.id;
            }

            // Generate Local Crypto
            const enc = new TextEncoder();
            let salt;
            if (existingSaltStr) {
                salt = this.base64ToBuffer(existingSaltStr);
            } else if (gistId && status.innerText.includes("Existing")) {
                // Legacy v2.3 fallback: missing salt in gist means it used the hardcoded v2.3 salt
                const legacyPatStr = '4kCCaVV0b1ds6pefD8y6DCmEcFVLpMKaRqcdqY41jjpK4QsXAi8JPoTVL7Cae0/lNZYW4KL78j+GyR54R2/tHAMBVGisERsGGNitwBqBDU1i/Moe';
                const legacyCombined = new Uint8Array(atob(legacyPatStr).split("").map(c => c.charCodeAt(0)));
                salt = legacyCombined.slice(0, 16);
                console.log("☁️ OmniAgent: Upgrading legacy v2.3 vault to v2.6.");
            } else {
                salt = crypto.getRandomValues(new Uint8Array(16));
            }
            this.vaultSalt = salt;

            const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
            this.vaultKey = await crypto.subtle.deriveKey(
                { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
                keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
            );

            this.pat = pat;
            this.GIST_ID = gistId;
            this.isVaultSetup = true;

            await this.saveEncryptedLocalData();

            // Sync with cloud
            const cloudProfiles = await this.fetchVault();
            if (Array.isArray(cloudProfiles) && cloudProfiles.length > 0) {
                this.profiles = cloudProfiles;
                if (!this.profiles.find(p => p.id === this.activeProfileId)) {
                    this.activeProfileId = this.profiles[0]?.id || null;
                }
                await this.saveLocalData();
            } else if (this.profiles.length > 0) {
                await this.updateVault(this.profiles);
            }

            this.isSynced = true;
            this.updateVaultUI();
            this.renderProfilesList();
            await this.initActiveProfile();

            status.innerText = "Vault Setup & Synced Successfully!";
            status.style.color = "#10b981";

        } catch (err) {
            status.innerText = err.message;
            status.style.color = "#ef4444";
            throw err;
        }
    }

    async encryptVaultData(profilesArray) {
        const enc = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = enc.encode(JSON.stringify(profilesArray));
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, this.vaultKey, data);

        return JSON.stringify({
            v: 1,
            salt: this.bufferToBase64(this.vaultSalt),
            iv: this.bufferToBase64(iv),
            data: this.bufferToBase64(ciphertext)
        });
    }

    async decryptVaultData(encryptedString) {
        try {
            const parsed = JSON.parse(encryptedString);
            if (parsed.v !== 1) throw new Error("Unknown vault version");
            const iv = this.base64ToBuffer(parsed.iv);
            const data = this.base64ToBuffer(parsed.data);

            const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, this.vaultKey, data);
            return JSON.parse(new TextDecoder().decode(decrypted));
        } catch (e) {
            try { return JSON.parse(encryptedString); } catch (err) { return []; }
        }
    }

    async fetchVault() {
        const res = await fetch(`https://api.github.com/gists/${this.GIST_ID}`, {
            headers: {
                'Authorization': `Bearer ${this.pat}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        if (!res.ok) throw new Error("Failed to connect to GitHub Gist.");
        const data = await res.json();

        const fileContent = data.files['profiles.json']?.content;
        if (!fileContent || fileContent === '{}' || fileContent.trim() === '') return [];

        return await this.decryptVaultData(fileContent);
    }

    async updateVault(profilesArray) {
        if (!this.pat || !this.isSynced || !this.vaultKey || !this.GIST_ID) return;

        try {
            const encryptedContent = await this.encryptVaultData(profilesArray);

            await fetch(`https://api.github.com/gists/${this.GIST_ID}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${this.pat}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                body: JSON.stringify({
                    files: {
                        'profiles.json': {
                            content: encryptedContent
                        }
                    }
                })
            });
            console.log("☁️ OmniAgent: Vault encrypted and synced to cloud.");
        } catch (err) {
            console.error("☁️ OmniAgent: Failed to sync vault to cloud.", err);
        }
    }

    async handleUnlockVault(password) {
        const btn = this.shadowRoot.getElementById('btn-unlock-vault');
        const status = this.shadowRoot.getElementById('vault-status');

        btn.disabled = true;
        btn.innerText = "Unlocking...";

        try {
            await this.unlockCrypto(password);

            status.innerText = "Fetching and decrypting cloud data...";
            status.style.color = "#fbbf24";
            const cloudProfiles = await this.fetchVault();

            if (Array.isArray(cloudProfiles) && cloudProfiles.length > 0) {
                this.profiles = cloudProfiles;
                if (!this.profiles.find(p => p.id === this.activeProfileId)) {
                    this.activeProfileId = this.profiles[0]?.id || null;
                }
                await this.saveLocalData();
            } else if (this.profiles.length > 0) {
                await this.updateVault(this.profiles);
            }

            this.isSynced = true;
            this.updateVaultUI();
            this.renderProfilesList();
            await this.initActiveProfile();

            status.innerText = "Vault Unlocked & Synced";
            status.style.color = "#10b981";

        } catch (err) {
            status.innerText = err.message;
            status.style.color = "#ef4444";
        } finally {
            btn.disabled = false;
            btn.innerText = "Unlock & Sync";
            this.shadowRoot.getElementById('vault-password').value = '';
        }
    }

    updateVaultUI() {
        const sr = this.shadowRoot;
        const setupUi = sr.getElementById('vault-setup-ui');
        const lockedUi = sr.getElementById('vault-locked-ui');
        const unlockedUi = sr.getElementById('vault-unlocked-ui');

        if (!this.isVaultSetup) {
            setupUi.style.display = 'block';
            lockedUi.style.display = 'none';
            unlockedUi.style.display = 'none';
        } else if (this.isSynced) {
            setupUi.style.display = 'none';
            lockedUi.style.display = 'none';
            unlockedUi.style.display = 'block';
        } else {
            setupUi.style.display = 'none';
            lockedUi.style.display = 'block';
            unlockedUi.style.display = 'none';
        }
    }

    // ==========================================
    // AGENTIC PROTOCOL & EXECUTION ENGINE
    // ==========================================

    getSystemPrompt() {
        // Generate a lightweight map of the DOM to give the agent instant "sight"
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

    // Creates a minified map of the DOM, skipping huge text blocks and noisy tags
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

                // Check if the agent wants to execute code
                const jsMatch = responseRaw.match(/<run_js>([\s\S]*?)<\/run_js>/);

                if (jsMatch) {
                    const rawCode = jsMatch[1];
                    const displayContent = responseRaw.replace(jsMatch[0], '').trim();

                    if (displayContent) this.appendMessage('assistant', displayContent);

                    // Visual feedback of execution
                    this.appendMessage('assistant', `<div class="code-exec-block"><div class="code-exec-title">⚡ Agent Executing Code</div><pre><code>${this.escapeHTML(rawCode)}</code></pre></div>`, true);

                    // Execute natively in host window context
                    let jsResult;
                    try {
                        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
                        const executor = new AsyncFunction(rawCode);
                        const result = await executor();

                        jsResult = typeof result === 'object' ? JSON.stringify(result) : String(result);
                        this.appendMessage('system', `Result: ${jsResult.substring(0, 100)}${jsResult.length > 100 ? '...' : ''}`);

                        // Feed back to loop
                        this.messages.push({ role: 'user', content: `<js_result>\n${jsResult}\n</js_result>` });
                    } catch (err) {
                        jsResult = err.toString();
                        this.appendMessage('system', `Error: ${jsResult}`);
                        // Feed error back to allow self-correction
                        this.messages.push({ role: 'user', content: `<js_error>\n${jsResult}\n</js_error>` });
                    }
                    // Loop continues automatically
                } else {
                    // No JS tags, agent is done
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
                #settings-view { padding: 0; }
                .segmented-control { display: flex; background: #e2e8f0; padding: 4px; border-radius: 10px; margin: 16px; }
                .segment { flex: 1; text-align: center; padding: 8px 0; font-size: 13px; font-weight: 600; color: #64748b; border-radius: 8px; cursor: pointer; transition: 0.2s; }
                .segment.active { background: #ffffff; color: #0f172a; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
                .tab-pane { display: none; padding: 0 20px 20px; animation: fadeIn 0.3s ease; }
                .tab-pane.active { display: block; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
                
                .fancy-input-group { position: relative; margin-bottom: 20px; }
                .fancy-input { width: 100%; padding: 12px 12px 12px 40px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 14px; box-sizing: border-box; transition: 0.2s; outline: none; background: #f8fafc; color: #0f172a; }
                .fancy-input:focus { border-color: #6366f1; background: #ffffff; }
                .fancy-icon { position: absolute; left: 14px; top: 12px; color: #94a3b8; font-size: 16px; }
                label { font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 8px; display: block; }

                .btn-primary { width: 100%; padding: 12px; background: #0f172a; color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; transition: 0.2s; }
                .btn-primary:hover { background: #1e293b; }
                .btn-danger-outline { border: 1px solid #fca5a5; color: #dc2626; background: transparent; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; width: 100%;}
                .btn-danger-outline:hover { background: #fef2f2; }

                .vault-status-box { background: #ecfdf5; border: 1px solid #a7f3d0; padding: 16px; border-radius: 10px; text-align: center; }
                .vault-status-box p { color: #059669; font-weight: 600; margin: 0 0 12px 0; }
                
                /* Accordion for Provider Groups */
                .accordion-item { border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 10px; overflow: hidden; background: #fff;}
                .accordion-header { padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 600; color: #0f172a; background: #f8fafc; transition: 0.2s; }
                .accordion-header:hover { background: #f1f5f9; }
                .accordion-content { padding: 0 12px 12px; display: none; }
                .accordion-content.active { display: block; }
                
                .profile-row { display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #e2e8f0; }
                .profile-row:last-child { border-bottom: none; }
                .profile-row.active-profile { border-left: 3px solid #6366f1; background: #eef2ff; }
                .prof-actions button { background: none; border: none; cursor: pointer; padding: 4px; border-radius: 4px; color: var(--text-muted);}
                .prof-actions button:hover { background: #e2e8f0; color: var(--text); }

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
                    
                    <div class="segmented-control">
                        <div class="segment active" data-tab="profiles">Profiles</div>
                        <div class="segment" data-tab="models">Model</div>
                        <div class="segment" data-tab="vault">Vault Sync</div>
                    </div>

                    <div id="settings-tab-profiles" class="tab-pane active">
                        <div id="profiles-list"></div>

                        <label id="profile-form-title" style="margin-top:20px;">Add New Profile</label>
                        <input type="hidden" id="edit-profile-id" value="">
                        <div class="fancy-input-group">
                            <span class="fancy-icon">🏢</span>
                            <select class="fancy-input" id="set-provider">
                                <option value="openai">OpenAI (ChatGPT)</option>
                                <option value="gemini">Google Gemini</option>
                                <option value="claude">Anthropic (Claude)</option>
                            </select>
                        </div>
                        <div class="fancy-input-group">
                            <span class="fancy-icon">🏷️</span>
                            <input type="text" class="fancy-input" id="set-name" placeholder="Profile Name">
                        </div>
                        <div class="fancy-input-group">
                            <span class="fancy-icon">🔑</span>
                            <input type="password" class="fancy-input" id="set-key" placeholder="API Key">
                            <a id="api-link" style="font-size:11px;color:#6366f1;text-decoration:none;margin-top:4px;display:block;" href="https://platform.openai.com/api-keys" target="_blank">Get an OpenAI API Key</a>
                        </div>
                        <div style="display:flex; gap:10px;">
                            <button class="btn-primary" id="btn-save-profile">+ Save Profile</button>
                            <button class="btn-danger-outline" id="btn-cancel-edit" style="display:none; width:auto; padding: 12px;">Cancel</button>
                        </div>
                    </div>

                    <div id="settings-tab-models" class="tab-pane">
                        <label>Select AI Model <button id="btn-refresh-models" style="background:none;border:none;cursor:pointer;color:#6366f1;font-size:14px;float:right;padding:0;" title="Refresh list">🔄</button></label>
                        <div id="model-config-area">
                            <div class="fancy-input-group">
                                <span class="fancy-icon">🧠</span>
                                <select class="fancy-input" id="set-model"></select>
                            </div>
                            <label>Or custom Model ID</label>
                            <div class="fancy-input-group">
                                <span class="fancy-icon">⚡</span>
                                <input type="text" class="fancy-input" id="set-custom-model" placeholder="e.g. custom-model-v2">
                            </div>
                            <button class="btn-primary" id="btn-update-model">Apply Model</button>
                        </div>
                    </div>

                    <div id="settings-tab-vault" class="tab-pane">
                        <div id="vault-setup-ui" style="display:none;">
                            <label>GitHub Personal Access Token (PAT)</label>
                            <div class="fancy-input-group">
                                <span class="fancy-icon">🔑</span>
                                <input type="password" id="setup-pat" class="fancy-input" placeholder="ghp_xxxxxxxxxxxxxxx">
                                <a class="helper-link" style="margin-top:4px; display:inline-block; font-size:11px; color:#6366f1; text-decoration:none;" href="https://github.com/settings/tokens/new?scopes=gist&description=OmniAgent+Vault" target="_blank">Generate PAT (Needs 'gist' scope)</a>
                            </div>
                            <label>Create Master Password</label>
                            <div class="fancy-input-group">
                                <span class="fancy-icon">🔒</span>
                                <input type="password" id="setup-password" class="fancy-input" placeholder="Strong password to encrypt vault">
                            </div>
                            <label>Gist ID (Optional)</label>
                            <div class="fancy-input-group" style="margin-bottom: 12px;">
                                <span class="fancy-icon">🔗</span>
                                <input type="text" id="setup-gist-id" class="fancy-input" placeholder="Leave blank to auto-create/search">
                            </div>
                            <button class="btn-primary" id="btn-setup-vault">Initialize Vault</button>
                        </div>

                        <div id="vault-locked-ui" style="display:none;">
                            <label>Master Password</label>
                            <div class="fancy-input-group">
                                <span class="fancy-icon">🔒</span>
                                <input type="password" id="vault-password" class="fancy-input" placeholder="Enter password to sync">
                            </div>
                            <button class="btn-primary" id="btn-unlock-vault" style="margin-bottom:12px;">Unlock & Sync</button>
                            <button class="btn-danger-outline" id="btn-forget-vault">Forget Vault (Reset Local)</button>
                        </div>

                        <div id="vault-unlocked-ui" style="display:none;">
                            <div class="vault-status-box" style="margin-bottom:20px;">
                                <p>✅ Vault Unlocked & Synced</p>
                                <button class="btn-danger-outline" id="btn-lock-vault">Lock Vault</button>
                            </div>
                        </div>
                        <div id="vault-status" style="font-size:12px; margin-top:8px; text-align:center;"></div>
                        
                        <label style="color:#64748b; font-weight:400; line-height:1.5; margin-top:16px;">Your profiles are securely encrypted locally and synced to a private GitHub Gist. Zero-knowledge ensures your keys are safe.</label>
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
                console.warn("OmniAgent: TrustedTypes policy blocked.", e);
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

        // Vault Events
        sr.getElementById('btn-setup-vault').addEventListener('click', async () => {
            const pat = sr.getElementById('setup-pat').value.trim();
            const pwd = sr.getElementById('setup-password').value;
            const explicitGistId = sr.getElementById('setup-gist-id') ? sr.getElementById('setup-gist-id').value.trim() : '';
            if (!pat || !pwd) return alert("PAT and Master Password are required.");
            const btn = sr.getElementById('btn-setup-vault');
            btn.disabled = true;
            btn.innerText = "Initializing...";
            try {
                await this.setupVault(pat, pwd, explicitGistId);
            } catch (e) {
                console.error(e);
            } finally {
                btn.disabled = false;
                btn.innerText = "Initialize Vault";
            }
        });

        sr.getElementById('btn-unlock-vault').addEventListener('click', () => {
            const pwd = sr.getElementById('vault-password').value;
            if (pwd) this.handleUnlockVault(pwd);
        });

        sr.getElementById('vault-password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const pwd = sr.getElementById('vault-password').value;
                if (pwd) this.handleUnlockVault(pwd);
            }
        });

        sr.getElementById('btn-lock-vault').addEventListener('click', () => {
            this.pat = null;
            this.vaultKey = null;
            this.isSynced = false;
            this.updateVaultUI();
            sr.getElementById('vault-status').innerText = "Vault locked. Re-enter password to sync.";
            sr.getElementById('vault-status').style.color = "#94a3b8";
        });

        sr.getElementById('btn-forget-vault').addEventListener('click', () => {
            if (confirm("This will forget your vault connection on this device. You will need your PAT and Master Password to reconnect. Proceed?")) {
                localStorage.removeItem('omniagent_vault');
                this.isVaultSetup = false;
                this.pat = null;
                this.GIST_ID = null;
                this.vaultKey = null;
                this.vaultSalt = null;
                this.isSynced = false;
                this.profiles = [];
                this.activeProfileId = null;
                this.updateVaultUI();
                this.renderProfilesList();
                sr.getElementById('vault-status').innerText = "Vault disconnected locally.";
                sr.getElementById('vault-status').style.color = "#64748b";
            }
        });

        // Chat Input
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

        // Settings Sub-Tabs
        sr.querySelectorAll('.segment').forEach(seg => {
            seg.addEventListener('click', (e) => {
                sr.querySelectorAll('.segment').forEach(s => s.classList.remove('active'));
                sr.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
                e.target.classList.add('active');
                sr.getElementById('settings-tab-' + e.target.dataset.tab).classList.add('active');
            });
        });

        // Settings Logic
        sr.getElementById('btn-save-profile').addEventListener('click', async () => {
            const provider = sr.getElementById('set-provider').value;
            const name = sr.getElementById('set-name').value.trim() || provider.toUpperCase();
            const key = sr.getElementById('set-key').value.trim();
            const editId = sr.getElementById('edit-profile-id').value;

            if (!key) return alert("API Key is required.");

            if (editId) {
                const p = this.profiles.find(prof => prof.id === editId);
                if (p) { p.name = name; p.provider = provider; p.apiKey = key; }
            } else {
                const newProfile = { id: 'prof_' + Date.now(), name, provider, apiKey: key, model: '' };
                this.profiles.push(newProfile);
                this.activeProfileId = newProfile.id;
            }

            sr.getElementById('set-name').value = '';
            sr.getElementById('set-key').value = '';
            sr.getElementById('edit-profile-id').value = '';
            sr.getElementById('profile-form-title').innerText = 'Add New Profile';
            sr.getElementById('btn-save-profile').innerText = '+ Save Profile';
            sr.getElementById('btn-cancel-edit').style.display = 'none';

            await this.saveLocalData();
            await this.updateVault(this.profiles); // Cloud Sync

            this.renderProfilesList();
            this.initActiveProfile();
        });

        sr.getElementById('btn-cancel-edit').addEventListener('click', () => {
            sr.getElementById('set-name').value = '';
            sr.getElementById('set-key').value = '';
            sr.getElementById('edit-profile-id').value = '';
            sr.getElementById('profile-form-title').innerText = 'Add New Profile';
            sr.getElementById('btn-save-profile').innerText = '+ Save Profile';
            sr.getElementById('btn-cancel-edit').style.display = 'none';
        });

        sr.getElementById('btn-refresh-models').addEventListener('click', () => this.initActiveProfile(true));

        sr.getElementById('btn-update-model').addEventListener('click', async () => {
            const active = this.getActiveProfile();
            if (!active) return;
            const customModel = sr.getElementById('set-custom-model').value.trim();
            const dropdownModel = sr.getElementById('set-model').value;
            active.model = customModel || dropdownModel;

            await this.saveLocalData();
            await this.updateVault(this.profiles); // Cloud Sync

            alert(`Model updated to ${active.model}`);
        });

        // Dragging
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
        this.updateVaultUI();
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
            await this.saveLocalData();
            this.updateVault(this.profiles); // Cloud Sync
        }
    }

    async saveLocalData() {
        if (this.isVaultSetup) {
            await this.saveEncryptedLocalData();
        } else {
            localStorage.setItem('omniagent_profiles', JSON.stringify(this.profiles));
        }
        if (this.activeProfileId) {
            localStorage.setItem('omniagent_active_profile', this.activeProfileId);
        } else {
            localStorage.removeItem('omniagent_active_profile');
        }
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
            list.innerHTML = '<p style="font-size:12px; color:var(--text-muted); padding: 12px; text-align: center; border: 1px dashed var(--border); border-radius: 8px;">No profiles found. Add one below.</p>';
            return;
        }

        // Group by provider
        const groups = { openai: [], gemini: [], claude: [] };
        this.profiles.forEach(p => {
            if (!groups[p.provider]) groups[p.provider] = [];
            groups[p.provider].push(p);
        });

        const providerNames = { openai: 'OpenAI', gemini: 'Google Gemini', claude: 'Anthropic' };

        Object.keys(groups).forEach(provider => {
            if (groups[provider].length === 0) return;

            const accItem = document.createElement('div');
            accItem.className = 'accordion-item';

            const accHeader = document.createElement('div');
            accHeader.className = 'accordion-header';
            accHeader.innerHTML = `<span>${providerNames[provider] || provider} (${groups[provider].length})</span> <span class="sign">+</span>`;

            const accContent = document.createElement('div');
            accContent.className = 'accordion-content';

            accHeader.addEventListener('click', () => {
                const isActive = accContent.classList.contains('active');
                accContent.classList.toggle('active');
                accHeader.querySelector('.sign').innerText = isActive ? '+' : '-';
            });

            groups[provider].forEach(p => {
                const row = document.createElement('div');
                row.className = `profile-row ${p.id === this.activeProfileId ? 'active-profile' : ''}`;
                row.innerHTML = `
                    <div style="flex:1; cursor:pointer;" class="prof-activate">
                        <div style="font-weight:600;font-size:13px;color:#0f172a;">${p.name} ${p.id === this.activeProfileId ? '<span style="font-size:9px;background:#6366f1;color:white;padding:2px 4px;border-radius:4px;margin-left:4px;">ACTIVE</span>' : ''}</div>
                        <div style="font-size:11px;color:#64748b;margin-top:2px;">${p.model || 'No model set'}</div>
                    </div>
                    <div class="prof-actions">
                        <button class="edit-btn" title="Edit">✏️</button>
                        <button class="del-btn" title="Delete" style="color:#ef4444;">✖</button>
                    </div>
                `;

                row.querySelector('.prof-activate').addEventListener('click', async () => {
                    this.activeProfileId = p.id;
                    await this.saveLocalData();
                    this.renderProfilesList();
                    this.initActiveProfile();
                });

                row.querySelector('.edit-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const sr = this.shadowRoot;
                    sr.getElementById('set-provider').value = p.provider;
                    // Trigger change to update helper link
                    sr.getElementById('set-provider').dispatchEvent(new Event('change'));

                    sr.getElementById('set-name').value = p.name;
                    sr.getElementById('set-key').value = p.apiKey;
                    sr.getElementById('edit-profile-id').value = p.id;
                    sr.getElementById('profile-form-title').innerText = 'Edit Profile';
                    sr.getElementById('btn-save-profile').innerText = 'Save Changes';
                    sr.getElementById('btn-cancel-edit').style.display = 'block';

                    // Switch to Profiles tab if not there
                    sr.querySelectorAll('.segment').forEach(s => s.classList.remove('active'));
                    sr.querySelector('.segment[data-tab="profiles"]').classList.add('active');
                    sr.querySelectorAll('.tab-pane').forEach(tp => tp.classList.remove('active'));
                    sr.getElementById('settings-tab-profiles').classList.add('active');
                });

                row.querySelector('.del-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    this.profiles = this.profiles.filter(prof => prof.id !== p.id);
                    if (this.activeProfileId === p.id) this.activeProfileId = this.profiles[0]?.id || null;
                    await this.saveLocalData();
                    await this.updateVault(this.profiles);
                    this.renderProfilesList();
                    this.initActiveProfile();
                });

                accContent.appendChild(row);
            });

            // Auto-expand if active profile is inside
            if (groups[provider].some(p => p.id === this.activeProfileId)) {
                accContent.classList.add('active');
                accHeader.querySelector('.sign').innerText = '-';
            }

            accItem.appendChild(accHeader);
            accItem.appendChild(accContent);
            list.appendChild(accItem);
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

if (!customElements.get('omni-agent')) {
    customElements.define('omni-agent', OmniAgent);
}
if (!document.querySelector('omni-agent')) {
    document.body.appendChild(document.createElement('omni-agent'));
}