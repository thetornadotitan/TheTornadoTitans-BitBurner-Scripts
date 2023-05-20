/** @param {NS} ns */
export async function main(ns) {
	const target = ns.args[0];
	const endTime = ns.args[1];
	const time = ns.args[2];

	let delay = endTime - time - Date.now();
	if (delay < 0) ns.writePort(20, -delay);
	delay = Math.max(delay, 0);

	await ns.weaken(target, {additionalMsec: delay});
}