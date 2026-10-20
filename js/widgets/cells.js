import { UIWidget } from './base.js';
import { readNumberFromArray } from '../parse.js';
import { sprintfNamed, escapeHtml } from '../format.js';

// Сводка по ячейкам АКБ: минимальное и максимальное напряжение, их номера и разница.
//
// Пакет: { uint8 fId; uint16 val[2]; uint8 num[2]; }  (7 байт, little-endian)
//   val[0] — минимальное напряжение ячейки, val[1] — максимальное (raw, делится на scale)
//   num[0] — номер ячейки с минимумом,     num[1] — номер ячейки с максимумом
//   fId 0x61/0x62/0x63 — уровень (норма/предупреждение/критично) по наихудшему значению;
//   fId 0x65 — тот же пакет без уровня (ответ на чужой запрос): значения обновляем,
//   уровень оставляем прежним.

const LEVELS = { 0x61: 'normal', 0x62: 'warning', 0x63: 'critical' };

export class CellsWidget extends UIWidget
{
	static type = 'cells';

	Render()
	{
		this.element.innerHTML =
		`<div class="ui_root ui-cells">
			<div class="ui_title ui-cells_title">${escapeHtml(this.config.name)}</div>
			<div class="ui-cells_content">
				<span class="ui-cells_sign">▼</span><span class="ui-cells_num ui-cells_min-num">-</span><span class="ui-cells_val ui-cells_min">-</span>
				<span class="ui-cells_sign">▲</span><span class="ui-cells_num ui-cells_max-num">-</span><span class="ui-cells_val ui-cells_max">-</span>
				<span class="ui-cells_sign">Δ</span><span class="ui-cells_delta">-</span>
			</div>
			<div class="ui-cells_bar" hidden><div class="ui-cells_spread"></div></div>
		</div>`;

		const q = sel => this.element.querySelector(sel);
		this.refs.min = q('.ui-cells_min');
		this.refs.max = q('.ui-cells_max');
		this.refs.minNum = q('.ui-cells_min-num');
		this.refs.maxNum = q('.ui-cells_max-num');
		this.refs.delta = q('.ui-cells_delta');
		this.refs.bar = q('.ui-cells_bar');
		this.refs.spread = q('.ui-cells_spread');

		// Полоска «где min и max внутри рабочего диапазона» — только если задан range
		if(Array.isArray(this.config.range)) this.refs.bar.hidden = false;

		this.Subscribe();
	}

	Update(rx_data)
	{
		const fId    = readNumberFromArray(rx_data, 0, 'uint8');
		const minRaw = readNumberFromArray(rx_data, 1, 'uint16');
		const maxRaw = readNumberFromArray(rx_data, 3, 'uint16');
		const minNum = readNumberFromArray(rx_data, 5, 'uint8');
		const maxNum = readNumberFromArray(rx_data, 6, 'uint8');
		if(maxNum === null) return; // короткий пакет

		const scale = this.config.scale || 1000;   // по умолчанию raw в мВ → В
		const format = this.config.format || '${value:%1.3f} V';
		const vMin = minRaw / scale;
		const vMax = maxRaw / scale;
		const deltaMv = (maxRaw - minRaw) / scale * 1000;

		this.refs.min.textContent = sprintfNamed(format, { value: vMin, value_raw: minRaw });
		this.refs.max.textContent = sprintfNamed(format, { value: vMax, value_raw: maxRaw });
		this.refs.minNum.textContent = '#' + minNum;
		this.refs.maxNum.textContent = '#' + maxNum;
		this.refs.delta.textContent = `${Math.round(deltaMv)} mV`;

		// Уровень приходит только с таймерными пакетами; 0x65 его не меняет
		const level = LEVELS[fId];
		if(level)
		{
			for(const l of Object.values(LEVELS))
				this.element.classList.toggle('lvl-' + l, l === level);
		}

		if(!this.refs.bar.hidden)
		{
			const [lo, hi] = this.config.range;
			const pos = v => Math.min(100, Math.max(0, (v - lo) / (hi - lo) * 100));
			this.refs.spread.style.left = pos(vMin) + '%';
			this.refs.spread.style.width = Math.max(1, pos(vMax) - pos(vMin)) + '%';
		}
	}
}
