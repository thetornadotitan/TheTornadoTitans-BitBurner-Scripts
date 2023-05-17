import {getAllServers} from "./helpers.js";

/** @param {NS} ns */
export async function main(ns) {

	// Gets all servers.
	const targets = getAllServers(ns);

	targets.forEach(target => {
		const files = ns.ls(target);
		for (let i = files.length - 1; i >= 0; i--) {
			if (files[i].endsWith(".js")) files.splice(i, 1);
		}

		if(files.length > 0) ns.tprint(`--- ${target} ---`);
		files.forEach(file => {
			ns.tprint(`\t ${file}`);
		});
	});
}