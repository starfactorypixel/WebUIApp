const blocksMap = new Map(); // baseID -> DOM элемент

function parsePacket(byteArray) {
    const data = byteArray instanceof Uint8Array
        ? byteArray
        : new Uint8Array(byteArray);

    const view = new DataView(data.buffer);

    let offset = 1; // старт со смещения 1

    const baseID = view.getUint16(offset, true);
    offset += 2;

    const hw_type = view.getUint8(offset++);
    const hw_ver = view.getUint8(offset++);

    const sw_ver = view.getUint8(offset++);
    const can_ver = view.getUint8(offset++);

    const sn = [];
    for (let i = 0; i < 8; i++)
	{
        sn.push(view.getUint8(offset++));
    }

    const features = [];
    for (let i = 0; i < 7; i++)
	{
        features.push(view.getUint8(offset++));
    }

    const uptime = view.getUint32(offset, true);
    offset += 4;

    const voltage = view.getUint16(offset, true);
    offset += 2;

    const current = view.getUint16(offset, true);
    offset += 2;

    const temperature = view.getInt8(offset++);
    const error_flags = view.getUint8(offset++);



    return {
        baseID,
        hw_type,
        hw_ver,
        sw_ver,
        can_ver,
		sn: sn.map(v => v.toString(16).padStart(2, "0")).join(":"),
		features: features.map(v => v.toString(16).padStart(2, "0")).join(":"),
        uptime,
        voltage,
        current,
        temperature,
        error_flags,
    };
}

function createOrUpdateBlock(info) {
    let block = blocksMap.get(info.baseID);

    if (!block) {
        block = document.createElement("div");
        block.className = "device-block";
        block.dataset.baseid = info.baseID;

        block.innerHTML = `
			<div style="text-align: center;">
				<span class="baseID" style="font-size: 22px;"></span> <br>
				<span class="sn"></span>
			</div>
			<hr>
			<div>HW Type: <span class="hw_type"></span></div>
			<div>HW Ver: <span class="hw_ver"></span></div>
			<div>SW Ver: <span class="sw_ver"></span></div>
			<div>CAN Ver: <span class="can_ver"></span></div>
			<div>Uptime: <span class="uptime"></span></div>
			<div>Voltage: <span class="voltage"></span></div>
			<div>Current: <span class="current"></span></div>
			<div>Temperature: <span class="temperature"></span></div>
			<div>Error Flags: <span class="error_flags"></span></div>
        `;

        document
            .getElementById("blocksContainer")
            .appendChild(block);

        blocksMap.set(info.baseID, block);
    }

    block.querySelector(".baseID").textContent = int2hex(info.baseID, 4);
    block.querySelector(".hw_type").textContent = info.hw_type;
    block.querySelector(".hw_ver").textContent = info.hw_ver;
    block.querySelector(".sw_ver").textContent = info.sw_ver;
    block.querySelector(".can_ver").textContent = info.can_ver;
    block.querySelector(".uptime").textContent = fastFormatMs(info.uptime) + " ms";
    block.querySelector(".voltage").textContent = info.voltage + " mV";
    block.querySelector(".current").textContent = info.current + " mA";
    block.querySelector(".temperature").textContent = info.temperature + " °C";
    block.querySelector(".error_flags").textContent = "0b" + info.error_flags.toString(2).padStart(8, "0");
    block.querySelector(".sn").textContent = info.sn;
}

function processPacket(packetBytes) {
    const parsed = parsePacket(packetBytes);
    createOrUpdateBlock(parsed);
}