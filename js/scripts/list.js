// Таблица скриптов, загруженных в память ESP (то, что исполняется): ID, размер, состояние, галочка «включён».
// reload_needed — флеш-память изменена, а в памяти ещё старое: показать подсказку про перезагрузку.
// Клик по строке → onOpen(id), клик по галочке → onEnable(id, on). Галочку ставит только ответ ESP (Show/Update).
//
// Колонки: ID | Размер | Состояние | ☑
//   - flags (галочка) — intent пользователя: «хочу, чтобы скрипт был включён». Survives RELOAD через disabled[].
//   - state — фактическое состояние в runtime (STATE_*). Если галочка стоит, а state ≠ ENABLED — авто-отключение
//     (зацикливание / нет оператора); пользователь видит это в колонке «Состояние» и в tooltip строки.

import { Int2Hex } from '../utils/format.js';
import { FLAG_ENABLED, STATE } from './ops.js';

// state → { text (короткий), cls (css-класс цвета), title (полное пояснение для tooltip) }
const STATE_VIEW =
{
	[STATE.DISABLED_UNKOP]: { text: 'Нет оп', cls: 'is-bad',  title: 'Скрипт отключён ESP: отсутствует оператор' },
	[STATE.DISABLED_LOOP]:  { text: 'Цикл',   cls: 'is-warn', title: 'Скрипт отключён ESP: обнаружено зацикливание' },
	[STATE.DISABLED]:       { text: 'Выкл',   cls: 'is-off',  title: 'Скрипт отключён пользователем' },
	[STATE.NONE]:           { text: '—',      cls: 'is-none', title: 'Состояние неизвестно' },
	[STATE.ENABLED]:        { text: 'Вкл',    cls: 'is-on',   title: 'Скрипт включён и исполняется' },
};

function stateView(state)
{
	return STATE_VIEW[state] ?? STATE_VIEW[0];
}

export class ScriptList
{
	#body;
	#info;
	#reload;
	#onOpen;
	#onEnable;
	#scripts = new Map();	// id -> { id, length, flags, state }
	#current = null;		// подсвеченный id
	#busy = false;

	/**
	 * @param {HTMLElement} body      tbody таблицы
	 * @param {HTMLElement} info      строка сводки «N скриптов, M байт»
	 * @param {HTMLElement} reload    подсказка «нужна перезагрузка скриптов»
	 * @param {Function}    onOpen    (id) => void
	 * @param {Function}    onEnable  (id, on) => void
	 */
	constructor(body, info, reload, { onOpen, onEnable })
	{
		this.#body = body;
		this.#info = info;
		this.#reload = reload;
		this.#onOpen = onOpen;
		this.#onEnable = onEnable;
	}

	Has(id) { return this.#scripts.has(id); }

	// Новый список из ответа ESP
	Show(scripts, reload_needed)
	{
		this.#scripts = new Map(scripts.map(s => [s.id, s]));
		this.#reload.hidden = !reload_needed;
		this.#render();
	}

	// Новые flags/state одного скрипта (ответ на ENABLE: галочка и фактическое состояние).
	Update(id, { flags, state })
	{
		const s = this.#scripts.get(id);
		if(!s) return;
		if(flags !== undefined) s.flags = flags;
		if(state  !== undefined) s.state  = state;
		this.#render();
	}

	// Подсветить строку (id в редакторе); null — снять
	Mark(id)
	{
		this.#current = id;
		for(const tr of this.#body.children) tr.classList.toggle('is-current', Number(tr.dataset.id) === id);
	}

	SetBusy(busy)
	{
		this.#busy = busy;
		for(const box of this.#body.querySelectorAll('input')) box.disabled = busy;
	}

	#render()
	{
		this.#body.innerHTML = '';
		for(const s of [...this.#scripts.values()].sort((a, b) => a.id - b.id)) this.#body.appendChild(this.#row(s));

		const total = [...this.#scripts.values()].reduce((sum, s) => sum + s.length, 0);
		this.#info.textContent = `${this.#scripts.size} скриптов, ${total} байт`;
		this.Mark(this.#current);
	}

	#row(s)
	{
		const on = (s.flags & FLAG_ENABLED) !== 0;
		const sv = stateView(s.state);

		// Tooltip строки: краткое состояние + размер. Если галочка стоит, но state не ENABLED — добавим пояснение.
		let title = `${sv.title} · ${s.length} байт`;
		if(on && sv.cls !== 'is-on' && sv.cls !== 'is-none') title += ` · галочка стоит, но скрипт не исполняется`;

		const tr = document.createElement('tr');
		tr.dataset.id = s.id;
		tr.classList.toggle('is-off', !on);
		tr.title = title;
		tr.innerHTML =
			`<td>${Int2Hex(s.id, 3)}</td>` +
			`<td>${s.length}</td>` +
			`<td class="state ${sv.cls}" title="${sv.title}">${sv.text}</td>` +
			`<td><input type="checkbox" title="Включён"></td>`;

		const box = tr.querySelector('input');
		box.checked = on;
		box.disabled = this.#busy;
		box.addEventListener('click', (e) =>
		{
			e.preventDefault();		// галочку ставит только ответ ESP
			e.stopPropagation();	// не открывать скрипт
			this.#onEnable(s.id, !on);
		});

		tr.addEventListener('click', () => this.#onOpen(s.id));
		return tr;
	}
}
