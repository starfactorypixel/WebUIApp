import { UIWidget } from './base.js';
import { sprintfNamed, escapeHtml } from '../../format.js';
import { Control } from '../control.js';

export class RangeWidget extends UIWidget
{
	static type = 'range';
	static multiObj = true;

	Render()
	{
		const c = this.config;
		const min = c.min ?? 0;
		const max = c.max ?? 100;
		const step = c.step ?? 1;
		this.scale = c.scale || 1;

		this.element.innerHTML =
		`<div class="ui_root ui-range">
			<div class="ui_title ui-range_title">${escapeHtml(c.name)}</div>
			<div class="ui-range_content">
				<input type="range" min="${min}" max="${max}" step="${step}" value="${min}">
				<div class="ui-range_value">-</div>
			</div>
		</div>`;

		this.refs.input = this.element.querySelector('.ui-range_content input');
		this.refs.value = this.element.querySelector('.ui-range_value');

		// Тянут — меняется только подпись
		this.refs.input.addEventListener('input', () =>
		{
			this.refs.value.innerHTML = this.Format(Number(this.refs.input.value));
		});

		// Отпустили (или стрелка на клавиатуре) — отправляем
		this.refs.input.addEventListener('change', () =>
		{
			const raw = Number(this.refs.input.value) * this.scale;
			const isFloat = (this.config.type || '').startsWith('float');
			this.control.set(isFloat ? raw : Math.round(raw));
		});

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
		const input = this.refs.input;
		input.disabled = !!this.config.readonly || c.busy;

		if(c.busy) // ждём ответ — ползунок там, где отпустили
		{
			input.value = c.target / this.scale;
			this.refs.value.innerHTML = '⏳ ' + this.Format(c.target / this.scale);
		}
		else if(c.value !== null) // подтверждённое значение
		{
			input.value = c.value / this.scale;
			this.refs.value.innerHTML = this.Format(c.value / this.scale);
		}
		else
		{
			this.refs.value.textContent = c.mixed ? 'смеш.' : '-';
		}

		c.showState(this.element);
	}

	Format(value)
	{
		return sprintfNamed(this.config.format || '${value}', { value, value_raw: Math.round(value * this.scale) });
	}
}
