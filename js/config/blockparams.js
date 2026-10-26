// Панель настроек выбранного блока.
//
//   const panel = new BlockParams(container, blocks_json, onClose);
//   panel.Open(info);   // info из BlockInfo: { baseID, hw_type, ... }
//   panel.Close();
//
// Что происходит при Open():
//   1. Описание параметров берётся из blocks.json по типу блока (hw_type) и рисуется список.
//   2. Подписка на obj настроек блока (baseID + blocks.json → offset).
//   3. Групповой запрос всех параметров одним WS-сообщением — сервер упакует в минимум пакетов L3.
//   При переподключении WS параметры читаются заново. Close() снимает подписку.
//
// Пакеты настроек (fId 0x37, obj настроек):
//   чтение  → [0x37, 0x01, id]          ответ ← [0x37, 0x01, id, value…]
//   запись  → [0x37, 0x02, id, value…]  ответ ← [0x37, 0x02, id, value…]
//   сохранить всё и перезагрузить → [0x37, 0x03]  ответ ← [0x37, 0x03]
//   ошибка                              ответ ← [0x37, 0x04, code]
// value — по type параметра, little-endian.
//
// Запрос без ответа за REQUEST_TIMEOUT_MS — поле разблокируется, строка помечается is-failed, запись в лог.

import { WSEvents, WSSendCanMsg, WSSendCanMsgBatch } from '../utils/ws.js';
import { subscribe } from '../client/subscriptions.js';
import { readNumberFromArray, writeNumberToArray } from '../utils/parse.js';
import { Int2Hex, escapeHtml } from '../utils/format.js';
import { log } from '../utils/loghtml.js';

const FID_CFG   = 0x37;
const CMD_READ  = 0x01;
const CMD_WRITE = 0x02;
const CMD_SAVE  = 0x03;
const CMD_ERROR = 0x04;

const REQUEST_TIMEOUT_MS = 1100;

export class BlockParams
{
	#container;
	#json;			// blocks.json целиком
	#onClose;
	#block = null;	// открытый блок: { info, type, cfgId, rows: Map(id -> row), unsubscribe }

	constructor(container, blocks_json, onClose = () => {})
	{
		this.#container = container;
		this.#json = blocks_json;
		this.#onClose = onClose;

		// Связь восстановилась — подписка уйдёт сама (subscriptions.js), читаем параметры заново
		WSEvents.addEventListener('open', () =>
		{
			if(this.#block) this.ReadAll();
		});
	}

	get baseID() { return this.#block ? this.#block.info.baseID : null; }

	Open(info)
	{
		this.Close();

		const type = this.#json.blocks.find(b => b.type === info.hw_type);
		const cfgId = info.baseID + this.#json.offset;
		const title = `${Int2Hex(info.baseID, 4)} · ${type ? type.name : 'тип ' + info.hw_type}`;

		this.#container.classList.add('panel');
		this.#container.innerHTML =
		`<div class="panel_head">
			<div>
				<div class="panel_title">${escapeHtml(title)}</div>
				<div class="panel_desc">${escapeHtml(type ? type.desc : '')} · obj настроек ${Int2Hex(cfgId, 4)}</div>
			</div>
			<div class="params_ctrl">
				<button data-cmd="read-all" title="Прочитать всё">📥 Прочитать всё</button>
				<button data-cmd="save" title="Сохранить все параметры в блоке и перезагрузить его">💾 Сохранить всё и перезагрузить</button>
				<button data-cmd="close" title="Закрыть">✕</button>
			</div>
		</div>
		<div class="params_list"></div>`;

		this.#container.querySelector('[data-cmd="read-all"]').addEventListener('click', () => this.ReadAll());
		this.#container.querySelector('[data-cmd="save"]').addEventListener('click', () => this.Save());
		this.#container.querySelector('[data-cmd="close"]').addEventListener('click', () => this.Close());

		const list = this.#container.querySelector('.params_list');
		const params = type ? type.params : [];
		if(params.length === 0)
		{
			list.innerHTML = `<div class="params_empty">Для этого типа блока нет параметров в blocks.json</div>`;
			this.#container.querySelector('[data-cmd="read-all"]').disabled = true;
			this.#container.querySelector('[data-cmd="save"]').disabled = true;
		}

		const rows = new Map();
		for(const param of params) rows.set(param.id, this.#createRow(list, param));

		this.#block =
		{
			info,
			type,
			cfgId,
			rows,
			saveTimer: null,
			unsubscribe: subscribe(cfgId, (bytes) => this.#onPacket(bytes)),
		};

		// Подписка уходит в конце текущей задачи — читаем сразу после неё
		if(rows.size > 0) queueMicrotask(() => this.ReadAll());
	}

	Close()
	{
		if(!this.#block) return;

		for(const row of this.#block.rows.values()) clearTimeout(row.timer);
		clearTimeout(this.#block.saveTimer);
		this.#block.unsubscribe();
		this.#block = null;
		this.#container.innerHTML = '';
		this.#container.classList.remove('panel');
		this.#onClose();
	}

	// Групповой запрос всех параметров одним WS-сообщением
	ReadAll()
	{
		const b = this.#block;
		if(!b || b.rows.size === 0) return;

		const msgs = [...b.rows.keys()].map(id => ({ id: b.cfgId, bytes: [FID_CFG, CMD_READ, id] }));
		if(!WSSendCanMsgBatch(msgs)) return; // нет связи — прочитаем при подключении

		for(const row of b.rows.values()) this.#startRequest(row);
	}

	Read(row)
	{
		if(WSSendCanMsg(this.#block.cfgId, [FID_CFG, CMD_READ, row.param.id])) this.#startRequest(row);
	}

	Write(row)
	{
		if(!row.input.reportValidity()) return;

		const value = writeNumberToArray(Number(row.input.value), row.param.type);
		if(WSSendCanMsg(this.#block.cfgId, [FID_CFG, CMD_WRITE, row.param.id, ...value])) this.#startRequest(row);
	}

	// Сохранить все параметры в блоке и перезагрузить его (то, что записано кнопками 💾 у параметров)
	Save()
	{
		const b = this.#block;
		const name = `[Настройки ${Int2Hex(b.cfgId, 4)}]`;
		if(!confirm(`Сохранить все параметры блока ${Int2Hex(b.info.baseID, 4)} и перезагрузить его?`)) return;

		if(!WSSendCanMsg(b.cfgId, [FID_CFG, CMD_SAVE]))
		{
			log.warn(`${name} Нет связи — сохранение не отправлено`);
			return;
		}

		const button = this.#container.querySelector('[data-cmd="save"]');
		button.disabled = true;
		log.info(`${name} Сохранение и перезагрузка…`);

		clearTimeout(b.saveTimer);
		b.saveTimer = setTimeout(() =>
		{
			button.disabled = false;
			log.warn(`${name} Нет ответа на сохранение (блок мог перезагрузиться раньше, чем ответил)`);
		}, REQUEST_TIMEOUT_MS);
	}

	// Подставить значение по умолчанию (в блок не пишется — для этого «Записать»)
	Reset(row)
	{
		if(row.param.default !== null && row.param.default !== undefined) row.input.value = row.param.default;
	}

	// ---- Строка параметра -------------------------------------------

	#createRow(list, param)
	{
		const f = param.filter ?? {};
		const el = document.createElement('div');
		el.className = 'param';
		el.innerHTML =
		`<div class="param_id">${param.id}</div>
		<div class="param_text">
			<div class="param_name">${escapeHtml(param.name)}</div>
			<div class="param_desc">${escapeHtml(param.disc ?? '')}</div>
		</div>
		<div class="param_field">
			<input type="number" min="${f.min ?? ''}" max="${f.max ?? ''}" step="${f.step ?? 'any'}">
		</div>
		<div class="param_ctrl">
			<button data-cmd="read" title="Прочитать">📥</button>
			<button data-cmd="write" title="Записать">💾</button>
			<button data-cmd="reset" title="Значение по умолчанию: ${param.default ?? '—'}">🔄</button>
		</div>`;
		list.appendChild(el);

		const row = { param, el, input: el.querySelector('input'), timer: null };
		el.querySelector('[data-cmd="read"]').addEventListener('click', () => this.Read(row));
		el.querySelector('[data-cmd="write"]').addEventListener('click', () => this.Write(row));
		el.querySelector('[data-cmd="reset"]').addEventListener('click', () => this.Reset(row));
		return row;
	}

	// Запрос ушёл: блокируем поле до ответа или таймаута
	#startRequest(row)
	{
		clearTimeout(row.timer);
		row.input.disabled = true;
		row.el.classList.add('is-pending');
		row.el.classList.remove('is-failed');

		row.timer = setTimeout(() =>
		{
			this.#finishRequest(row, false);
			log.warn(`[Настройки ${Int2Hex(this.#block.cfgId, 4)}] Параметр ${row.param.id} «${row.param.name}»: нет ответа`);
		}, REQUEST_TIMEOUT_MS);
	}

	#finishRequest(row, ok)
	{
		clearTimeout(row.timer);
		row.timer = null;
		row.input.disabled = false;
		row.el.classList.remove('is-pending');
		row.el.classList.toggle('is-failed', !ok);
	}

	// ---- Ответы блока -----------------------------------------------

	#onPacket(bytes)
	{
		if(bytes[0] !== FID_CFG) return;

		const cmd = bytes[1];
		if(cmd === CMD_ERROR)
		{
			log.error(`[Настройки ${Int2Hex(this.#block.cfgId, 4)}] Блок вернул ошибку, код ${bytes[2]}`);
			return;
		}
		if(cmd === CMD_SAVE)
		{
			clearTimeout(this.#block.saveTimer);
			this.#container.querySelector('[data-cmd="save"]').disabled = false;
			log.info(`[Настройки ${Int2Hex(this.#block.cfgId, 4)}] Сохранено, блок перезагружается`);
			return;
		}
		if(cmd !== CMD_READ && cmd !== CMD_WRITE) return;

		const row = this.#block.rows.get(bytes[2]);
		if(!row) return; // параметра нет в blocks.json

		// Чтение — всегда со значением; запись — значение, если блок его вернул
		const value = readNumberFromArray(bytes, 3, row.param.type);
		if(value !== null) row.input.value = value;

		this.#finishRequest(row, true);
	}
}
