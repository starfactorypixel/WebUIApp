// ObjGroup — состояние управляемого объекта (или группы объектов) с ожиданием ответа.
//
// Виджет (кнопка, радио…) не решает сам, что считать подтверждением: он
// отдаёт сюда все пакеты своих obj (handle) и команды (set/toggle/action),
// а отрисовывает готовое состояние (state) в колбэке onChange.
//
// Протокол (первый байт пакета — всегда fId):
//   команды:  0x01 [value] SET, 0x02 TOGGLE, 0x03 ACTION
//   ответы:   0x65 [value] — текущее (новое) состояние; приходит на любую
//             команду и на подписку
//             0x61/0x62/0x63 [value] — периодическая отправка (индикаторы)
//             0xE6 — ошибка объекта
//
// Состояние, которое видит виджет (state.status):
//   unknown — ни один obj ещё не сообщил значение
//   ok      — все obj сообщили одинаковое значение
//   partial — сообщили не все, но сообщившие согласны
//   mixed   — значения у obj разные
// Плюс независимые признаки:
//   state.pending — команда отправлена, ждём 0x65 от всех obj
//   state.error   — по последней команде не ответили (missing) или ответили
//                   не тем / ошибкой (wrong). Повтора нет — решает пользователь.
//                   Сбрасывается следующей командой или поздним правильным ответом.

import { readNumberFromArray, writeNumberToArray } from '../parse.js';
import { WSSendRaw } from '../ws.js';

export const FID = {
	SET: 0x01,
	TOGGLE: 0x02,
	ACTION: 0x03,
	TIMER_NORMAL: 0x61,
	TIMER_WARNING: 0x62,
	TIMER_CRITICAL: 0x63,
	STATE: 0x65,
	ERROR: 0xE6,
};

const CMD_PACKET_TYPE = 0x15;

export class ObjGroup
{
	/** Таймаут ожидания ответа по умолчанию, мс. Переопределяется в app-client.js или config.timeout. */
	static defaultTimeout = 2000;

	#ids;
	#type;
	#timeout;
	#onChange;
	#facts = new Map(); // id -> { value, fId } | null
	#pending = null;    // { target, expect, waiting:Set, wrong:Set, timer }
	#error = null;      // { expect, missing:Set, wrong:Set }

	/**
	 * @param {number[]} ids
	 * @param {Object}   opts
	 * @param {string}   [opts.type='uint8']   тип значения в пакете (байт 1+)
	 * @param {number}   [opts.timeout]        мс ожидания ответа
	 * @param {Function} [opts.onChange]       (state) => void
	 */
	constructor(ids, { type = 'uint8', timeout, onChange } = {})
	{
		this.#ids = [...ids];
		this.#type = type;
		this.#timeout = timeout ?? ObjGroup.defaultTimeout;
		this.#onChange = onChange ?? null;
		for (const id of this.#ids) this.#facts.set(id, null);
	}

	get ids() { return this.#ids; }

	/** Пакет от одного из obj группы. */
	handle(id, data)
	{
		if(!this.#facts.has(id)) return;

		const fId = readNumberFromArray(data, 0, 'uint8');
		if(fId === null) return;

		if(fId === FID.ERROR)
		{
			this.#onResponse(id, null, false);
			this.#changed();
			return;
		}

		const value = readNumberFromArray(data, 1, this.#type);
		if(value === null) return; // короткий пакет

		this.#facts.set(id, { value, fId });
		if(fId === FID.STATE) this.#onResponse(id, value, true);
		this.#changed();
	}

	/** SET конкретного значения во все obj. Ответ должен совпасть со значением. */
	set(value)
	{
		const target = this.#type === 'float32' ? Math.fround(value) : value;
		const payload = writeNumberToArray(value, this.#type);
		return this.#send(() => [FID.SET, ...payload], v => v === target, target);
	}

	/** TOGGLE во все obj. Устройство решает само, подтверждением считается любой 0x65. */
	toggle()
	{
		return this.#send(() => [FID.TOGGLE], null, null);
	}

	/** ACTION во все obj. Подтверждением считается любой 0x65. */
	action()
	{
		return this.#send(() => [FID.ACTION], null, null);
	}

	get state()
	{
		const known = [];
		const counts = new Map(); // value -> сколько obj его сообщили
		for (const id of this.#ids)
		{
			const f = this.#facts.get(id);
			if(!f) continue;
			known.push(f.value);
			counts.set(f.value, (counts.get(f.value) ?? 0) + 1);
		}

		let status;
		if(known.length === 0) status = 'unknown';
		else if(counts.size > 1) status = 'mixed';
		else if(known.length < this.#ids.length) status = 'partial';
		else status = 'ok';

		const p = this.#pending;
		const e = this.#error;
		return {
			status,
			value: counts.size === 1 ? known[0] : null, // общее значение, если оно одно
			counts,
			known: known.length,
			total: this.#ids.length,
			pending: p ? { target: p.target, waiting: [...p.waiting] } : null,
			error: e ? { missing: [...e.missing], wrong: [...e.wrong] } : null,
		};
	}

	destroy()
	{
		if(this.#pending) clearTimeout(this.#pending.timer);
		this.#pending = null;
		this.#onChange = null;
	}

	// ---------------------------------------------------------------

	#send(bytesFor, expect, target)
	{
		if(this.#pending) return false; // ждём ответ на предыдущую команду

		this.#error = null;
		const p = { target, expect, waiting: new Set(), wrong: new Set(), timer: null };
		const notSent = new Set();

		for (const id of this.#ids)
		{
			if(WSSendRaw(CMD_PACKET_TYPE, id, bytesFor(id))) p.waiting.add(id);
			else notSent.add(id);
		}

		if(p.waiting.size === 0)
		{
			// Ничего не ушло (нет связи) — сразу ошибка.
			this.#error = { expect, missing: notSent, wrong: new Set() };
			this.#changed();
			return false;
		}

		p.notSent = notSent;
		p.timer = setTimeout(() => this.#finish(), this.#timeout);
		this.#pending = p;
		this.#changed();
		return true;
	}

	#onResponse(id, value, ok)
	{
		const p = this.#pending;
		if(p && p.waiting.has(id))
		{
			p.waiting.delete(id);
			if(!ok || (p.expect && !p.expect(value))) p.wrong.add(id);
			if(p.waiting.size === 0) this.#finish();
			return;
		}

		// Поздний ответ после таймаута: если он правильный — ошибку по этому obj снимаем.
		const e = this.#error;
		if(!p && e && (e.missing.has(id) || e.wrong.has(id)))
		{
			e.missing.delete(id);
			if(!ok || (e.expect && !e.expect(value))) e.wrong.add(id);
			else e.wrong.delete(id);
			if(e.missing.size === 0 && e.wrong.size === 0) this.#error = null;
		}
	}

	#finish()
	{
		const p = this.#pending;
		if(!p) return;
		clearTimeout(p.timer);
		this.#pending = null;

		const missing = new Set([...p.waiting, ...p.notSent]);
		if(missing.size > 0 || p.wrong.size > 0)
			this.#error = { expect: p.expect, missing, wrong: p.wrong };

		this.#changed();
	}

	#changed()
	{
		if(this.#onChange) this.#onChange(this.state);
	}
}

/** Классы состояния на корневом элементе виджета + подсказка с деталями ошибки. */
export function applyGroupState(element, state)
{
	const cl = element.classList;
	cl.toggle('is-unknown', state.status === 'unknown');
	cl.toggle('is-partial', state.status === 'partial');
	cl.toggle('is-mixed', state.status === 'mixed');
	cl.toggle('is-pending', !!state.pending);
	cl.toggle('is-failed', !!state.error);

	const hex = id => '0x' + id.toString(16).toUpperCase().padStart(4, '0');
	const lines = [];
	if(state.error)
	{
		if(state.error.missing.length) lines.push('Нет ответа: ' + state.error.missing.map(hex).join(', '));
		if(state.error.wrong.length) lines.push('Ответ не совпал / ошибка: ' + state.error.wrong.map(hex).join(', '));
	}
	if(state.status === 'mixed') lines.push('Состояния объектов различаются');
	if(state.status === 'partial') lines.push(`Известно состояние ${state.known} из ${state.total}`);
	if(state.pending) lines.push('Ожидание ответа: ' + state.pending.waiting.map(hex).join(', '));

	if(lines.length) element.title = lines.join('\n');
	else element.removeAttribute('title');
}
