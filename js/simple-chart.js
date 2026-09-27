/**
 * SimpleChart — лёгкий и быстрый класс для отрисовки "живых" графиков
 * на canvas, без внешних зависимостей.
 *
 * Ключевые свойства:
 *  - Данные хранятся внутри класса (кольцевой буфер на Float64Array),
 *    наружу торчит только push() — старые точки вытесняются сами.
 *  - Поддержка нескольких измерений (серий) в одном графике.
 *  - Режим отрисовки: 'line' (только линия) или 'fill' (линия + заливка вниз).
 *  - min/max можно зафиксировать явно, а можно оставить авто-подстройку
 *    под текущее окно данных.
 *  - 3 состояния палитры: 'normal' | 'warning' | 'critical'.
 *    setState() мгновенно перекрашивает весь график.
 *  - Рендер идёт через requestAnimationFrame — на графике можно вызывать
 *    push() хоть на каждый tick сокета, лишних перерисовок не будет.
 *
 * Пример использования:
 *
 *   import { SimpleChart } from './simple-chart.js';
 *
 *   const chart = new SimpleChart({
 *     container: document.getElementById('chart'),
 *     dimensions: 2,
 *     windowSize: 150,
 *     fillMode: 'fill',
 *     series: [
 *       { name: 'temp', color: '#4da3ff' },
 *       { name: 'load' },
 *     ],
 *   });
 *
 *   chart.push([23.4, 0.7]);       // одна точка на каждое измерение
 *   chart.setState('critical');    // сменить палитру целиком
 */

export class SimpleChart {
  static STATES = ['normal', 'warning', 'critical'];

  static DEFAULT_PALETTES = {
    normal: {
      background: '#ffffff',
      grid: 'rgba(0,0,0,0.07)',
      text: 'rgba(0,0,0,0.45)',
      series: ['#2e7d32', '#1565c0', '#f9a825', '#8e24aa', '#d84315'],
    },
    warning: {
      background: '#fffaf0',
      grid: 'rgba(230,126,0,0.10)',
      text: 'rgba(191,90,0,0.65)',
      series: ['#ef6c00', '#e65100', '#f57f17', '#bf360c', '#ff8f00'],
    },
    critical: {
      background: '#fff5f5',
      grid: 'rgba(198,40,40,0.10)',
      text: 'rgba(183,28,28,0.7)',
      series: ['#c62828', '#b71c1c', '#d32f2f', '#ad1457', '#e53935'],
    },
  };

  /**
   * @param {Object} options
   * @param {HTMLElement} options.container   Элемент, куда вставляется canvas.
   * @param {number}  [options.dimensions=1]   Кол-во измерений (серий).
   * @param {number}  [options.windowSize=100] Размер окна (сколько точек хранить).
   * @param {Array}   [options.series]         Настройки серий: [{name, color}, ...].
   * @param {'line'|'fill'} [options.fillMode='line']
   * @param {number}  [options.min]            Фиксированный минимум (иначе авто).
   * @param {number}  [options.max]            Фиксированный максимум (иначе авто).
   * @param {number}  [options.lineWidth=2]
   * @param {number}  [options.fillOpacity=0.18]
   * @param {Object}  [options.padding]        {top,right,bottom,left}
   * @param {Object}  [options.palettes]       Переопределение палитр по состояниям.
   * @param {'normal'|'warning'|'critical'} [options.state='normal']
   * @param {boolean} [options.autoResize=true]
   * @param {boolean} [options.grid=true]        Рисовать ли фоновую сетку.
   */
  constructor(options) {
    const {
      container,
      dimensions = 1,
      windowSize = 100,
      series = [],
      fillMode = 'line',
      min,
      max,
      lineWidth = 2,
      fillOpacity = 0.18,
      padding = { top: 5, right: 5, bottom: 5, left: 5 },
      palettes = {},
      state = 'normal',
      autoResize = true,
      grid = true,
    } = options || {};

    if (!container) throw new Error('SimpleChart: не передан container');
    if (!Number.isInteger(dimensions) || dimensions < 1) {
      throw new Error('SimpleChart: dimensions должно быть целым числом >= 1');
    }

    this.container = container;
    this.dimensions = dimensions;
    this.windowSize = Math.max(2, windowSize | 0);
    this.fillMode = fillMode;
    this.fixedMin = typeof min === 'number' ? min : null;
    this.fixedMax = typeof max === 'number' ? max : null;
    this.lineWidth = lineWidth;
    this.fillOpacity = fillOpacity;
    this.padding = padding;
    this.showGrid = !!grid;
    this.series = Array.from({ length: dimensions }, (_, i) => series[i] || {});
    this.state = SimpleChart.STATES.includes(state) ? state : 'normal';

    // объединяем дефолтные палитры с переданными пользователем
    this.palettes = {};
    for (const s of SimpleChart.STATES) {
      this.palettes[s] = {
        ...SimpleChart.DEFAULT_PALETTES[s],
        ...(palettes[s] || {}),
      };
    }

    // кольцевой буфер: по одному Float64Array на измерение
    this.buffers = Array.from(
      { length: dimensions },
      () => new Float64Array(this.windowSize).fill(NaN)
    );
    this.head = 0;  // куда будет записана следующая точка
    this.count = 0; // сколько точек реально накоплено (<= windowSize)

    this._buildDom();
    this._rafId = null;

    if (autoResize && typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._resizeCanvas());
      this._ro.observe(this.container);
    }
    this._resizeCanvas();
  }

  // ---------------------------------------------------------------------
  // Публичное API
  // ---------------------------------------------------------------------

  /**
   * Добавить новую точку.
   * @param {number|number[]} value  число (если dimensions=1) или массив
   *                                 чисел длиной dimensions.
   */
  push(value) {
    const values = Array.isArray(value) ? value : [value];
    if (values.length !== this.dimensions) {
      console.warn(
        `SimpleChart: push() получил ${values.length} значени(е/я), ` +
        `а измерений (dimensions) настроено ${this.dimensions}. ` +
        `Недостающие серии будут пустыми (NaN) в этой точке.`
      );
    }
    for (let i = 0; i < this.dimensions; i++) {
      const v = typeof values[i] === 'number' ? values[i] : NaN;
      this.buffers[i][this.head] = v;
    }
    this.head = (this.head + 1) % this.windowSize;
    this.count = Math.min(this.count + 1, this.windowSize);
    this._scheduleRender();
  }

  /** Сменить состояние палитры целиком: 'normal' | 'warning' | 'critical'. */
  setState(state) {
    if (!SimpleChart.STATES.includes(state)) {
      throw new Error(`SimpleChart: неизвестное состояние "${state}"`);
    }
    if (this.state === state) return;
    this.state = state;
    this._scheduleRender();
  }

  /** Текущее состояние палитры. */
  getState() {
    return this.state;
  }

  /** Включить/выключить фоновую сетку. */
  setGrid(visible) {
    this.showGrid = !!visible;
    this._scheduleRender();
  }

  /** Жёстко задать диапазон значений. Передайте null, чтобы вернуть авто-режим. */
  setRange(min, max) {
    this.fixedMin = typeof min === 'number' ? min : null;
    this.fixedMax = typeof max === 'number' ? max : null;
    this._scheduleRender();
  }

  /** Очистить все накопленные данные. */
  clear() {
    for (const buf of this.buffers) buf.fill(NaN);
    this.head = 0;
    this.count = 0;
    this._scheduleRender();
  }

  /** Отвязать canvas от DOM и остановить наблюдатели/анимацию. */
  destroy() {
    if (this._ro) this._ro.disconnect();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.canvas.remove();
  }

  // ---------------------------------------------------------------------
  // Внутреннее
  // ---------------------------------------------------------------------

  _buildDom() {
    // Контейнер обязан быть точкой отсчёта для абсолютного позиционирования,
    // иначе canvas будет позиционироваться относительно более дальнего предка.
    const pos = getComputedStyle(this.container).position;
    if (pos === 'static' || !pos) {
      this.container.style.position = 'relative';
    }
    // overflow:hidden — доп. страховка на случай долей пикселя при масштабировании
    //if (!this.container.style.overflow) {
    //  this.container.style.overflow = 'hidden';
    //}

    this.canvas = document.createElement('canvas');
    // position:absolute + inset:0 — ключевой момент: собственный (intrinsic)
    // размер canvas, заданный через атрибуты width/height в пикселях,
    // больше НЕ участвует в расчёте размера контейнера. Без этого высота
    // контейнера, зависящая от контента (auto), начинает расти вслед за
    // canvas, ResizeObserver это видит и снова увеличивает canvas —
    // получается бесконечный рост по диагонали.
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  _resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));

    // Если размер фактически не изменился — выходим. Это не столько
    // обязательное условие (после фикса выше цикла уже не будет), сколько
    // страховка от лишней работы при частых срабатываниях ResizeObserver.
    if (w === this.cssWidth && h === this.cssHeight) return;

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssWidth = w;
    this.cssHeight = h;
    this._render();
  }

  _scheduleRender() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._render();
    });
  }

  // Вернуть точки измерения i в хронологическом порядке (старые -> новые)
  _ordered(i) {
    const buf = this.buffers[i];
    const n = this.count;
    const out = new Float64Array(n);
    const start = (this.head - n + this.windowSize) % this.windowSize;
    for (let k = 0; k < n; k++) out[k] = buf[(start + k) % this.windowSize];
    return out;
  }

  _computeRange() {
    if (this.fixedMin !== null && this.fixedMax !== null) {
      return { min: this.fixedMin, max: this.fixedMax };
    }
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < this.dimensions; i++) {
      const buf = this.buffers[i];
      for (let k = 0; k < this.count; k++) {
        const v = buf[k];
        if (Number.isNaN(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === Infinity) { min = 0; max = 1; }
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.08;
    return {
      min: this.fixedMin !== null ? this.fixedMin : min - pad,
      max: this.fixedMax !== null ? this.fixedMax : max + pad,
    };
  }

  _render() {
    const ctx = this.ctx;
    const w = this.cssWidth, h = this.cssHeight;
    const pal = this.palettes[this.state];
    const pad = this.padding;
    const x0 = pad.left, x1 = w - pad.right;
    const y0 = pad.top, y1 = h - pad.bottom;
    const plotW = Math.max(1, x1 - x0);
    const plotH = Math.max(1, y1 - y0);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = pal.background;
    ctx.fillRect(0, 0, w, h);

    if (this.count < 2) return;

    const { min, max } = this._computeRange();
    const range = (max - min) || 1;
    const toX = (idx) => x0 + (idx / (this.windowSize - 1)) * plotW;
    const toY = (v) => y1 - ((v - min) / range) * plotH;

    // сетка (отключается через options.grid = false / setGrid(false))
    if (this.showGrid) {
      ctx.strokeStyle = pal.grid;
      ctx.lineWidth = 1;
      const gridLines = 4;
      for (let g = 0; g <= gridLines; g++) {
        const y = y0 + (g / gridLines) * plotH;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
      }
    }

    // если точек меньше, чем windowSize — прижимаем их к правому краю
    const offset = this.windowSize - this.count;

    for (let i = 0; i < this.dimensions; i++) {
      const data = this._ordered(i);
      const color = (this.series[i] && this.series[i].color) || pal.series[i % pal.series.length];

      // Рисуем непрерывный отрезок данных [from..to] (без NaN внутри).
      // Линия и заливка — два отдельных path'а, каждый строится с нуля:
      // так заливка всегда корректна и не зависит от состояния пути после stroke().
      const drawSegment = (from, to) => {
        if (to - from < 1) return; // меньше двух точек — рисовать нечего

        ctx.beginPath();
        for (let k = from; k <= to; k++) {
          const x = toX(offset + k);
          const y = toY(data[k]);
          if (k === from) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = this.lineWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();

        if (this.fillMode === 'fill') {
          ctx.beginPath();
          ctx.moveTo(toX(offset + from), y1);
          for (let k = from; k <= to; k++) {
            ctx.lineTo(toX(offset + k), toY(data[k]));
          }
          ctx.lineTo(toX(offset + to), y1);
          ctx.closePath();
          ctx.fillStyle = this._withAlpha(color, this.fillOpacity);
          ctx.fill();
        }
      };

      let segStart = -1;
      for (let k = 0; k < data.length; k++) {
        if (Number.isNaN(data[k])) {
          if (segStart !== -1) { drawSegment(segStart, k - 1); segStart = -1; }
          continue;
        }
        if (segStart === -1) segStart = k;
      }
      if (segStart !== -1) drawSegment(segStart, data.length - 1);
    }
  }

  // hex/rgb -> rgba(...) с нужной прозрачностью, для заливки
  _withAlpha(color, alpha) {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
      const bigint = parseInt(full, 16);
      const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
      return `rgba(${r},${g},${b},${alpha})`;
    }
    if (color.startsWith('rgb')) {
      const nums = color.match(/[\d.]+/g).slice(0, 3);
      return `rgba(${nums[0]},${nums[1]},${nums[2]},${alpha})`;
    }
    return color;
  }
}
