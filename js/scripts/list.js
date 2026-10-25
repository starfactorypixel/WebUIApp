// Таблица скриптов в ESP: ID, размер, галочка «включён».
// Клик по строке → onOpen(id), клик по галочке → onEnable(id, on). Галочку ставит только ответ ESP (Show/SetFlags).

import { Int2Hex } from '../utils/format.js';
import { FLAG_LOADED, FLAG_ENABLED } from './ops.js';

export class ScriptList
{
	#body;
	#info;
	#onOpen;
	#onEnable;
	#scripts = new Map();	// id -> { id, length, flags }
	#current = null;		// подсвеченный id
	#busy = false;

	/**
	 * @param {HTMLElement} body      tbody таблицы
	 * @param {HTMLElement} info      строка сводки «N скриптов, M байт»
	 * @param {Function}    onOpen    (id) => void
	 * @param {Function}    onEnable  (id, on) => void
	 */
	constructor(body, info, { onOpen, onEnable })
	{
		this.#body = body;
		this.#info = info;
		this.#onOpen = onOpen;
		this.#onEnable = onEnable;
	}

	Has(id) { return this.#scripts.has(id); }

	// Новый список из ответа ESP
	Show(scripts)
	{
		this.#scripts = new Map(scripts.map(s => [s.id, s]));
		this.#render();
	}

	// Новые флаги одного скрипта (ответ на ENABLE)
	SetFlags(id, flags)
	{
		const s = this.#scripts.get(id);
		if(!s) return;
		s.flags = flags;
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
		const loaded = (s.flags & FLAG_LOADED) !== 0;

		const tr = document.createElement('tr');
		tr.dataset.id = s.id;
		tr.classList.toggle('is-off', !on);
		tr.classList.toggle('is-unloaded', !loaded);
		tr.title = loaded ? 'Открыть в редакторе' : 'Не загружен в память ESP (ошибка CRC или нет места). Открыть в редакторе';
		tr.innerHTML = `<td>${Int2Hex(s.id, 3)}</td><td>${s.length}</td><td><input type="checkbox" title="Включён"></td>`;

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
