import { UIWidget } from './base.js';
import { readNumberFromArray } from '../parse.js';
import { sprintfNamed, escapeHtml } from '../format.js';

export class MeterWidget extends UIWidget
{
	static type = 'meter';

	Render()
	{
		const c = this.config;
		this.element.innerHTML =
		`<div class="ui_root ui-meter">
			<div class="ui_title ui-meter_title">${escapeHtml(c.name)}</div>
			<div class="ui-meter_content">
				<meter min="${c.min}" max="${c.max}" low="${c.low}" high="${c.high}" optimum="${c.optimum}" value="${c.min}"></meter>
				<div class="ui-meter_value"></div>
			</div>
		</div>`;

		this.refs.meter = this.element.querySelector('.ui-meter_content meter');
		this.refs.value = this.element.querySelector('.ui-meter_value');

		this.Subscribe();
	}

	Update(rx_data)
	{
		const data = this.ReadValue(rx_data);
		if(data.value === null) return;

		if(this.config.level) this.ShowLevel(readNumberFromArray(rx_data, 0, 'uint8')); // только если включено в config

		this.refs.meter.value = data.value;
		this.refs.meter.textContent = `[${this.config.min}__${data.value}__${this.config.max}]`;
		this.refs.value.innerHTML = sprintfNamed(this.config.format, data);
	}
}
