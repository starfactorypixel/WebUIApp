import { UIWidget } from './base.js';
import { readNumberFromArray } from '../parse.js';
import { sprintfNamed } from '../format.js';
import { AddSubscribe } from '../ws.js';

export class MeterWidget extends UIWidget
{
	static type = 'meter';

	Render()
	{
		this.element.innerHTML =
		`<div class="ui-meter">
			<div class="ui_title ui-meter_title">${this.config.name}</div>
			<div class="ui-meter_content">
				<meter min="${this.config.min}" max="${this.config.max}" low="${this.config.low}" high="${this.config.high}" optimum="${this.config.optimum}" value="${this.config.min}"></meter>
				<div class="ui-meter_value"></div>
			</div>
		<div>`;

		this.refs.meter = this.element.querySelector('.ui-meter_content meter');
		this.refs.value = this.element.querySelector('.ui-meter_value');

		AddSubscribe(this.id);
	}

	Update(rx_data)
	{
		let value_raw = readNumberFromArray(rx_data, 1, this.config.type, true);
		let value = value_raw / this.config.scale;
		let data = { value: value, value_raw: value_raw };

		if (value_raw == 0) return;

		this.refs.meter.value = data.value;
		this.refs.meter.innerHTML = `[${this.config.min}__${data.value}__${this.config.max}]`;
		this.refs.value.innerHTML = sprintfNamed(this.config.format, data);
	}
}
