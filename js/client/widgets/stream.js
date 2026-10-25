import { UIWidget } from './base.js';
import { readNumberFromArray } from '../../parse.js';
import { sprintfNamed, escapeHtml } from '../../format.js';
import { WSSendRaw } from '../../ws.js';

export class StreamWidget extends UIWidget
{
	static type = 'stream';

	Render()
	{
		this.element.innerHTML =
		`<div class="ui_root ui-stream">
			<div class="ui_title ui-stream_title">${escapeHtml(this.config.name)}</div>
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

		this.Subscribe();
	}

	Update(rx_data)
	{
		const rx_num = readNumberFromArray(rx_data, 1, 'uint8', true);
		const { value: rx_value, value_raw: rx_val_raw } = this.ReadValue(rx_data, 2);
		if(rx_num === null || rx_val_raw === null) return; // короткий пакет

		const template_data = { number: rx_num, value: rx_value, value_raw: rx_val_raw };
		const text = sprintfNamed(this.config.format, template_data);

		let cell_obj = this.refs.cells.get(rx_num);
		if(cell_obj !== undefined)
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
			if(Number(children[i].dataset.number) > num)
			{
				container.insertBefore(cell_obj, children[i]);
				return;
			}
		}
		container.appendChild(cell_obj); // либо контейнер пуст, либо num больше всех существующих
	}
}
