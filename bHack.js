/*
Batcher by TheTornadoTitan
Goals:
	Prep target server(s)

	Once prep'd
	start frist hwgw batch
	stage following batches based on playerStats and when the w1 of the staged batch will end

	The idea is a hwgw cycle should be happening consistently so a script is constantly ending x miliseconds apart
	However, we don't needlessly overload ram usage with upcoming batches stuck waiting.
	This is a JIT that should handle level ups dyanmically by checking batches as they run.
	As it check it will adjust unlauched states for the current and upcoming batches.

Tracking Batches:
	lets have a queue object with the following
	queue as a Map() = 
	{
		// Type: is this a prep or hack batch (wgw or hwgw)?
		// Current State: A bit odd: its 1-4 and denotes the last script that has run in the hwgw cycle.
		//               However its based on the script RUN time so the states 1-4 go through, w1,w2,g,h.
		// startTimes for each script in hwgw order or _wgw order for a prep batch.
		// batchCompletionTime: When the batch will complete
		// nextBatchStartTime: when to start the next batch to coiincide the next batch ending right after the ending of this batch

		[Key] target-server: [value] {
			isPreped: false,
			hasHitMinSec: false,
			batches: [{
				id, n,
				type: n, 
				currentState: n, 
				PIDs: [n,n,n,n], 
				startTimes: [t,t,t,t],
				initialWeakenTime: t, 
				batchCompletionTime: t, 
				nextBatchStartTime: t,
				nextBatchStarted: b
			}],
			hThreads,
			w1Threads,
			gThreads,
			w2Threads,
		}
	}

	We want to spawn the next batch when the hack would end just after batchCompletionTime ended on the previous batch.
*/

import {threadCalc, getAllServers, formatUSD, nukeServer, replicateFiles} from "./helpers.js";
/** @param {NS} ns */
export async function main(ns) {
	ns.disableLog("ALL");
	if (!ns.fileExists("Formulas.exe", "home")) {
		ns.tprint("Formulas.exe is required for this script. Please run again once obtained.");
		return;
	}

	const bData = {
		hackScript: "runH.js",
		growScript: "runG.js",
		weakScript: "runW.js",
		delay: 20,
		greed: .90,
		queue: new Map(),
		usableServers: ["home"],
		targetServers: ["ecorp"],
	}

	while(true) {
		const allServers = ["home", ...getAllServers(ns)];

		bData.usableServers = allServers.filter(server => {
			nukeServer(ns, server);
			if(!ns.hasRootAccess(server) || ns.getServerMaxRam(server) == 0) return false;

			replicateFiles(ns, [bData.hackScript, bData.growScript, bData.weakScript], server);
			return true;
		});

		bData.targetServers.forEach(server => {
			if (!bData.queue.has(server)) {
				deployInitialBatch(ns, server, bData);
			}

			checkBatches(ns, server, bData.queue.get(server), bData);
		});

		await ns.sleep(0);
	}
}

/** @param {NS} ns */
function checkServer(ns, target, targetInfo) {
	const minSec = ns.getServerMinSecurityLevel(target);
	const sec = ns.getServerSecurityLevel(target);
	const maxMon = ns.getServerMaxMoney(target);
	const mon = ns.getServerMoneyAvailable(target);

	if(targetInfo) {
		if (sec == minSec) targetInfo.hasHitMinSec = true;
		if (mon == maxMon && sec == minSec) targetInfo.isPreped = true;
		else targetInfo.isPreped = false;

		return targetInfo.isPreped;
	} else {
		return (minSec == sec && mon == maxMon);
	}
}

/*
	Return times based on current player stats and wether a server is preped or not
	If a server is not preped it will use the "in the moment" stats for future batches.
	If a server is preped it will use simulated stats for future batches.
*/
/** @param {NS} ns */
function getTimes(ns, target, isPreped) {
	let wt;
	let gt;
	let ht;

	if(isPreped) {
		const targetSim = ns.getServer(target);
		targetSim.hackDifficulty = targetSim.minDifficulty;
		wt = ns.formulas.hacking.weakenTime(targetSim, ns.getPlayer());
		gt = ns.formulas.hacking.growTime(targetSim, ns.getPlayer());
		ht = ns.formulas.hacking.hackTime(targetSim, ns.getPlayer());
	} else {
		wt = ns.getWeakenTime(target);
		gt = ns.getGrowTime(target);
		ht = ns.getHackTime(target);
	}

	wt = Math.ceil(wt);
	gt = Math.ceil(gt);
	ht = Math.ceil(ht);
	
	return {wt, gt, ht};
}

/** @param {NS} ns */
async function deployInitialBatch(ns, target, data) {
	//get times based on simulate or actual server stats, depending on preped state, with current player stats
	const isPreped = checkServer(ns, target)
	let {wt, gt, ht} = getTimes(ns, target, isPreped);

	const currentTime = Date.now();

	if(data.queue.has(target)){
		ns.tprint(`ERROR: Initial Batch already depoyed on: ${target}`); 
		return;
	}

	const {hThreads, w1Threads, gThreads, w2Threads } = getNeededThreads(ns, target, data);

	/* Algorithm Explanation:
		----------Start Times-------------
		The idea for calculating the start times of each script is based on a diagram similar to the following:
		0  1  2  3  4  5  6  7  8  9  10 11
		|  |  |  |  |  |  |  |  |  |  |  |
		|        [hacktime]              |
		[   weaken 1 time    ]           |
		|        [   grow time  ]        |
		|     [    weaken 2 time   ]     |
		[     Total Batch Time        ]  |
		----------------------------------

		imagine each " | " is some amount of time, say "delay" or time steps.
		each + or - of delay is in relation to these ticks.

		To find the best start time for each script we use the calculation for weaken time, as that is the longest of the set.

		This is why weaken 1's start time is set directly to the current time as we are starting now, and thus why weaken 1 starts at tick 0.
		weaken 2 thus needs to start 2 "ticks" ahead of weaken 1 as weaken 2 should be the final script in the batch. 
		which is easy enough to calculate just using the delay time; currentTime + delay * 2.

		where grow and hack need to start is only slightly more complicated.
		To find the grow script's start time we need to offset it by the time weaken 1 will end. 
		We can start by getting the time weaken 1 will end.
		To do so we use this formula: currentTime + wt (weaken time).

		then we need to find where the start of grow would be if it was to end at the time we just calculated.
		To do so we just subtract how long a grow script will take to run from the end time we have:
		currentTime + wt (weaken time) - gt (grow time)

		However if we started at this time it would cause the scripts to end at the same time, 
		so our last step is offsetting it by one tick by adding one "delay"!
		so the final grow script start time is: currentTime + wt (weaken time) - gt (grow time) + delay

		This is exactly the same for hack time save for the fact we subtract 1 delay instead of add one delay so it is the first script to end.
		In so doing our batch should have properly spaced out to run in the HWGW order.
		----------------------------------

		-----------Other Times------------
		We need to keep the initial calculation of weaken time for adjusting the start of scripts in relation to level ups.
		Thus we have a property called "initialWeakenTime" set to wt.

		We have a property "batchCompletionTime" to know when to slice the batch out of the target's batches array.
		This prevents having inifinite memory consumption on the IRL host machine and keeps our loops from growing ad infinitum
		Note between each batch I've alloted a 1 "tick" spacer for script reconciliation
		which is why I multiple by 3 rather than 2 as 2 would have the batch completion match the end of weaken2's end time.

		Lastly we have the "nextBatchStartTime" which uses similar logic for the start times to know when to launch the next batch.
		Note between each batch I've alloted a 1 "tick" spacer for script reconciliation.
		----------------------------------
	*/

	data.queue.set(target, {
		isPreped: true,
		hasHitMinSec: false,
		batches: [{
			id: 0,
			type: (isPreped) ? 1 : 0, 
			currentState: 1, 
			startTimes: [
				currentTime + wt - ht - data.delay,
				currentTime,
				currentTime + wt - gt + data.delay,
				currentTime + data.delay * 2
			],
			initialWeakenTime: wt, 
			initialStartTime: currentTime,
			batchCompletionTime: currentTime + wt + data.delay * 3, 
			nextBatchStartTime: currentTime + wt + data.delay * 5 - wt,
			nextBatchStarted: false,
		}],
		hThreads,
		w1Threads,
		gThreads,
		w2Threads,
	});
	//ns.print("Start W1 " + currentTime + " -- " + 0 + " -- " + 1);
	distributeWeaken1Threads(ns, target, data.queue.get(target), data, 0);
}

function createFutureBatch(ns, startTime, target, targetInfo, data) {
	let {wt, gt, ht} = getTimes(ns, target, targetInfo.isPreped);
	
	return {
		id: targetInfo.batches[targetInfo.batches.length-1].id+1,
		type: (targetInfo.isPreped) ? 1 : 0, 
		currentState: 0, 
		startTimes: [
			startTime + wt - ht - data.delay,
			startTime,
			startTime + wt - gt + data.delay,
			startTime + data.delay * 2
		],
		initialWeakenTime: wt,
		initialStartTime: startTime,
		batchCompletionTime: startTime + wt + data.delay * 3, 
		nextBatchStartTime: startTime + wt + data.delay * 5 - wt,
		nextBatchStarted: false,
	}
}

/** @param {NS} ns */
async function checkBatches(ns, target, targetInfo, data) {
	const idxToDel = [];
	let i = 0;

	checkServer(ns, target, targetInfo);
	if (targetInfo.batches.length < 1) deployInitialBatch(ns, target, data);

	// get times based on simulated or actual server stats, depending on preped state, with current player stats
	let {wt, gt, ht} = getTimes(ns, target, targetInfo.isPreped);

	const currentTime = Date.now();

	//for each batch on target
	for (const batch of targetInfo.batches) {
		//initial weaken time of the batch we are checking
		const iwt = batch.initialWeakenTime;
		//initial start time of the batch we are checking
		const ist = batch.initialStartTime;

		/* Differences between the initial batch launch
			Please see " Algorithm Explanation:" in the deployInitialBatch for more details.

			Here we follow the same logic but to account for level ups of the character we base that logic on our initial
			understanding of when this batch should have ended. This keeps everything moving forward properly in tandem with our character
			Leveling up.

			for each script not run yet run we calculate what the new runtime should be based on our current stats.
			After we calculate when they should run we check to see if we are at that time. 
			If so; run the script and mark it as having run.
		*/

		if (batch.currentState == 0) {
			batch.startTimes[0] = ist + iwt - ht - data.delay;
			batch.startTimes[1] = ist + iwt - wt;
			batch.startTimes[2] = ist + iwt - gt + data.delay;
			batch.startTimes[3] = ist + iwt - wt + data.delay * 2;

			if (currentTime >= batch.startTimes[1]) {
				//ns.print("Start W1 " + currentTime + " -- " + batch.id + " -- " + targetInfo.batches.length);
				distributeWeaken1Threads(ns, target, targetInfo, data, batch.id);
				batch.currentState++;
			}
		}
		else if (batch.currentState == 1) {
			batch.startTimes[0] = ist + iwt - ht - data.delay;
			batch.startTimes[2] = ist + iwt - gt + data.delay;
			batch.startTimes[3] = ist + iwt - wt + data.delay * 2;

			if (currentTime >= batch.startTimes[3]) {
				//ns.print("Start W2 " + currentTime + " -- " + batch.id + " -- " + targetInfo.batches.length);
				distributeWeaken2Threads(ns, target, targetInfo, data, batch.id);
				batch.currentState++;
			}
		} else if (batch.currentState == 2) {
			batch.startTimes[0] = ist + iwt - ht - data.delay;
			batch.startTimes[2] = ist + iwt - gt + data.delay;

			if (currentTime >= batch.startTimes[2]) {
				//ns.print("Start G " + currentTime + " -- " + batch.id + " -- " + targetInfo.batches.length);
				distributeGrowThreads(ns, target, targetInfo, data, batch.id);
				batch.currentState++;
			}
		} else if (batch.currentState == 3) {
			batch.startTimes[0] = ist + iwt - ht - data.delay;

			if (currentTime >= batch.startTimes[0]) {
				//ns.print("Start H " + currentTime + " -- " + batch.id + " -- " + targetInfo.batches.length);
				distributeHackThreads(ns, target, targetInfo, data, batch.id);
				batch.currentState++;
			}
		} else if (batch.currentState == 4) {} 
		else { ns.print("ERROR: Invalid state"); }

		if (!batch.nextBatchStarted) {
			//batch.nextBatchStartTime = ist + iwt + data.delay * 5 - wt;
			const nextBatchStartTimeCap = targetInfo.batches[0].startTimes[0] - data.delay + 1;
			//ns.print(currentTime + "    " + nextBatchStartTimeCap);
			if (currentTime >= batch.nextBatchStartTime && batch.nextBatchStartTime <= nextBatchStartTimeCap) {
				//ns.print("Start Next Batch " + currentTime + " -- " + batch.id + " -- " + targetInfo.batches.length);
				targetInfo.batches.push(createFutureBatch(ns, batch.nextBatchStartTime, target, targetInfo, data));
				batch.nextBatchStarted = true;
				ns.clearLog();
				ns.print(`🛡️:${ns.getServerMinSecurityLevel(target)}/${ns.getServerSecurityLevel(target)}`);
			}
		}

		if (currentTime >= batch.batchCompletionTime && batch.nextBatchStarted && batch.currentState == 4) {
			//ns.print("Batch Done " + currentTime + " -- " + batch.id + " -- " + targetInfo.batches.length);
			idxToDel.push(i);
		}

		i++;
	}

	idxToDel.sort((a, b)=>(a - b) * -1);
	idxToDel.forEach(i => {
		targetInfo.batches.splice(i, 1);
	});
}

/** @param {NS} ns */
function distributeWeaken1Threads(ns, target, targetInfo, data, id) {
	const neededThreads = targetInfo.w1Threads;
	let launchedThreads = 0;

	for (let i = 0; i < data.usableServers.length; i++) {
		if (launchedThreads >= neededThreads) break;

		const availRam = ns.getServerMaxRam(data.usableServers[i]) - ns.getServerUsedRam(data.usableServers[i]);
		const launchableThreads = Math.floor(availRam / ns.getScriptRam(data.weakScript));
		const threadsToLaunch = (launchableThreads > neededThreads - launchedThreads) ? neededThreads - launchedThreads : launchableThreads;

		//ns.print(neededThreads + " -- " + ns.getServerMaxRam(data.usableServers[i]) + " -- " + ns.getServerUsedRam(data.usableServers[i]));
		//ns.print(`${data.usableServers[i]} -- ${availRam} -- ${launchableThreads} -- ${threadsToLaunch}`);

		if(threadsToLaunch == 0) continue;
		ns.exec(data.weakScript, data.usableServers[i], threadsToLaunch, target, "w1 - " + id);
		launchedThreads += threadsToLaunch;
	}

	if (launchedThreads < neededThreads) ns.print("Unable to distribute w1");
}

/** @param {NS} ns */
function distributeWeaken2Threads(ns, target, targetInfo, data, id) {
	const neededThreads = targetInfo.w2Threads;
	let launchedThreads = 0;

	for (let i = 0; i < data.usableServers.length; i++) {
		if (launchedThreads >= neededThreads) break;

		const availRam = ns.getServerMaxRam(data.usableServers[i]) - ns.getServerUsedRam(data.usableServers[i]);
		const launchableThreads = Math.floor(availRam / ns.getScriptRam(data.weakScript));
		const threadsToLaunch = (launchableThreads > neededThreads - launchedThreads) ? neededThreads - launchedThreads : launchableThreads;

		if(threadsToLaunch == 0) continue;
		ns.exec(data.weakScript, data.usableServers[i], threadsToLaunch, target, "w2 - " + id);
		launchedThreads += threadsToLaunch;
	}

	if (launchedThreads < neededThreads) ns.print("Unable to distribute w2");
}

/** @param {NS} ns */
function distributeGrowThreads(ns, target, targetInfo, data, id) {
	if (!targetInfo.hasHitMinSec) return;
	if (!targetInfo.isPreped && ns.getServerMoneyAvailable(target) == ns.getServerMaxMoney(target)) return;

	const neededThreads = targetInfo.gThreads;
	let launchedThreads = 0;

	for (let i = 0; i < data.usableServers.length; i++) {
		if (launchedThreads >= neededThreads) break;

		const availRam = ns.getServerMaxRam(data.usableServers[i]) - ns.getServerUsedRam(data.usableServers[i]);
		const launchableThreads = Math.floor(availRam / ns.getScriptRam(data.growScript));
		const threadsToLaunch = (launchableThreads > neededThreads - launchedThreads) ? neededThreads - launchedThreads : launchableThreads;

		if(threadsToLaunch == 0) continue;
		ns.exec(data.growScript, data.usableServers[i], threadsToLaunch, target, "g - " + id);
		launchedThreads += threadsToLaunch;
	}

	if (launchedThreads < neededThreads) ns.print("Unable to distribute g");
	
}

/** @param {NS} ns */
function distributeHackThreads(ns, target, targetInfo, data, id) {
	if (!targetInfo.hasHitMinSec || !targetInfo.isPreped) return;
	
	const neededThreads = targetInfo.hThreads;
	let launchedThreads = 0;

	for (let i = 0; i < data.usableServers.length; i++) {
		if (launchedThreads >= neededThreads) break;

		const availRam = ns.getServerMaxRam(data.usableServers[i]) - ns.getServerUsedRam(data.usableServers[i]);
		const launchableThreads = Math.floor(availRam / ns.getScriptRam(data.hackScript));
		const threadsToLaunch = (launchableThreads > neededThreads - launchedThreads) ? neededThreads - launchedThreads : launchableThreads;

		if(threadsToLaunch == 0) continue;
		ns.exec(data.hackScript, data.usableServers[i], threadsToLaunch, target, "h - " + id);
		launchedThreads += threadsToLaunch;
	}

	if (launchedThreads < neededThreads) ns.print("Unable to distribute h");
}

/** @param {NS} ns */
function getNeededThreads(ns, target, data) {
	const targetSim = ns.getServer(target);
	targetSim.hackDifficulty = targetSim.minDifficulty;

	const hThreads = Math.floor(data.greed / ns.formulas.hacking.hackPercent(targetSim, ns.getPlayer()));

	const w1Threads = Math.ceil(ns.hackAnalyzeSecurity(hThreads, target) / ns.weakenAnalyze(1));

	targetSim.moneyAvailable = targetSim.moneyMax * data.greed;
	const gThreads = Math.ceil(ns.formulas.hacking.growThreads(targetSim, ns.getPlayer(), targetSim.moneyMax));

	const w2Threads = Math.ceil(ns.growthAnalyzeSecurity(gThreads, target)  / ns.weakenAnalyze(1));

	return {hThreads, w1Threads, gThreads, w2Threads};
}