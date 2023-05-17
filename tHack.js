import {threadCalc, getAllServers, formatUSD, nukeServer, replicateFiles} from "./helpers.js";

/** @param {NS} ns */
export async function main(ns) {
	ns.disableLog("ALL");

	const hackScript = "runH.js";
	const growScript = "runG.js";
	const weakScript = "runW.js";

	const targetServers = new Map();
	let hackingLevelDivisor = 2;
	let hackingLevelDeductionOnSleep = 0.01;

	while (true) {
		const allServers = getAllServers(ns);
		
		allServers.forEach(server => {
			if (!ns.hasRootAccess(server))
				nukeServer(ns, server);

			if (ns.hasRootAccess(server))
				replicateFiles(ns, [hackScript, growScript, weakScript], server);
		})

		const usableServers = ["home", ...allServers.filter(server => ns.hasRootAccess(server) && ns.getServerMaxRam(server) >= 2)];
		
		const targetServersPre = allServers.filter(
			server => ns.getServerMaxMoney(server) > 0 && 
			ns.getServerRequiredHackingLevel(server) <= (ns.getHackingLevel() / hackingLevelDivisor) &&
			ns.hasRootAccess(server)
		);

        targetServersPre.sort((a,b) => {
            const ax = ns.getServerMaxMoney(a) / ns.getServerMinSecurityLevel(a) - ns.getServerRequiredHackingLevel(a);
            const bx = ns.getServerMaxMoney(b) / ns.getServerMinSecurityLevel(b) - ns.getServerRequiredHackingLevel(b);
            return ax - bx;
        });

		targetServersPre.forEach(server => {
			if (targetServers.has(server) == false) {
				targetServers.set(server, {
					"hack" : {"running" : false, "finishMilis" : 0, "threads" : 0},
					"grow" : {"running" : false, "finishMilis" : 0, "threads" : 0},
					"weak" : {"running" : false, "finishMilis" : 0, "threads" : 0}
				});
			}
		});

		let sleepingMachines = 0;
		let workingMachines = 0;

		usableServers.forEach(host => {
			let availRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);

			targetServers.forEach((info, target, targetServers) => {
				const targteInfo = info;
				if (targteInfo.hack.running && ns.getTimeSinceLastAug() >= targteInfo.hack.finishMilis) {targteInfo.hack.running = false; targteInfo.hack.threads = 0}
				if (targteInfo.grow.running && ns.getTimeSinceLastAug() >= targteInfo.grow.finishMilis) {targteInfo.grow.running = false; targteInfo.grow.threads = 0}
				if (targteInfo.weak.running && ns.getTimeSinceLastAug() >= targteInfo.weak.finishMilis) {targteInfo.weak.running = false; targteInfo.weak.threads = 0}

				if (ns.getServerSecurityLevel(target) > ns.getServerMinSecurityLevel(target)) {
					const currentThreads = targteInfo.weak.threads;
					const neededWeakenThreads = Math.ceil((ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target)) / ns.weakenAnalyze(1) - currentThreads);
					const maxWeakenThread = Math.floor(availRam / ns.getScriptRam(weakScript));
					if (neededWeakenThreads > 0  && maxWeakenThread > 0) {
						const finalThreads = (neededWeakenThreads < maxWeakenThread) ? neededWeakenThreads : maxWeakenThread;
						ns.exec(weakScript, host, finalThreads, target);
						availRam -= finalThreads * ns.getScriptRam(weakScript);
						targteInfo.weak.running = true;
						targteInfo.weak.finishMilis = ns.getTimeSinceLastAug() + ns.getWeakenTime(target);
						targteInfo.weak.threads += finalThreads;
					}
				}

				if (ns.getServerMoneyAvailable(target) < ns.getServerMaxMoney(target) && ns.getServerSecurityLevel(target) <= ns.getServerMinSecurityLevel(target)) {
					const currentThreads = targteInfo.grow.threads;
					//1000 - 800 = 200
					const moneyDelta = ns.getServerMaxMoney(target) - ns.getServerMoneyAvailable(target);
					//= 800 (min 1)
					const moneyA = Math.max(ns.getServerMoneyAvailable(target), 1);
					//200 / 800 = 0.25
					const multFactor = moneyDelta / moneyA + 1;
					const neededGrowThreads = Math.ceil(ns.growthAnalyze(target, multFactor) - currentThreads);
					const maxGrowThreads = Math.floor(availRam / ns.getScriptRam(growScript));
					if(neededGrowThreads > 0 && maxGrowThreads > 0) {
						const finalThreads = (neededGrowThreads < maxGrowThreads) ? neededGrowThreads : maxGrowThreads;
						ns.exec(growScript, host, finalThreads, target);
						availRam -= finalThreads * ns.getScriptRam(growScript);
						targteInfo.grow.running = true;
						targteInfo.grow.finishMilis = ns.getTimeSinceLastAug() + ns.getGrowTime(target);
						targteInfo.grow.threads += finalThreads;
					}
				} else if (ns.getServerSecurityLevel(target) <= ns.getServerMinSecurityLevel(target) && ns.hackAnalyzeChance(target) > 0.10){
					const currentThreads = targteInfo.hack.threads;
					const neededHackThreads = Math.ceil((ns.getServerMoneyAvailable(target) / (ns.getServerMoneyAvailable(target) * ns.hackAnalyze(target))) - currentThreads);
					const maxHackThreads = Math.floor(availRam / ns.getScriptRam(hackScript));
					if(neededHackThreads > 0 && maxHackThreads > 0) {
						const finalThreads = (neededHackThreads < maxHackThreads) ? neededHackThreads : maxHackThreads;
						ns.exec(hackScript, host, finalThreads, target);
						availRam -= finalThreads * ns.getScriptRam(hackScript);
						targteInfo.hack.running = true;
						targteInfo.hack.finishMilis = ns.getTimeSinceLastAug() + ns.getHackTime(target);
						targteInfo.hack.threads += finalThreads;
					}
				}
			});

			if (ns.getServerUsedRam(host) < 1) sleepingMachines += 1;
			else workingMachines += 1;
		});

		if (sleepingMachines > 0 && hackingLevelDivisor > 1) hackingLevelDivisor -= hackingLevelDeductionOnSleep;
		if (hackingLevelDivisor < 1) hackingLevelDivisor = 1;

		ns.clearLog();

		ns.print(`Status: 🖥️:${usableServers.length} 🎯:${targetServers.size} 💪:${workingMachines} 💤:${sleepingMachines}`);
		targetServers.forEach((info, target, targetServers) => {
			if (info.hack.running || info.grow.running || info.weak.running)
				ns.print(`└${target.padEnd(20)} 🛡️:${info.weak.running?"✅":"❌"}  📈:${info.grow.running?"✅":"❌"}  💸:${info.hack.running?"✅":"❌"}  🧵:${(info.hack.threads + info.grow.threads + info.weak.threads).toString().padEnd(10)} 💰:${formatUSD(ns, ns.getServerMaxMoney(target)).padStart(25)} (%${Math.round((ns.getServerMoneyAvailable(target) / ns.getServerMaxMoney(target)) * 100).toString().padStart(3)})`);
		});
		
		await ns.sleep(0);
	}
}