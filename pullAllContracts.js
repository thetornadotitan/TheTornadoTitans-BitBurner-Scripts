import {getAllServers} from "./helpers.js";

/** @param {NS} ns */
export async function main(ns) {

	// Gets all servers.
	const targets = getAllServers(ns);

	targets.forEach(target => {
		const files = ns.ls(target);
		files.forEach(file => {
			if (file.endsWith(".cct")) {
				ns.scp(file, target, "home");
				ns.tprint(`Moving: ${file}`);
			}
		})
	});
}