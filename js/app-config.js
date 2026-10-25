import { WSEvents, WSStart, WSSendCanMsg } from './utils/ws.js';
import { log } from './utils/loghtml.js';
import { readNumberFromArray, writeNumberToArray } from './utils/parse.js'
import { BlockInfo } from './config/blockinfo.js';
import blocks_json from '../data/blocks.json' with { type: 'json' };

const WS_URL = 'ws://localhost:8080';

const blocks_info = new BlockInfo(blocks_json.blocks);

WSEvents.addEventListener('packet', (e) => 
{
	const { id, bytes } = e.detail;

	const fId = bytes[0];				// fId CAN протокола, 0x37
	const cmd = bytes[1];				// Команда объекта BlockCFG
	const data_id = bytes[2];			// Id параметра объекта BlockCFG
	const data = bytes.slice(3);		// Data параметра объекта BlockCFG

	// Пришёл ответ на ID, который сейчас открыт у нас.
	if(id == CFG_ID)
	{
		// Пришёл пакет с fId BlockCFG
		if(fId == 0x37)
		{
			const root_obj = document.querySelector('.param-obj[data-id="' + data_id + '"]');
			if(root_obj == null) return;
			
			const root_data = JSON.parse(root_obj.dataset.data);
			const input_obj = root_obj.querySelector('.param_field input');

			switch(cmd)
			{
				// Получен ответ на запрос параметра
				case 0x01:
				{
					const value = readNumberFromArray(data, 0, root_data.type, true);
					input_obj.value = value;
					input_obj.disabled = false;

					break;
				}

				// Получен ответ на запись параметра
				case 0x02:
				{
					input_obj.disabled = false;
					
					break;
				}
				
				// Получен ответ на сохранение и перезагрузку
				case 0x03:
				{
					break;
				}

				// Получен ответ c ошибкой
				default:
				{
					console.log("Ошибка настроек: ", msg);
					
					break;
				}
			}
		}
	}
});

WSEvents.addEventListener('packetRaw', (e) => 
{
	const { bytes } = e.detail;
	
	if(bytes[0] == 0x0A)
	{
		//processPacket(bytes);
		blocks_info.processPacket(bytes)
		return;
	}
});

		const BLOCK_TYPE = 30;
		const BLOCK_ID = 0x0160;
		const CFG_ID = BLOCK_ID + 1;

		RenderUI(BLOCK_TYPE);

WSStart(WS_URL);

function RenderUI(block_type)
{
	let block_json_data = null;
	blocks_json.blocks.forEach((block) => 
	{
		if(block.type == block_type)
		{
			block_json_data = block;
			return;
		}
	});

	console.log(block_json_data);

	block_json_data.params.forEach((param) => 
	{
		const root_obj = document.createElement('div');
		root_obj.classList.add('param-obj');
		root_obj.dataset.id = param.id;
		root_obj.dataset.data = JSON.stringify(param);
		root_obj.innerHTML = `
		<div class="param_id">${param.id}</div>
		<div class="param_namedisc">
			<div class="param_name">${param.name}</div>
			<div class="param_disc">${param.disc}</div>
		</div>
		<div class="param_field">
			<input type="number" min="${param.filter.min}" max="${param.filter.max}" step="${param.filter.step}" />
		</div>
		<div class="param_ctrl">
			<button data-cmd="read" title="Прочитать">📥</button> 
			<button data-cmd="write" title="Записать">💾</button> 
			<button data-cmd="reset" title="Сбросить">🔄</button> 
		</div>`;
		
		root_obj.querySelector('button[data-cmd="read"]').addEventListener('click', function(e)
		{
			ReadParam(e.currentTarget);
		});

		root_obj.querySelector('button[data-cmd="write"]').addEventListener('click', function(e)
		{
			WriteParam(e.currentTarget)
		});

		root_obj.querySelector('button[data-cmd="reset"]').addEventListener('click', function(e)
		{
			ResetParam(e.currentTarget)
		});
		
		const params_container = document.getElementById('params_container');
		params_container.appendChild(root_obj);
	});

	ReadAllParam();
}

function ReadParam(obj)
{
	const root = obj.closest('.param-obj');
	const field = root.querySelector('.param_field input');
	const data = JSON.parse(root.dataset.data);

	field.disabled = true;

	WSSendCanMsg(CFG_ID, [0x37, 0x01, data.id]);
}

function ReadAllParam()
{
	const buttons = params_container.querySelectorAll('.param-obj .param_ctrl button:first-child');
	buttons.forEach((button) => 
	{
		button.click();
	});
}

function WriteParam(obj)
{
	const root = obj.closest('.param-obj');
	const field = root.querySelector('.param_field input');
	const data = JSON.parse(root.dataset.data);

	if(field.reportValidity() == false) return;

	field.disabled = true;

	const value = writeNumberToArray(parseInt(field.value), data.type, true);
	WSSendCanMsg(CFG_ID, [0x37, 0x02, data.id, ...value]);
}

function ResetParam(obj)
{
	const root = obj.closest('.param-obj');
	const field = root.querySelector('.param_field input');
	const data = JSON.parse(root.dataset.data);

	field.value = data.default;
}
