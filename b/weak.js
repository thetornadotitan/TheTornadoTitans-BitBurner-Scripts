/** @param {NS} ns */
export async function main(ns) {
	//args = target, batchID, endTime, time, type;
	if(ns.args[0] == undefined) { ns.tprint("Missing Target Server"); return; }
	if(ns.args[1] == undefined) { ns.tprint("Missing Batch ID"); return; }
	if(ns.args[2] == undefined) { ns.tprint("Missing End Time"); return; }
	if(ns.args[3] == undefined) { ns.tprint("Missing Time"); return; }
	if(ns.args[4] == undefined) { ns.tprint("Missing Type"); return; }

	const target 	= ns.args[0];
	const batchID 	= ns.args[1];
	const endTime 	= ns.args[2];
	const time 		= ns.args[3];
	const type 		= ns.args[4];
	
	const delayMS1 = Date.now() - (endTime - time);

	if (delayMS1 > 0) ns.tprint(`${type} - started ${delayMS1}ms late.`);

	ns.writePort(19, Math.max(delayMS1,0));

	const actualStartTime = Date.now();
	const resultMessage = "Weakened: " + await ns.weaken(target, {additionalMsec: (delayMS1 < 0) ? 0 : delayMS1});
	const actualEndTime = Date.now();

	const delayMS2 = actualStartTime - endTime;
	
	const port = ns.getPortHandle(20);
	port.tryWrite(type);
	port.tryWrite(endTime);
	port.tryWrite(actualStartTime);
	port.tryWrite(actualEndTime);
	port.tryWrite(delayMS1);
	port.tryWrite(delayMS2);
	port.tryWrite(resultMessage);
}