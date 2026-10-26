'use strict';
// Скрипты ESP по L3 — серверная сторона протокола (SCRIPTS_PROTOCOL.md).
//
//   const scripts = new Scripts(obj_l3, log);
//   const result = await scripts.Load(id, onProgress);   // ошибка — исключение с понятным текстом
//
// Запрос: [fId][cmd][поля…], ответ: [fId][cmd | 0x80][status][поля…].
// Длину сообщения несёт L3 (len перед каждым сообщением в пакете), поэтому своей длины у Script нет.
//
// Каждая операция — последовательность «запрос → ждём ответ» (по одному запросу за раз).
// Одновременно выполняется одна операция; вторая сразу получает ошибку «занято».
// Размеры кусков считаются от l3.msg_max и лимита, который сообщает ESP.

const CMD =
{
	INFO:        0x01,
	DELETE:      0x02,
	WRITE_BEGIN: 0x03,
	WRITE:       0x04,
	WRITE_END:   0x05,
	READ:        0x06,
	RELOAD:      0x08,
	ENABLE:      0x0A,
	LIST:        0x0C,
};
const RESP_BIT = 0x80;

// Размеры заголовков сообщений (с fId)
const REQ_HEADER_LEN = 2;							// fId, cmd
const RESP_HEADER_LEN = REQ_HEADER_LEN + 1;			// + status
const WRITE_HEADER_LEN = REQ_HEADER_LEN + 4;		// + id u16, offset u16
const READ_RESP_HEADER_LEN = RESP_HEADER_LEN + 4;	// + id u16, offset u16
const LIST_ENTRY_LEN = 5;							// id u16, length u16, flags u8
const LIST_END = 0xFFFF;

const STEP_TIMEOUT_MS = 1100;				// ожидание ответа на один запрос
const RELOAD_TIMEOUT_MS = STEP_TIMEOUT_MS * 5;	// RELOAD читает все скрипты из флеш-памяти — долго

const STATUS_TEXT =
{
	[-1]: 'неверный запрос',
	[-2]: 'неверный ID скрипта',
	[-3]: 'скрипт не загружен в память ESP',
	[-4]: 'скрипт слишком длинный',
	[-5]: 'неверное смещение данных',
	[-6]: 'запись не начата',
	[-7]: 'контрольная сумма не совпала',
	[-8]: 'приняты не все данные',
	[-9]: 'ошибка записи во флеш-память',
};


class Scripts
{
	#l3;
	#log;
	#fid;
	#busy = null;	// имя текущей операции
	#wait = null;	// ожидаемый ответ: { cmd, resolve, reject, timer }

	constructor(l3, log)
	{
		this.#l3 = l3;
		this.#log = log;
		this.#fid = l3.fid.Script;

		// Связь с ESP пропала — ждать ответа бессмысленно
		l3.on('disconnect', () => this.#fail(new Error('связь с ESP потеряна')));
	}

	// Сообщение Script от ESP (data начинается с fId, L3Packet уже отделил его по len)
	onMessage(data)
	{
		const w = this.#wait;
		if(!w || data.length < RESP_HEADER_LEN || data[1] !== (w.cmd | RESP_BIT)) return; // не наш ответ

		this.#wait = null;
		clearTimeout(w.timer);

		const status = data.readInt8(2);
		if(status < 0) w.reject(new Error(STATUS_TEXT[status] ?? 'ошибка ESP, код ' + status));
		else w.resolve(data.subarray(RESP_HEADER_LEN)); // поля ответа после status
	}


	// ============================================================ Операции

	Info(id)
	{
		return this.#run('информация', async () =>
		{
			const r = await this.#request(CMD.INFO, U16(id));	// id, length, crc32, flags
			return { id, length: r.readUInt16LE(2), crc32: r.readUInt32LE(4), flags: r[8] };
		});
	}

	Load(id, onProgress = () => {})
	{
		return this.#run('чтение', async () =>
		{
			const info = await this.#request(CMD.INFO, U16(id));
			const length = info.readUInt16LE(2);
			const crc = info.readUInt32LE(4);

			const max_len = this.#l3.msg_max - READ_RESP_HEADER_LEN;
			const data = Buffer.alloc(length);
			let offset = 0;

			while(offset < length)
			{
				const r = await this.#request(CMD.READ, [...U16(id), ...U16(offset), ...U16(Math.min(max_len, length - offset))]);	// id, offset, data
				const chunk = r.subarray(4);
				if(r.readUInt16LE(2) !== offset || chunk.length === 0) throw new Error('ESP вернул не тот кусок данных');

				chunk.copy(data, offset);
				offset += chunk.length;
				onProgress(offset, length);
			}

			if(Crc32(data) !== crc) throw new Error('контрольная сумма прочитанного не совпала');
			return { id, data: Array.from(data) };
		});
	}

	Save(id, bytes, onProgress = () => {})
	{
		return this.#run('запись', async () =>
		{
			const data = Buffer.from(bytes);
			const begin = await this.#request(CMD.WRITE_BEGIN, [...U16(id), ...U16(data.length)]);	// id, max_chunk
			const chunk_max = Math.min(begin.readUInt16LE(2), this.#l3.msg_max - WRITE_HEADER_LEN);
			if(chunk_max <= 0) throw new Error('ESP сообщил нулевой размер куска');

			for(let offset = 0; offset < data.length; offset += chunk_max)
			{
				const chunk = data.subarray(offset, offset + chunk_max);
				await this.#request(CMD.WRITE, [...U16(id), ...U16(offset), ...chunk]);
				onProgress(offset + chunk.length, data.length);
			}

			await this.#request(CMD.WRITE_END, [...U16(id), ...U32(Crc32(data))]);
			return { id };
		});
	}

	Delete(id)
	{
		return this.#run('удаление', async () =>
		{
			await this.#request(CMD.DELETE, U16(id));
			return { id };
		});
	}

	Reload()
	{
		return this.#run('перезагрузка', async () =>
		{
			const r = await this.#request(CMD.RELOAD, [], RELOAD_TIMEOUT_MS);	// count
			return { count: r.readUInt16LE(0) };
		});
	}

	Enable(id, on)
	{
		return this.#run('включение', async () =>
		{
			const r = await this.#request(CMD.ENABLE, [...U16(id), on ? 1 : 0]);	// id, flags
			return { id, flags: r[2] };
		});
	}

	List()
	{
		return this.#run('список', async () =>
		{
			const scripts = [];
			let reload_needed = false;
			let from = 0;

			while(from !== LIST_END)
			{
				const r = await this.#request(CMD.LIST, U16(from));	// reload_needed, next, записи
				reload_needed = r[0] !== 0;
				const next = r.readUInt16LE(1);

				for(let o = 3; o + LIST_ENTRY_LEN <= r.length; o += LIST_ENTRY_LEN)
					scripts.push({ id: r.readUInt16LE(o), length: r.readUInt16LE(o + 2), flags: r[o + 4] });

				if(next !== LIST_END && next <= from) throw new Error('ESP вернул неверное продолжение списка');
				from = next;
			}

			return { scripts, reload_needed };
		});
	}


	// ============================================================ Внутреннее

	// Одна операция за раз
	async #run(name, fn)
	{
		if(this.#busy) throw new Error(`занято: идёт ${this.#busy}`);

		this.#busy = name;
		try
		{
			return await fn();
		}
		finally
		{
			this.#busy = null;
		}
	}

	// Запрос и ожидание ответа с тем же cmd
	#request(cmd, body, timeout_ms = STEP_TIMEOUT_MS)
	{
		return new Promise((resolve, reject) =>
		{
			const msg = Buffer.from([this.#fid, cmd, ...body]);
			if(msg.length > this.#l3.msg_max) return reject(new Error(`запрос ${msg.length} байт, максимум сообщения L3 ${this.#l3.msg_max}`));
			if(!this.#l3.send(msg)) return reject(new Error('ESP не подключён'));

			const timer = setTimeout(() =>
			{
				this.#wait = null;
				reject(new Error('нет ответа от ESP'));
			}, timeout_ms);

			this.#wait = { cmd, resolve, reject, timer };
		});
	}

	#fail(err)
	{
		const w = this.#wait;
		if(!w) return;
		this.#wait = null;
		clearTimeout(w.timer);
		w.reject(err);
	}
}


// ================================================================ Байты

function U16(v)
{
	return [v & 0xFF, (v >> 8) & 0xFF];
}

function U32(v)
{
	return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
}

// CRC-32 (zlib): полином 0xEDB88320, начальное 0xFFFFFFFF, финальная инверсия. "123456789" → 0xCBF43926
const CRC_TABLE = new Uint32Array(256);
for(let i = 0; i < 256; i++)
{
	let c = i;
	for(let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
	CRC_TABLE[i] = c >>> 0;
}

function Crc32(bytes)
{
	let crc = 0xFFFFFFFF;
	for(const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

module.exports = { Scripts, Crc32 };
