/** @param {NS} ns */
export async function main(ns) {
	ns.disableLog("ALL");

	while(true) {
		if (ns.hacknet.getPurchaseNodeCost() < ns.getPlayer().money) ns.hacknet.purchaseNode();

		let totalLevels = 0;
		let totalRam = 0;
		let totalCores = 0;

		for (let i = 0; i < ns.hacknet.numNodes(); i++) {
			if(ns.hacknet.getLevelUpgradeCost(i, 1) < ns.getPlayer().money) ns.hacknet.upgradeLevel (i, 1);
			if(ns.hacknet.getRamUpgradeCost  (i, 1) < ns.getPlayer().money) ns.hacknet.upgradeRam   (i, 1);
			if(ns.hacknet.getCoreUpgradeCost (i, 1) < ns.getPlayer().money) ns.hacknet.upgradeCore  (i, 1);
			if(ns.hacknet.getCacheUpgradeCost(i, 1) < ns.getPlayer().money) ns.hacknet.upgradeCache (i, 1);

			const nodeStat = ns.hacknet.getNodeStats(i);
			totalLevels += nodeStat.level;
			totalRam += nodeStat.ram;
			totalCores += nodeStat.cores;
		}

		ns.clearLog();

		ns.print(`Hacknet Stats:`);
		ns.print(`Total Nodes: ${ns.hacknet.numNodes()}`);
		ns.print(`Total Levels: ${totalLevels}`);
		ns.print(`Total RAM: ${totalRam}`);
		ns.print(`Total Cores: ${totalCores}`);

		await ns.sleep(10);
	}
}