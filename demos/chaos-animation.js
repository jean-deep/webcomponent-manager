class ChaosAnimation extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.shadowRoot.innerHTML = `
      <style>
        canvas {
          position: fixed; top: 0; left: 0;
          width: 100vw; height: 100vh;
          pointer-events: none; /* Let clicks pass through to the app */
          z-index: 9998;
        }
      </style>
      <canvas id="canvas"></canvas>
    `;
        this.init();
    }

    init() {
        const canvas = this.shadowRoot.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const particles = Array.from({ length: 50 }, () => ({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            r: Math.random() * 5 + 2,
            dx: (Math.random() - 0.5) * 10,
            dy: (Math.random() - 0.5) * 10,
            color: `hsl(${Math.random() * 360}, 70%, 60%)`
        }));

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(p => {
                p.x += p.dx; p.y += p.dy;
                if (p.x < 0 || p.x > canvas.width) p.dx *= -1;
                if (p.y < 0 || p.y > canvas.height) p.dy *= -1;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();
            });
            this._frame = requestAnimationFrame(animate);
        };
        animate();
    }

    disconnectedCallback() {
        cancelAnimationFrame(this._frame);
    }
}
customElements.define('chaos-animation', ChaosAnimation);