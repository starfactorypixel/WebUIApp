// Операции со скриптами ESP через сервер (SCRIPTS_PROTOCOL.md, раздел «Браузер ⇄ server.js»).
//
//   ScriptLoad {id}         ← ScriptLoadResp   {id, data}
//   ScriptSave {id, data}   ← ScriptSaveResp   {id}
//   ScriptDelete {id}       ← ScriptDeleteResp {id}
//   ScriptReload {}         ← ScriptReloadResp {count}
//   ScriptList {}           ← ScriptListResp   {scripts: [{id, length, flags}]}
//   ScriptEnable {id, on}   ← ScriptEnableResp {id, flags}
//   во время чтения/записи  ← ScriptProgress   {done, total}
// Ошибка — поле error в ответе (пишется в лог, onResult не вызывается).
//
// Одновременно — одна операция: следующая не отправится, пока нет ответа или OP_TIMEOUT_MS.

import { WSEvents, WSSend } from '../utils/ws.js';
import { log } from '../utils/loghtml.js';
import { Int2Hex } from '../utils/format.js';

const OP_TIMEOUT_MS = 15000;	// сервер сам ограничивает каждый шаг; это — страховка

export const FLAG_LOADED = 0x02;
export const FLAG_ENABLED = 0x04;

export class ScriptOps
{
	#pending = null;	// { cmd, timer }
	#onBusy;
	#onProgress;
	#onResult;

	/**
	 * @param {Function} onBusy      (busy) => void — операция началась / закончилась
	 * @param {Function} onProgress  (text) => void — ход чтения/записи
	 * @param {Function} onResult    (cmd, data) => void — успешный ответ, cmd — 'ScriptLoadResp' и т.д.
	 */
	constructor({ onBusy, onProgress, onResult })
	{
		this.#onBusy = onBusy;
		this.#onProgress = onProgress;
		this.#onResult = onResult;
		WSEvents.addEventListener('response', (e) => this.#response(e.detail));
	}

	get busy() { return this.#pending !== null; }

	Load(id)       { this.#start('ScriptLoad', { id }, `Чтение скрипта ${Int2Hex(id, 4)}…`); }
	Save(id, data) { this.#start('ScriptSave', { id, data }, `Запись скрипта ${Int2Hex(id, 4)}, ${data.length} байт…`); }
	Delete(id)     { this.#start('ScriptDelete', { id }, `Удаление скрипта ${Int2Hex(id, 4)}…`); }
	Reload()       { this.#start('ScriptReload', {}, 'Перезагрузка всех скриптов в ESP…'); }
	List()         { this.#start('ScriptList', {}, null); }
	Enable(id, on) { this.#start('ScriptEnable', { id, on }, `${on ? 'Включение' : 'Отключение'} скрипта ${Int2Hex(id, 4)}…`); }

	// Отправить команду и ждать ответа
	#start(cmd, data, message)
	{
		if(this.#pending) return;

		if(!WSSend({ cmd, data }))
		{
			log.warn('[Скрипты] Нет связи с сервером — не отправлено');
			return;
		}

		if(message) log.info('[Скрипты] ' + message);
		this.#pending = { cmd, timer: setTimeout(() => this.#timeout(), OP_TIMEOUT_MS) };
		this.#onBusy(true);
	}

	#finish()
	{
		clearTimeout(this.#pending.timer);
		this.#pending = null;
		this.#onBusy(false);
	}

	#timeout()
	{
		log.warn(`[Скрипты] Нет ответа сервера на ${this.#pending.cmd} за ${OP_TIMEOUT_MS / 1000} с`);
		this.#finish();
	}

	#response({ cmd, data })
	{
		if(!this.#pending) return;

		if(cmd === 'ScriptProgress')
		{
			this.#onProgress(`${this.#pending.cmd === 'ScriptSave' ? 'Запись' : 'Чтение'}: ${data.done} / ${data.total} байт`);
			return;
		}
		if(cmd !== this.#pending.cmd + 'Resp') return;

		this.#finish();

		const name = data.id !== undefined ? `Скрипт ${Int2Hex(data.id, 4)}` : 'Скрипты';
		if(data.error)
		{
			log.error(`[Скрипты] ${name}: ${data.error}`);
			return;
		}

		switch(cmd)
		{
			case 'ScriptLoadResp':   log.info(`[Скрипты] ${name} прочитан: ${data.data.length} байт`); break;
			case 'ScriptSaveResp':   log.info(`[Скрипты] ${name} записан`); break;
			case 'ScriptDeleteResp': log.info(`[Скрипты] ${name} удалён`); break;
			case 'ScriptReloadResp': log.info(`[Скрипты] ESP перечитал скрипты из флеш-памяти: загружено ${data.count}`); break;
			case 'ScriptEnableResp': log.info(`[Скрипты] ${name} ${data.flags & FLAG_ENABLED ? 'включён' : 'отключён'}`); break;
		}

		this.#onResult(cmd, data);
	}
}
