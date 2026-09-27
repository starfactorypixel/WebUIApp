import { UIWidget } from './base.js';
import { readNumberFromArray, writeNumberToArray } from '../parse.js';
import { WSSendRaw, AddSubscribe } from '../ws.js';

export class RadioWidget extends UIWidget
{
	static type = 'radio';

	Render()
	{
		this.element.innerHTML =
		`<div class="ui-radio">
            <div class="ui_title ui-radio_title">${this.config.name}</div>
            <div class="ui-radio_content"></div>
        </div>`;

		this.refs.container = this.element.querySelector('.ui-radio_content');
		this.refs.radios = new Map(); // value_raw (число) -> input, без querySelector на каждый пакет

		this.buildOptions();

		AddSubscribe(this.id);
	}

	buildOptions()
	{
		this.config.radios.split(',').forEach(item =>
		{
			const [rawValue, name] = item.split(':');
			const value_raw = Number(rawValue);

			const radio = document.createElement('input');
			radio.type = 'radio';
			radio.name = 'id' + this.id;
			radio.value = value_raw;
			radio.disabled = !!this.config.readonly;
			radio.addEventListener('click', () => 
			{
				const payload = writeNumberToArray(value_raw, this.config.type, true);
				WSSendRaw(0x15, this.id, [0x01, ...payload]);
			});

			const label = document.createElement('label');
			label.textContent = name;
			label.prepend(radio);

			this.refs.container.appendChild(label);
			this.refs.radios.set(value_raw, radio);
		});
	}

	Update(rx_data)
	{
		const value_raw = readNumberFromArray(rx_data, 1, this.config.type, true);

		const radio = this.refs.radios.get(value_raw);
		if (radio === undefined) return;
		radio.checked = true;
	}
}