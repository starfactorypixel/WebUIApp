// Control — состояние управляемых obj для кнопки, радио и ползунка.
//
// Что хранит:
//   values  — Map: obj → последнее значение (нет записи = ещё не знаем)
//   waiting — Set: obj, от которых ждём ответ на команду
//   target  — значение, отправленное командой SET (для TOGGLE/ACTION — null)
//   failed  — obj, не подтвердившие последнюю команду
//
// Как работает команда:
//   1. send() отправляет её во все obj и запускает таймер.
//   2. Каждый ответ 0x65 убирает obj из waiting. Для SET ответ должен быть равен target,
//      иначе obj попадает в failed.
//   3. По таймеру все, кто так и не ответил, тоже попадают в failed.
//   failed очищается при следующей команде. Повтора нет — решает пользователь.

import { readNumberFromArray, writeNumberToArray } from '../parse.js';
import { WSSendRaw } from '../ws.js';

const FID_SET    = 0x01;
const FID_TOGGLE = 0x02;
const FID_ACTION = 0x03;
const FID_STATE  = 0x65; // ответ устройства: текущее состояние

export class Control
{
	static timeout = 2000; // мс, общий таймаут; у виджета можно задать config.timeout

	constructor(ids, config, onChange)
	{
		this.ids = ids;
		this.type = config.type || 'uint8';
		this.timeout = config.timeout ?? Control.timeout;
		this.onChange = onChange; // вызывается при любом изменении — виджет перерисовывается

		this.values = new Map();
		this.waiting = new Set();
		this.target = null;
		this.failed = [];
		this.timer = null;
	}

	// ---- Входящие пакеты -------------------------------------------

	onPacket(id, data)
	{
		const fId = readNumberFromArray(data, 0, 'uint8');
		const value = readNumberFromArray(data, 1, this.type);
		if(value === null) return; // короткий пакет

		this.values.set(id, value);

		if(fId === FID_STATE && this.waiting.has(id))
		{
			this.waiting.delete(id);
			if(this.target !== null && value !== this.target) this.failed.push(id);
			if(this.waiting.size === 0) clearTimeout(this.timer);
		}

		this.onChange();
	}

	// ---- Команды ---------------------------------------------------

	set(value)
	{
		if(this.type === 'float32') value = Math.fround(value); // чтобы сравнение с ответом совпало
		this.send([FID_SET, ...writeNumberToArray(value, this.type)], value);
	}

	toggle() { this.send([FID_TOGGLE]); }
	action() { this.send([FID_ACTION]); }

	send(bytes, target = null)
	{
		if(this.busy) return; // ещё ждём ответ на прошлую команду

		this.target = target;
		this.failed = [];
		for(const id of this.ids)
		{
			if(WSSendRaw(0x15, id, bytes)) this.waiting.add(id);
			else this.failed.push(id); // нет связи — не ушло
		}

		clearTimeout(this.timer);
		this.timer = setTimeout(() =>
		{
			this.failed.push(...this.waiting); // не ответили вовремя
			this.waiting.clear();
			this.onChange();
		}, this.timeout);

		this.onChange();
	}

	// ---- Для отображения -------------------------------------------

	get busy() { return this.waiting.size > 0; }

	// true — obj сообщили разные значения
	get mixed() { return new Set(this.values.values()).size > 1; }

	// Общее значение всех obj; null — если кто-то ещё не ответил или значения разные
	get value()
	{
		if(this.values.size < this.ids.length || this.mixed) return null;
		return this.values.values().next().value;
	}

	// CSS-классы состояния на <ui-element> + подсказка, кто не подтвердил
	showState(element)
	{
		element.classList.toggle('is-pending', this.busy);
		element.classList.toggle('is-mixed', this.mixed);
		element.classList.toggle('is-failed', this.failed.length > 0);

		const hex = id => '0x' + id.toString(16).toUpperCase().padStart(4, '0');
		element.title = this.failed.length ? 'Не подтвердили: ' + this.failed.map(hex).join(', ') : '';
	}

	destroy()
	{
		clearTimeout(this.timer);
		this.onChange = () => {};
	}
}
