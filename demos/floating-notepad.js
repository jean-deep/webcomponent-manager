class FloatingNotepad extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.pos = { x: 100, y: 100 };
    }

    connectedCallback() {
        const savedNote = localStorage.getItem('wc-notepad-content') || '';
        this.shadowRoot.innerHTML = `
      <style>
        .wrapper {
          position: fixed; top: ${this.pos.y}px; left: ${this.pos.x}px;
          width: 250px; background: #fff9c4; border: 1px solid #fbc02d;
          box-shadow: 5px 5px 15px rgba(0,0,0,0.2); z-index: 10001;
          display: flex; flex-direction: column; border-radius: 4px;
        }
        .handle {
          background: #fbc02d; padding: 5px; cursor: move;
          font-size: 10px; font-weight: bold; text-align: center;
        }
        textarea {
          border: none; background: transparent; padding: 10px;
          resize: vertical; min-height: 150px; outline: none;
          font-family: 'Courier New', monospace;
        }
      </style>
      <div class="wrapper" id="note">
        <div class="handle">DRAG ME - QUICK NOTE</div>
        <textarea placeholder="Write something...">${savedNote}</textarea>
      </div>
    `;

        const note = this.shadowRoot.getElementById('note');
        const handle = this.shadowRoot.querySelector('.handle');
        const area = this.shadowRoot.querySelector('textarea');

        // Auto-save logic
        area.oninput = () => localStorage.setItem('wc-notepad-content', area.value);

        // Basic Drag and Drop logic
        handle.onmousedown = (e) => {
            let shiftX = e.clientX - note.getBoundingClientRect().left;
            let shiftY = e.clientY - note.getBoundingClientRect().top;

            const moveAt = (pageX, pageY) => {
                note.style.left = pageX - shiftX + 'px';
                note.style.top = pageY - shiftY + 'px';
            };

            const onMouseMove = (event) => moveAt(event.pageX, event.pageY);
            document.addEventListener('mousemove', onMouseMove);

            document.onmouseup = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.onmouseup = null;
            };
        };
    }
}
customElements.define('floating-notepad', FloatingNotepad);