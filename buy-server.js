import {formatUSD} from "./helpers.js";

/** @param {NS} ns */
export async function main(ns) {
	ns.disableLog("ALL");

	while(true) {
		const servers = ns.getPurchasedServers();
		let currentHighestRam = 0;
		servers.forEach(server => {
			if (ns.getServerMaxRam(server) > currentHighestRam) {
				currentHighestRam = ns.getServerMaxRam(server);
			}
		});
		const numServers = servers.length;
		const ramGB = ((2 * Math.pow(2, numServers)) < ns.getPurchasedServerMaxRam()) ? 2 * Math.pow(2, numServers) : ns.getPurchasedServerMaxRam();
		const limit = ns.getPurchasedServerLimit();
		const cost = ns.getPurchasedServerCost(ramGB);

		if(cost <= ns.getPlayer().money && numServers < limit)
			ns.purchaseServer("Tatsu.pwn", ramGB);

		servers.forEach(server => {
			if (ns.getPurchasedServerUpgradeCost(server, currentHighestRam) < ns.getPlayer().money) ns.upgradePurchasedServer(server, currentHighestRam);
		});
		
		ns.clearLog();
		let moneyInvested = 0;

		ns.print(`------------Server List:------------`);
		servers.forEach(server => {
			ns.print(server.padEnd(13) + `- ${ns.getServerMaxRam(server)}`);
			moneyInvested += ns.getPurchasedServerCost(ns.getServerMaxRam(server));
		})
		ns.print(`------------------------------------`);
		
		ns.print(`Servers Info`);
		ns.print(`Servers: ${numServers}/${limit}`);
		ns.print(`Cost for Next Server: ${formatUSD(ns, cost)}`);
		ns.print(`Cost per Server Upgrade: ${formatUSD(ns, ns.getPurchasedServerCost(currentHighestRam))}`);
		ns.print(`Money Invested: ${formatUSD(ns, moneyInvested)}`);

		await ns.sleep(10);
	}
}