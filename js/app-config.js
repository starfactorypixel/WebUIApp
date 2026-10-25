// Вход config.html: найденные блоки и настройка выбранного.
//
//   пакет 0x0A (Raw) → карточка блока (BlockInfo)
//   клик по карточке  → панель настроек (BlockParams): параметры из blocks.json, чтение/запись

import { WSEvents, WSStart } from './utils/ws.js';
import { BlockInfo, FID_BLOCK_INFO } from './config/blockinfo.js';
import { BlockParams } from './config/blockparams.js';
import blocks_json from '../data/blocks.json' with { type: 'json' };

const WS_URL = 'ws://localhost:8080';

const params = new BlockParams(document.getElementById('params'), blocks_json, () => blocks.select(null));

const blocks = new BlockInfo(document.getElementById('blocks'), blocks_json.blocks, (info) =>
{
	if(params.baseID === info.baseID) return; // уже открыт
	params.Open(info);
	blocks.select(info.baseID);
});

WSEvents.addEventListener('packetRaw', (e) =>
{
	const { bytes } = e.detail;
	if(bytes[0] === FID_BLOCK_INFO) blocks.processPacket(bytes);
});

WSStart(WS_URL);
