/**
 * Система вкладок.
 *
 * new Tabs(rootElement, { active: 0, onClose(e){}, onOpen(e){} })
 *
 * Генерирует на rootElement события:
 *   "tab:close" — закрытие старой вкладки
 *   "tab:open"  — открытие новой вкладки
 * event.detail = { panel, button, index, title, tabs }
 *   panel — DOM-контейнер вкладки (ищите в нём элементы: panel.querySelectorAll(...))
 */

export class Tabs {
  constructor(root, options = {}) {
    this.root = typeof root === 'string' ? document.querySelector(root) : root;
    this.options = options;
    this.current = -1;
 
    // Собираем панели (прямые потомки с data-tab-title)
    this.panels = [...this.root.querySelectorAll(':scope > [data-tab-title]')];
 
    // Шапка с кнопками
    this.header = document.createElement('div');
    this.header.className = 'tabs__header';
    this.header.setAttribute('role', 'tablist');
 
    this.buttons = this.panels.map((panel, i) => {
      panel.classList.add('tabs__panel');
      panel.setAttribute('role', 'tabpanel');
      panel.hidden = true;
 
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tabs__btn';
      btn.textContent = panel.dataset.tabTitle;
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => this.open(i));
      this.header.appendChild(btn);
      return btn;
    });
 
    this.root.prepend(this.header);
 
    // Подписка на колбэки из опций (по желанию)
    if(options.onClose) this.root.addEventListener('tab:close', options.onClose);
    if(options.onOpen)  this.root.addEventListener('tab:open',  options.onOpen);
 
    this.open(options.active ?? 0);
  }
 
  _detail(i) {
    return {
      panel: this.panels[i],
      button: this.buttons[i],
      index: i,
      title: this.panels[i].dataset.tabTitle,
      tabs: this
    };
  }
 
  _emit(name, i) {
    this.root.dispatchEvent(new CustomEvent(name, { detail: this._detail(i) }));
  }
 
  /** Открыть вкладку по индексу */
  open(i) {
    if(i === this.current || i < 0 || i >= this.panels.length) return;
 
    // 1. Закрытие старой
    if(this.current !== -1) {
      const old = this.current;
      this._emit('tab:close', old);
      this.panels[old].hidden = true;
      this.buttons[old].classList.remove('active');
      this.buttons[old].setAttribute('aria-selected', 'false');
    }
 
    // 2. Открытие новой
    this.current = i;
    this.panels[i].hidden = false;
    this.buttons[i].classList.add('active');
    this.buttons[i].setAttribute('aria-selected', 'true');
    this._emit('tab:open', i);
  }
 
  /** Открыть вкладку по названию */
  openByTitle(title) {
    const i = this.panels.findIndex(p => p.dataset.tabTitle === title);
    if(i !== -1) this.open(i);
  }
 
  get activePanel() { return this.panels[this.current]; }
}
