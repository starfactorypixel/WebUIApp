import { UIWidget } from './base.js';
import { sprintfNamed, escapeHtml } from '../../utils/format.js';
import { parseValueList } from '../../utils/parse.js';
import { Control } from '../control.js';

export class ButtonWidget extends UIWidget
{
	static type = 'button';
	static multiObj = true;

	Render()
	{
		this.element.innerHTML =
		`<div class="ui_root ui-button">
			<div class="ui_title ui-button_title">${escapeHtml(this.config.name)}</div>
			<div class="ui-button_content">
				<button>-</button>
			</div>
		</div>`;

		this.refs.btn = this.element.querySelector('.ui-button_content button');
		this.refs.btn.addEventListener('click', () => this.OnClick());

		this.txt = parseValueList(this.config.txt);
		this.control = new Control(this.ids, this.config, () => this.Show());

		for(const id of this.ids) this.Subscribe(id);
		this.Show();
	}

	Destroy()
	{
		this.control.destroy();
		super.Destroy();
	}

	// Пакет от любого из obj → в Control, он вызовет Show()
	Update(rx_data, id)
	{
		this.control.onPacket(id, rx_data);
	}

	OnClick()
	{
		const c = this.control;
		const cmd = this.config.cmd ?? (this.ids.length > 1 ? 'set' : 'toggle');

		if(cmd === 'toggle') c.toggle();
		else if(cmd === 'action') c.action();
		else
		{
			// set: было включено → выключаем, иначе (выкл/смешано/неизвестно) → включаем
			const on = this.config.on ?? 255;
			const off = this.config.off ?? 0;
			c.set(c.value === on ? off : on);
		}
	}

	Show()
	{
		const c = this.control;
		const v = c.value;

		let icon = v === null ? '🟡' : (v === 0 ? '🔴' : '🟢');
		if(c.mixed) icon = '⚠️';
		if(c.busy) icon = '⏳';

		const data =
		{
			value: v === null ? null : v / (this.config.scale || 1),
			value_raw: v,
			icon1: icon,
			txt: c.mixed ? 'смеш.' : (this.txt.get(v) ?? '-'),
			count: `${c.values.size}/${this.ids.length}`,
		};

		this.refs.btn.innerHTML = sprintfNamed(this.config.format, data);
		this.refs.btn.disabled = c.busy;
		c.showState(this.element);
	}
}
