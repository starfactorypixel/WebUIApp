import { UIWidget } from './base.js';
import { readNumberFromArray } from '../parse.js';
import { sprintfNamed } from '../format.js';
import { WSSendRaw, WSSubscribe } from '../ws.js';

export class StreamWidget extends UIWidget
{
	static type = 'stream';

	Render()
	{
		this.element.innerHTML =
		`<div class="ui-stream">
			<div class="ui_title ui-stream_title">${this.config.name}</div>
			<div class="ui-stream_content"></div>
			<div class="ui-stream_control">
				<button>Запрос</button>
			</div>
		</div>`;

		this.refs.container = this.element.querySelector('.ui-stream_content');
		this.refs.cells = new Map();

		const button = this.element.querySelector('.ui-stream_control button');
		button.addEventListener('click', () => 
		{
			WSSendRaw(0x15, this.id, [0x11]);
		});

		WSSubscribe([this.id]);
	}

	Update(rx_data)
	{
		const rx_num = readNumberFromArray(rx_data, 1, 'uint8', true);
		/*const*/ let rx_val_raw = readNumberFromArray(rx_data, 2, this.config.type, true);
		rx_val_raw += this.getRandomInt(3200, 4200);
		const rx_value = rx_val_raw / this.config.scale;
		const template_data = { number: rx_num, value: rx_value, value_raw: rx_val_raw };
		const text = sprintfNamed(this.config.format, template_data);

		let cell_obj = this.refs.cells.get(rx_num);
		if (cell_obj !== undefined)
		{
			cell_obj.textContent = text;
		}
		else
		{
			cell_obj = document.createElement('span');
			cell_obj.classList.add('ui-stream_element');
			cell_obj.dataset.number = rx_num;
			cell_obj.textContent = text;

			this.refs.cells.set(rx_num, cell_obj);
			this.insertSorted(rx_num, cell_obj);
		}

	}

	insertSorted(num, cell_obj)
	{
		const container = this.refs.container;
		const children = container.children;

		for (let i = 0; i < children.length; i++)
		{
			if (Number(children[i].dataset.number) > num)
			{
				container.insertBefore(cell_obj, children[i]);
				return;
			}
		}
		container.appendChild(cell_obj); // либо контейнер пуст, либо num больше всех существующих
	}

	// Для отладки, временно
	getRandomInt(min, max)
	{
		min = Math.ceil(min);
		max = Math.floor(max);
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}
}
