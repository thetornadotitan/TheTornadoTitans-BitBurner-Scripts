import {threadCalc, getAllServers, formatUSD, nukeServer, replicateFiles} from "./helpers.js";
/** @param {NS} ns */
export async function main(ns) {
	const allServers = getAllServers(ns);

	allServers.sort((a, b) =>{ 
		return ns.getServerMaxMoney(a) - ns.getServerMaxMoney(b); 
	})

	for (const server of allServers) {
		ns.tprint(`Server: ${server}\nholds up to: ${formatUSD(ns,ns.getServerMaxMoney(server))} \nRoot Access: ${ns.hasRootAccess(server)}\nLvl Required: ${ns.getServerRequiredHackingLevel(server)}`);
	}
}