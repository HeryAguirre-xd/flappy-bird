// Game Canvas Setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game Configuration - All tunable values in one place
const CONFIG = {
    canvas: {
        width: 400,
        height: 600
    },
    bird: {
        x: 80,
        width: 34,
        height: 24,
        gravity: 0.6,
        jumpStrength: -10,
        maxVelocity: 12,
        terminalVelocity: 10,
        hitboxPadding: 5  // Pixels to reduce from collision box for forgiveness
    },
    pipe: {
        width: 60,
        gap: 150,
        minHeight: 50,
        baseSpeed: 2.5,
        spawnInterval: 120  // frames
    },
    ground: {
        height: 100,
        scrollSpeed: 2.5
    },
    physics: {
        targetFPS: 60,
        rotationEasing: 0.15
    },
    difficulty: {
        enabled: true,
        speedIncreasePerScore: 0.05,
        maxSpeedMultiplier: 1.8,
        gapDecreasePerScore: 2,
        minGap: 120
    },
    debug: {
        showHitboxes: false  // Set to true to visualize collision boxes
    }
};

// Set canvas size
canvas.width = CONFIG.canvas.width;
canvas.height = CONFIG.canvas.height;

// Game States
const GameState = {
    START: 'start',
    PLAYING: 'playing',
    PAUSED: 'paused',
    GAME_OVER: 'gameOver'
};

// Game Variables
let gameState = GameState.START;
let score = 0;
let bestScore = parseInt(localStorage.getItem('bestScore')) || 0;
let frame = 0;
let particles = [];
let groundOffset = 0;
let lastFrameTime = performance.now();
let deltaTime = 0;
let difficultyMultiplier = 1;
let currentPipeGap = CONFIG.pipe.gap;

// Particle System
class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 4;
        this.vy = (Math.random() - 0.5) * 4 - 2;
        this.gravity = 0.3;
        this.life = 1;
        this.decay = 0.02;
        this.size = Math.random() * 4 + 2;
        this.color = color || '#FFD700';
    }

    update(dt) {
        const normalizedDt = dt / (1000 / CONFIG.physics.targetFPS);
        this.vy += this.gravity * normalizedDt;
        this.x += this.vx * normalizedDt;
        this.y += this.vy * normalizedDt;
        this.life -= this.decay * normalizedDt;
    }

    draw() {
        ctx.save();
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.size, this.size);
        ctx.restore();
    }

    isDead() {
        return this.life <= 0;
    }
}

// Bird Object with improved physics
const bird = {
    x: CONFIG.bird.x,
    y: canvas.height / 2,
    width: CONFIG.bird.width,
    height: CONFIG.bird.height,
    velocity: 0,
    gravity: CONFIG.bird.gravity,
    jumpStrength: CONFIG.bird.jumpStrength,
    rotation: 0,
    wingFrame: 0,
    maxVelocity: CONFIG.bird.maxVelocity,
    terminalVelocity: CONFIG.bird.terminalVelocity,

    jump() {
        this.velocity = this.jumpStrength;
        // Create wing flap particles
        for (let i = 0; i < 5; i++) {
            particles.push(new Particle(this.x, this.y + this.height / 2, '#FFFFFF'));
        }
    },

    update(dt) {
        // Apply gravity with terminal velocity (frame rate independent)
        const normalizedDt = dt / (1000 / CONFIG.physics.targetFPS);
        this.velocity += this.gravity * normalizedDt;
        this.velocity = Math.min(this.velocity, this.terminalVelocity);

        this.y += this.velocity * normalizedDt;

        // Smooth rotation based on velocity with easing
        const targetRotation = Math.min(Math.max(this.velocity * 4, -30), 90);
        this.rotation += (targetRotation - this.rotation) * CONFIG.physics.rotationEasing;

        // Wing animation (frame rate independent)
        this.wingFrame = (this.wingFrame + 0.2 * normalizedDt) % 3;

        // Ground and ceiling collision with bounce effect
        if (this.y + this.height > canvas.height - CONFIG.ground.height) {
            this.y = canvas.height - CONFIG.ground.height - this.height;
            this.velocity = 0;
            if (gameState === GameState.PLAYING) {
                // Create impact particles
                for (let i = 0; i < 10; i++) {
                    particles.push(new Particle(this.x + this.width / 2, this.y + this.height, '#DEB887'));
                }
                gameOver();
            }
        }

        if (this.y < 0) {
            this.y = 0;
            this.velocity = 0;
        }
    },

    draw() {
        ctx.save();
        ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
        ctx.rotate(this.rotation * Math.PI / 180);

        // Add shadow for depth
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;

        // Draw pixel bird
        drawPixelBird(ctx, -this.width / 2, -this.height / 2, Math.floor(this.wingFrame));

        ctx.restore();

        // Debug: Draw hitbox
        if (CONFIG.debug.showHitboxes) {
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.lineWidth = 2;
            ctx.strokeRect(
                this.x + CONFIG.bird.hitboxPadding,
                this.y + CONFIG.bird.hitboxPadding,
                this.width - CONFIG.bird.hitboxPadding * 2,
                this.height - CONFIG.bird.hitboxPadding * 2
            );
        }
    },

    reset() {
        this.y = canvas.height / 2;
        this.velocity = 0;
        this.rotation = 0;
        this.wingFrame = 0;
    }
};

// Pipe Object with enhanced visuals
class Pipe {
    constructor() {
        this.x = canvas.width;
        this.width = CONFIG.pipe.width;
        this.gap = currentPipeGap;
        this.minHeight = CONFIG.pipe.minHeight;
        this.maxHeight = canvas.height - this.gap - CONFIG.ground.height - 50;
        this.topHeight = Math.random() * (this.maxHeight - this.minHeight) + this.minHeight;
        this.scored = false;
        this.speed = CONFIG.pipe.baseSpeed * difficultyMultiplier;
        this.highlightOffset = 0;
    }

    update(dt) {
        const normalizedDt = dt / (1000 / CONFIG.physics.targetFPS);
        this.x -= this.speed * normalizedDt;
        this.highlightOffset = (this.highlightOffset + 0.5 * normalizedDt) % 20;

        // Check if bird passed pipe
        if (!this.scored && this.x + this.width < bird.x) {
            this.scored = true;
            score++;
            updateScore();
            updateDifficulty();
            // Score particles with visual feedback
            for (let i = 0; i < 15; i++) {
                particles.push(new Particle(bird.x + bird.width, bird.y + bird.height / 2, '#FFD700'));
            }
        }
    }

    draw() {
        // Top pipe
        drawPipe(ctx, this.x, 0, this.width, this.topHeight, this.highlightOffset);

        // Bottom pipe
        const bottomY = this.topHeight + this.gap;
        drawPipe(ctx, this.x, bottomY, this.width, canvas.height - bottomY - CONFIG.ground.height, this.highlightOffset);

        // Debug: Draw hitbox
        if (CONFIG.debug.showHitboxes) {
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
            ctx.lineWidth = 2;
            ctx.strokeRect(this.x, 0, this.width, this.topHeight);
            ctx.strokeRect(this.x, bottomY, this.width, canvas.height - bottomY - CONFIG.ground.height);
        }
    }

    collidesWith(bird) {
        // Apply hitbox padding for more forgiving collision
        const padding = CONFIG.bird.hitboxPadding;
        const birdLeft = bird.x + padding;
        const birdRight = bird.x + bird.width - padding;
        const birdTop = bird.y + padding;
        const birdBottom = bird.y + bird.height - padding;

        if (birdRight > this.x && birdLeft < this.x + this.width) {
            if (birdTop < this.topHeight || birdBottom > this.topHeight + this.gap) {
                // Create collision particles
                for (let i = 0; i < 15; i++) {
                    particles.push(new Particle(bird.x + bird.width / 2, bird.y + bird.height / 2, '#FF0000'));
                }
                return true;
            }
        }
        return false;
    }
}

// Pipes Array
let pipes = [];

// Cloud Object for parallax background
class Cloud {
    constructor(layer = 1) {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * (canvas.height - 200);
        this.layer = layer;
        this.speed = (0.2 + Math.random() * 0.4) * layer;
        this.size = (15 + Math.random() * 25) / layer;
        this.opacity = 0.3 + (0.3 * layer);
    }

    update(dt) {
        const normalizedDt = dt / (1000 / CONFIG.physics.targetFPS);
        this.x -= this.speed * normalizedDt;
        if (this.x + this.size * 2 < 0) {
            this.x = canvas.width + this.size;
            this.y = Math.random() * (canvas.height - 200);
        }
    }

    draw() {
        ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.arc(this.x + this.size * 0.7, this.y - this.size * 0.3, this.size * 0.8, 0, Math.PI * 2);
        ctx.arc(this.x + this.size * 1.3, this.y, this.size * 0.9, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Mountain background for parallax
class Mountain {
    constructor(layer) {
        this.layer = layer;
        this.speed = 0.3 * layer;
        this.offset = 0;
        this.color = layer === 1 ? 'rgba(76, 150, 76, 0.3)' : 'rgba(102, 178, 102, 0.5)';
    }

    update(dt) {
        const normalizedDt = dt / (1000 / CONFIG.physics.targetFPS);
        this.offset = (this.offset + this.speed * normalizedDt) % canvas.width;
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        for (let x = -this.offset; x < canvas.width + 100; x += 80) {
            const height = 100 + Math.sin(x * 0.01) * 30;
            ctx.lineTo(x, canvas.height - CONFIG.ground.height - height / this.layer);
        }
        ctx.lineTo(canvas.width, canvas.height - CONFIG.ground.height);
        ctx.lineTo(-this.offset, canvas.height - CONFIG.ground.height);
        ctx.closePath();
        ctx.fill();
    }
}

// Create parallax clouds (multiple layers)
const clouds = [];
for (let layer = 1; layer <= 2; layer++) {
    for (let i = 0; i < 4; i++) {
        clouds.push(new Cloud(layer));
    }
}

// Create mountains for depth
const mountains = [new Mountain(1), new Mountain(2)];

// Drawing Functions
function drawPixelBird(ctx, x, y, wingFrame) {
    const scale = 2;
    // Wing animation frames
    const wingOffset = wingFrame < 1.5 ? 0 : 1;

    const pixels = [
        [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
        [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
        [0, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
        [1, 1, 1, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
        [1, 1, 1, 4, 4, 2, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
        [1, 1, 1, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
        [1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
        [1, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
        [0, 1, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
        [0, 0, 1, 3, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
    ];

    const colors = {
        0: 'transparent',
        1: '#FFD700', // Yellow body
        2: '#000000', // Black eye
        3: '#FF6B35', // Orange beak
        4: '#FFFFFF'  // White eye
    };

    pixels.forEach((row, i) => {
        row.forEach((pixel, j) => {
            if (pixel !== 0) {
                ctx.fillStyle = colors[pixel];
                // Wing animation - slight offset
                const yOffset = (i > 4 && i < 8 && j > 8) ? wingOffset : 0;
                ctx.fillRect(x + j * scale, y + i * scale + yOffset, scale, scale);

                // Add shading for depth
                if (pixel === 1 && j > 9) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
                    ctx.fillRect(x + j * scale, y + i * scale + yOffset, scale, scale);
                }
            }
        });
    });
}

function drawPipe(ctx, x, y, width, height, highlightOffset) {
    // Pipe shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(x + 3, y + 3, width, height);

    // Pipe body with gradient
    const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
    gradient.addColorStop(0, '#4A9D4A');
    gradient.addColorStop(0.5, '#5CB85C');
    gradient.addColorStop(1, '#4A9D4A');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);

    // Pipe border
    ctx.strokeStyle = '#2D5A2D';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, width, height);

    // Pipe texture/pattern
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    for (let i = 0; i < height; i += 15) {
        ctx.fillRect(x, y + i, width, 2);
    }

    // Pipe cap with 3D effect
    const capHeight = 30;
    if (y === 0) {
        // Top pipe cap
        const capGradient = ctx.createLinearGradient(x - 5, 0, x + width + 5, 0);
        capGradient.addColorStop(0, '#4A9D4A');
        capGradient.addColorStop(0.5, '#6BC86B');
        capGradient.addColorStop(1, '#4A9D4A');
        ctx.fillStyle = capGradient;
        ctx.fillRect(x - 5, y + height - capHeight, width + 10, capHeight);
        ctx.strokeStyle = '#2D5A2D';
        ctx.lineWidth = 3;
        ctx.strokeRect(x - 5, y + height - capHeight, width + 10, capHeight);

        // Cap highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(x - 3, y + height - capHeight + 2, width + 6, 5);
    } else {
        // Bottom pipe cap
        const capGradient = ctx.createLinearGradient(x - 5, 0, x + width + 5, 0);
        capGradient.addColorStop(0, '#4A9D4A');
        capGradient.addColorStop(0.5, '#6BC86B');
        capGradient.addColorStop(1, '#4A9D4A');
        ctx.fillStyle = capGradient;
        ctx.fillRect(x - 5, y, width + 10, capHeight);
        ctx.strokeStyle = '#2D5A2D';
        ctx.lineWidth = 3;
        ctx.strokeRect(x - 5, y, width + 10, capHeight);

        // Cap highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(x - 3, y + 2, width + 6, 5);
    }

    // Animated highlights
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(x + 5, y, 8, height);

    // Secondary highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x + width - 10, y, 5, height);
}

function drawGround() {
    // Ground shadow
    const groundY = canvas.height - CONFIG.ground.height;
    const shadowGradient = ctx.createLinearGradient(0, groundY - 5, 0, groundY);
    shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
    ctx.fillStyle = shadowGradient;
    ctx.fillRect(0, groundY - 5, canvas.width, 5);

    // Ground base with gradient
    const groundGradient = ctx.createLinearGradient(0, groundY, 0, canvas.height);
    groundGradient.addColorStop(0, '#CD853F');
    groundGradient.addColorStop(0.3, '#DEB887');
    groundGradient.addColorStop(1, '#8B7355');
    ctx.fillStyle = groundGradient;
    ctx.fillRect(0, groundY, canvas.width, CONFIG.ground.height);

    // Animated grass with parallax
    ctx.fillStyle = '#8BC34A';
    ctx.fillRect(0, groundY, canvas.width, 20);

    // Grass blades
    ctx.fillStyle = '#6FA02F';
    for (let i = 0; i < canvas.width; i += 8) {
        const offset = gameState === GameState.PLAYING ? (groundOffset % 8) : 0;
        ctx.fillRect(i - offset, groundY, 2, 8);
        ctx.fillRect(i + 4 - offset, groundY + 4, 2, 6);
    }

    // Ground pattern with depth
    ctx.fillStyle = 'rgba(205, 133, 63, 0.6)';
    for (let i = 0; i < canvas.width; i += 40) {
        const offset = gameState === GameState.PLAYING ? (groundOffset % 40) : 0;
        ctx.fillRect(i - offset, groundY + 20, 20, 8);
        ctx.fillRect(i + 20 - offset, groundY + 40, 20, 8);
    }

    // Ground details
    ctx.fillStyle = 'rgba(139, 115, 85, 0.5)';
    for (let i = 0; i < canvas.width; i += 60) {
        const offset = gameState === GameState.PLAYING ? (groundOffset % 60) : 0;
        ctx.fillRect(i + 10 - offset, groundY + 30, 8, 4);
        ctx.fillRect(i + 35 - offset, groundY + 50, 6, 3);
    }
}

function drawBackground() {
    // Realistic sky gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height - CONFIG.ground.height);
    gradient.addColorStop(0, '#87CEEB');
    gradient.addColorStop(0.3, '#4EC0CA');
    gradient.addColorStop(0.7, '#7DD0D8');
    gradient.addColorStop(1, '#B8E6E8');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height - CONFIG.ground.height);

    // Sun
    const sunGradient = ctx.createRadialGradient(350, 80, 10, 350, 80, 40);
    sunGradient.addColorStop(0, 'rgba(255, 255, 200, 0.8)');
    sunGradient.addColorStop(0.5, 'rgba(255, 255, 150, 0.4)');
    sunGradient.addColorStop(1, 'rgba(255, 255, 150, 0)');
    ctx.fillStyle = sunGradient;
    ctx.fillRect(310, 40, 80, 80);

    ctx.fillStyle = '#FFF4B3';
    ctx.beginPath();
    ctx.arc(350, 80, 25, 0, Math.PI * 2);
    ctx.fill();

    // Draw mountains for parallax
    mountains.forEach(mountain => mountain.draw());

    // Draw clouds with parallax
    clouds.forEach(cloud => cloud.draw());
}

// Game Functions
function startGame() {
    gameState = GameState.PLAYING;
    score = 0;
    pipes = [];
    particles = [];  // Clear particles
    frame = 0;
    difficultyMultiplier = 1;
    currentPipeGap = CONFIG.pipe.gap;
    bird.reset();
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    document.getElementById('pauseScreen').classList.add('hidden');
    document.getElementById('score').classList.remove('hidden');
    updateScore();
}

function pauseGame() {
    if (gameState === GameState.PLAYING) {
        gameState = GameState.PAUSED;
        document.getElementById('pauseScreen').classList.remove('hidden');
    } else if (gameState === GameState.PAUSED) {
        gameState = GameState.PLAYING;
        document.getElementById('pauseScreen').classList.add('hidden');
        lastFrameTime = performance.now();  // Reset frame time to avoid time jump
    }
}

function updateDifficulty() {
    if (!CONFIG.difficulty.enabled) return;

    // Gradually increase speed
    difficultyMultiplier = Math.min(
        1 + (score * CONFIG.difficulty.speedIncreasePerScore),
        CONFIG.difficulty.maxSpeedMultiplier
    );

    // Gradually decrease gap (make it harder)
    currentPipeGap = Math.max(
        CONFIG.pipe.gap - (score * CONFIG.difficulty.gapDecreasePerScore),
        CONFIG.difficulty.minGap
    );
}

function gameOver() {
    gameState = GameState.GAME_OVER;

    if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('bestScore', bestScore);
    }

    document.getElementById('finalScore').textContent = score;
    document.getElementById('bestScore').textContent = bestScore;
    document.getElementById('gameOverScreen').classList.remove('hidden');
    document.getElementById('score').classList.add('hidden');
}

function updateScore() {
    const scoreElement = document.getElementById('score');
    scoreElement.textContent = score;

    // Visual feedback: brief scale animation
    scoreElement.style.transform = 'translateX(-50%) scale(1.3)';
    setTimeout(() => {
        scoreElement.style.transform = 'translateX(-50%) scale(1)';
    }, 150);
}

// Game Loop with frame rate independence
function gameLoop(currentTime) {
    // Calculate delta time for frame rate independence
    deltaTime = currentTime - lastFrameTime;
    lastFrameTime = currentTime;

    // Cap delta time to avoid large jumps (e.g., when tab is inactive)
    deltaTime = Math.min(deltaTime, 100);

    // Clear canvas
    drawBackground();

    // Update clouds and mountains (always animate)
    clouds.forEach(cloud => cloud.update(deltaTime));
    mountains.forEach(mountain => mountain.update(deltaTime));

    if (gameState === GameState.PLAYING) {
        frame++;
        const normalizedDt = deltaTime / (1000 / CONFIG.physics.targetFPS);
        groundOffset += CONFIG.ground.scrollSpeed * normalizedDt;

        // Spawn pipes
        if (frame % CONFIG.pipe.spawnInterval === 0) {
            pipes.push(new Pipe());
        }

        // Update bird
        bird.update(deltaTime);

        // Update and draw pipes
        for (let i = pipes.length - 1; i >= 0; i--) {
            const pipe = pipes[i];
            pipe.update(deltaTime);
            pipe.draw();

            // Check collision
            if (pipe.collidesWith(bird)) {
                gameOver();
            }

            // Remove off-screen pipes
            if (pipe.x + pipe.width < 0) {
                pipes.splice(i, 1);
            }
        }

        // Update and draw particles (limit particle count for performance)
        if (particles.length > 200) {
            particles = particles.slice(-100);  // Keep only recent particles
        }
        particles = particles.filter(particle => {
            particle.update(deltaTime);
            particle.draw();
            return !particle.isDead();
        });
    } else if (gameState === GameState.PAUSED) {
        // Draw pipes when paused
        pipes.forEach(pipe => pipe.draw());
    }

    // Draw bird
    bird.draw();

    // Draw ground
    drawGround();

    requestAnimationFrame(gameLoop);
}

// Event Listeners
let lastJumpTime = 0;
const jumpCooldown = 100;  // ms to prevent spam clicking

function handleJump() {
    const now = performance.now();
    if (now - lastJumpTime < jumpCooldown) return;
    lastJumpTime = now;

    if (gameState === GameState.START) {
        startGame();
        bird.jump();
    } else if (gameState === GameState.PLAYING) {
        bird.jump();
    } else if (gameState === GameState.GAME_OVER) {
        startGame();
    }
}

// Mouse/Touch controls
canvas.addEventListener('click', handleJump);

// Touch controls for mobile
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    handleJump();
}, { passive: false });

// Keyboard controls
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        handleJump();
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        if (gameState === GameState.PLAYING || gameState === GameState.PAUSED) {
            pauseGame();
        }
    } else if (e.code === 'KeyD' && (e.metaKey || e.ctrlKey)) {
        // Debug mode toggle (Cmd/Ctrl + D)
        e.preventDefault();
        CONFIG.debug.showHitboxes = !CONFIG.debug.showHitboxes;
    }
});

// Update best score display on load
document.getElementById('bestScore').textContent = bestScore;

// Start game loop
gameLoop();
