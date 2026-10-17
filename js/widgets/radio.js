import { UIWidget } from './base.js';
import { escapeHtml } from '../format.js';
import { parseValueList } from '../parse.js';
import { Control } from '../client/control.js';

let groupCounter = 0; // уникальное name для каждой группы радиокнопок

export class RadioWidget extends UIWidget
{
	static type = 'radio';
	static multiObj = true;

	Render()
	{
		this.element.innerHTML =
		`<div class="ui_root ui-radio">
			<div class="ui_title ui-radio_title">${escapeHtml(this.config.name)}</div>
			<div class="ui-radio_content"></div>
		</div>`;

		const container = this.element.querySelector('.ui-radio_content');
		const groupName = `ui-radio-${++groupCounter}`;
		this.refs.options = new Map(); // значение -> { input, label }

		for(const [value, name] of parseValueList(this.config.radios))
		{
			const input = document.createElement('input');
			input.type = 'radio';
			input.name = groupName;
			input.addEventListener('click', (e) =>
			{
				e.preventDefault(); // отметку ставит только ответ устройства (Show)
				if(!this.config.readonly) this.control.set(value);
			});

			const label = document.createElement('label');
			label.append(input, name);
			container.appendChild(label);

			this.refs.options.set(value, { input, label });
		}

		this.control = new Control(this.ids, this.config, () => this.Show());

		for(const id of this.ids) this.Subscribe(id);
		this.Show();
	}

	Destroy()
	{
		this.control.destroy();
		super.Destroy();
	}

	Update(rx_data, id)
	{
		this.control.onPacket(id, rx_data);
	}

	Show()
	{
		const c = this.control;

		for(const [value, { input, label }] of this.refs.options)
		{
			input.checked = c.value === value;                                  // отмечено подтверждённое
			input.disabled = !!this.config.readonly || c.busy;
			label.classList.toggle('is-target', c.busy && c.target === value);  // что ждём
		}

		c.showState(this.element);
	}
}
