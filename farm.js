import {threadCalc, getAllServers, formatUSD, nukeServer, replicateFiles} from "./helpers.js";

/** @param {NS} ns */
export async function main(ns) {
	//Disable default logs
	ns.disableLog("ALL");
	
	const getActionSummary = (type) => {
		let smallestMilis = Infinity;
		let numServersWeakening = 0;
		let threads = 0;
		let toRemove = [];

		for (const ti of targetsInfo.keys()){
			if(targetsInfo.get(ti).type == type) {
				threads = targetsInfo.get(ti).threads;
				numServersWeakening++;
				if (targetsInfo.get(ti).milis <= smallestMilis) smallestMilis = targetsInfo.get(ti).milis;
				if (targetsInfo.get(ti).milis - ns.getTimeSinceLastAug() < 1) toRemove.push(ti);
			}
		}

		for (const r of toRemove) {
			targetsInfo.delete(r);
		}

		if(numServersWeakening > 0)
			return `Running - ${threads} | ${Math.floor((smallestMilis - ns.getTimeSinceLastAug()) / 1000)}`
		else
			return "None Queued";
	}

	const getActionCount = (type) => {
		let numActions = 0;

		for (const ti of targetsInfo.values()){
			if(ti.type == type) numActions++;
		}

		return numActions;
	}

	const getActionChange = (type) => {
		let totalChange = 0;

		for (const ti of targetsInfo.values()){
			if(ti.type == type && type == 0) totalChange += ns.weakenAnalyze(ti.threads);
		}

		return totalChange;
	}

	// Gets all servers.
	const targets = (ns.args[0]) ? [ns.args[0]] : getAllServers(ns);
	const host = (ns.args[1]) ? ns.args[1] : "home";

	let curMili = 0;

	const targetsInfo = new Map();

	// Infinite loop that continously hacks/grows/weakens the target servers
	while (true) {
		let bestServer = "";
		let bestValue = 0;
		curMili = ns.getTimeSinceLastAug();
		
		for (let i = 0; i < targets.length; i++) {
			const target = targets[i];
			const thisMachine = host

			//Attempt to nuke
			nukeServer(ns, target);

			if(!ns.hasRootAccess(target)) continue;

			//Make sure to replicate the most up-to-date file
			replicateFiles(ns, ["helpers.js", "runW.js", "runG.js", "runH.js"], thisMachine);

			targets.forEach(t => {
				if(ns.hasRootAccess(t) && 
				ns.getServerMaxMoney(t) > bestValue && 
				ns.getServerRequiredHackingLevel(t) <= ns.getHackingLevel()) {
					bestServer = t;
					bestValue = ns.getServerMaxMoney(t) / ns.getHackTime(t);
				}
			});

			// Defines how much money a server should have before we hack it
			// In this case, it is set to 75% of the server's max money
			const moneyThresh = ns.getServerMaxMoney(bestServer) * 0.75;

			// Defines the maximum security level the target server can
			// have. If the target's security level is higher than this,
			// we'll weaken it before doing anything else
			const securityThresh = (ns.getServerMinSecurityLevel(bestServer) * 0.25 > 5) ? 
			ns.getServerMinSecurityLevel(bestServer) + 5 : 
			ns.getServerMinSecurityLevel(bestServer) * 1.25;

			// If the server's security level is above our threshold, weaken it
			// If the server's money is less than our threshold, grow it
			// Otherwise hack it
			if (ns.getServerSecurityLevel(bestServer) > securityThresh && ns.getServerSecurityLevel(bestServer) - getActionChange(0) > securityThresh) {
				const threadsNeeded = (ns.getServerSecurityLevel(bestServer) * 2) / ns.weakenAnalyze(1);
				const threads = threadCalc(ns, "runW.js", thisMachine, threadsNeeded);
				if (threads > 0) {
					ns.exec("runW.js", thisMachine, threads, bestServer);
					targetsInfo.set("weaken", {"host": thisMachine, "type": 0, "milis": curMili + ns.getWeakenTime(bestServer), "threads": threads});
					await ns.sleep(1);
				}
			}

			if (ns.getServerMoneyAvailable(bestServer) < moneyThresh) {
				const threads = (ns.scriptRunning("runG.js", ns.getHostname())) ? 0 : threadCalc(ns, "runG.js", thisMachine);
				if (threads > 0) {
					ns.exec("runG.js", thisMachine, threads, bestServer);
					targetsInfo.set("grow", {"host": thisMachine,"type": 1, "milis": curMili + ns.getGrowTime(bestServer), "threads": threads});
					await ns.sleep(1);
				}
			}
			else {
				const threads = threadCalc(ns, "runH.js", thisMachine);
				if (threads > 0) {
					ns.exec("runH.js", thisMachine, threads, bestServer);
					targetsInfo.set("hack", {"host": thisMachine,"type": 2, "milis": curMili + ns.getHackTime(bestServer), "threads": threads});
					await ns.sleep(1);
				}
			}
		}
		ns.clearLog();

		ns.print(`Target: ${bestServer}`);
		ns.print(`Security:\n  ${Math.round(ns.getServerMinSecurityLevel(bestServer) * 100) / 100} / ${Math.round(ns.getServerSecurityLevel(bestServer) * 100) / 100} / ${Math.round(ns.getServerBaseSecurityLevel(bestServer) * 100) / 100}`);
		ns.print(`Money: \n  ${formatUSD(ns, Math.round(ns.getServerMoneyAvailable(bestServer)))} /\n  ${formatUSD(ns, ns.getServerMaxMoney(bestServer))}\n  ${Math.round(ns.getServerMoneyAvailable(bestServer)/ns.getServerMaxMoney(bestServer) * 100)}%`);
		ns.print(`Weaken: ${getActionSummary(0)}`);
		ns.print(`Grow: ${getActionSummary(1)}`);
		ns.print(`Hack: ${getActionSummary(2)}`);

		await ns.sleep(1);
	}
}