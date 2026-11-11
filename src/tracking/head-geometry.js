/**
 * Геометрия головы по точкам позы и фильтр её движения.
 * Чистые функции без DOM и MediaPipe — их можно проверять отдельно.
 *
 * Вся геометрия шляпы строится по линии ушей: её середина, длина и наклон.
 * Уши — самые ненадёжные точки головы (волосы, шапки, поворот), поэтому при их
 * отсутствии линию восстанавливаем по внешним уголкам глаз, а если не видно и
 * их — по плечам и носу. Пропорции у всех разные (у детей плечи узкие), так что
 * пока уши видны, коэффициенты подстраиваются под конкретного игрока, и переход
 * на запасной источник не меняет размер и положение шляпы скачком.
 */

/** Начальные коэффициенты: ширина ушей к ширине источника и смещение центра. */
export const HEAD_SOURCE_DEFAULTS = {
    // Межушное расстояние примерно в 1.55 раза шире внешних уголков глаз,
    // а центр ушей лежит чуть ниже линии глаз.
    eyes: { span: 1.55, off: 0.06 },
    // Межушное расстояние в 2.4 раза уже плеч (у детей ближе к 2.1).
    // Центр ушей: чуть выше носа, если он виден, иначе заметно выше плеч.
    shoulders: { span: 1 / 2.4, offNose: -0.12, offShoulders: -1.25 }
};

/** Анатомические пределы: наблюдение за ними — сбой модели, а не пропорции игрока. */
const HEAD_SOURCE_LIMITS = {
    eyesSpan: [1.2, 2.1],
    eyesOff: [-0.25, 0.35],
    shSpan: [1 / 3.4, 1 / 1.6],
    offNose: [-0.5, 0.25],
    offShoulders: [-2.0, -0.6]
};

/** Скорость подстройки коэффициентов за кадр. */
const HEAD_SOURCE_LEARN = 0.08;

export function newHeadCalibration() {
    return {
        eyes: { ...HEAD_SOURCE_DEFAULTS.eyes },
        shoulders: { ...HEAD_SOURCE_DEFAULTS.shoulders }
    };
}

function lmVisible(p, minVis) {
    return !!p && (p.visibility ?? 1) >= minVis;
}

function clampTo(v, [lo, hi]) {
    return Math.max(lo, Math.min(hi, v));
}

/**
 * Сдвигает коэффициент к наблюдению, но только если наблюдение правдоподобно.
 * Значение за пределами анатомических границ отбрасываем целиком, иначе один
 * кривой кадр уводил бы запасной размер головы на пятую часть.
 */
function learnToward(current, observed, limits) {
    if (!Number.isFinite(observed) || observed < limits[0] || observed > limits[1]) return current;
    return clampTo(current + (observed - current) * HEAD_SOURCE_LEARN, limits);
}

/** Единичная нормаль к отрезку A→B, направленная вниз по кадру (к подбородку). */
function downNormal(A, B) {
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    if (ny < 0) {
        nx = -nx;
        ny = -ny;
    }
    return { x: nx, y: ny };
}

/**
 * Строит пару «ушей» по лучшему доступному источнику.
 * Точки ожидаются в пикселях кадра (изотропных), с полем visibility.
 *
 * @param {Array<{x:number,y:number,visibility?:number}>} lm точки одного человека
 * @param {object} cal коэффициенты игрока, изменяются на месте
 * @param {number} minVis порог видимости точки
 * @returns {{L: {x:number,y:number}, R: {x:number,y:number}, source: string} | null}
 */
export function resolveHeadEars(lm, cal, minVis) {
    const ear7 = lm[7];
    const ear8 = lm[8];
    const eye3 = lm[3];
    const eye6 = lm[6];
    const sh11 = lm[11];
    const sh12 = lm[12];
    const nose = lm[0];

    const earsOk = lmVisible(ear7, minVis) && lmVisible(ear8, minVis);
    const eyesOk = lmVisible(eye3, minVis) && lmVisible(eye6, minVis);
    const shOk = lmVisible(sh11, minVis) && lmVisible(sh12, minVis);
    const noseOk = lmVisible(nose, minVis);

    if (earsOk) {
        const L = { x: ear7.x, y: ear7.y };
        const R = { x: ear8.x, y: ear8.y };
        const earSpan = Math.hypot(R.x - L.x, R.y - L.y);
        const earMid = { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2 };
        if (earSpan > 1) {
            if (eyesOk) {
                const span = Math.hypot(eye6.x - eye3.x, eye6.y - eye3.y);
                if (span > 1) {
                    const n = downNormal(eye3, eye6);
                    const mid = { x: (eye3.x + eye6.x) / 2, y: (eye3.y + eye6.y) / 2 };
                    const off = ((earMid.x - mid.x) * n.x + (earMid.y - mid.y) * n.y) / earSpan;
                    cal.eyes.span = learnToward(cal.eyes.span, earSpan / span, HEAD_SOURCE_LIMITS.eyesSpan);
                    cal.eyes.off = learnToward(cal.eyes.off, off, HEAD_SOURCE_LIMITS.eyesOff);
                }
            }
            if (shOk) {
                const span = Math.hypot(sh12.x - sh11.x, sh12.y - sh11.y);
                if (span > 1) {
                    const n = downNormal(sh11, sh12);
                    const shMid = { x: (sh11.x + sh12.x) / 2, y: (sh11.y + sh12.y) / 2 };
                    cal.shoulders.span = learnToward(cal.shoulders.span, earSpan / span, HEAD_SOURCE_LIMITS.shSpan);
                    const offSh = ((earMid.x - shMid.x) * n.x + (earMid.y - shMid.y) * n.y) / earSpan;
                    cal.shoulders.offShoulders = learnToward(
                        cal.shoulders.offShoulders,
                        offSh,
                        HEAD_SOURCE_LIMITS.offShoulders
                    );
                    if (noseOk) {
                        const offN = ((earMid.x - nose.x) * n.x + (earMid.y - nose.y) * n.y) / earSpan;
                        cal.shoulders.offNose = learnToward(cal.shoulders.offNose, offN, HEAD_SOURCE_LIMITS.offNose);
                    }
                }
            }
        }
        return { L, R, source: 'ears' };
    }

    /** Виртуальные уши: центр + половина ширины вдоль линии источника A→B. */
    const build = (A, B, center, earSpan, source) => {
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const h = earSpan / 2;
        return {
            L: { x: center.x - ux * h, y: center.y - uy * h },
            R: { x: center.x + ux * h, y: center.y + uy * h },
            source
        };
    };

    if (eyesOk) {
        const span = Math.hypot(eye6.x - eye3.x, eye6.y - eye3.y);
        if (span > 1) {
            const earSpan = span * cal.eyes.span;
            const n = downNormal(eye3, eye6);
            const mid = { x: (eye3.x + eye6.x) / 2, y: (eye3.y + eye6.y) / 2 };
            const c = { x: mid.x + n.x * cal.eyes.off * earSpan, y: mid.y + n.y * cal.eyes.off * earSpan };
            return build(eye3, eye6, c, earSpan, 'eyes');
        }
    }

    if (shOk) {
        const span = Math.hypot(sh12.x - sh11.x, sh12.y - sh11.y);
        if (span > 1) {
            const earSpan = span * cal.shoulders.span;
            const n = downNormal(sh11, sh12);
            let c;
            if (noseOk) {
                const o = cal.shoulders.offNose * earSpan;
                c = { x: nose.x + n.x * o, y: nose.y + n.y * o };
            } else {
                const mid = { x: (sh11.x + sh12.x) / 2, y: (sh11.y + sh12.y) / 2 };
                const o = cal.shoulders.offShoulders * earSpan;
                c = { x: mid.x + n.x * o, y: mid.y + n.y * o };
            }
            return build(sh11, sh12, c, earSpan, noseOk ? 'shoulders+nose' : 'shoulders');
        }
    }

    return null;
}

/**
 * Адаптивный фильтр «One Euro»: в покое режет дрожание сильно, а при движении
 * поднимает частоту среза и почти не отстаёт. Прежняя цепочка из трёх
 * экспоненциальных сглаживаний давала около 0.2 с отставания на любой скорости.
 */
export class OneEuro {
    /**
     * @param {number} minCutoff частота среза в покое, Гц — меньше значит плавнее
     * @param {number} beta насколько скорость поднимает срез
     * @param {number} dCutoff срез для оценки скорости, Гц
     */
    constructor(minCutoff, beta, dCutoff = 1.5) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.reset();
    }

    reset() {
        this.t = null;
        this.raw = 0;
        this.x = 0;
        /** Сглаженная скорость, единиц в секунду. */
        this.dx = 0;
    }

    static alpha(cutoffHz, dtSec) {
        const tau = 1 / (2 * Math.PI * cutoffHz);
        return 1 / (1 + tau / dtSec);
    }

    /**
     * @param {number} value измерение
     * @param {number} tMs время измерения
     * @param {number} scale масштаб скорости: скорость делится на него перед умножением на beta
     */
    filter(value, tMs, scale = 1) {
        if (this.t === null) {
            this.t = tMs;
            this.raw = value;
            this.x = value;
            this.dx = 0;
            return value;
        }
        const dt = Math.max(1e-3, (tMs - this.t) / 1000);
        this.t = tMs;
        const dRaw = (value - this.raw) / dt;
        this.raw = value;
        this.dx += (dRaw - this.dx) * OneEuro.alpha(this.dCutoff, dt);
        const cutoff = this.minCutoff + this.beta * (Math.abs(this.dx) / (scale || 1));
        this.x += (value - this.x) * OneEuro.alpha(cutoff, dt);
        return this.x;
    }
}

/**
 * Фильтр головы: центр, размер и наклон сглаживаются раздельно.
 * Центр должен поспевать за игроком, а размер и наклон меняются медленно —
 * их можно давить сильнее, иначе на дальней дистанции, где шум ушей составляет
 * заметную долю их расстояния, шляпа «дышала» бы размером.
 */
export class HeadFilter {
    constructor() {
        this.cx = new OneEuro(1.7, 0.9, 2.0);
        this.cy = new OneEuro(1.7, 0.9, 2.0);
        this.span = new OneEuro(0.7, 0.25, 1.0);
        this.angle = new OneEuro(1.0, 1.2, 1.0);
        this.has = false;
        this.tMs = 0;
    }

    reset() {
        this.cx.reset();
        this.cy.reset();
        this.span.reset();
        this.angle.reset();
        this.has = false;
    }

    /** Принимает измеренные «уши» в пикселях кадра. */
    update(L, R, tMs) {
        let dx = R.x - L.x;
        let dy = R.y - L.y;
        // Индекс 7 — анатомически левое ухо, на кадре оно справа. Берём линию
        // всегда слева направо, чтобы угол описывал только наклон головы.
        if (dx < 0) {
            dx = -dx;
            dy = -dy;
        }
        const span = Math.hypot(dx, dy);
        if (span < 1e-6) return;
        const scale = Math.max(1, this.has ? this.span.x : span);
        this.cx.filter((L.x + R.x) / 2, tMs, scale);
        this.cy.filter((L.y + R.y) / 2, tMs, scale);
        this.span.filter(span, tMs, scale);
        this.angle.filter(Math.atan2(dy, dx), tMs, 1);
        this.has = true;
        this.tMs = tMs;
    }

    /**
     * Состояние на момент tMs. Между кадрами камеры и на коротких пропусках
     * продолжаем движение по последней скорости, но не дольше maxLeadMs:
     * дальше прогноз вреднее, чем остановка.
     */
    predict(tMs, maxLeadMs = 110) {
        if (!this.has) return null;
        const lead = Math.max(0, Math.min(maxLeadMs, tMs - this.tMs)) / 1000;
        return {
            cx: this.cx.x + this.cx.dx * lead,
            cy: this.cy.x + this.cy.dx * lead,
            span: this.span.x,
            angle: this.angle.x,
            vx: this.cx.dx,
            vy: this.cy.dx
        };
    }
}
