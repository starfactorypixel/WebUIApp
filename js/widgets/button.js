import { UIWidget } from './base.js';
import { readNumberFromArray } from '../parse.js';
import { sprintfNamed } from '../format.js';
import { WSSendRaw, WSSubscribe } from '../ws.js';

export class ButtonWidget extends UIWidget
{
	static type = 'button';

	#txtMap = new Map();

	Render()
	{
		this.element.innerHTML =
		`<div class="ui-button">
			<div class="ui_title ui-button_title">${this.config.name}</div>
			<div class="ui-button_content">
				<button>-</button>
			</div>
		</div>`;

		this.refs.btn = this.element.querySelector('.ui-button_content button');
		this.refs.btn.addEventListener('click', () =>
		{
			WSSendRaw(0x15, this.id, [0x02]);
		});
		
		if (this.config.txt)
		{
			for (const item of this.config.txt.split(','))
			{
				const [pValue, pName] = item.split(':');
				this.#txtMap.set(Number(pValue), pName);
			}
		}
		
		WSSubscribe([this.id]);
	}

	Update(rx_data)
	{
		let value_raw = readNumberFromArray(rx_data, 1, this.config.type);
		let value = value_raw / this.config.scale;
		let data = { value: value, value_raw: value_raw, icon1: this.#icon1(value_raw), txt: this.#txt(value_raw) };

		this.refs.btn.innerHTML = sprintfNamed(this.config.format, data);
	}

	#icon1(value)
	{
		if (value === null) return '🟡';
		if (value === 0) return '🔴';
		return '🟢';
	}

	#txt(value)
	{
		const name = this.#txtMap.get(value);
		return name !== undefined ? name : '-';
	}
}
