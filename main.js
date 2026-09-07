import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

const MEDIAPIPE_TASKS_VISION_WASM_VER = '0.10.34';

const STORAGE_SFX_VOL = 'hatter-sfx-vol';
const STORAGE_MUSIC_VOL = 'hatter-music-vol';
const STORAGE_LANG = 'hatter-lang';
const STORAGE_PLAYER_COUNT = 'hatter-player-count';
const STORAGE_LEADERBOARD = 'hatter-leaderboard-top10';

const FINAL_LEVEL = 5;
const LEADERBOARD_MAX = 10;
const CATCH_TUTORIAL_MS = 5000;
/** Промахов (шляпа упала на пол) до конца игры. */
const START_LIVES = 3;

const DEBUG_FRAME_PERF =
    typeof location !== 'undefined' && new URLSearchParams(location.search).get('perf') === '1';

/** Android: GPU-делегат MediaPipe часто даёт нестабильные landmarks. */
function isAndroidBrowser() {
    return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

const trackTuning = {
    /** На Android сначала CPU; на ПК/iPad — GPU (быстрее и стабилен). */
    preferCpuPose: isAndroidBrowser(),
    minPoseConfidence: isAndroidBrowser() ? 0.3 : 0.5
};

/** 0…1 — громкость эффектов и музыки (ползунки) */
let sfxVolume01 = 1;
let musicVolume01 = 1;
/** 'ru' | 'en' */
let uiLang = 'ru';

function loadPlayerCountPreference() {
    const raw = localStorage.getItem(STORAGE_PLAYER_COUNT);
    return raw === '2' ? 2 : 1;
}

/** 1 или 2 — совпадает с numPoses у PoseLandmarker */
let playerModeCount = loadPlayerCountPreference();

const I18N_STRINGS = {
    ru: {
        playerLabel: 'Игроков на камере',
        cornerLangTitle: 'Язык',
        cornerPlayersTitle: 'Игроки',
        btnStart: 'Играть',
        optionsTitle: 'Звук и музыка',
        volSfx: 'Громкость эффектов',
        volMusic: 'Громкость музыки',
        btnBackMenu: 'Меню',
        fullscreen: 'На весь экран',
        fullscreenExit: 'Свернуть',
        galleryLink: 'Все игры',
        gameOver: 'ИГРА ОКОНЧЕНА',
        victory: 'Уровень пройден!',
        youWon: 'Ты победил!',
        leaderboardTitle: 'Топ-10 на этом устройстве',
        campaignScore: 'Итоговый счёт',
        leaderboardRank: 'Место в рейтинге',
        leaderboardNewRecord: 'Новый рекорд!',
        leaderboardNoTop: 'Не попал в топ-10',
        leaderboardEmpty: 'Пока нет результатов',
        tutCatch: 'Подставь голову — шляпа наденется',
        tutMiss: 'Упавшая шляпа — минус жизнь',
        levelLabel: 'Уровень',
        livesLabel: 'Жизни',
        quotaLabel: 'Поймать',
        loadingModels: 'Загрузка моделей…',
        players1ok: 'Режим: 1 игрок',
        players1wait: 'Режим: 1 игрок · встаньте в кадр',
        players2ok: 'Режим: 2 игрока · общий счёт',
        players2wait1: 'Режим: 2 игрока · позовите второго',
        players2wait0: 'Режим: 2 игрока · встаньте в кадр',
        errTitle: 'Не удалось запустить игру.',
        errHintDefault:
            'Откройте консоль браузера (F12 → Console) и при необходимости пришлите текст ошибки.',
        errHintPermission:
            'Браузер заблокировал камеру для этого сайта. Нажмите на значок замка слева от адреса → разрешите камеру, обновите страницу.',
        errHintNotFound: 'Камера не найдена. Проверьте, что она подключена и не занята другим приложением.',
        errHintAbort:
            'Камера не успела запуститься. Отключите режим эмуляции устройства в DevTools, закройте другие программы, использующие камеру, и обновите страницу.'
    },
    en: {
        playerLabel: 'Players in frame',
        cornerLangTitle: 'Language',
        cornerPlayersTitle: 'Players',
        btnStart: 'Play',
        optionsTitle: 'Sound & music',
        volSfx: 'Sound effects volume',
        volMusic: 'Music volume',
        btnBackMenu: 'Menu',
        fullscreen: 'Fullscreen',
        fullscreenExit: 'Exit fullscreen',
        galleryLink: 'All games',
        gameOver: 'GAME OVER',
        victory: 'Level complete!',
        youWon: 'You won!',
        leaderboardTitle: 'Top 10 on this device',
        campaignScore: 'Final score',
        leaderboardRank: 'Leaderboard rank',
        leaderboardNewRecord: 'New record!',
        leaderboardNoTop: 'Not in top 10',
        leaderboardEmpty: 'No scores yet',
        tutCatch: 'Move your head under the hat to wear it',
        tutMiss: 'A hat that hits the floor costs a life',
        levelLabel: 'Level',
        livesLabel: 'Lives',
        quotaLabel: 'Catch',
        loadingModels: 'Loading models…',
        players1ok: 'Mode: 1 player',
        players1wait: 'Mode: 1 player · step into frame',
        players2ok: 'Mode: 2 players · shared score',
        players2wait1: 'Mode: 2 players · bring in second player',
        players2wait0: 'Mode: 2 players · step into frame',
        errTitle: 'Could not start the game.',
        errHintDefault:
            'Open the browser console (F12 → Console) and share the error text if you need help.',
        errHintPermission:
            'The browser blocked camera access for this site. Use the lock icon in the address bar → allow camera, then reload.',
        errHintNotFound: 'No camera found. Check it is plugged in and not in use by another app.',
        errHintAbort:
            'The camera did not start in time. Turn off device emulation in DevTools, close other apps using the camera, and reload.'
    }
};

function t(key) {
    const pack = I18N_STRINGS[uiLang] || I18N_STRINGS.ru;
    const v = pack[key];
    return v != null ? v : I18N_STRINGS.en[key] ?? key;
}

function formatScore(n) {
    return uiLang === 'ru' ? `Счёт: ${n}` : `Score: ${n}`;
}

function formatLevel(n = currentLevel) {
    return `${t('levelLabel')}: ${n}`;
}

function updateLevelDisplay() {
    if (levelDisplay) levelDisplay.textContent = formatLevel();
}

function updateLivesDisplay() {
    if (!livesDisplay) return;
    const hearts = '♥'.repeat(Math.max(0, lives)) + '·'.repeat(Math.max(0, START_LIVES - lives));
    livesDisplay.textContent = `${t('livesLabel')}: ${hearts}`;
}

function updateQuotaDisplay() {
    if (!quotaDisplay) return;
    if (!isPlaying) {
        quotaDisplay.textContent = '';
        return;
    }
    quotaDisplay.textContent = `${t('quotaLabel')}: ${caughtThisLevel} / ${levelQuota}`;
}

function loadLangPreference() {
    const raw = localStorage.getItem(STORAGE_LANG);
    if (raw === 'en' || raw === 'ru') return raw;
    if (typeof navigator !== 'undefined' && navigator.language && /^en/i.test(navigator.language)) return 'en';
    return 'ru';
}

function applyI18n() {
    document.documentElement.lang = uiLang === 'en' ? 'en' : 'ru';
    for (const el of document.querySelectorAll('[data-i18n]')) {
        const key = el.getAttribute('data-i18n');
        if (key) el.textContent = t(key);
    }
    syncFullscreenButton();
    const loadEl = document.getElementById('loading');
    const ld = document.getElementById('loading-text');
    if (ld && loadEl?.classList.contains('visible')) {
        ld.textContent = t('loadingModels');
    }
    if (scoreDisplay && isPlaying) scoreDisplay.innerText = formatScore(score);
    if (isPlaying) {
        updateLevelDisplay();
        updateLivesDisplay();
        updateQuotaDisplay();
    }
    document.getElementById('players-count-group')?.setAttribute('aria-label', t('playerLabel'));
}

function loadPersistedSettings() {
    let sVol = parseFloat(localStorage.getItem(STORAGE_SFX_VOL));
    if (!Number.isFinite(sVol)) sVol = 1;
    sfxVolume01 = Math.max(0, Math.min(1, sVol));

    let mVol = parseFloat(localStorage.getItem(STORAGE_MUSIC_VOL));
    if (!Number.isFinite(mVol)) mVol = 1;
    musicVolume01 = Math.max(0, Math.min(1, mVol));

    uiLang = loadLangPreference();

    const volSfxEl = document.getElementById('vol-sfx');
    const volMusicEl = document.getElementById('vol-music');
    const volSfxVal = document.getElementById('vol-sfx-val');
    const volMusicVal = document.getElementById('vol-music-val');
    if (volSfxEl) volSfxEl.value = String(Math.round(sfxVolume01 * 100));
    if (volMusicEl) volMusicEl.value = String(Math.round(musicVolume01 * 100));
    if (volSfxVal) volSfxVal.textContent = `${Math.round(sfxVolume01 * 100)}%`;
    if (volMusicVal) volMusicVal.textContent = `${Math.round(musicVolume01 * 100)}%`;

    const optRu = document.getElementById('opt-lang-ru');
    const optEn = document.getElementById('opt-lang-en');
    if (optRu && optEn) {
        optRu.checked = uiLang === 'ru';
        optEn.checked = uiLang === 'en';
    }
    applyI18n();
    applyMusicOutputVolumes();
}

/* ---------------------------------------------------------------------------
 * Звук: синтезируем эффекты в Web Audio — внешних mp3 в репозитории нет,
 * поэтому «поймал / промазал / уровень» звучат из осцилляторов.
 * ------------------------------------------------------------------------- */

function getOrCreateSfxContext() {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!window.__hatterAudioCtx) {
            const ctx = new AC();
            window.__hatterAudioCtx = ctx;
            try {
                ctx.onstatechange = () => {
                    if (ctx.state === 'running') webAudioUnlocked = true;
                };
            } catch (_) {}
        }
        return window.__hatterAudioCtx;
    } catch (_) {
        return null;
    }
}

/**
 * Короткий тон с экспоненциальным затуханием.
 * @param {number[]} freqs частоты в порядке проигрывания (арпеджио)
 */
function playToneSequence(freqs, { type = 'triangle', step = 0.075, dur = 0.16, gain = 0.22 } = {}) {
    if (sfxVolume01 <= 0) return;
    const ctx = getOrCreateSfxContext();
    if (!ctx || ctx.state !== 'running') {
        if (ctx && ctx.state === 'suspended') {
            try {
                void ctx.resume();
            } catch (_) {}
        }
        return;
    }
    const now = ctx.currentTime;
    freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const at = now + i * step;
        osc.type = type;
        osc.frequency.setValueAtTime(f, at);
        const peak = Math.max(0.0001, gain * sfxVolume01);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + dur + 0.02);
    });
}

/** Шумовой «пуф» — падение шляпы на пол. */
function playNoiseBurst({ dur = 0.28, gain = 0.16, lowpass = 900 } = {}) {
    if (sfxVolume01 <= 0) return;
    const ctx = getOrCreateSfxContext();
    if (!ctx || ctx.state !== 'running') return;
    const frames = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) {
        const fade = 1 - i / frames;
        data[i] = (Math.random() * 2 - 1) * fade * fade;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.value = gain * sfxVolume01;
    src.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);
    src.start();
}

function playCatchSound(comboLevel = 0) {
    const base = 523.25 * Math.pow(2, Math.min(comboLevel, 6) / 12);
    playToneSequence([base, base * 1.26, base * 1.5], { type: 'triangle', step: 0.055, dur: 0.15, gain: 0.2 });
}

function playMissSound() {
    playNoiseBurst({ dur: 0.3, gain: 0.2, lowpass: 700 });
    playToneSequence([196, 155], { type: 'sawtooth', step: 0.09, dur: 0.22, gain: 0.12 });
}

function playBonusSound() {
    playToneSequence([659.25, 880, 1046.5, 1318.5], { type: 'square', step: 0.06, dur: 0.13, gain: 0.13 });
}

function playBombSound() {
    playNoiseBurst({ dur: 0.42, gain: 0.26, lowpass: 420 });
    playToneSequence([110, 82], { type: 'sawtooth', step: 0.11, dur: 0.3, gain: 0.16 });
}

function playLevelUpSound() {
    playToneSequence([523.25, 659.25, 783.99, 1046.5], { type: 'triangle', step: 0.11, dur: 0.28, gain: 0.2 });
}

function playGameOverSound() {
    playToneSequence([392, 330, 262, 196], { type: 'sawtooth', step: 0.17, dur: 0.4, gain: 0.17 });
}

/* --- Фоновая музыка: лёгкий генеративный арпеджиатор на Web Audio --- */

let musicTimerId = null;
let musicStepIndex = 0;
let musicMasterGain = null;
const MUSIC_SCALE = [0, 3, 5, 7, 10];
const MUSIC_ROOTS = [220, 196, 174.61, 261.63];

function applyMusicOutputVolumes() {
    if (musicMasterGain) {
        musicMasterGain.gain.value = 0.06 * Math.max(0, Math.min(1, musicVolume01));
    }
}

function stopMusic() {
    if (musicTimerId != null) {
        clearInterval(musicTimerId);
        musicTimerId = null;
    }
    if (musicMasterGain) {
        try {
            musicMasterGain.disconnect();
        } catch (_) {}
        musicMasterGain = null;
    }
}

function startMusic(tempoMs = 260) {
    stopMusic();
    if (musicVolume01 <= 0) return;
    const ctx = getOrCreateSfxContext();
    if (!ctx || ctx.state !== 'running') return;
    musicMasterGain = ctx.createGain();
    musicMasterGain.gain.value = 0.06 * musicVolume01;
    musicMasterGain.connect(ctx.destination);
    musicStepIndex = 0;
    musicTimerId = setInterval(() => {
        if (!musicMasterGain || ctx.state !== 'running') return;
        const bar = Math.floor(musicStepIndex / 8) % MUSIC_ROOTS.length;
        const root = MUSIC_ROOTS[bar];
        const degree = MUSIC_SCALE[musicStepIndex % MUSIC_SCALE.length];
        const octave = musicStepIndex % 8 < 4 ? 1 : 2;
        const freq = root * Math.pow(2, degree / 12) * octave;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.9, now + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
        osc.connect(g);
        g.connect(musicMasterGain);
        osc.start(now);
        osc.stop(now + 0.46);
        musicStepIndex += 1;
    }, tempoMs);
}

function getMediapipeWasmUrl() {
    let base = import.meta.env.BASE_URL || '/';
    if (!base.endsWith('/')) base += '/';
    return new URL('mediapipe-wasm', window.location.origin + base).href;
}

let webAudioUnlocked = false;

/**
 * iOS/iPadOS Safari запускает AudioContext в состоянии suspended, если он создан вне
 * пользовательского жеста. Канонический разблок — проиграть пустой буфер внутри жеста.
 * Должна вызываться синхронно из обработчика клика/тача.
 */
function unlockWebAudioInGesture() {
    const ctx = getOrCreateSfxContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
        try {
            const p = ctx.resume();
            if (p && typeof p.then === 'function') p.catch(() => {});
        } catch (_) {}
    }
    try {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(0);
    } catch (_) {}
    if (ctx.state === 'running') webAudioUnlocked = true;
}

function tryUnlockAudioOnUserGesture() {
    if (!webAudioUnlocked) unlockWebAudioInGesture();
}

const video = document.getElementById('webcam');
const canvasElement = document.getElementById('game-canvas');
const canvasCtx = canvasElement.getContext('2d');
const scoreDisplay = document.getElementById('score-display');
const gameOverOverlay = document.getElementById('game-over-overlay');
const victoryOverlay = document.getElementById('victory-overlay');
const catchTutorialOverlay = document.getElementById('catch-tutorial-overlay');
const catchTutorialCountdown = document.getElementById('catch-tutorial-countdown');
const campaignCompleteOverlay = document.getElementById('campaign-complete-overlay');
const campaignScoreLine = document.getElementById('campaign-score-line');
const campaignRankLine = document.getElementById('campaign-rank-line');
const leaderboardList = document.getElementById('leaderboard-list');
const btnCampaignMenu = document.getElementById('btn-campaign-menu');
const levelDisplay = document.getElementById('level-display');
const livesDisplay = document.getElementById('lives-display');
const quotaDisplay = document.getElementById('quota-display');
const loadingElement = document.getElementById('loading');
const mainMenu = document.getElementById('main-menu');
const hudGame = document.getElementById('hud-game');
const btnBackMenu = document.getElementById('btn-back-menu');
const btnStart = document.getElementById('btn-start');
const playersDisplay = document.getElementById('players-display');

let poseLandmarker;
let visionTasksResolver = null;
let mediapipePoseDelegate = 'CPU';
let lastVideoTime = -1;
let poseDetectTsMs = 0;

const cachedSmoothedLmByPoseKey = new Map();
const posePrevTargetLmByPoseKey = new Map();
const poseTargetLmByPoseKey = new Map();
const poseDisplayLmByPoseKey = new Map();
let poseFrameStartMs = 0;
let poseFrameIntervalMs = 33.33;
let prevVideoTimeForInterval = -1;

let score = 0;
let currentLevel = 1;
let lives = START_LIVES;
let caughtThisLevel = 0;
let levelQuota = 6;
let comboStreak = 0;
let isPlaying = false;
let victoryTransitionActive = false;
let victoryTimeoutId = null;
let catchTutorialActive = false;
let catchTutorialTimeoutId = null;
let catchTutorialCountdownId = null;
const VICTORY_DISPLAY_MS = 2200;

/** Планирующие шляпы в воздухе. */
let fallingHats = [];
/** Частицы: конфетти, вспышки. */
let particles = [];
/** Всплывающий текст «+50». */
let floaters = [];
let spawnTimerMs = 0;
let spawnedThisLevel = 0;

/* ---------------------------------------------------------------------------
 * Уровни и типы шляп
 * ------------------------------------------------------------------------- */

/**
 * Спека уровня: сколько шляп надо поймать, как часто они появляются,
 * как быстро планируют и какая доля «плохих» (бомб-цилиндров).
 */
const LEVEL_SPECS = [
    { quota: 6, spawnMs: 2100, fallMul: 0.85, swayMul: 0.8, bombChance: 0.0, goldenChance: 0.06, maxAir: 2 },
    { quota: 9, spawnMs: 1850, fallMul: 1.0, swayMul: 1.0, bombChance: 0.1, goldenChance: 0.08, maxAir: 3 },
    { quota: 12, spawnMs: 1600, fallMul: 1.15, swayMul: 1.15, bombChance: 0.16, goldenChance: 0.1, maxAir: 3 },
    { quota: 15, spawnMs: 1400, fallMul: 1.32, swayMul: 1.3, bombChance: 0.2, goldenChance: 0.11, maxAir: 4 },
    { quota: 18, spawnMs: 1200, fallMul: 1.5, swayMul: 1.45, bombChance: 0.24, goldenChance: 0.12, maxAir: 4 }
];

function getLevelSpec(level = currentLevel) {
    const idx = Math.max(0, Math.min(LEVEL_SPECS.length - 1, level - 1));
    return LEVEL_SPECS[idx];
}

/**
 * Виды шляп. `score` — очки за поимку, `wearable` — надевается ли на голову.
 * Бомба-цилиндр не надевается: попадание по голове снимает жизнь.
 */
const HAT_TYPES = {
    top: {
        id: 'top',
        score: 50,
        wearable: true,
        crown: '#7b4dff',
        crownLight: '#c9a6ff',
        band: '#ffcf4d',
        brimMul: 1.0
    },
    cowboy: {
        id: 'cowboy',
        score: 60,
        wearable: true,
        crown: '#c07b3a',
        crownLight: '#e8b271',
        band: '#5b3a1c',
        brimMul: 1.28
    },
    party: {
        id: 'party',
        score: 45,
        wearable: true,
        crown: '#ff6fae',
        crownLight: '#ffb3d4',
        band: '#4fe3a1',
        brimMul: 0.72
    },
    beret: {
        id: 'beret',
        score: 55,
        wearable: true,
        crown: '#4fa8ff',
        crownLight: '#a6d4ff',
        band: '#1b2a52',
        brimMul: 0.9
    },
    golden: {
        id: 'golden',
        score: 150,
        wearable: true,
        golden: true,
        crown: '#ffcf4d',
        crownLight: '#fff2c2',
        band: '#a3701a',
        brimMul: 1.08
    },
    bomb: {
        id: 'bomb',
        score: 0,
        wearable: false,
        bomb: true,
        crown: '#2b2b34',
        crownLight: '#55555f',
        band: '#ff4f4f',
        brimMul: 1.05
    }
};

const WEARABLE_ORDER = ['top', 'cowboy', 'party', 'beret'];

function pickHatTypeForLevel(spec) {
    const r = Math.random();
    if (r < spec.bombChance) return HAT_TYPES.bomb;
    if (r < spec.bombChance + spec.goldenChance) return HAT_TYPES.golden;
    const id = WEARABLE_ORDER[Math.floor(Math.random() * WEARABLE_ORDER.length)];
    return HAT_TYPES[id];
}

/* ---------------------------------------------------------------------------
 * Рисование шляпы. Одна функция и для летящих, и для надетых:
 * рисует в локальных координатах с центром на «линии посадки» (нижняя кромка тульи),
 * ширина полей = brimW. Вызывающий сам делает translate/rotate/scale.
 * ------------------------------------------------------------------------- */

function drawHatShape(ctx, type, brimW, opts = {}) {
    const alpha = opts.alpha ?? 1;
    const wobble = opts.wobble ?? 0;
    const bw = brimW;
    const brimH = bw * 0.17;
    const crownW = bw * 0.52;
    const crownH = bw * 0.5;

    ctx.save();
    ctx.globalAlpha *= alpha;

    if (type.golden) {
        ctx.shadowColor = 'rgba(255, 207, 77, 0.85)';
        ctx.shadowBlur = bw * 0.28;
    } else if (type.bomb) {
        ctx.shadowColor = 'rgba(255, 79, 79, 0.75)';
        ctx.shadowBlur = bw * 0.22;
    }

    // Поля
    ctx.beginPath();
    ctx.ellipse(0, 0, bw * 0.5, brimH, 0, 0, Math.PI * 2);
    const brimGrad = ctx.createLinearGradient(0, -brimH, 0, brimH);
    brimGrad.addColorStop(0, type.crownLight);
    brimGrad.addColorStop(1, type.crown);
    ctx.fillStyle = brimGrad;
    ctx.fill();

    ctx.shadowBlur = 0;

    // Тулья
    if (type.id === 'party') {
        ctx.beginPath();
        ctx.moveTo(-crownW * 0.5, 0);
        ctx.lineTo(0, -crownH * 1.45);
        ctx.lineTo(crownW * 0.5, 0);
        ctx.closePath();
    } else if (type.id === 'beret') {
        ctx.beginPath();
        ctx.ellipse(0, -crownH * 0.36, crownW * 0.66, crownH * 0.5, wobble * 0.1, 0, Math.PI * 2);
    } else if (type.id === 'cowboy') {
        ctx.beginPath();
        ctx.moveTo(-crownW * 0.5, 0);
        ctx.quadraticCurveTo(-crownW * 0.46, -crownH * 0.92, 0, -crownH * 0.86);
        ctx.quadraticCurveTo(crownW * 0.46, -crownH * 0.92, crownW * 0.5, 0);
        ctx.closePath();
    } else {
        // top / golden / bomb — цилиндр
        const h = type.bomb ? crownH * 0.78 : crownH;
        ctx.beginPath();
        ctx.moveTo(-crownW * 0.5, 0);
        ctx.lineTo(-crownW * 0.46, -h);
        ctx.quadraticCurveTo(0, -h * 1.12, crownW * 0.46, -h);
        ctx.lineTo(crownW * 0.5, 0);
        ctx.closePath();
    }
    const crownGrad = ctx.createLinearGradient(-crownW * 0.5, 0, crownW * 0.5, 0);
    crownGrad.addColorStop(0, type.crown);
    crownGrad.addColorStop(0.45, type.crownLight);
    crownGrad.addColorStop(1, type.crown);
    ctx.fillStyle = crownGrad;
    ctx.fill();

    // Лента
    if (type.id !== 'party' && type.id !== 'beret') {
        ctx.fillStyle = type.band;
        ctx.fillRect(-crownW * 0.5, -crownH * 0.34, crownW, crownH * 0.2);
    } else if (type.id === 'party') {
        ctx.fillStyle = type.band;
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(-crownW * 0.16 + i * crownW * 0.16, -crownH * (0.35 + i * 0.28), bw * 0.028, 0, Math.PI * 2);
            ctx.fill();
        }
    } else {
        ctx.fillStyle = type.band;
        ctx.beginPath();
        ctx.arc(0, -crownH * 0.86, bw * 0.035, 0, Math.PI * 2);
        ctx.fill();
    }

    // Бомба: горящий фитиль и череп-предупреждение
    if (type.bomb) {
        ctx.strokeStyle = '#ff4f4f';
        ctx.lineWidth = Math.max(2, bw * 0.035);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-bw * 0.16, -crownH * 0.2);
        ctx.lineTo(bw * 0.16, -crownH * 0.62);
        ctx.moveTo(bw * 0.16, -crownH * 0.2);
        ctx.lineTo(-bw * 0.16, -crownH * 0.62);
        ctx.stroke();
    }

    // Золотая: блик-звёздочка
    if (type.golden) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        const sx = -crownW * 0.2;
        const sy = -crownH * 0.62;
        const r = bw * 0.045;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const rr = i % 2 === 0 ? r : r * 0.42;
            const px = sx + Math.cos(a) * rr;
            const py = sy + Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
    }

    ctx.restore();
}

/**
 * Планирующая сверху шляпа. Падает медленно, покачиваясь как лист,
 * чтобы игрок успел подставить голову.
 */
class FallingHat {
    constructor(type, spec) {
        const w = gameLayout.w;
        const h = gameLayout.h;
        this.type = type;
        this.brimW = Math.max(64, gameLayout.minSide * 0.19);
        // Стартуем в пределах центральных 76% ширины — по краям голову не подставить.
        this.baseX = w * (0.12 + Math.random() * 0.76);
        this.x = this.baseX;
        this.y = -this.brimW * 0.6;
        this.vy = h * 0.00019 * spec.fallMul * (0.85 + Math.random() * 0.3);
        this.swayAmp = w * 0.055 * spec.swayMul * (0.7 + Math.random() * 0.6);
        this.swayFreq = 0.0016 + Math.random() * 0.0012;
        this.swayPhase = Math.random() * Math.PI * 2;
        // Медленный дрейф по горизонтали — траектория не строго вертикальная.
        this.driftVx = w * 0.00002 * (Math.random() * 2 - 1) * spec.swayMul;
        this.ageMs = 0;
        this.rot = 0;
        this.caught = false;
        this.dead = false;
    }

    update(dtMs) {
        this.ageMs += dtMs;
        this.baseX += this.driftVx * dtMs;
        const sway = Math.sin(this.ageMs * this.swayFreq + this.swayPhase);
        this.x = this.baseX + sway * this.swayAmp;
        this.y += this.vy * dtMs;
        // Наклон следует за боковой скоростью планирования.
        this.rot = Math.cos(this.ageMs * this.swayFreq + this.swayPhase) * 0.34;
        const margin = this.brimW;
        if (this.x < margin * 0.4) this.baseX += margin * 0.02;
        if (this.x > gameLayout.w - margin * 0.4) this.baseX -= margin * 0.02;
        if (this.y > gameLayout.h + this.brimW) this.dead = true;
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rot);
        // Тень-контур, чтобы шляпа читалась на пёстром видео.
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = this.brimW * 0.14;
        ctx.shadowOffsetY = this.brimW * 0.05;
        drawHatShape(ctx, this.type, this.brimW);
        ctx.restore();
    }

    /** Круг ловли — вокруг «линии посадки» шляпы. */
    /**
     * Круг ловли вокруг линии посадки шляпы.
     * У ловушки он заметно уже: щедрая зона нужна, чтобы легче ловить хорошие шляпы,
     * но с ней же игрок притягивал бы бомбу, пройдя мимо на полкорпуса.
     */
    catchDisc() {
        const mul = this.type.bomb ? 0.2 : 0.42;
        return { x: this.x, y: this.y, r: this.brimW * mul };
    }
}

/* ---------------------------------------------------------------------------
 * Эффекты: конфетти и всплывающий счёт
 * ------------------------------------------------------------------------- */

class Particle {
    constructor(x, y, color, kind = 'dot') {
        this.x = x;
        this.y = y;
        const ang = Math.random() * Math.PI * 2;
        const sp = (kind === 'spark' ? 7 : 4) * (0.4 + Math.random());
        this.vx = Math.cos(ang) * sp;
        this.vy = Math.sin(ang) * sp - 2;
        this.gravity = kind === 'confetti' ? 0.16 : 0.09;
        this.life = 1;
        this.decay = 0.016 + Math.random() * 0.018;
        this.color = color;
        this.kind = kind;
        this.size = kind === 'confetti' ? 4 + Math.random() * 5 : 2 + Math.random() * 3;
        this.rot = Math.random() * Math.PI;
        this.vrot = (Math.random() - 0.5) * 0.3;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vy += this.gravity * dt;
        this.vx *= 0.99;
        this.rot += this.vrot * dt;
        this.life -= this.decay * dt;
    }

    draw(ctx) {
        if (this.life <= 0) return;
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        if (this.kind === 'confetti') {
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rot);
            ctx.fillRect(-this.size * 0.5, -this.size * 0.3, this.size, this.size * 0.6);
        } else if (this.kind === 'spark') {
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x - this.vx * 1.6, this.y - this.vy * 1.6);
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

class ScoreFloater {
    constructor(x, y, text, color) {
        this.x = x;
        this.y = y;
        this.text = text;
        this.color = color;
        this.life = 1;
    }

    update(dt) {
        this.y -= 1.1 * dt;
        this.life -= 0.014 * dt;
    }

    draw(ctx) {
        if (this.life <= 0) return;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, this.life * 1.4));
        // Канвас зеркалится в CSS — текст переворачиваем обратно, иначе он читается наоборот.
        ctx.translate(this.x, this.y);
        ctx.scale(-1, 1);
        ctx.font = `900 ${Math.round(gameLayout.minSide * 0.05)}px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(this.text, 0, 0);
        ctx.fillStyle = this.color;
        ctx.fillText(this.text, 0, 0);
        ctx.restore();
    }
}

function spawnCatchBurst(x, y, type) {
    const colors = type.golden
        ? ['#ffcf4d', '#fff2c2', '#ffffff', '#ffa726']
        : [type.crown, type.crownLight, type.band, '#ffffff'];
    for (let i = 0; i < 22; i++) {
        particles.push(new Particle(x, y, colors[i % colors.length], 'confetti'));
    }
    for (let i = 0; i < 10; i++) {
        particles.push(new Particle(x, y, '#ffffff', 'spark'));
    }
}

function spawnMissBurst(x, y, color) {
    for (let i = 0; i < 14; i++) {
        particles.push(new Particle(x, y, color, 'dot'));
    }
}

/* ---------------------------------------------------------------------------
 * Игроки: порядок, стабильные ключи, сглаживание позы
 * ------------------------------------------------------------------------- */

function getOrderedPersons(poseResults) {
    const persons = poseResults?.landmarks;
    if (!persons?.length) return [];
    return persons
        .map((lm, idx) => {
            const ls = lm[11];
            const rs = lm[12];
            const xs = [];
            if (ls) xs.push(ls.x);
            if (rs) xs.push(rs.x);
            return { lm, idx, sortX: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : idx };
        })
        .sort((a, b) => a.sortX - b.sortX)
        .map((p, i) => ({ lm: p.lm, key: `Pose#${i}` }));
}

/** Центр плеч в экранных координатах — не даём Pose#0/#1 перепрыгивать между людьми. */
let stablePoseShoulderMid = [];

function otherPoseKey(k) {
    return k === 'Pose#0' ? 'Pose#1' : 'Pose#0';
}

function shoulderMidScreen(lm, getScreenPoint) {
    const ls = lm[11];
    const rs = lm[12];
    if (!ls || !rs) return null;
    const a = getScreenPoint(ls);
    const b = getScreenPoint(rs);
    return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

/**
 * Сохраняет poseKey за слотом по близости центра плеч к прошлому кадру.
 * Надетая шляпа должна оставаться на том же игроке, даже если он на миг пропал.
 */
function bindStablePoseKeys(sortedPersons, getScreenPoint) {
    const items = [];
    for (const { lm } of sortedPersons) {
        const mid = shoulderMidScreen(lm, getScreenPoint);
        if (!mid) continue;
        items.push({ lm, mid });
    }
    if (items.length === 0) return [];

    if (items.length >= 3) {
        stablePoseShoulderMid = items.map((it, i) => ({ key: `Pose#${i}`, x: it.mid.x, y: it.mid.y }));
        return items.map((it, i) => ({ lm: it.lm, key: `Pose#${i}` }));
    }

    if (items.length === 1) {
        if (stablePoseShoulderMid.length >= 2) {
            let bestSlot = stablePoseShoulderMid[0];
            let bestD = Infinity;
            for (const s of stablePoseShoulderMid) {
                const d = Math.hypot(items[0].mid.x - s.x, items[0].mid.y - s.y);
                if (d < bestD) {
                    bestD = d;
                    bestSlot = s;
                }
            }
            bestSlot.x = items[0].mid.x;
            bestSlot.y = items[0].mid.y;
            return [{ lm: items[0].lm, key: bestSlot.key }];
        }
        if (stablePoseShoulderMid.length === 1) {
            stablePoseShoulderMid[0].x = items[0].mid.x;
            stablePoseShoulderMid[0].y = items[0].mid.y;
            return [{ lm: items[0].lm, key: stablePoseShoulderMid[0].key }];
        }
        stablePoseShoulderMid = [{ key: 'Pose#0', x: items[0].mid.x, y: items[0].mid.y }];
        return [{ lm: items[0].lm, key: 'Pose#0' }];
    }

    const t0 = items[0];
    const t1 = items[1];

    if (stablePoseShoulderMid.length === 1) {
        const old = stablePoseShoulderMid[0];
        const d0 = Math.hypot(t0.mid.x - old.x, t0.mid.y - old.y);
        const d1 = Math.hypot(t1.mid.x - old.x, t1.mid.y - old.y);
        if (d0 <= d1) {
            stablePoseShoulderMid = [
                { key: old.key, x: t0.mid.x, y: t0.mid.y },
                { key: otherPoseKey(old.key), x: t1.mid.x, y: t1.mid.y }
            ];
            return [
                { lm: t0.lm, key: old.key },
                { lm: t1.lm, key: otherPoseKey(old.key) }
            ];
        }
        stablePoseShoulderMid = [
            { key: otherPoseKey(old.key), x: t0.mid.x, y: t0.mid.y },
            { key: old.key, x: t1.mid.x, y: t1.mid.y }
        ];
        return [
            { lm: t0.lm, key: otherPoseKey(old.key) },
            { lm: t1.lm, key: old.key }
        ];
    }

    if (stablePoseShoulderMid.length !== 2) {
        stablePoseShoulderMid = [
            { key: 'Pose#0', x: t0.mid.x, y: t0.mid.y },
            { key: 'Pose#1', x: t1.mid.x, y: t1.mid.y }
        ];
        return [
            { lm: t0.lm, key: 'Pose#0' },
            { lm: t1.lm, key: 'Pose#1' }
        ];
    }

    const s0 = stablePoseShoulderMid[0];
    const s1 = stablePoseShoulderMid[1];
    const d00 = Math.hypot(t0.mid.x - s0.x, t0.mid.y - s0.y);
    const d10 = Math.hypot(t1.mid.x - s0.x, t1.mid.y - s0.y);
    const d01 = Math.hypot(t0.mid.x - s1.x, t0.mid.y - s1.y);
    const d11 = Math.hypot(t1.mid.x - s1.x, t1.mid.y - s1.y);
    let itemForS0 = 0;
    let itemForS1 = 1;
    if (d01 + d10 + 12 < d00 + d11) {
        itemForS0 = 1;
        itemForS1 = 0;
    }
    const mS0 = items[itemForS0];
    const mS1 = items[itemForS1];
    s0.x = mS0.mid.x;
    s0.y = mS0.mid.y;
    s1.x = mS1.mid.x;
    s1.y = mS1.mid.y;
    return [
        { lm: mS0.lm, key: s0.key },
        { lm: mS1.lm, key: s1.key }
    ];
}

const FACE_LM_INDICES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const POSE_FACE_ALPHA = 0.3;
const POSE_BODY_ALPHA = 0.42;
const POSE_TELEPORT_THRESHOLD = 0.22;
const POSE_STATE_TTL_MS = 600;
const poseSmoothByKey = new Map();

function smoothPoseLandmarks(personKey, rawLm, nowMs) {
    let state = poseSmoothByKey.get(personKey);
    if (!state) {
        state = { lm: {}, lastSeenMs: nowMs };
        poseSmoothByKey.set(personKey, state);
    }
    state.lastSeenMs = nowMs;
    const out = new Array(rawLm.length);
    for (let i = 0; i < rawLm.length; i++) {
        const r = rawLm[i];
        if (!r) {
            out[i] = r;
            continue;
        }
        const prev = state.lm[i];
        const alpha = FACE_LM_INDICES.has(i) ? POSE_FACE_ALPHA : POSE_BODY_ALPHA;
        if (!prev || Math.hypot(r.x - prev.x, r.y - prev.y) > POSE_TELEPORT_THRESHOLD) {
            state.lm[i] = { x: r.x, y: r.y, z: r.z, visibility: r.visibility };
        } else {
            state.lm[i] = {
                x: prev.x * (1 - alpha) + r.x * alpha,
                y: prev.y * (1 - alpha) + r.y * alpha,
                z: (prev.z ?? 0) * (1 - alpha) + (r.z ?? 0) * alpha,
                visibility: r.visibility
            };
        }
        out[i] = state.lm[i];
    }
    return out;
}

function prunePoseSmoothState(activeKeys, nowMs) {
    for (const k of [...poseSmoothByKey.keys()]) {
        if (activeKeys.has(k)) continue;
        const s = poseSmoothByKey.get(k);
        if (!s || nowMs - s.lastSeenMs > POSE_STATE_TTL_MS) poseSmoothByKey.delete(k);
    }
}

function cloneLandmarksArray(lm) {
    return lm.map((p) => (p ? { x: p.x, y: p.y, z: p.z, visibility: p.visibility } : p));
}

function lerpLandmarksInto(fromLm, toLm, t, outLm) {
    const n = toLm.length;
    for (let i = 0; i < n; i++) {
        const a = fromLm[i];
        const b = toLm[i];
        if (!b) {
            outLm[i] = b;
            continue;
        }
        if (!a) {
            outLm[i] = { x: b.x, y: b.y, z: b.z, visibility: b.visibility };
            continue;
        }
        outLm[i] = {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t,
            visibility: b.visibility
        };
    }
}

function prunePoseDisplayState(activeKeys) {
    for (const k of [...poseTargetLmByPoseKey.keys()]) {
        if (activeKeys.has(k)) continue;
        poseTargetLmByPoseKey.delete(k);
        posePrevTargetLmByPoseKey.delete(k);
        poseDisplayLmByPoseKey.delete(k);
    }
}

/** Между кадрами камеры плавно интерполируем prev в target (экран 120 Гц, камера ~30 fps). */
function updatePoseDisplayLandmarks(activeKeys, nowMs) {
    const interval = Math.max(16, poseFrameIntervalMs);
    let t = (nowMs - poseFrameStartMs) / interval;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    t = t * t * (3 - 2 * t);

    for (const key of activeKeys) {
        const target = poseTargetLmByPoseKey.get(key);
        if (!target) continue;
        const prev = posePrevTargetLmByPoseKey.get(key);
        if (!prev || t <= 0) {
            poseDisplayLmByPoseKey.set(key, cloneLandmarksArray(target));
            continue;
        }
        let out = poseDisplayLmByPoseKey.get(key);
        if (!out || out.length !== target.length) {
            out = cloneLandmarksArray(target);
            poseDisplayLmByPoseKey.set(key, out);
        }
        lerpLandmarksInto(prev, target, t, out);
    }
}

function commitPoseTargetsFromFrame(orderedPersons, nowMs) {
    for (const { lm: rawLm, key: poseKey } of orderedPersons) {
        const smoothed = smoothPoseLandmarks(poseKey, rawLm, nowMs);
        cachedSmoothedLmByPoseKey.set(poseKey, smoothed);
        const prevTarget = poseTargetLmByPoseKey.get(poseKey);
        posePrevTargetLmByPoseKey.set(poseKey, cloneLandmarksArray(prevTarget ?? smoothed));
        poseTargetLmByPoseKey.set(poseKey, smoothed);
    }
    poseFrameStartMs = nowMs;
}

/* ---------------------------------------------------------------------------
 * Надетая шляпа: держится на голове до тех пор, пока игрок не поймает новую.
 *
 * Голова берётся по ушам (7, 8) и носу (0): линия ушей задаёт угол наклона и
 * масштаб, нос — направление взгляда. Шляпа сидит над линией ушей.
 * ------------------------------------------------------------------------- */

/** poseKey -> { type, sinceMs } — что надето на игроке прямо сейчас. */
const wornHatByPoseKey = new Map();
/** poseKey -> сглаженное состояние головы для отрисовки. */
const headOverlayByPoseKey = new Map();

/** Сглаживание положения ушей/носа (меньше — плавнее, но с задержкой). */
const HEAD_SMOOTH_ALPHA = isAndroidBrowser() ? 0.38 : 0.2;
/** Ширина полей шляпы относительно расстояния между ушами. */
const WORN_HAT_BRIM_MUL = 2.55;
/** Насколько выше линии ушей сидит шляпа (в долях расстояния между ушами). */
const WORN_HAT_LIFT_FRAC = 0.62;
/** Порог видимости точек головы — ниже него голову не отслеживаем. */
const HEAD_MIN_VISIBILITY = 0.28;

function pruneHeadOverlayState(activePoseKeys) {
    for (const k of [...headOverlayByPoseKey.keys()]) {
        if (!activePoseKeys.has(k)) headOverlayByPoseKey.delete(k);
    }
}

/**
 * Обновляет сглаженную геометрию головы игрока.
 * @returns {boolean} true — голова видна и пригодна для ловли/отрисовки.
 */
function tickHeadOverlayFromLm(poseKey, lm, getScreenPoint) {
    const nose = lm[0];
    const earL = lm[7];
    const earR = lm[8];
    if (!nose || !earL || !earR) return false;
    const vis = Math.min(nose.visibility ?? 1, earL.visibility ?? 1, earR.visibility ?? 1);
    if (vis < HEAD_MIN_VISIBILITY) return false;

    const L = getScreenPoint(earL);
    const R = getScreenPoint(earR);
    const n = getScreenPoint(nose);
    const a = HEAD_SMOOTH_ALPHA;
    let st = headOverlayByPoseKey.get(poseKey);
    if (!st) {
        st = { lx: L.x, ly: L.y, rx: R.x, ry: R.y, nx: n.x, ny: n.y };
        headOverlayByPoseKey.set(poseKey, st);
    } else {
        st.lx = st.lx * (1 - a) + L.x * a;
        st.ly = st.ly * (1 - a) + L.y * a;
        st.rx = st.rx * (1 - a) + R.x * a;
        st.ry = st.ry * (1 - a) + R.y * a;
        st.nx = st.nx * (1 - a) + n.x * a;
        st.ny = st.ny * (1 - a) + n.y * a;
    }

    const earSpan = Math.hypot(st.rx - st.lx, st.ry - st.ly);
    if (earSpan < 8) return false;

    st.earSpan = earSpan;
    st.cx = (st.lx + st.rx) * 0.5;
    st.cy = (st.ly + st.ry) * 0.5;

    // Индекс 7 — анатомически левое ухо, и на кадре фронтальной камеры оно оказывается
    // СПРАВА. Вектор 7→8 тогда смотрит влево, angle ≈ 180°, и шляпа рисуется вверх
    // тормашками. Берём линию ушей всегда слева направо по экрану: угол остаётся
    // в пределах ±90° и описывает только наклон головы.
    let dx = st.rx - st.lx;
    let dy = st.ry - st.ly;
    if (dx < 0) {
        dx = -dx;
        dy = -dy;
    }
    st.angle = Math.atan2(dy, dx);
    return true;
}

/**
 * Точка на макушке, куда садится шляпа.
 * Смещаемся от центра линии ушей вверх по нормали к этой линии,
 * чтобы шляпа наклонялась вместе с головой.
 */
function headCrownPoint(st) {
    const lift = st.earSpan * WORN_HAT_LIFT_FRAC;
    // Нормаль к линии ушей. st.angle нормализован в ±90°, поэтому cos(angle) > 0
    // и ny всегда отрицательный — точка уходит вверх по экрану, к макушке.
    const nx = Math.sin(st.angle);
    const ny = -Math.cos(st.angle);
    return { x: st.cx + nx * lift, y: st.cy + ny * lift };
}

/**
 * Зона ловли — круг вокруг макушки; чуть шире головы, чтобы ловить было приятно.
 * Для ловушки радиус ужимаем до размера самой головы: попасть под бомбу должно
 * требовать реальной ошибки, а не близкого прохода.
 */
function headCatchDisc(st, strict = false) {
    const crown = headCrownPoint(st);
    return { x: crown.x, y: crown.y, r: st.earSpan * (strict ? 0.5 : 0.78) };
}

function drawWornHat(ctx, poseKey) {
    const st = headOverlayByPoseKey.get(poseKey);
    if (!st || !st.earSpan) return;
    const worn = wornHatByPoseKey.get(poseKey);
    if (!worn) return;

    const crown = headCrownPoint(st);
    const brimW = st.earSpan * WORN_HAT_BRIM_MUL * worn.type.brimMul;

    // Короткая «пружинка» в первые 260 мс после надевания.
    const since = performance.now() - worn.sinceMs;
    let pop = 1;
    if (since < 260) {
        const p = since / 260;
        pop = 1 + 0.22 * Math.sin(p * Math.PI) * (1 - p * 0.4);
    }

    ctx.save();
    ctx.translate(crown.x, crown.y);
    ctx.rotate(st.angle);
    ctx.scale(pop, pop);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = brimW * 0.1;
    drawHatShape(ctx, worn.type, brimW);
    ctx.restore();
}

/** Подсветка зоны ловли, пока на игроке ещё нет шляпы — обучающая подсказка. */
function drawCatchHint(ctx, poseKey) {
    const st = headOverlayByPoseKey.get(poseKey);
    if (!st || !st.earSpan) return;
    if (wornHatByPoseKey.has(poseKey)) return;
    const disc = headCatchDisc(st);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.005);
    ctx.save();
    ctx.globalAlpha = 0.25 + pulse * 0.2;
    ctx.strokeStyle = '#a37bff';
    ctx.lineWidth = Math.max(2, st.earSpan * 0.06);
    ctx.setLineDash([st.earSpan * 0.22, st.earSpan * 0.16]);
    ctx.beginPath();
    ctx.arc(disc.x, disc.y, disc.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function circleHit(ax, ay, ar, bx, by, br) {
    const dx = ax - bx;
    const dy = ay - by;
    const rr = ar + br;
    return dx * dx + dy * dy <= rr * rr;
}

/* ---------------------------------------------------------------------------
 * Ловля, промахи, прогресс уровня
 * ------------------------------------------------------------------------- */

function loseLife(reason) {
    if (!isPlaying || victoryTransitionActive) return;
    lives -= 1;
    comboStreak = 0;
    updateLivesDisplay();
    if (lives <= 0) triggerGameOver();
    else if (reason === 'bomb') playBombSound();
    else playMissSound();
}

/** Игрок подставил голову под шляпу. */
function catchHat(hat, poseKey, disc) {
    hat.caught = true;
    hat.dead = true;

    if (hat.type.bomb) {
        // Шляпа-бомба сбивает надетую и стоит жизни.
        wornHatByPoseKey.delete(poseKey);
        spawnMissBurst(disc.x, disc.y, '#ff4f4f');
        floaters.push(new ScoreFloater(disc.x, disc.y, '✖', '#ff6b6b'));
        loseLife('bomb');
        return;
    }

    // Новая шляпа заменяет старую и держится, пока не поймана следующая.
    wornHatByPoseKey.set(poseKey, { type: hat.type, sinceMs: performance.now() });

    comboStreak += 1;
    const comboBonus = Math.min(comboStreak - 1, 5) * 10;
    const gained = hat.type.score + comboBonus;
    score += gained;
    caughtThisLevel += 1;
    scoreDisplay.innerText = formatScore(score);
    updateQuotaDisplay();

    spawnCatchBurst(disc.x, disc.y, hat.type);
    floaters.push(
        new ScoreFloater(disc.x, disc.y - disc.r * 0.6, `+${gained}`, hat.type.golden ? '#ffcf4d' : '#ffffff')
    );

    if (hat.type.golden) playBonusSound();
    else playCatchSound(comboStreak - 1);

    if (caughtThisLevel >= levelQuota) advanceLevel();
}

/** Шляпа долетела до низа экрана. Пропущенная обычная шляпа стоит жизни. */
function hatReachedFloor(hat) {
    if (hat.type.bomb) {
        // Бомбе и положено упасть — это не промах.
        spawnMissBurst(hat.x, gameLayout.h - hat.brimW * 0.3, '#2b2b34');
        return;
    }
    spawnMissBurst(hat.x, gameLayout.h - hat.brimW * 0.3, hat.type.crown);
    loseLife('miss');
}

function advanceLevel() {
    if (victoryTransitionActive) return;
    if (currentLevel >= FINAL_LEVEL) {
        triggerCampaignComplete();
        return;
    }
    triggerVictoryAndNextLevel();
}

function beginLevel(level) {
    currentLevel = Math.max(1, Math.min(FINAL_LEVEL, level));
    const spec = getLevelSpec(currentLevel);
    levelQuota = spec.quota;
    caughtThisLevel = 0;
    spawnedThisLevel = 0;
    // Первую шляпу даём почти сразу, чтобы игрок не ждал.
    spawnTimerMs = 500;
    fallingHats.length = 0;
    updateLevelDisplay();
    updateQuotaDisplay();
}

function updateSpawning(dtMs) {
    const spec = getLevelSpec(currentLevel);
    spawnTimerMs -= dtMs;
    if (spawnTimerMs > 0) return;
    const airborne = fallingHats.filter((h) => !h.dead).length;
    if (airborne >= spec.maxAir) {
        spawnTimerMs = 260;
        return;
    }
    // Первую шляпу уровня всегда даём безопасной — иначе бомба на старте бьёт вслепую.
    const type = spawnedThisLevel === 0 ? HAT_TYPES.top : pickHatTypeForLevel(spec);

    // Две ловимые шляпы не должны идти вплотную по высоте: голова одна, и вторую
    // тогда теряешь не по своей вине. Ловушке это не мешает — её и не ловят.
    if (!type.bomb) {
        const tooClose = fallingHats.some(
            (h) => !h.dead && !h.type.bomb && h.y < gameLayout.h * 0.34
        );
        if (tooClose) {
            spawnTimerMs = 320;
            return;
        }
    }

    fallingHats.push(new FallingHat(type, spec));
    spawnedThisLevel += 1;
    spawnTimerMs = spec.spawnMs * (0.82 + Math.random() * 0.36);
}

/**
 * Проверка «голова под шляпой» для всех игроков в кадре.
 * Идём по снимку массива: поимка может закрыть уровень, а переход уровня
 * очищает fallingHats прямо во время обхода.
 */
function updateHatCatching(orderedPersons) {
    const snapshot = fallingHats.slice();
    for (let i = snapshot.length - 1; i >= 0; i--) {
        const hat = snapshot[i];
        if (!hat || hat.dead) continue;
        const hd = hat.catchDisc();
        for (const { key: poseKey } of orderedPersons) {
            const st = headOverlayByPoseKey.get(poseKey);
            if (!st || !st.earSpan) continue;
            const disc = headCatchDisc(st, hat.type.bomb === true);
            if (!circleHit(hd.x, hd.y, hd.r, disc.x, disc.y, disc.r)) continue;
            catchHat(hat, poseKey, disc);
            break;
        }
    }
}

/* ---------------------------------------------------------------------------
 * Таблица рекордов
 * ------------------------------------------------------------------------- */

function loadLeaderboard() {
    try {
        const raw = localStorage.getItem(STORAGE_LEADERBOARD);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((e) => e && Number.isFinite(e.score))
            .sort((a, b) => b.score - a.score)
            .slice(0, LEADERBOARD_MAX);
    } catch {
        return [];
    }
}

function formatLeaderboardDate(ts) {
    try {
        return new Date(ts).toLocaleDateString(uiLang === 'en' ? 'en-US' : 'ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
        });
    } catch {
        return '';
    }
}

function renderLeaderboardList(entries, highlightId = null) {
    if (!leaderboardList) return;
    leaderboardList.innerHTML = '';
    if (!entries.length) {
        const li = document.createElement('li');
        li.className = 'leaderboard-empty';
        li.textContent = t('leaderboardEmpty');
        leaderboardList.appendChild(li);
        return;
    }
    entries.forEach((entry, i) => {
        const li = document.createElement('li');
        if (entry.id === highlightId) li.classList.add('is-highlight');
        const rank = document.createElement('span');
        rank.className = 'leaderboard-rank';
        rank.textContent = `${i + 1}.`;
        const sc = document.createElement('span');
        sc.className = 'leaderboard-score';
        sc.textContent = String(entry.score);
        const dt = document.createElement('span');
        dt.className = 'leaderboard-date';
        dt.textContent = formatLeaderboardDate(entry.at);
        li.append(rank, sc, dt);
        leaderboardList.appendChild(li);
    });
}

/** @returns {{ saved: boolean, rank: number|null, entries: object[], entryId: string|null }} */
function saveScoreToLeaderboard(finalScore) {
    const entries = loadLeaderboard();
    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        score: finalScore,
        at: Date.now()
    };
    const merged = [...entries, entry].sort((a, b) => b.score - a.score);
    const top = merged.slice(0, LEADERBOARD_MAX);
    const saved = top.some((e) => e.id === entry.id);
    if (saved) {
        try {
            localStorage.setItem(STORAGE_LEADERBOARD, JSON.stringify(top));
        } catch (_) {}
    }
    const rank = saved ? top.findIndex((e) => e.id === entry.id) + 1 : null;
    return { saved, rank, entries: loadLeaderboard(), entryId: saved ? entry.id : null };
}

/* ---------------------------------------------------------------------------
 * Переходы между состояниями игры
 * ------------------------------------------------------------------------- */

function clearVictoryTransition() {
    if (victoryTimeoutId != null) {
        clearTimeout(victoryTimeoutId);
        victoryTimeoutId = null;
    }
    victoryTransitionActive = false;
    victoryOverlay?.classList.add('is-hidden');
    campaignCompleteOverlay?.classList.add('is-hidden');
}

function triggerGameOver() {
    if (!isPlaying) return;
    clearVictoryTransition();
    stopMusic();
    playGameOverSound();
    isPlaying = false;
    updateQuotaDisplay();
    gameOverOverlay?.classList.remove('is-hidden');
    // Итог кампании тоже идёт в таблицу рекордов — иначе прогресс до game over пропадает.
    showCampaignResult();
}

function showCampaignResult() {
    const result = saveScoreToLeaderboard(score);
    if (campaignScoreLine) campaignScoreLine.textContent = `${t('campaignScore')}: ${score}`;
    if (campaignRankLine) {
        if (result.saved && result.rank === 1) {
            campaignRankLine.textContent = `${t('leaderboardNewRecord')} #${result.rank}`;
        } else if (result.saved && result.rank) {
            campaignRankLine.textContent = `${t('leaderboardRank')}: #${result.rank}`;
        } else {
            campaignRankLine.textContent = t('leaderboardNoTop');
        }
    }
    renderLeaderboardList(result.entries, result.entryId);
    campaignCompleteOverlay?.classList.remove('is-hidden');
}

function triggerCampaignComplete() {
    if (victoryTransitionActive) return;
    victoryTransitionActive = true;
    isPlaying = false;
    stopMusic();
    playLevelUpSound();
    fallingHats.length = 0;
    updateQuotaDisplay();
    const title = campaignCompleteOverlay?.querySelector('.campaign-complete-title');
    if (title) title.textContent = t('youWon');
    showCampaignResult();
}

function triggerVictoryAndNextLevel() {
    if (victoryTransitionActive) return;
    victoryTransitionActive = true;
    fallingHats.length = 0;
    playLevelUpSound();
    victoryOverlay?.classList.remove('is-hidden');
    victoryTimeoutId = setTimeout(() => {
        victoryTimeoutId = null;
        victoryTransitionActive = false;
        victoryOverlay?.classList.add('is-hidden');
        if (!isPlaying) return;
        beginLevel(currentLevel + 1);
    }, VICTORY_DISPLAY_MS);
}

function clearCatchTutorial() {
    if (catchTutorialTimeoutId != null) {
        clearTimeout(catchTutorialTimeoutId);
        catchTutorialTimeoutId = null;
    }
    if (catchTutorialCountdownId != null) {
        clearInterval(catchTutorialCountdownId);
        catchTutorialCountdownId = null;
    }
    catchTutorialActive = false;
    catchTutorialOverlay?.classList.add('is-hidden');
}

function showCatchTutorial(onDone) {
    clearCatchTutorial();
    catchTutorialActive = true;
    let secLeft = Math.ceil(CATCH_TUTORIAL_MS / 1000);
    if (catchTutorialCountdown) catchTutorialCountdown.textContent = String(secLeft);
    catchTutorialOverlay?.classList.remove('is-hidden');
    catchTutorialCountdownId = setInterval(() => {
        secLeft -= 1;
        if (catchTutorialCountdown) {
            catchTutorialCountdown.textContent = secLeft > 0 ? String(secLeft) : '';
        }
        if (secLeft <= 0) {
            clearInterval(catchTutorialCountdownId);
            catchTutorialCountdownId = null;
        }
    }, 1000);
    catchTutorialTimeoutId = setTimeout(() => {
        if (catchTutorialCountdownId != null) {
            clearInterval(catchTutorialCountdownId);
            catchTutorialCountdownId = null;
        }
        catchTutorialTimeoutId = null;
        catchTutorialActive = false;
        catchTutorialOverlay?.classList.add('is-hidden');
        onDone?.();
    }, CATCH_TUTORIAL_MS);
}

function resetRuntimeState() {
    fallingHats.length = 0;
    particles.length = 0;
    floaters.length = 0;
    wornHatByPoseKey.clear();
    headOverlayByPoseKey.clear();
    poseSmoothByKey.clear();
    stablePoseShoulderMid = [];
    lastVideoTime = -1;
    poseDetectTsMs = 0;
    cachedSmoothedLmByPoseKey.clear();
    posePrevTargetLmByPoseKey.clear();
    poseTargetLmByPoseKey.clear();
    poseDisplayLmByPoseKey.clear();
    poseFrameStartMs = 0;
    poseFrameIntervalMs = 33.33;
    prevVideoTimeForInterval = -1;
    currentPoseResults = null;
    comboStreak = 0;
}

function showMainMenu() {
    isPlaying = false;
    clearCatchTutorial();
    clearVictoryTransition();
    stopMusic();
    gameOverOverlay?.classList.add('is-hidden');
    mainMenu.classList.remove('is-hidden');
    hudGame.classList.add('is-hidden');
    resetRuntimeState();
    updateQuotaDisplay();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasElement.style.visibility = 'hidden';
    void video.pause();
}

function startGame(startLevel = 1) {
    tryUnlockAudioOnUserGesture();
    clearVictoryTransition();
    gameOverOverlay?.classList.add('is-hidden');
    score = 0;
    lives = START_LIVES;
    scoreDisplay.innerText = formatScore(score);
    resetRuntimeState();
    beginLevel(startLevel);
    updateLivesDisplay();
    lastFrameTime = performance.now();
    mainMenu.classList.add('is-hidden');
    hudGame.classList.remove('is-hidden');
    canvasElement.style.visibility = 'visible';
    isPlaying = true;
    updateQuotaDisplay();
    void video.play().catch(() => {});
    showCatchTutorial(() => {
        startMusic(getLevelSpec(currentLevel).spawnMs > 1600 ? 280 : 230);
    });
    queueMicrotask(() => {
        requestAnimationFrame(gameLoop);
    });
}

let lastFrameTime = performance.now();

btnStart?.addEventListener('click', () => startGame(1));
btnBackMenu?.addEventListener('click', () => showMainMenu());
btnCampaignMenu?.addEventListener('click', () => showMainMenu());

/* ---------------------------------------------------------------------------
 * Полноэкранный режим
 * ------------------------------------------------------------------------- */

const gameContainer = document.getElementById('game-container');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnFullscreenLabel = btnFullscreen?.querySelector('.btn-fullscreen-label');

function isFullscreenSupported() {
    const el = gameContainer || document.documentElement;
    return !!(
        document.fullscreenEnabled ||
        document.webkitFullscreenEnabled ||
        el.requestFullscreen ||
        el.webkitRequestFullscreen
    );
}

function getCurrentFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

async function enterFullscreen() {
    const el = gameContainer || document.documentElement;
    try {
        if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) {
        console.warn('fullscreen request failed:', e);
    }
}

async function exitFullscreen() {
    try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (e) {
        console.warn('exit fullscreen failed:', e);
    }
}

function syncFullscreenButton() {
    if (!btnFullscreen) return;
    const active = !!getCurrentFullscreenElement();
    btnFullscreen.classList.toggle('is-active', active);
    if (btnFullscreenLabel) {
        btnFullscreenLabel.textContent = active ? t('fullscreenExit') : t('fullscreen');
    }
}

if (btnFullscreen) {
    if (isFullscreenSupported()) {
        btnFullscreen.hidden = false;
        btnFullscreen.addEventListener('click', async () => {
            tryUnlockAudioOnUserGesture();
            if (getCurrentFullscreenElement()) await exitFullscreen();
            else await enterFullscreen();
            syncFullscreenButton();
        });
    } else {
        btnFullscreen.hidden = true;
    }
}

document.addEventListener('fullscreenchange', () => {
    syncFullscreenButton();
    scheduleResizeCanvas();
});
document.addEventListener('webkitfullscreenchange', () => {
    syncFullscreenButton();
    scheduleResizeCanvas();
});

/* ---------------------------------------------------------------------------
 * Ползунки громкости и язык
 * ------------------------------------------------------------------------- */

const volSfxEl = document.getElementById('vol-sfx');
const volMusicEl = document.getElementById('vol-music');
const volSfxVal = document.getElementById('vol-sfx-val');
const volMusicVal = document.getElementById('vol-music-val');

volSfxEl?.addEventListener('input', () => {
    const v = Math.max(0, Math.min(100, parseInt(volSfxEl.value, 10) || 0));
    sfxVolume01 = v / 100;
    if (volSfxVal) volSfxVal.textContent = `${v}%`;
    try {
        localStorage.setItem(STORAGE_SFX_VOL, String(sfxVolume01));
    } catch (_) {}
});

volMusicEl?.addEventListener('input', () => {
    const v = Math.max(0, Math.min(100, parseInt(volMusicEl.value, 10) || 0));
    musicVolume01 = v / 100;
    if (volMusicVal) volMusicVal.textContent = `${v}%`;
    try {
        localStorage.setItem(STORAGE_MUSIC_VOL, String(musicVolume01));
    } catch (_) {}
    applyMusicOutputVolumes();
    if (musicVolume01 <= 0) stopMusic();
});

for (const id of ['opt-lang-ru', 'opt-lang-en']) {
    document.getElementById(id)?.addEventListener('change', (ev) => {
        if (!ev.target.checked) return;
        uiLang = ev.target.value === 'en' ? 'en' : 'ru';
        try {
            localStorage.setItem(STORAGE_LANG, uiLang);
        } catch (_) {}
        applyI18n();
    });
}

/* ---------------------------------------------------------------------------
 * Режим 1 / 2 игрока — меняет numPoses у модели
 * ------------------------------------------------------------------------- */

const btnPlayers1 = document.getElementById('btn-players-1');
const btnPlayers2 = document.getElementById('btn-players-2');

function syncPlayerCountButtons() {
    const one = playerModeCount === 1;
    btnPlayers1?.classList.toggle('is-selected', one);
    btnPlayers2?.classList.toggle('is-selected', !one);
    btnPlayers1?.setAttribute('aria-pressed', String(one));
    btnPlayers2?.setAttribute('aria-pressed', String(!one));
}

function setPlayerMode(next, userInitiated) {
    const n = next === 2 ? 2 : 1;
    if (n === playerModeCount) {
        syncPlayerCountButtons();
        return;
    }
    playerModeCount = n;
    try {
        localStorage.setItem(STORAGE_PLAYER_COUNT, String(n));
    } catch (_) {}
    syncPlayerCountButtons();
    if (userInitiated) {
        void recreatePoseLandmarker().catch((e) => console.warn('recreate pose landmarker:', e));
    }
}

btnPlayers1?.addEventListener('click', () => setPlayerMode(1, true));
btnPlayers2?.addEventListener('click', () => setPlayerMode(2, true));

/* ---------------------------------------------------------------------------
 * MediaPipe: модель поз
 * ------------------------------------------------------------------------- */

async function createPoseLandmarkerInstance() {
    const vision = visionTasksResolver;
    if (!vision) {
        console.warn('[Hatter] createPoseLandmarkerInstance: vision resolver not ready');
        return;
    }
    const np = playerModeCount === 1 ? 1 : 2;
    const conf = trackTuning.minPoseConfidence;
    const poseOpts = (delegate) => ({
        baseOptions: {
            modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
            delegate
        },
        runningMode: 'VIDEO',
        numPoses: np,
        minPoseDetectionConfidence: conf,
        minPosePresenceConfidence: conf,
        minTrackingConfidence: conf
    });

    const delegateOrder = trackTuning.preferCpuPose ? ['CPU', 'GPU'] : ['GPU', 'CPU'];
    let lastErr;
    for (const delegate of delegateOrder) {
        try {
            poseLandmarker = await PoseLandmarker.createFromOptions(vision, poseOpts(delegate));
            mediapipePoseDelegate = delegate;
            console.info(
                `[Hatter] pose delegate: ${mediapipePoseDelegate}, numPoses=${np}, androidCpuFirst=${trackTuning.preferCpuPose}`
            );
            return;
        } catch (e) {
            lastErr = e;
            console.warn(`PoseLandmarker ${delegate} failed:`, e);
        }
    }
    throw lastErr ?? new Error('PoseLandmarker init failed');
}

async function recreatePoseLandmarker() {
    if (!visionTasksResolver) return;
    if (poseLandmarker) {
        try {
            poseLandmarker.close();
        } catch (_) {}
        poseLandmarker = null;
    }
    resetRuntimeState();
    await createPoseLandmarkerInstance();
}

/* ---------------------------------------------------------------------------
 * Канвас и размеры
 * ------------------------------------------------------------------------- */

let gameLayout = { w: 800, h: 600, minSide: 600 };

const MAX_CANVAS_LONG_EDGE_PX = 1280;
let loggedCanvasBufferCap = false;

function readViewportSize() {
    const vv = window.visualViewport;
    const w = Math.max(1, Math.floor(vv?.width ?? window.innerWidth));
    const h = Math.max(1, Math.floor(vv?.height ?? window.innerHeight));
    return { w, h };
}

let lastResizeW = 0;
let lastResizeH = 0;

function resizeCanvas() {
    const { w: vw, h: vh } = readViewportSize();
    if (vw === lastResizeW && vh === lastResizeH) return;
    lastResizeW = vw;
    lastResizeH = vh;

    let iw = vw;
    let ih = vh;
    const longEdge = Math.max(iw, ih);
    if (longEdge > MAX_CANVAS_LONG_EDGE_PX) {
        const s = MAX_CANVAS_LONG_EDGE_PX / longEdge;
        iw = Math.max(1, Math.floor(vw * s));
        ih = Math.max(1, Math.floor(vh * s));
    }

    if ((iw < vw || ih < vh) && !loggedCanvasBufferCap) {
        loggedCanvasBufferCap = true;
        console.info(
            `[Hatter] canvas buffer capped ${iw}x${ih} px (window ${vw}x${vh}) — saves GPU/CPU on large displays`
        );
    }

    gameLayout.w = iw;
    gameLayout.h = ih;
    gameLayout.minSide = Math.min(iw, ih);

    canvasElement.width = iw;
    canvasElement.height = ih;
    canvasElement.style.width = `${vw}px`;
    canvasElement.style.height = `${vh}px`;

    const gc = document.getElementById('game-container');
    if (gc) {
        gc.style.width = `${vw}px`;
        gc.style.height = `${vh}px`;
    }
    document.documentElement.style.height = `${vh}px`;
    document.body.style.height = `${vh}px`;
    document.documentElement.style.width = `${vw}px`;
    document.body.style.width = `${vw}px`;
}

let resizeCanvasDebounce = 0;
function scheduleResizeCanvas() {
    if (isPlaying) {
        clearTimeout(resizeCanvasDebounce);
        resizeCanvasDebounce = 0;
        resizeCanvas();
        return;
    }
    clearTimeout(resizeCanvasDebounce);
    resizeCanvasDebounce = setTimeout(() => {
        resizeCanvasDebounce = 0;
        resizeCanvas();
    }, 110);
}

window.addEventListener('resize', scheduleResizeCanvas);
window.visualViewport?.addEventListener('resize', scheduleResizeCanvas);

/* ---------------------------------------------------------------------------
 * Камера
 * ------------------------------------------------------------------------- */

function stopVideoTracks() {
    const s = video.srcObject;
    if (s && typeof s.getTracks === 'function') {
        s.getTracks().forEach((tr) => tr.stop());
    }
    video.srcObject = null;
}

function waitForVideoReady(el, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        if (el.readyState >= 2 && el.videoWidth > 0) {
            resolve();
            return;
        }
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            el.removeEventListener('loadedmetadata', onMeta);
            el.removeEventListener('loadeddata', onData);
            el.removeEventListener('canplay', onPlay);
            if (ok) resolve();
            else reject(new Error('Video metadata timeout'));
        };
        const onMeta = () => {
            if (el.videoWidth > 0) finish(true);
        };
        const onData = () => finish(true);
        const onPlay = () => finish(true);
        const timer = setTimeout(() => finish(false), timeoutMs);
        el.addEventListener('loadedmetadata', onMeta);
        el.addEventListener('loadeddata', onData);
        el.addEventListener('canplay', onPlay);
    });
}

async function setupWebcam() {
    const nav = window.navigator;
    if (!nav.mediaDevices?.getUserMedia) {
        throw new Error('Webcam not supported.');
    }

    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');

    const constraintSets = isAndroidBrowser()
        ? [
              {
                  video: {
                      width: { ideal: 640 },
                      height: { ideal: 480 },
                      facingMode: 'user',
                      frameRate: { ideal: 30, max: 30 }
                  }
              },
              { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } },
              { video: { facingMode: 'user' } },
              { video: true }
          ]
        : [
              { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } },
              { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } },
              { video: { facingMode: 'user' } },
              { video: true }
          ];

    let lastErr;
    for (const constraints of constraintSets) {
        try {
            stopVideoTracks();
            const stream = await nav.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            await waitForVideoReady(video, 25000);
            await video.play();
            return;
        } catch (e) {
            lastErr = e;
            console.warn('Webcam attempt failed:', constraints, e);
            stopVideoTracks();
        }
    }
    throw lastErr ?? new Error('Could not open webcam');
}

async function initializeModels() {
    let vision;
    const wasmLocal = getMediapipeWasmUrl();
    let visionWasmSource = 'same-origin';
    try {
        vision = await FilesetResolver.forVisionTasks(wasmLocal);
    } catch (e) {
        console.warn('MediaPipe wasm failed locally, CDN fallback:', e);
        visionWasmSource = 'jsdelivr-fallback';
        vision = await FilesetResolver.forVisionTasks(
            `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_WASM_VER}/wasm`
        );
    }
    console.info(`[Hatter] MediaPipe WASM: ${visionWasmSource}`);

    visionTasksResolver = vision;
    await createPoseLandmarkerInstance();
}

/* ---------------------------------------------------------------------------
 * Игровой цикл
 * ------------------------------------------------------------------------- */

let currentPoseResults = null;

let perfFrameSumMs = 0;
let perfFrameCount = 0;
let perfLastLogMs = 0;

function gameLoop(nowTime) {
    if (!isPlaying) return;

    if (!nowTime) nowTime = performance.now();
    let dtMs = nowTime - lastFrameTime;
    if (dtMs > 50) dtMs = 50;
    if (dtMs < 0) dtMs = 0;
    const dt = dtMs / (1000 / 60);
    lastFrameTime = nowTime;

    const startTimeMs = performance.now();
    let gotNewVideoPoseFrame = false;

    if (poseLandmarker && lastVideoTime !== video.currentTime) {
        if (prevVideoTimeForInterval >= 0 && video.currentTime > prevVideoTimeForInterval) {
            poseFrameIntervalMs = Math.max(
                20,
                Math.min(50, (video.currentTime - prevVideoTimeForInterval) * 1000)
            );
        }
        prevVideoTimeForInterval = video.currentTime;
        lastVideoTime = video.currentTime;
        gotNewVideoPoseFrame = true;
        let frameTsMs = Number.isFinite(video.currentTime) ? video.currentTime * 1000 : startTimeMs;
        if (frameTsMs <= poseDetectTsMs) frameTsMs = poseDetectTsMs + 1;
        poseDetectTsMs = frameTsMs;
        try {
            const pRes = poseLandmarker.detectForVideo(video, frameTsMs);
            if (pRes) currentPoseResults = pRes;
        } catch (err) {
            console.warn('PoseLandmarker detectForVideo:', err);
        }
    }

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    const vRatio = canvasElement.width / video.videoWidth;
    const hRatio = canvasElement.height / video.videoHeight;
    const ratio = Math.max(vRatio, hRatio);
    const centerShift_x = (canvasElement.width - video.videoWidth * ratio) / 2;
    const centerShift_y = (canvasElement.height - video.videoHeight * ratio) / 2;

    if (video.videoWidth > 0) {
        canvasCtx.drawImage(
            video,
            0,
            0,
            video.videoWidth,
            video.videoHeight,
            centerShift_x,
            centerShift_y,
            video.videoWidth * ratio,
            video.videoHeight * ratio
        );
    }

    // Затемняем видео — шляпы и HUD читаются на любом фоне.
    canvasCtx.fillStyle = 'rgba(8, 5, 18, 0.42)';
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);

    function getScreenPoint(landmark) {
        return {
            x: landmark.x * video.videoWidth * ratio + centerShift_x,
            y: landmark.y * video.videoHeight * ratio + centerShift_y
        };
    }

    const displayLmByPoseKey = poseDisplayLmByPoseKey;
    let orderedPersons = [];

    if (currentPoseResults?.landmarks) {
        orderedPersons = bindStablePoseKeys(getOrderedPersons(currentPoseResults), getScreenPoint);
        const nowPoseMs = performance.now();
        const activePoseKeys = new Set(orderedPersons.map((p) => p.key));

        if (gotNewVideoPoseFrame) {
            prunePoseSmoothState(activePoseKeys, nowPoseMs);
            prunePoseDisplayState(activePoseKeys);
            pruneHeadOverlayState(activePoseKeys);
            commitPoseTargetsFromFrame(orderedPersons, nowPoseMs);
        }

        updatePoseDisplayLandmarks(activePoseKeys, nowPoseMs);

        for (const { key: poseKey } of orderedPersons) {
            const landmarks = displayLmByPoseKey.get(poseKey);
            if (landmarks) tickHeadOverlayFromLm(poseKey, landmarks, getScreenPoint);
        }
    }

    const acceptingInput = isPlaying && !catchTutorialActive && !victoryTransitionActive;

    if (acceptingInput) {
        updateSpawning(dtMs);
    }

    // Летящие шляпы: обновление, ловля, падение на пол.
    for (let i = fallingHats.length - 1; i >= 0; i--) {
        const hat = fallingHats[i];
        if (acceptingInput) hat.update(dtMs);
        if (!hat.dead) hat.draw(canvasCtx);
    }

    if (acceptingInput && orderedPersons.length > 0) {
        updateHatCatching(orderedPersons);
    }

    // Сначала снимаем отработавшие шляпы с массива, потом начисляем последствия:
    // hatReachedFloor может завершить игру и сам очистить fallingHats.
    const landed = [];
    for (let i = fallingHats.length - 1; i >= 0; i--) {
        const hat = fallingHats[i];
        if (!hat.dead) continue;
        fallingHats.splice(i, 1);
        if (!hat.caught) landed.push(hat);
    }
    for (const hat of landed) hatReachedFloor(hat);

    // Шляпы на головах рисуем поверх летящих — надетая всегда на виду.
    for (const { key: poseKey } of orderedPersons) {
        drawCatchHint(canvasCtx, poseKey);
        drawWornHat(canvasCtx, poseKey);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.update(dt);
        p.draw(canvasCtx);
        if (p.life <= 0) particles.splice(i, 1);
    }

    for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.update(dt);
        f.draw(canvasCtx);
        if (f.life <= 0) floaters.splice(i, 1);
    }

    if (playersDisplay) {
        const n = orderedPersons.length;
        if (playerModeCount === 1) {
            playersDisplay.textContent = n >= 1 ? t('players1ok') : t('players1wait');
        } else {
            playersDisplay.textContent =
                n >= 2 ? t('players2ok') : n === 1 ? t('players2wait1') : t('players2wait0');
        }
    }

    if (DEBUG_FRAME_PERF) {
        const elapsed = performance.now() - startTimeMs;
        perfFrameSumMs += elapsed;
        perfFrameCount += 1;
        const tNow = performance.now();
        if (tNow - perfLastLogMs >= 2500) {
            perfLastLogMs = tNow;
            const avg = perfFrameSumMs / perfFrameCount;
            console.info(`[perf] среднее за кадр ${avg.toFixed(1)} ms (n=${perfFrameCount})`);
            perfFrameSumMs = 0;
            perfFrameCount = 0;
        }
    }

    if (isPlaying) requestAnimationFrame(gameLoop);
}

/* ---------------------------------------------------------------------------
 * Запуск
 * ------------------------------------------------------------------------- */

function showStartError(e) {
    console.error(e);
    mainMenu?.classList.add('is-hidden');
    hudGame?.classList.add('is-hidden');
    canvasElement.style.visibility = 'hidden';
    const name = e?.name || '';
    const msg = e?.message || String(e);
    let hint = t('errHintDefault');
    if (name === 'NotAllowedError' || /Permission/i.test(msg)) {
        hint = t('errHintPermission');
    } else if (name === 'NotFoundError' || /DevicesNotFound/i.test(msg)) {
        hint = t('errHintNotFound');
    } else if (name === 'AbortError' || /Timeout starting video source|metadata timeout/i.test(msg)) {
        hint = t('errHintAbort');
    }
    loadingElement.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'max-width:28rem;margin:0 auto;text-align:left;line-height:1.45;font-size:0.95rem;';
    const titleEl = document.createElement('p');
    titleEl.textContent = t('errTitle');
    titleEl.style.fontWeight = '700';
    titleEl.style.marginBottom = '0.5rem';
    wrap.appendChild(titleEl);
    const d = document.createElement('p');
    d.style.opacity = '0.9';
    d.style.fontSize = '0.85rem';
    d.style.wordBreak = 'break-word';
    d.textContent = msg ? `${name ? `[${name}] ` : ''}${msg}` : hint;
    wrap.appendChild(d);
    const h = document.createElement('p');
    h.style.marginTop = '0.75rem';
    h.style.fontSize = '0.82rem';
    h.style.opacity = '0.75';
    h.textContent = hint;
    wrap.appendChild(h);
    loadingElement.appendChild(wrap);
    loadingElement.classList.add('visible');
    const ld = document.getElementById('loading-text');
    if (ld) ld.textContent = '';
}

async function start() {
    try {
        loadPersistedSettings();
        syncPlayerCountButtons();
        resizeCanvas();
        await setupWebcam();
        await initializeModels();
        loadingElement.classList.remove('visible');
        showMainMenu();
    } catch (e) {
        showStartError(e);
    }
}

start().catch(showStartError);
