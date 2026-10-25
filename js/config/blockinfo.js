// Карточки блоков, найденных в системе.
//
// Каждый блок раз в несколько секунд присылает пакет с информацией о себе (fId 0x0A, приходит как Raw).
// На каждый baseID рисуется карточка, при повторных пакетах она обновляется.
// Клик по карточке → onSelect(info) — открыть настройки этого блока.
//
// Пакет (little-endian, 32 байта):
//   [0]     fId 0x0A
//   [1..2]  baseID u16        [3] hw_type   [4] hw_ver   [5] sw_ver   [6] can_ver
//   [7..14] SN, 8 байт        [15..21] features, 7 байт
//   [22..25] uptime u32, мс   [26..27] voltage u16, мВ  [28..29] current u16, мА
//   [30] temperature i8, °C   [31] error_flags

import { Int2Hex, FastFormatMs, escapeHtml } from '../utils/format.js';

export const FID_BLOCK_INFO = 0x0A;
const PACKET_LEN = 32;

export class BlockInfo
{
	#container;
	#blocks;		// описание типов из blocks.json
	#onSelect;
	#cards = new Map();	// baseID -> { el, info }

	/**
	 * @param {HTMLElement} container   куда добавлять карточки
	 * @param {Array}       blocks      blocks.json → blocks
	 * @param {Function}    onSelect    (info) => void — клик по карточке
	 */
	constructor(container, blocks, onSelect)
	{
		this.#container = container;
		this.#blocks = blocks;
		this.#onSelect = onSelect;
	}

	// Пакет 0x0A → карточка
	processPacket(bytes)
	{
		const info = this.#parse(bytes);
		if(info === null)
		{
			console.warn('[Блоки] Короткий пакет информации о блоке', bytes);
			return;
		}

		let card = this.#cards.get(info.baseID);
		if(!card)
		{
			card = this.#createCard(info.baseID);
			this.#cards.set(info.baseID, card);
		}
		card.info = info;
		this.#updateCard(card.el, info);
	}

	// Подсветить выбранную карточку
	select(baseID)
	{
		for(const [id, card] of this.#cards)
			card.el.classList.toggle('is-selected', id === baseID);
	}

	// Описание типа блока из blocks.json (или undefined)
	findType(hw_type)
	{
		return this.#blocks.find(b => b.type === hw_type);
	}

	#parse(bytes)
	{
		if(!bytes || bytes.length < PACKET_LEN) return null;

		const u8 = Uint8Array.from(bytes);
		const view = new DataView(u8.buffer);
		const hex = (from, len) => Array.from(u8.subarray(from, from + len), v => v.toString(16).padStart(2, '0')).join(':');

		return {
			baseID:      view.getUint16(1, true),
			hw_type:     view.getUint8(3),
			hw_ver:      view.getUint8(4),
			sw_ver:      view.getUint8(5),
			can_ver:     view.getUint8(6),
			sn:          hex(7, 8),
			features:    hex(15, 7),
			uptime:      view.getUint32(22, true),
			voltage:     view.getUint16(26, true),
			current:     view.getUint16(28, true),
			temperature: view.getInt8(30),
			error_flags: view.getUint8(31),
		};
	}

	#createCard(baseID)
	{
		const el = document.createElement('div');
		el.className = 'block-card';
		el.title = 'Открыть настройки блока';
		el.innerHTML =
		`<div class="block-card_head">
			<div class="block-card_id"></div>
			<div class="block-card_name"></div>
			<div class="block-card_sn"></div>
		</div>
		<div class="block-card_rows">
			<span>HW</span>          <span class="f-hw"></span>
			<span>SW / CAN</span>    <span class="f-sw"></span>
			<span>Uptime</span>      <span class="f-uptime"></span>
			<span>Напряжение</span>  <span class="f-voltage"></span>
			<span>Ток</span>         <span class="f-current"></span>
			<span>Температура</span> <span class="f-temp"></span>
			<span>Ошибки</span>      <span class="f-errors"></span>
		</div>`;

		el.addEventListener('click', () =>
		{
			const card = this.#cards.get(baseID);
			this.#onSelect(card.info);
		});

		this.#container.appendChild(el);
		return { el, info: null };
	}

	#updateCard(el, info)
	{
		const type = this.findType(info.hw_type);
		const q = sel => el.querySelector(sel);

		q('.block-card_id').textContent = Int2Hex(info.baseID, 4);
		q('.block-card_name').innerHTML = type
			? escapeHtml(type.name)
			: `<span class="is-unknown">Тип ${info.hw_type}: нет в blocks.json</span>`;
		q('.block-card_sn').textContent = info.sn;
		q('.f-hw').textContent = `тип ${info.hw_type}, вер. ${info.hw_ver}`;
		q('.f-sw').textContent = `${info.sw_ver} / ${info.can_ver}`;
		q('.f-uptime').textContent = FastFormatMs(info.uptime);
		q('.f-voltage').textContent = info.voltage + ' мВ';
		q('.f-current').textContent = info.current + ' мА';
		q('.f-temp').textContent = info.temperature + ' °C';
		q('.f-errors').textContent = '0b' + info.error_flags.toString(2).padStart(8, '0');

		el.classList.toggle('has-errors', info.error_flags !== 0);
	}
}
