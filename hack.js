import {threadCalc, getAllServers, formatUSD, nukeServer, replicateFiles} from "./helpers.js";

/** @param {NS} ns */
export async function main(ns) {
	//Disable default logs
	ns.disableLog("ALL");
	
	const getActionSummary = (type) => {
		let smallestMilis = Infinity;
		let numServersWeakening = 0;

		for (const ti of targetsInfo.values()){
			if(ti.type == type) {
				numServersWeakening++;
				if (ti.milis <= smallestMilis) smallestMilis = ti.milis;
			}
		}

		if(numServersWeakening > 0)
			return `Running - ${numServersWeakening} | ${Math.floor((smallestMilis - ns.getTimeSinceLastAug()) / 1000)}`
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
	let targets = (ns.args[0]) ? [ns.args[0]] : getAllServers(ns);
	const myServers = ["home", ...ns.getPurchasedServers()];

	myServers.forEach(serv => {
		targets = targets.filter(t => t != serv);
	})

	let curMili = 0;

	const targetsInfo = new Map();

	// Infinite loop that continously hacks/grows/weakens the target servers
	while (targets.length > 0) {
		let bestServer = "";
		let bestValue = 0;
		curMili = ns.getTimeSinceLastAug();
		
		for (let i = 0; i < targets.length; i++) {
			const target = targets[i];

			//Attempt to nuke
			nukeServer(ns, target);

			if(!ns.hasRootAccess(target)) continue;

			//Make sure to replicate the most up-to-date file
			replicateFiles(ns, ["runW.js", "runG.js", "runH.js"], target);

			targets.forEach(t => {
				if(ns.hasRootAccess(t) && 
				ns.getServerMaxMoney(t) > bestValue && 
				ns.getServerRequiredHackingLevel(t) <= ns.getHackingLevel()) {
					bestServer = t;
					bestValue = ns.getServerMaxMoney(t);
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
				const threads = threadCalc(ns, "runW.js", target);
				if (threads > 0) {
					ns.exec("runW.js", target, threads, bestServer);
					targetsInfo.set(target, {"host": target, "type": 0, "milis": curMili + ns.getWeakenTime(bestServer), "threads": threads});
					await ns.sleep(1);
				}
			}

			if (ns.getServerMoneyAvailable(bestServer) < moneyThresh) {
				const threads = threadCalc(ns, "runG.js", target);
				if (threads > 0) {
					ns.exec("runG.js", target, threads, bestServer);
					targetsInfo.set(target, {"host": target,"type": 1, "milis": curMili + ns.getGrowTime(bestServer), "threads": threads});
					await ns.sleep(1);
				}
			}
			else {
				const threads = threadCalc(ns, "runH.js", target);
				if (threads > 0) {
					ns.exec("runH.js", target, threads, bestServer);
					targetsInfo.set(target, {"host": target,"type": 2, "milis": curMili + ns.getHackTime(bestServer), "threads": threads});
					await ns.sleep(1);
				}
			}
		}

		for (let i = 0; i < myServers.length; i++) {
			replicateFiles(ns, ["runW.js", "runG.js", "runH.js"], myServers[i]);
			if (i % 3 == 0 && i != 0) {
				const threads = threadCalc(ns, "runH.js", myServers[i]);
				if (threads > 0) {
					ns.exec("runH.js", myServers[i], threads, bestServer);
					targetsInfo.set(myServers[i], {"host": myServers[i], "type": 2, "milis": curMili + ns.getHackTime(bestServer), "threads": threads});
					await ns.sleep(1);
				}
			}
			else if (i % 2 == 0 && i != 0) {
				const threads = threadCalc(ns, "runG.js", myServers[i]);
				if (threads > 0) {
					ns.exec("runG.js", myServers[i], threads, bestServer);
					targetsInfo.set(myServers[i], {"host": myServers[i], "type": 1, "milis": curMili + ns.getGrowTime(bestServer), "threads": threads});
					await ns.sleep(1);
				}
			}
			else {
				const threads = threadCalc(ns, "runW.js", myServers[i]);
				if (threads > 0) {
					ns.exec("runW.js", myServers[i], threads, bestServer);
					targetsInfo.set(myServers[i], {"host": myServers[i], "type": 0, "milis": curMili + ns.getWeakenTime(bestServer), "threads": threads});
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