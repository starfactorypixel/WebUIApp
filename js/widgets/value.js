import { UIWidget } from './base.js';
import { readNumberFromArray } from '../parse.js';
import { sprintfNamed } from '../format.js';
import { WSSubscribe } from '../ws.js';
import { SimpleChart } from '../simple-chart.js'

export class ValueWidget extends UIWidget
{
	static type = 'value';

	Render()
	{
		this.element.innerHTML =
		`<div class="ui-value">
			<div class="ui_title ui-value_title">${this.config.name}</div>
			<div class="ui-value_content">
				<div class="ui-value_value">-</div>
				<div class="ui_chart ui-value_chart" style="display: none;"></div>
			</div>
		</div>`;

		this.refs.value = this.element.querySelector('.ui-value_value');

		if (this.config.chart)
		{
			const obj = this.element.querySelector('.ui-value_chart');
			obj.style.removeProperty('display');

			this.refs.chart = new SimpleChart(
			{
				container: obj,
				windowSize: this.config.chart.count,
				fillMode: this.config.chart.mode,
				lineWidth: 1,
				fillOpacity: 0.5,
				grid: false,
			});
		}

		WSSubscribe([this.id]);
	}

	Update(rx_data)
	{
		let fId = readNumberFromArray(rx_data, 0, 'uint8');
		let value_raw = readNumberFromArray(rx_data, 1, this.config.type);
		let value = value_raw / this.config.scale;
		let data = { value: value, value_raw: value_raw };

		//if (value_raw == 0) return;

		this.refs.value.innerHTML = sprintfNamed(this.config.format, data);
		if (this.refs.chart)
		{
			//if (value > 15.0) fId++;
			//if (value > 30.0) fId++;

			this.refs.chart.setState(this.timer_type[fId]);
			this.refs.chart.push(value);
		}
	}

}
