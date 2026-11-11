/**
 * Трекер голов игроков поверх MediaPipe PoseLandmarker.
 *
 * Почему он устроен не «один детектор на весь кадр».
 * Детектор позы сжимает кадр до 224×224 и ищет человека по лицу. Измерено на
 * стенде: в кадре 1280×720 человек ростом меньше примерно трети высоты кадра
 * не находится вовсе — одинаково для lite, full и heavy, потому что детектор у
 * них общий. Уже найденного человека слежение держит до 50 px роста, то есть
 * ломается именно повторный захват: потеряли на резком движении — и до тех пор,
 * пока игрок не подойдёт к камере, найти его детектор не может.
 *
 * Лекарство — показывать модели не весь кадр, а увеличенный вырез:
 *   • у каждого игрока свой экземпляр слежения и свой квадратный вырез, который
 *     едет за игроком. В вырезе человек крупный, и собственный детектор модели
 *     находит его заново за кадр-два даже после рывка;
 *   • отдельный «разведчик» ищет потерянных и новых игроков по плиткам кадра:
 *     сначала там, где игрока видели в последний раз, затем по всему кадру
 *     всё более мелкой сеткой. На том же стенде человек в вырезе находится
 *     до 56 px роста — вчетверо дальше, чем по полному кадру.
 *
 * Модуль не знает про DOM игры: на вход кадр, на выход линии ушей игроков.
 */

import { HeadFilter, newHeadCalibration, resolveHeadEars } from './head-geometry.js';

/** Сторона канваса выреза. Модель всё равно приводит вход к 224–256 px. */
const CROP_CANVAS_PX = 256;
/** Фон за пределами кадра, когда вырез выходит за край. */
const PAD_COLOR = '#7f7f7f';

/** Порог видимости точек головы. */
const HEAD_MIN_VISIBILITY = 0.28;
/** Какую долю стороны выреза должен занимать человек: с запасом на движение. */
const CROP_FILL = 0.55;
/** Минимальная сторона выреза в долях меньшей стороны кадра. */
const CROP_MIN_FRAC = 0.09;
/** Вырез не трогаем, пока человек не ушёл от центра дальше этой доли стороны… */
const CROP_DEADZONE_CENTER = 0.07;
/** …или пока его размер не разошёлся с желаемым сильнее чем в это число раз. */
const CROP_DEADZONE_SCALE = 1.22;
/** Доля пути к желаемому вырезу за кадр. */
const CROP_EASE = 0.4;
/** Сколько кадров подряд слежение может молчать, прежде чем игрок считается потерянным. */
const MISS_LIMIT = 6;
/** На каждом пропуске вырез расширяется: игрок мог выскочить за его край. */
const MISS_WIDEN = 1.18;
/** Сколько секунд помним, где видели потерянного игрока, чтобы искать сначала там. */
const HINT_TTL_MS = 4000;
/** Находки разведчика с носом в этой верхней доле плитки не берём (см. scoutOnce). */
const SCOUT_TOP_GUARD = 0.27;
/** Перерыв в измерениях, после которого фильтр головы начинается заново. */
const FILTER_RESET_GAP_MS = 250;
/** Скачок измерения от прогноза (в ширинах головы), после которого фильтр начинается заново. */
const FILTER_RESET_JUMP = 2.5;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Рисует квадратную область кадра в канвас, закрашивая то, что вышло за край. */
function drawRegion(ctx, source, srcW, srcH, r) {
    const C = ctx.canvas.width;
    ctx.fillStyle = PAD_COLOR;
    ctx.fillRect(0, 0, C, C);
    const sx0 = Math.max(0, r.x);
    const sy0 = Math.max(0, r.y);
    const sx1 = Math.min(srcW, r.x + r.side);
    const sy1 = Math.min(srcH, r.y + r.side);
    if (sx1 - sx0 < 1 || sy1 - sy0 < 1) return;
    const k = C / r.side;
    ctx.drawImage(source, sx0, sy0, sx1 - sx0, sy1 - sy0, (sx0 - r.x) * k, (sy0 - r.y) * k, (sx1 - sx0) * k, (sy1 - sy0) * k);
}

/** Точки из координат выреза (0..1) в пиксели кадра. */
function toFramePx(lm, r) {
    const out = new Array(lm.length);
    for (let i = 0; i < lm.length; i++) {
        const p = lm[i];
        out[i] = { x: r.x + p.x * r.side, y: r.y + p.y * r.side, visibility: p.visibility ?? 1 };
    }
    return out;
}

/**
 * Похоже ли это на человека, а не на мебель: нос и плечи видны, голова выше
 * плеч, плечи не уже головы. Порог уверенности у моделей опущен ради дальней
 * дистанции, поэтому отсев ложных срабатываний делаем сами.
 */
function plausiblePerson(lm) {
    const nose = lm[0];
    const l = lm[11];
    const r = lm[12];
    if (!nose || !l || !r) return false;
    if (nose.visibility < 0.5 || l.visibility < 0.4 || r.visibility < 0.4) return false;
    const shW = Math.hypot(l.x - r.x, l.y - r.y);
    if (shW < 3) return false;
    const shMidY = (l.y + r.y) / 2;
    // Голова над плечами (с допуском на наклон вперёд) и не дальше трёх ширин плеч.
    const up = shMidY - nose.y;
    if (up < -0.15 * shW || up > 3 * shW) return false;
    const earW = Math.hypot(lm[7].x - lm[8].x, lm[7].y - lm[8].y);
    return earW < shW * 1.6;
}

/** Рамка человека по надёжным точкам; голова и плечи входят всегда. */
function personBox(lm) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < lm.length; i++) {
        const p = lm[i];
        if (!p) continue;
        const always = i === 0 || i === 7 || i === 8 || i === 11 || i === 12;
        if (!always && p.visibility < 0.55) continue;
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
    }
    const shW = Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y);
    // Над носом ещё полголовы, а рамка по точкам её не включает.
    y0 -= shW * 0.45;
    // Если ног не видно, рамка вырождается в голову с плечами — не даём ей стать уже торса.
    const minH = shW * 1.6;
    if (y1 - y0 < minH) y1 = y0 + minH;
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, shW };
}

function cropForBox(box, srcW, srcH) {
    const minSide = Math.min(srcW, srcH) * CROP_MIN_FRAC;
    const side = clamp(Math.max(box.w, box.h) / CROP_FILL, minSide, Math.max(srcW, srcH));
    return { x: box.cx - side / 2, y: box.cy - side / 2, side };
}

/**
 * Список областей поиска: от самых вероятных к полному перебору.
 * Плитка стороной S находит людей ростом от S/4 (измерено), причём достаточно,
 * чтобы в неё попали голова и плечи.
 */
export function buildSearchRegions(srcW, srcH, hints = []) {
    const regions = [];
    const minS = Math.min(srcW, srcH);
    const maxS = Math.max(srcW, srcH);

    // 1. Вокруг места, где игрока видели в последний раз, в двух масштабах.
    for (const h of hints) {
        for (const mult of [3, 5.5]) {
            const side = clamp(h.personH * mult, minS * 0.2, maxS);
            regions.push({ x: h.x - side / 2, y: h.y - side * 0.3, side, kind: 'hint' });
        }
    }

    // 2. Крупные плитки во всю меньшую сторону кадра, с перекрытием наполовину.
    const along = (len, side, step) => {
        const out = [];
        if (len <= side) return [(len - side) / 2];
        const n = Math.ceil((len - side) / step) + 1;
        for (let i = 0; i < n; i++) out.push(((len - side) * i) / (n - 1));
        return out;
    };
    for (const x of along(srcW, minS, minS * 0.5)) {
        for (const y of along(srcH, minS, minS * 0.5)) regions.push({ x, y, side: minS, kind: 'L1' });
    }

    // 3. Весь кадр целиком: близкий игрок может не поместиться в плитку.
    regions.push({ x: (srcW - maxS) / 2, y: (srcH - maxS) / 2, side: maxS, kind: 'full' });

    // 4. Мелкие плитки в половину меньшей стороны: далёкие игроки и дети.
    const s2 = minS * 0.5;
    for (const y of along(srcH, s2, s2 * 0.6)) {
        for (const x of along(srcW, s2, s2 * 0.6)) regions.push({ x, y, side: s2, kind: 'L2' });
    }
    return regions;
}

class Slot {
    constructor(key) {
        this.key = key;
        this.tracker = null;
        this.ts = 0;
        this.canvas = null;
        this.ctx = null;
        this.resetState();
    }

    resetState() {
        /** Текущий вырез {x, y, side} в пикселях кадра или null, если игрок не ведётся. */
        this.crop = null;
        this.miss = 0;
        /** Сколько кадров подряд слежение отвечает. */
        this.streak = 0;
        this.filter = new HeadFilter();
        this.cal = newHeadCalibration();
        this.source = null;
        /** Время последнего настоящего измерения головы. */
        this.lastMeasMs = -Infinity;
        /** Где и какого размера игрока видели в последний раз. */
        this.hint = null;
        /** Рамка тела по последнему измерению. */
        this.box = null;
    }
}

export class HeadTracker {
    /**
     * @param {object} o
     * @param {object} o.PoseLandmarker класс из @mediapipe/tasks-vision
     * @param {object} o.vision результат FilesetResolver.forVisionTasks
     * @param {number} o.players 1 или 2
     * @param {string[]} o.trackerModelUrls модели слежения по порядку попыток
     * @param {string} o.scoutModelUrl модель разведчика (детектор у всех моделей общий)
     * @param {string[]} o.delegateOrder например ['GPU', 'CPU']
     * @param {number} [o.confidence] порог уверенности модели
     */
    constructor(o) {
        this.o = o;
        this.players = o.players === 2 ? 2 : 1;
        this.slots = [];
        for (let i = 0; i < this.players; i++) this.slots.push(new Slot(`Pose#${i}`));
        this.scout = null;
        this.scoutCanvas = null;
        this.scoutCtx = null;
        this.regions = [];
        this.regionIdx = 0;
        this.frameNo = 0;
        this.srcW = 0;
        this.srcH = 0;
        this.info = { model: '', delegate: '' };
    }

    async init() {
        const { PoseLandmarker, vision, trackerModelUrls, scoutModelUrl, delegateOrder } = this.o;
        const conf = this.o.confidence ?? 0.3;
        const make = async (urls, runningMode, numPoses) => {
            let lastErr;
            for (const url of urls) {
                for (const delegate of delegateOrder) {
                    try {
                        const inst = await PoseLandmarker.createFromOptions(vision, {
                            baseOptions: { modelAssetPath: url, delegate },
                            runningMode,
                            numPoses,
                            minPoseDetectionConfidence: conf,
                            minPosePresenceConfidence: conf,
                            minTrackingConfidence: conf
                        });
                        return { inst, url, delegate };
                    } catch (e) {
                        lastErr = e;
                        console.warn(`[HeadTracker] ${runningMode} ${delegate} ${url.split('/').pop()} failed:`, e);
                    }
                }
            }
            throw lastErr ?? new Error('PoseLandmarker init failed');
        };

        const mkCanvas = () => {
            const c = document.createElement('canvas');
            c.width = CROP_CANVAS_PX;
            c.height = CROP_CANVAS_PX;
            return c;
        };

        for (const slot of this.slots) {
            const made = await make(trackerModelUrls, 'VIDEO', 1);
            slot.tracker = made.inst;
            slot.canvas = mkCanvas();
            slot.ctx = slot.canvas.getContext('2d', { alpha: false });
            this.info = { model: made.url.split('/').pop(), delegate: made.delegate };
        }
        // Разведчик работает покадрово (IMAGE): ему не нужна память о прошлом
        // кадре, он каждый раз смотрит в новую область.
        const scout = await make([scoutModelUrl], 'IMAGE', this.players);
        this.scout = scout.inst;
        this.scoutCanvas = mkCanvas();
        this.scoutCtx = this.scoutCanvas.getContext('2d', { alpha: false });
    }

    close() {
        for (const slot of this.slots) {
            try {
                slot.tracker?.close();
            } catch (_) {}
            slot.tracker = null;
        }
        try {
            this.scout?.close();
        } catch (_) {}
        this.scout = null;
    }

    /** Забыть игроков (новая игра). Экземпляры моделей и их счётчики времени живут дальше. */
    reset() {
        for (const slot of this.slots) slot.resetState();
        this.regions = [];
        this.regionIdx = 0;
    }

    /** Сколько игроков ведётся прямо сейчас. */
    get trackedCount() {
        let n = 0;
        for (const s of this.slots) if (s.crop && s.streak > 0) n++;
        return n;
    }

    /**
     * Обработать новый кадр камеры.
     * @param {CanvasImageSource} source видео или канвас
     * @param {number} srcW ширина кадра, px
     * @param {number} srcH высота кадра, px
     * @param {number} nowMs время кадра (performance.now)
     */
    update(source, srcW, srcH, nowMs) {
        if (!this.scout || srcW < 2 || srcH < 2) return;
        this.srcW = srcW;
        this.srcH = srcH;
        this.frameNo++;

        for (const slot of this.slots) {
            if (slot.crop) this.trackSlot(slot, source, nowMs);
        }
        this.dropDuplicates();

        const free = this.slots.filter((s) => !s.crop);
        if (free.length) {
            // Никого не ведём — ищем каждый кадр. Кого-то ведём — через кадр,
            // чтобы поиск второго игрока не съедал время у первого.
            const everyFrame = free.length === this.slots.length;
            if (everyFrame || this.frameNo % 2 === 0) this.scoutOnce(source, free, nowMs);
        } else {
            this.regions = [];
        }
    }

    trackSlot(slot, source, nowMs) {
        const r = slot.crop;
        drawRegion(slot.ctx, source, this.srcW, this.srcH, r);
        // Метка времени обязана строго расти за всю жизнь экземпляра.
        slot.ts = Math.max(slot.ts + 1, Math.round(nowMs));
        let res = null;
        try {
            res = slot.tracker.detectForVideo(slot.canvas, slot.ts);
        } catch (e) {
            console.warn('[HeadTracker] detectForVideo:', e);
        }
        const raw = res?.landmarks?.[0];
        const lm = raw ? toFramePx(raw, r) : null;
        if (lm && plausiblePerson(lm) && this.measure(slot, lm, nowMs)) {
            slot.miss = 0;
            slot.streak++;
            this.followCrop(slot, lm);
            return;
        }
        // Пропуск. Вырез расширяем и ведём по последней скорости: в увеличенном
        // вырезе собственный детектор модели найдёт игрока сам за кадр-два.
        slot.miss++;
        slot.streak = 0;
        if (slot.miss > MISS_LIMIT) {
            slot.crop = null;
            slot.box = null;
            return;
        }
        const p = slot.filter.predict(nowMs, 200);
        const maxSide = Math.max(this.srcW, this.srcH);
        const side = Math.min(maxSide, r.side * MISS_WIDEN);
        const cx = r.x + r.side / 2 + (p ? p.vx * 0.033 : 0);
        const cy = r.y + r.side / 2 + (p ? p.vy * 0.033 : 0);
        slot.crop = { x: cx - side / 2, y: cy - side / 2, side };
    }

    /** Измерить голову по точкам и обновить фильтр. */
    measure(slot, lm, nowMs) {
        const ears = resolveHeadEars(lm, slot.cal, HEAD_MIN_VISIBILITY);
        if (!ears) return false;
        const span = Math.hypot(ears.R.x - ears.L.x, ears.R.y - ears.L.y);
        if (span < 2.5) return false;
        // После перерыва или скачка начинаем фильтр заново: тянуть шляпу через
        // экран от старого положения хуже, чем просто поставить её на место.
        if (slot.filter.has) {
            const pr = slot.filter.predict(nowMs);
            const jump = Math.hypot((ears.L.x + ears.R.x) / 2 - pr.cx, (ears.L.y + ears.R.y) / 2 - pr.cy);
            if (nowMs - slot.lastMeasMs > FILTER_RESET_GAP_MS || jump > FILTER_RESET_JUMP * Math.max(span, pr.span)) {
                slot.filter.reset();
            }
        }
        slot.filter.update(ears.L, ears.R, nowMs);
        slot.source = ears.source;
        slot.lastMeasMs = nowMs;
        const box = personBox(lm);
        slot.box = box;
        slot.hint = { x: (ears.L.x + ears.R.x) / 2, y: (ears.L.y + ears.R.y) / 2, personH: box.h, tMs: nowMs };
        return true;
    }

    followCrop(slot, lm) {
        const box = personBox(lm);
        const want = cropForBox(box, this.srcW, this.srcH);
        const cur = slot.crop;
        const curCx = cur.x + cur.side / 2;
        const curCy = cur.y + cur.side / 2;
        const off = Math.hypot(box.cx - curCx, box.cy - curCy) / cur.side;
        const ratio = want.side / cur.side;
        if (off < CROP_DEADZONE_CENTER && ratio < CROP_DEADZONE_SCALE && ratio > 1 / CROP_DEADZONE_SCALE) return;
        const side = cur.side + (want.side - cur.side) * CROP_EASE;
        const cx = curCx + (box.cx - curCx) * CROP_EASE;
        const cy = curCy + (box.cy - curCy) * CROP_EASE;
        slot.crop = { x: cx - side / 2, y: cy - side / 2, side };
    }

    /** Два слежения не должны сидеть на одном человеке: оставляем то, что ведёт дольше. */
    dropDuplicates() {
        if (this.slots.length < 2) return;
        const [a, b] = this.slots;
        if (!a.crop || !b.crop || !a.filter.has || !b.filter.has) return;
        const d = Math.hypot(a.filter.cx.x - b.filter.cx.x, a.filter.cy.x - b.filter.cy.x);
        if (d > 0.9 * Math.max(a.filter.span.x, b.filter.span.x)) return;
        const loser = a.streak >= b.streak ? b : a;
        loser.crop = null;
        loser.streak = 0;
        loser.filter.reset();
        loser.lastMeasMs = -Infinity;
        loser.hint = null;
        loser.box = null;
    }

    scoutOnce(source, freeSlots, nowMs) {
        if (this.regionIdx >= this.regions.length) {
            const hints = freeSlots.map((s) => s.hint).filter((h) => h && nowMs - h.tMs < HINT_TTL_MS);
            this.regions = buildSearchRegions(this.srcW, this.srcH, hints);
            this.regionIdx = 0;
        }
        const r = this.regions[this.regionIdx++];
        drawRegion(this.scoutCtx, source, this.srcW, this.srcH, r);
        let res = null;
        try {
            res = this.scout.detect(this.scoutCanvas);
        } catch (e) {
            console.warn('[HeadTracker] scout detect:', e);
        }
        const found = (res?.landmarks ?? [])
            .map((raw) => toFramePx(raw, r))
            .filter(plausiblePerson)
            // Если в плитку попало тело без головы, модель «дорисовывает» голову
            // внутри плитки с полной уверенностью (видно на стенде). Настоящая
            // голова у верхнего края плитки целиком видна в соседней плитке выше,
            // поэтому такие находки просто пропускаем.
            .filter((lm) => r.y <= 1 || lm[0].y - r.y > r.side * SCOUT_TOP_GUARD);
        if (!found.length) return;

        let assigned = false;
        const taken = this.slots.filter((s) => s.crop);
        for (const lm of found) {
            const box = personBox(lm);
            const head = { x: (lm[7].x + lm[8].x) / 2, y: (lm[7].y + lm[8].y) / 2 };
            // Это тот, кого уже ведут? Сравниваем и с головой, и с рамкой тела:
            // по рамке отсекаются находки, собранные из чужого туловища.
            const dup = taken.some((s) => {
                if (s.filter.has && Math.hypot(s.filter.cx.x - head.x, s.filter.cy.x - head.y) < Math.max(box.shW, s.filter.span.x * 1.5)) {
                    return true;
                }
                const b = s.box;
                return !!b && head.x > b.x0 && head.x < b.x1 && head.y > b.y0 && head.y < b.y1;
            });
            if (dup) continue;
            const free = this.slots.filter((s) => !s.crop);
            if (!free.length) break;
            // Потерянному игроку возвращаем его же слот: за слотом закреплена надетая шляпа.
            let slot = free[0];
            let best = Infinity;
            for (const s of free) {
                if (!s.hint) continue;
                const d = Math.hypot(s.hint.x - head.x, s.hint.y - head.y);
                if (d < best) {
                    best = d;
                    slot = s;
                }
            }
            // Разведчик только указывает место. Голову отдаём игре после того,
            // как её подтвердит слежение на увеличенном вырезе — это следующий
            // кадр, зато случайная находка не успевает показать шляпу в воздухе.
            slot.crop = cropForBox(box, this.srcW, this.srcH);
            slot.box = box;
            slot.miss = 0;
            slot.streak = 0;
            taken.push(slot);
            assigned = true;
        }
        // Кого-то пристроили — следующий поиск начинаем заново с подсказок.
        // Если же все найденные уже ведутся, идём дальше по списку: иначе поиск
        // вечно возвращался бы к первым плиткам и не доходил до второго игрока.
        if (assigned) {
            this.regions = [];
            this.regionIdx = 0;
        }
    }

    /**
     * Линии ушей игроков на момент nowMs, в долях кадра (0..1).
     * @param {number} nowMs
     * @param {number} maxStaleMs сколько держать голову без новых измерений
     * @returns {Array<{key:string, lx:number, ly:number, rx:number, ry:number, staleMs:number, source:string}>}
     */
    getHeads(nowMs, maxStaleMs = 700) {
        const out = [];
        if (!this.srcW) return out;
        for (const slot of this.slots) {
            const stale = nowMs - slot.lastMeasMs;
            if (!slot.filter.has || stale > maxStaleMs) continue;
            const p = slot.filter.predict(nowMs);
            const hx = (Math.cos(p.angle) * p.span) / 2;
            const hy = (Math.sin(p.angle) * p.span) / 2;
            out.push({
                key: slot.key,
                lx: (p.cx - hx) / this.srcW,
                ly: (p.cy - hy) / this.srcH,
                rx: (p.cx + hx) / this.srcW,
                ry: (p.cy + hy) / this.srcH,
                staleMs: stale,
                source: slot.source
            });
        }
        return out;
    }

    /** Для отладки и стенда: вырезы и состояние слотов. */
    debugState() {
        return this.slots.map((s) => ({ key: s.key, crop: s.crop && { ...s.crop }, miss: s.miss, streak: s.streak, source: s.source }));
    }
}
