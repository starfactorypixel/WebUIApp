// Control — состояние управляемых obj для кнопки, радио и ползунка.
//
// Что хранит:
//   values  — Map: obj → последнее значение (нет записи = ещё не знаем)
//   waiting — Set: obj, от которых ждём ответ на команду
//   answers — Map: obj → что он ответил на последнюю команду
//   target  — значение, отправленное командой SET (для TOGGLE/ACTION — null)
//   failed  — obj, не подтвердившие последнюю команду
//
// Как работает команда:
//   1. send() отправляет её во все obj одним WS-сообщением (сервер — одним пакетом L3) и запускает таймер.
//   2. Каждый ответ 0x65 убирает obj из waiting. Для SET ответ должен быть равен target,
//      иначе obj попадает в failed.
//   3. Ответили все или сработал таймер → finish(): кто не ответил — в failed,
//      и если что-то не так, одна строка в лог с фактическими ответами каждого obj.
//   failed очищается при следующей команде. Повтора нет — решает пользователь.
//
// Что считается «не так» (пишется в лог):
//   - obj не ответил за timeout или команда не ушла (нет связи);
//   - на SET obj ответил другим значением;
//   - у группы obj ответы разные (например, TOGGLE развёл их в разные состояния).

import { readNumberFromArray, writeNumberToArray } from '../utils/parse.js';
import { WSSendCanMsgBatch } from '../utils/ws.js';
import { log } from '../utils/loghtml.js';

const FID_SET    = 0x01;
const FID_TOGGLE = 0x02;
const FID_ACTION = 0x03;
const FID_STATE  = 0x65; // ответ устройства: текущее состояние

const hex = id => '0x' + id.toString(16).toUpperCase().padStart(4, '0');

export class Control
{
	static timeout = 1100; // мс, общий таймаут; у виджета можно задать config.timeout

	constructor(ids, config, onChange)
	{
		this.ids = ids;
		this.name = config.name || hex(ids[0]); // для лога
		this.type = config.type || 'uint8';
		this.timeout = config.timeout ?? Control.timeout;
		this.debug = !!config.debug; // "debug": true — отправленные пакеты в лог (принятые пишет виджет)
		this.onChange = onChange; // вызывается при любом изменении — виджет перерисовывается

		this.values = new Map();
		this.waiting = new Set();
		this.answers = new Map();
		this.notSent = new Set();
		this.command = '';
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
			this.answers.set(id, value);
			if(this.target !== null && value !== this.target) this.failed.push(id);
			if(this.waiting.size === 0) this.finish(); // ответили все
		}

		this.onChange();
	}

	// ---- Команды ---------------------------------------------------

	set(value)
	{
		if(this.type === 'float32') value = Math.fround(value); // чтобы сравнение с ответом совпало
		this.send('SET ' + value, [FID_SET, ...writeNumberToArray(value, this.type)], value);
	}

	toggle() { this.send('TOGGLE', [FID_TOGGLE]); }
	action() { this.send('ACTION', [FID_ACTION]); }

	send(command, bytes, target = null)
	{
		if(this.busy) return; // ещё ждём ответ на прошлую команду

		this.command = command;
		this.target = target;
		this.failed = [];
		this.answers.clear();
		this.notSent.clear();

		// Всем obj одним WS-сообщением — сервер упакует в минимум пакетов L3
		const msgs = this.ids.map(id => ({ id, bytes }));
		if(WSSendCanMsgBatch(msgs))
		{
			if(this.debug) for(const m of msgs) log.packet(this.name, '→', m.id, m.bytes);
			for(const id of this.ids) this.waiting.add(id);
		}
		else
		{
			for(const id of this.ids) { this.failed.push(id); this.notSent.add(id); } // нет связи — не ушло
		}

		if(this.waiting.size === 0) this.finish(); // не ушло никуда — ждать нечего
		else this.timer = setTimeout(() => { this.finish(); this.onChange(); }, this.timeout);

		this.onChange();
	}

	// Команда завершена: ответили все или вышло время
	finish()
	{
		clearTimeout(this.timer);
		this.failed.push(...this.waiting); // не ответили вовремя
		this.waiting.clear();

		const different = new Set(this.answers.values()).size > 1;
		if(this.failed.length > 0 || different) this.report();
	}

	// Строка в лог: что фактически ответил каждый obj
	report()
	{
		const parts = this.ids.map(id =>
		{
			if(this.answers.has(id)) return `${hex(id)}=${this.answers.get(id)}`;
			if(this.notSent.has(id)) return `${hex(id)}=не отправлено`;
			return `${hex(id)}=нет ответа`;
		});
		log.warn(`[${this.name}] ${this.command}: ${parts.join(', ')}`);
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
		element.title = this.failed.length ? 'Не подтвердили: ' + this.failed.map(hex).join(', ') : '';
	}

	destroy()
	{
		clearTimeout(this.timer);
		this.onChange = () => {};
	}
}
