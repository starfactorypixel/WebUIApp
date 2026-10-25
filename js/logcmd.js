'use strict';
/*
Неблокирующий лог, общий для всего сервера: строки копятся и уходят одной записью раз в FLUSH_MS.
Консоль медленная (особенно в Windows): запись на каждую строку тормозит весь сервер.

	const Log = require('./logcmd.js');
	Log.init(config.log);			// один раз при старте: file — писать в файл вместо консоли
	const log = Log.source('ws');	// log(...) -> "[12:00:00:000] [ws] ..."
*/

const fs = require('fs');
const util = require('util');

const FLUSH_MS = 50;

let out = process.stdout;
let queue = [];
let timer = null;
let busy = false;

function init(cfg)
{
	if(cfg.file) out = fs.createWriteStream(cfg.file, { flags: 'a' });
}

function source(name)
{
	const prefix = ' [' + name + '] ';

	return (...args) =>
	{
		queue.push(time() + prefix + util.format(...args));
		if(timer === null && !busy) timer = setTimeout(flush, FLUSH_MS);
	};
}

function flush()
{
	timer = null;

	// Поток не принял пачку целиком — следующая после 'drain'
	if(out.write(take()) === false)
	{
		busy = true;
		out.once('drain', () => { busy = false; if(queue.length) flush(); });
	}
}

function take()
{
	const text = queue.join('\n') + '\n';
	queue = [];
	return text;
}

// [HH:MM:SS:mmm]
function time()
{
	const d = new Date();
	const p = (n, w) => String(n).padStart(w, '0');
	return '[' + p(d.getHours(), 2) + ':' + p(d.getMinutes(), 2) + ':' + p(d.getSeconds(), 2) + ':' + p(d.getMilliseconds(), 3) + ']';
}

// Остаток очереди при выходе — синхронно
process.on('exit', () =>
{
	if(queue.length === 0) return;
	try { fs.writeSync(out === process.stdout ? 1 : out.fd, take()); } catch(e) {}
});

module.exports = { init, source };
