import { UIWidget } from './base.js';
import { readNumberFromArray } from '../parse.js';
import { sprintfNamed, escapeHtml } from '../format.js';
import { SimpleChart } from '../simple-chart.js';

const EXPR_OPS = {
	'<': (a, b) => a < b,
	'<=': (a, b) => a <= b,
	'>': (a, b) => a > b,
	'>=': (a, b) => a >= b,
	'=': (a, b) => a === b,
	'!=': (a, b) => a !== b,
};

export class ValueWidget extends UIWidget
{
	static type = 'value';

	#exprRules = [];

	Render()
	{
		this.element.innerHTML =
		`<div class="ui_root ui-value">
			<div class="ui_title ui-value_title">${escapeHtml(this.config.name)}</div>
			<div class="ui-value_content">
				<div class="ui-value_value">-</div>
				<div class="ui_chart ui-value_chart" style="display: none;"></div>
			</div>
		</div>`;

		this.refs.value = this.element.querySelector('.ui-value_value');

		if(this.config.chart)
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

		this.#exprRules = this.#compileExpr(this.config.expr);

		this.Subscribe();
	}

	Destroy()
	{
		// Без этого ResizeObserver и requestAnimationFrame графика остаются жить после каждого переключения вкладки.
		if(this.refs.chart)
		{
			this.refs.chart.destroy();
			this.refs.chart = null;
		}
		super.Destroy();
	}

	Update(rx_data)
	{
		const fId = readNumberFromArray(rx_data, 0, 'uint8');
		const { value, value_raw } = this.ReadValue(rx_data);
		if(value === null) return;

		const data = { value, value_raw, expr: this.#expr(value) };

		this.refs.value.innerHTML = sprintfNamed(this.config.format, data);
		if(this.refs.chart)
		{
			// Неизвестный тип пакета не должен ронять Update (setState бросает исключение).
			const state = this.timer_type[fId];
			if(state) this.refs.chart.setState(state);
			this.refs.chart.push(value);
		}
	}

	#compileExpr(rules)
	{
		if(!Array.isArray(rules)) return [];

		const compiled = [];
		for (const rule of rules)
		{
			if(rule.length === 1)
			{
				compiled.push({ test: () => true, out: rule[0] });
				continue;
			}

			const [op, limit, out] = rule;
			const cmp = EXPR_OPS[op];
			if(!cmp)
			{
				console.warn('expr: неизвестный оператор', op, 'в', this.id);
				continue;
			}
			compiled.push({ test: v => cmp(v, limit), out });
		}
		return compiled;
	}

	#expr(value)
	{
		for (const r of this.#exprRules)
			if(r.test(value)) return r.out;
		return '';
	}

}
