# OmniAgent (v3.0)

**OmniAgent** is an advanced, fully client-side AI agent designed to be seamlessly embedded into any webpage. It operates as a dynamic, persistent web companion with "God Mode" access to the Document Object Model (DOM), enabling it to automatically write and execute vanilla JavaScript within the host page to automate tasks, extract data, and interact with web applications on your behalf.

---

## 🌟 Key Features

### 1. "God Mode" DOM Execution Protocol

OmniAgent is not just a chat widget. It is fully aware of its environment. It passes a minified snapshot of the webpage's DOM to the AI, giving it "sight." The agent can then automatically emit safe execution blocks (`<run_js>`) which are executed asynchronously in the context of the host page, allowing for completely autonomous, chained interactions.

### 2. Multi-Provider Intelligence

OmniAgent supports the major industry-leading Large Language Models (LLMs) and open-source ecosystems natively:

- **OpenAI** (GPT-4o, GPT-4 Turbo, GPT-3.5)
- **Anthropic** (Claude 3 Opus, Sonnet, Haiku)
- **Google Gemini** (Gemini 2.5/1.5 Pro & Flash)
- **AI Horde** (Free, crowdsourced cluster of open-source models)

### 3. Bring Your Own Vault (BYOV) Cloud Sync

OmniAgent uses a highly secure, Zero-Knowledge architecture to persist your API keys and configuration across any device or browser:

- **AES-GCM Encryption**: Your profiles and API keys are strictly encrypted locally in the browser using AES-GCM and a cryptographically secure PBKDF2 Master Password derivation.
- **GitHub Gists**: The encrypted payload is synchronized seamlessly to a private GitHub Gist via a Personal Access Token (PAT).
- **Absolute Privacy**: OmniAgent never transmits your Master Password or unencrypted keys over the network. Your keys never touch a central server.

### 4. AI Horde Smart Routing

For users who do not want to consume paid API quotas, OmniAgent offers full integration with the **AI Horde** ecosystem:

- **Multi-Model Selection**: Choose multiple open-source models at once.
- **Smart Parameters & Routing**: Before sending a request, OmniAgent dynamically checks active workers, cross-references your selected models, and smartly scales the max context limits based on the cluster's exact real-time capabilities to guarantee fulfillment.
- **Mid-Flight Fallbacks**: Intelligent abort handling if workers unexpectedly drop.

---

## ⚙️ Specifications & Requirements

### System Requirements

- **Browser**: Any modern browser (Chrome 110+, Firefox 110+, Edge 110+) that supports Web Components, modern Fetch API, and the Web Crypto API.
- **Permissions**: If running as a browser extension or userscript, standard injection permissions are required. If embedded manually via bookmarklet, no special permissions are needed.

### API Requirements

To use OmniAgent, you must provide your own API keys for the respective providers, or use the AI Horde (which works without an API key anonymously, though a free key is recommended for priority queuing).

To enable **BYOV Cloud Sync**, you will need:

1. A GitHub account.
2. A GitHub Personal Access Token (PAT) with **only** the `gist` scope.

---

## 📖 User Manual

### 1. Installation & Injection

OmniAgent is a self-contained Web Component. You can load it into any page via a script tag or bookmarklet:

```javascript
javascript:(function(){
    if(document.querySelector('omni-agent')) return console.log('OmniAgent already active.');
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/gh/jean-deep/webcomponent-manager@main/versions/v3/v3.0/omni-agent.js';
    script.onload = () => {
        document.body.appendChild(document.createElement('omni-agent'));
    };
    document.head.appendChild(script);
})();
```

```js
// Serve locally or via CDN
    script.src = 'path/to/omni-agent.js';
```

Once executed, a floating OmniAgent button will appear in the bottom right corner of the webpage.

### 2. Setting Up Your Vault (First Run)

1. Open the OmniAgent panel and navigate to the **Settings** ⚙️ tab.
2. Go to the **Vault Sync** sub-tab.
3. Paste your GitHub PAT (with `gist` scope) and create a strong Master Password.
4. Click **Initialize Vault**. This will encrypt your local configuration and create a secure cloud backup on your GitHub account.

*(Note: On other devices, simply enter the same PAT and Master Password to instantly pull and decrypt your profiles.)*

### 3. Creating API Profiles

1. In Settings, navigate to the **Profiles** tab.
2. Select an AI Provider (e.g., OpenAI, Anthropic, Gemini, AI Horde).
3. Enter a custom name and paste your API Key. (For AI Horde, the key is optional).
4. Click **Save Profile**.

### 4. Selecting Models & Using Smart Routing

1. In Settings, navigate to the **Model** tab.
2. Select your desired model from the dropdown.
3. *For AI Horde specifically*: You may hold `Ctrl` or `Shift` to select multiple models simultaneously. Ensure the **Smart Parameters & Routing** toggle is checked for the best reliability.
4. Click **Apply Model**.

### 5. Executing Agent Tasks

1. Navigate to the **Chat** 💬 tab.
2. Provide a command to the agent. Examples:
   - *"Summarize the content of this article."*
   - *"Find all the external links on this page and list them out."*
   - *"Click the submit button and read the success message that appears."*
3. The agent will read the DOM, output execution blocks to achieve the task, and report back natively within the chat window.

---

## 🛡️ Security Architecture & Privacy Policy

OmniAgent is designed with privacy-first principles.

- **No Telemetry**: OmniAgent does not collect usage statistics or tracking data.
- **CORS Proxies**: Since browsers block cross-origin requests, OmniAgent uses a transparent proxy (`https://omni-proxy.sidorokarcaria.workers.dev/`) to route API requests. You may change `this.proxyUrl` in the source code to your own secure proxy if desired.
- **Trusted Types**: OmniAgent includes a bypass for strict TrustedTypes CSP policies to ensure it can inject the UI safely into highly hostile/secure environments (like Discord or enterprise portals).

*Built with ❤️ for a decentralized, agentic web.*
