'use strict';
/*
L3Packet — клиент протокола L3 (связь с ESP32 по UART). Описание протокола — L3_client_guide.md.

	const l3 = new L3Packet(config, serialPort);		// config.l3 + config.serial.debug; сам читает порт и пишет в него
	l3.add(msg); l3.add(msg); l3.commit();				// сообщения подряд в пакет, как AddPacket/Commit в ESP
	l3.send(bytes);										// готовый DATA одним пакетом
	l3.fid.Script										// fId по имени из l3_fids.json

События (подписываться не обязательно):
	'message'    (fid, data)   — прикладное сообщение от ESP, data начинается с fId
	'connect'    (info)        — ESP принял подключение (пришёл его accept): { sn, name, session }.
	                             С этого момента можно отправлять прикладные данные
	'disconnect' (reason)      — принятый сеанс закрыт: 'link' — нет кадров ESP > 3 × interval,
	                             'session' — ESP сменил сеанс (перезапуск, закрытие), клиент подключается заново,
	                             'port' — порт закрылся (USB отвалился)
После закрытия порта или потери связи клиент ждёт beacon и подключается сам, ничего делать не нужно.

l3_fids.json — имя сообщения -> fId и, если известна, длина (нужна, чтобы делить DATA на сообщения):
	"Name": { "fid": "0x17", "length": 12 }
		фиксированная длина
	"Name": { "fid": "0x17", "length": { "header": 4, "len_field": 3, "item_size": 1 } }
		переменная: header + data[len_field] * item_size. header — байт до данных (с fId),
		len_field — смещение байта-счётчика от fId, item_size — размер элемента (не задан — 1)
	"Name": { "fid": "0x1B" }
		длина неизвестна: сообщение забирает остаток DATA целиком (в нём может быть несколько сообщений)
*/

const crypto = require('crypto');
const EventEmitter = require('events');
const FIDS = require('../data/l3_fids.json');
const log = require('./logcmd.js').source('l3');
const log_serial = require('./logcmd.js').source('serial');

const VERSION = 0x02;
const HEADER_LEN = 6;
const IV_LEN = 12;
const TAG_LEN = 16;
const CRC_LEN = 2;
const DATA_OFFSET = HEADER_LEN + IV_LEN;				// 18
const DATA_MAX = 64;
const PAYLOAD_MAX = IV_LEN + DATA_MAX + TAG_LEN;		// 92
const SECURE_MIN = HEADER_LEN + IV_LEN + TAG_LEN + CRC_LEN;	// кадр SIGN/ENCRYPT с пустым DATA

const DIR_TO_ESP = 0x80;								// бит 7 CTRL0
const FORMATS = { SIGN: 1, ENCRYPT: 3 };
const FMT_SIGN = 1;

const FID_BEACON = 0x00;
const FID_ACCEPT = 0x01;
const FID_PING = 0x05;
const BEACON_HEAD_LEN = 12;								// fId, interval(2), sn(8), length(1), далее имя
const ACCEPT = Buffer.from([FID_ACCEPT]);
const PING = Buffer.from([FID_PING]);
const COUNTER_MAX = 0xFFFFFFFF;
const EPOCH_MAX = 0xFFFFFF;

const CRC_TABLE = new Uint16Array(256);
for(let i = 0; i < 256; i++)
{
	let c = i << 8;
	for(let j = 0; j < 8; j++) c = (c & 0x8000) ? (c << 1) ^ 0x1021 : c << 1;
	CRC_TABLE[i] = c & 0xFFFF;
}


class L3Packet extends EventEmitter
{
	static DATA_MAX = DATA_MAX;

	constructor(config, port)
	{
		super();

		const cfg = config.l3;
		this.cfg = cfg;
		this.debug = cfg.debug;					// rx_raw, rx_sign, tx_sign, reject
		this.debug_serial = config.serial.debug;	// rx_chunk, rx_text
		this.port = port;

		this.format = FORMATS[cfg.format];
		if(this.format === undefined) throw new Error('L3: format — SIGN или ENCRYPT');

		this.keys = new Map(cfg.keys.map((k) => [this._hex(k.sn, 8).toString('hex'), this._hex(k.key, 32)]));

		this.fid = {};
		this.lengths = new Map();
		for(const [name, d] of Object.entries(FIDS))
		{
			const fid = Number(d.fid);
			this.fid[name] = fid;
			if(d.length !== undefined) this.lengths.set(fid, d.length);
		}

		this.rx_buf = Buffer.alloc(4096);
		this.rx_len = 0;
		this.stall_timer = null;
		this.stall_armed = false;
		this.esp_text = '';

		this.tx_buf = Buffer.alloc(DATA_MAX);
		this.tx_len = 0;

		this._reset();

		port.on('data', (chunk) => this._onData(chunk));
		port.on('close', () => this._onPortClose());
		setInterval(() => this._checkLink(), 250);
	}

	get connected()
	{
		return this.accepted;
	}

	// Добавить сообщение в пакет. Не помещается — накопленное уходит, сообщение начинает новый пакет
	add(msg)
	{
		if(msg.length > DATA_MAX) { log('сообщение ' + msg.length + ' байт, максимум ' + DATA_MAX + ' — не отправлено'); return false; }

		if(this.tx_len + msg.length > DATA_MAX) this.commit();
		this.tx_buf.set(msg, this.tx_len);
		this.tx_len += msg.length;

		return true;
	}

	// Отправить накопленное
	commit()
	{
		if(this.tx_len === 0) return true;
		if(!this.accepted) { log('ESP не принял подключение — не отправлено'); this.tx_len = 0; return false; }

		const ok = this._send(this.tx_buf.subarray(0, this.tx_len));
		this.tx_len = 0;

		return ok;
	}

	// Готовый DATA (одно или несколько сообщений) отдельным пакетом
	send(bytes)
	{
		if(!(bytes instanceof Uint8Array) && !(Array.isArray(bytes) && bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 0xFF)))
		{
			log('данные не массив байт — не отправлено');
			return false;
		}
		if(bytes.length > DATA_MAX) { log('DATA ' + bytes.length + ' байт, максимум ' + DATA_MAX + ' — не отправлено'); return false; }

		this.commit();
		if(!this.accepted) { log('ESP не принял подключение — не отправлено'); return false; }
		return this._send(Buffer.from(bytes));
	}


	// ------------------------------------------------ сеанс

	_reset()
	{
		this.session = false;
		this.accepted = false;					// ESP ответил accept: можно слать прикладные данные
		this.key = null;
		this.esp_instance = 0;
		this.my_instance = 0;
		this.esp_session = null;
		this.tx_epoch = 0; this.tx_counter = 0;		// N = epoch << 32 | counter, последний отправленный
		this.rx_epoch = 0; this.rx_counter = 0;		// последний принятый от ESP
		this.random = null;
		this.sn = null;
		this.name = null;
		this.interval = 0;
		this.last_rx = 0;
		this.tx_len = 0;
	}

	// Подключение: проверенный beacon -> состояние сеанса -> сразу accept. Сеанс открыт, когда ESP ответит своим accept
	_connect(f, beacon, key)
	{
		this.session = true;
		this.accepted = false;
		this.key = key;
		this.esp_instance = f[9];
		this.my_instance = this.esp_instance ^ 0xFF;
		this.esp_session = Buffer.from(f.subarray(14, 18));
		this.tx_epoch = this.rx_epoch = f[6] | (f[7] << 8) | (f[8] << 16);
		this.tx_counter = this.rx_counter = f.readUInt32LE(10);
		this.random = crypto.randomBytes(4);
		this.interval = beacon.interval;
		this.last_rx = performance.now();
		if(this.debug.rx_sign) this._logSign('rx_sign', this.rx_epoch, this.rx_counter, f.subarray(DATA_OFFSET, f.length - CRC_LEN - TAG_LEN), f);

		this.sn = beacon.sn;
		this.name = beacon.name;

		log('beacon SN ' + beacon.sn + ' «' + beacon.name + '», сеанс ESP ' + this.esp_session.toString('hex') + ': отправлен accept');
		this._send(ACCEPT);
	}

	// Accept от ESP: сеанс открыт
	_accept()
	{
		if(this.accepted) return;

		this.accepted = true;
		log('подключено к SN ' + this.sn + ' «' + this.name + '», сеанс ESP ' + this.esp_session.toString('hex'));
		this.emit('connect', { sn: this.sn, name: this.name, session: this.esp_session.toString('hex') });
	}

	_disconnect(reason, text)
	{
		if(!this.session) return;

		const accepted = this.accepted;
		this._reset();
		log(text);
		if(accepted) this.emit('disconnect', reason);
	}

	_checkLink()
	{
		if(this.session && performance.now() - this.last_rx > 3 * this.interval)
			this._disconnect('link', 'связь потеряна (нет кадров от ESP), ждём beacon');
	}

	// Порт закрылся: недособранный кадр выбросить, сеанс закрыть. После открытия порта — снова поиск beacon
	_onPortClose()
	{
		this.rx_len = 0;
		this.stall_armed = false;
		this._disconnect('port', 'порт закрыт, сеанс сброшен');
	}


	// ------------------------------------------------ отправка

	_send(data)
	{
		if(!this.session) { log('нет сеанса с ESP — не отправлено'); return false; }
		if(this.tx_epoch === EPOCH_MAX && this.tx_counter === COUNTER_MAX) { log('N исчерпан'); return false; }

		// N += 1, переполнение counter переходит в epoch
		if(this.tx_counter === COUNTER_MAX) { this.tx_counter = 0; this.tx_epoch++; }
		else this.tx_counter++;

		const len = IV_LEN + data.length + TAG_LEN;
		const tag_pos = DATA_OFFSET + data.length;
		const f = Buffer.alloc(HEADER_LEN + len + CRC_LEN);

		// Заголовок (входит в AAD, поэтому до подписи). Резервные биты — 0
		f[0] = 0x50; f[1] = 0x58;
		f[2] = VERSION | DIR_TO_ESP;
		f[3] = this.format;
		f.writeUInt16LE(len, 4);

		// IV: epoch(3) instance(1) counter(4) random(4)
		f[6] = this.tx_epoch & 0xFF; f[7] = (this.tx_epoch >> 8) & 0xFF; f[8] = this.tx_epoch >> 16;
		f[9] = this.my_instance;
		f.writeUInt32LE(this.tx_counter, 10);
		this.random.copy(f, 14);

		// GCM. В конце AAD — идентификатор сеанса ESP (в эфир не идёт)
		const cipher = crypto.createCipheriv('aes-256-gcm', this.key, f.subarray(HEADER_LEN, DATA_OFFSET));
		if(this.format === FMT_SIGN)
		{
			f.set(data, DATA_OFFSET);
			cipher.setAAD(Buffer.concat([f.subarray(0, tag_pos), this.esp_session]));
		}
		else
		{
			cipher.setAAD(Buffer.concat([f.subarray(0, DATA_OFFSET), this.esp_session]));
			cipher.update(data).copy(f, DATA_OFFSET);
		}
		cipher.final();
		cipher.getAuthTag().copy(f, tag_pos);

		f.writeUInt16LE(this._crc(f, 0, tag_pos + TAG_LEN), tag_pos + TAG_LEN);

		this.port.write(f);
		if(this.debug.tx_sign) this._logSign('tx_sign', this.tx_epoch, this.tx_counter, data, f);

		return true;
	}


	// ------------------------------------------------ приём

	// Кусок потока: дописать к недособранному хвосту и разобрать
	_onData(chunk)
	{
		if(this.debug_serial.rx_chunk) log_serial('rx_chunk: ' + this._hexStr(chunk));

		if(this.rx_len + chunk.length > this.rx_buf.length)
		{
			const buf = Buffer.alloc(this.rx_len + chunk.length);
			this.rx_buf.copy(buf, 0, 0, this.rx_len);
			this.rx_buf = buf;
		}
		chunk.copy(this.rx_buf, this.rx_len);
		this.rx_len += chunk.length;

		this._parse(0);
	}

	/*
	Поиск кадров с позиции p (§11): 'P','X', заголовок, LEN <= 92, 8 + LEN байт, CRC.
	LEN > 92 или CRC не сошёлся — кандидат ложный, поиск со следующего байта (внутри мог начаться настоящий кадр).
	Недособранный хвост переносится в начало буфера; не дособран за frame_timeout_ms — тоже ложный.
	*/
	_parse(p)
	{
		const b = this.rx_buf.subarray(0, this.rx_len);
		const end = b.length;

		while(p < end)
		{
			const i = b.indexOf(0x50, p);
			if(i < 0) { this._text(b, p, end); p = end; break; }
			this._text(b, p, i);
			p = i;

			if(end - p < 2) break;
			if(b[p + 1] !== 0x58) { this._text(b, p, p + 1); p++; continue; }
			if(end - p < HEADER_LEN) break;

			const len = b.readUInt16LE(p + 4);
			if(len > PAYLOAD_MAX) { this._text(b, p, p + 1); p++; continue; }

			const crc_pos = p + HEADER_LEN + len;
			if(crc_pos + CRC_LEN > end) break;

			if(this._crc(b, p, crc_pos) !== b.readUInt16LE(crc_pos)) { this._text(b, p, p + 1); p++; continue; }

			this._onFrame(b.subarray(p, crc_pos + CRC_LEN));
			p = crc_pos + CRC_LEN;
		}

		// Хвост — в начало буфера. Таймер сборки — на начало нового кандидата
		const tail = end - p;
		if(p > 0 && tail > 0) this.rx_buf.copyWithin(0, p, end);
		this.rx_len = tail;

		if(tail === 0) this.stall_armed = false;
		else if(p > 0 || !this.stall_armed) this._armStall();
	}

	_armStall()
	{
		if(this.stall_timer === null) this.stall_timer = setTimeout(() => this._onStall(), this.cfg.frame_timeout_ms);
		else this.stall_timer.refresh();
		this.stall_armed = true;
	}

	_onStall()
	{
		if(!this.stall_armed || this.rx_len === 0) return;

		this.stall_armed = false;
		this._text(this.rx_buf, 0, 1);
		this._parse(1);
	}

	// Кадр с верным CRC. Проверки по §5: заголовок -> тег -> instance -> сеанс -> N
	_onFrame(f)
	{
		if(this.debug.rx_raw) log('rx_raw: ' + this._hexStr(f));

		const fmt = f[3] & 0x07;
		if((f[2] & 0x0F) !== VERSION) return this._reject('версия', f);
		if((f[2] & DIR_TO_ESP) !== 0) return this._reject('направление', f);
		if(fmt !== FMT_SIGN && fmt !== this.format) return this._reject('формат', f);
		if(f.length < SECURE_MIN) return this._reject('длина', f);

		if(!this.session) return this._search(f);

		const data = this._open(f, fmt, this.key);
		if(data === null) return this._reject('подпись', f);
		if(f[9] !== this.esp_instance) return this._reject('instance', f);

		// Другой идентификатор сеанса раньше N: ESP закрыл сеанс или перезапустился, его N может быть меньше
		if(!f.subarray(14, 18).equals(this.esp_session))
		{
			const beacon = this._parseBeacon(data, 0);
			if(beacon === null) return this._reject('чужой сеанс', f);

			const key = this.key;
			this._disconnect('session', 'ESP сменил сеанс — переподключение');
			return this._connect(f, beacon, key);
		}

		const epoch = f[6] | (f[7] << 8) | (f[8] << 16);
		const counter = f.readUInt32LE(10);
		if(epoch < this.rx_epoch || (epoch === this.rx_epoch && counter <= this.rx_counter)) return this._reject('повтор', f);

		this.rx_epoch = epoch;
		this.rx_counter = counter;
		this.last_rx = performance.now();
		if(this.debug.rx_sign) this._logSign('rx_sign', epoch, counter, data, f);

		this._dispatch(data);
	}

	// Без сеанса нужен только beacon: SIGN, первое сообщение — beacon, ключ по SN, верная подпись
	_search(f)
	{
		if((f[3] & 0x07) !== FMT_SIGN) return this._reject('нет сеанса', f);

		const beacon = this._parseBeacon(f.subarray(DATA_OFFSET, f.length - CRC_LEN - TAG_LEN), 0);
		if(beacon === null) return this._reject('нет сеанса', f);

		const key = this.keys.get(beacon.sn);
		if(key === undefined)
		{
			log('ОШИБКА: нет ключа для SN ' + beacon.sn + ' «' + beacon.name + '» (не проверено) в config.l3.keys. Канал SIGN: без ключа работа невозможна');
			return;
		}
		if(this._open(f, FMT_SIGN, key) === null)
		{
			log('ОШИБКА: подпись beacon SN ' + beacon.sn + ' не сошлась с ключом из config.l3.keys: ключ неверный');
			return;
		}

		this._connect(f, beacon, key);
	}

	// DATA -> сообщения. Beacon, accept и ping обрабатываются здесь, остальное — в 'message'
	_dispatch(data)
	{
		let off = 0;
		while(off < data.length)
		{
			const fid = data[off];

			if(fid === FID_BEACON)
			{
				const beacon = this._parseBeacon(data, off);
				if(beacon === null) return;
				this.interval = beacon.interval;		// сеанс тот же — меняется только интервал
				off += beacon.size;
				continue;
			}

			if(fid === FID_ACCEPT)
			{
				this._accept();
				off += 1;
				continue;
			}

			if(fid === FID_PING)
			{
				this._send(PING);
				off += 1;
				continue;
			}

			const size = this._length(data, off);
			this.emit('message', fid, Buffer.from(data.subarray(off, off + size)));
			off += size;
		}
	}

	// Длина сообщения по l3_fids.json. Неизвестна — остаток DATA
	_length(data, off)
	{
		const left = data.length - off;
		const d = this.lengths.get(data[off]);

		let size = 0;
		if(typeof d === 'number') size = d;
		else if(d !== undefined && d.len_field < left) size = d.header + data[off + d.len_field] * (d.item_size ?? 1);

		return (size > 0 && size <= left) ? size : left;
	}

	_parseBeacon(data, off)
	{
		const left = data.length - off;
		if(left < BEACON_HEAD_LEN || data[off] !== FID_BEACON) return null;

		const name_len = data[off + 11];
		if(name_len > 32 || left < BEACON_HEAD_LEN + name_len) return null;

		return {
			interval: data.readUInt16LE(off + 1),
			sn: data.toString('hex', off + 3, off + 11),
			name: data.toString('utf8', off + BEACON_HEAD_LEN, off + BEACON_HEAD_LEN + name_len),
			size: BEACON_HEAD_LEN + name_len,
		};
	}

	/*
	Проверить тег кадра ESP, вернуть DATA или null. Кадры ESP подписаны без идентификатора сеанса,
	поэтому AAD — начало кадра: SIGN — до конца DATA, ENCRYPT — до конца IV
	*/
	_open(f, fmt, key)
	{
		const tag_pos = f.length - CRC_LEN - TAG_LEN;
		try
		{
			const d = crypto.createDecipheriv('aes-256-gcm', key, f.subarray(HEADER_LEN, DATA_OFFSET));
			d.setAuthTag(f.subarray(tag_pos, tag_pos + TAG_LEN));
			if(fmt === FMT_SIGN)
			{
				d.setAAD(f.subarray(0, tag_pos));
				d.final();
				return f.subarray(DATA_OFFSET, tag_pos);
			}
			d.setAAD(f.subarray(0, DATA_OFFSET));
			const data = d.update(f.subarray(DATA_OFFSET, tag_pos));
			d.final();
			return data;
		}
		catch(e)
		{
			return null;
		}
	}


	// ------------------------------------------------ служебное

	// rx_sign / tx_sign: N, открытый DATA и кадр целиком
	_logSign(name, epoch, counter, data, f)
	{
		log(name + ' N=' + epoch + ':' + counter + ' data: ' + this._hexStr(data) + ' | frame: ' + this._hexStr(f));
	}

	_reject(reason, f)
	{
		if(this.debug.reject) log('reject (' + reason + '): ' + this._hexStr(f));
	}

	// Байты вне кадров — текст логов ESP в том же UART
	_text(b, from, to)
	{
		if(!this.debug_serial.rx_text || to <= from) return;

		this.esp_text += b.toString('latin1', from, to);
		let i;
		while((i = this.esp_text.indexOf('\n')) >= 0)
		{
			const line = Buffer.from(this.esp_text.slice(0, i), 'latin1').toString('utf8').trim();
			if(line) log_serial('rx_text: ' + line);
			this.esp_text = this.esp_text.slice(i + 1);
		}
		if(this.esp_text.length > 256) { log_serial('rx_text: ' + this.esp_text); this.esp_text = ''; }
	}

	// CRC-16/XMODEM байт [start, end)
	_crc(b, start, end)
	{
		let crc = 0;
		for(let i = start; i < end; i++) crc = ((crc << 8) & 0xFFFF) ^ CRC_TABLE[((crc >> 8) ^ b[i]) & 0xFF];
		return crc;
	}

	_hex(text, bytes)
	{
		const clean = String(text).replace(/[^0-9a-fA-F]/g, '');
		if(clean.length !== bytes * 2) throw new Error('L3: "' + text + '": нужно ' + bytes + ' байт в hex');
		return Buffer.from(clean, 'hex');
	}

	_hexStr(b)
	{
		return b.toString('hex').replace(/(..)(?!$)/g, '$1 ');
	}
}

module.exports = L3Packet;
