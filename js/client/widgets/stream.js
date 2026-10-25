import { UIWidget } from './base.js';
import { readNumberFromArray } from '../../utils/parse.js';
import { sprintfNamed, escapeHtml } from '../../utils/format.js';
import { WSSendCanMsg } from '../../utils/ws.js';

// Много однотипных значений с одного obj (ячейки АКБ, датчики температуры).
// Пакет: [fId, number (uint8), value (по type)] — каждый пакет обновляет одну ячейку.
//
// Компактная сетка: в ячейке номер (мелко) и значение; ячейки по возрастанию номера, по columns в строке.
// Ячейка с минимальным значением подсвечивается синим, с максимальным — красным.
//
// config:
//   format   — формат ЗНАЧЕНИЯ ячейки: "${value:%1.3f}" (номер выводится отдельно)
//   columns  — ячеек в строке (по умолчанию 8)
//   interval — мс, автозапрос всех значений; кнопки «Запрос» нет.
//              0 или не задан — только ручной запрос кнопкой ⟳

const FID_REQUEST = 0x11;

export class StreamWidget extends UIWidget
{
	static type = 'stream';

	Render()
	{
		const interval = Number(this.config.interval) || 0;

		this.element.innerHTML =
		`<div class="ui_root ui-stream">
			<div class="ui-stream_head">
				<div class="ui_title ui-stream_title">${escapeHtml(this.config.name)}</div>
				${interval > 0 ? '' : '<button class="ui-stream_request" title="Запросить значения">⟳</button>'}
			</div>
			<div class="ui-stream_content" style="grid-template-columns: repeat(${this.config.columns || 8}, auto)"></div>
		</div>`;

		this.refs.container = this.element.querySelector('.ui-stream_content');
		this.refs.cells = new Map(); // number -> { el, val, value }

		if(interval > 0)
		{
			this.Request();
			this.timer = setInterval(() => this.Request(), interval);
		}
		else
		{
			this.element.querySelector('.ui-stream_request').addEventListener('click', () => this.Request());
		}

		this.Subscribe();
	}

	Destroy()
	{
		clearInterval(this.timer);
		super.Destroy();
	}

	Request()
	{
		WSSendCanMsg(this.id, [FID_REQUEST]); // нет связи — просто не уйдёт
	}

	Update(rx_data)
	{
		const number = readNumberFromArray(rx_data, 1, 'uint8');
		const { value, value_raw } = this.ReadValue(rx_data, 2);
		if(number === null || value === null) return; // короткий пакет

		let cell = this.refs.cells.get(number);
		if(!cell)
		{
			cell = this.#createCell(number);
			this.refs.cells.set(number, cell);
		}

		cell.value = value;
		cell.val.textContent = sprintfNamed(this.config.format || '${value}', { number, value, value_raw });

		this.#markMinMax();
	}

	#createCell(number)
	{
		const el = document.createElement('div');
		el.className = 'ui-stream_cell';
		el.dataset.number = number;
		el.innerHTML = `<span class="ui-stream_num">${String(number).padStart(2, '0')}</span><span class="ui-stream_val"></span>`;

		// По возрастанию номера
		const next = [...this.refs.container.children].find(c => Number(c.dataset.number) > number);
		this.refs.container.insertBefore(el, next ?? null);

		return { el, val: el.querySelector('.ui-stream_val'), value: null };
	}

	// Подсветка минимума и максимума (если значения не все одинаковые)
	#markMinMax()
	{
		const values = [...this.refs.cells.values()].map(c => c.value);
		const min = Math.min(...values);
		const max = Math.max(...values);
		const differ = min !== max;

		for(const cell of this.refs.cells.values())
		{
			cell.el.classList.toggle('is-min', differ && cell.value === min);
			cell.el.classList.toggle('is-max', differ && cell.value === max);
		}
	}
}
