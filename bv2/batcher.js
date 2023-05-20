import {threadCalc, getAllServers, formatUSD, nukeServer, replicateFiles} from "./helpers.js"
/** @param {NS} ns */
export async function main(ns) {
	ns.disableLog("ALL");
	//spawn and run a new BatchManager
	await new BatchManager(ns, 50, .95).run();
}

//The controller of batches, the brains for spawning and removing batches
class BatchManager {
	//Statics to hold scripts refrences
	static HACK_SCRIPT = "/bv2/hack.js";
	static GROW_SCRIPT = "/bv2/grow.js";
	static WEAK_SCRIPT = "/bv2/weak.js";

	/** @param {NS} ns */
	constructor(ns, stepTime, greed) {
		this.ns = ns;
		//Time between script deployments
		this.stepTime = stepTime;
		//Port to communicate to workers
		this.workerComms = ns.getPortHandle(20);
		//Precentage of money to steal from server
		this.greed = greed;
		//Server from which ti steal money
		this.target = "";
		//Server to use to steal money from target
		this.usableServers = [];

		//Keep tracking of post script execution delay
		this.accumulatedDelay = 0;
		//Highest delay recorded over a given period of time
		this.highestDelay = 0;
		//Variable to keep track of time passed for highestDelay reset
		this.resetAccDelay = 0;
		//Time in MS to reset highest Delay
		this.resetAccDelayMSThreshold = 10 * 1000; 
		this.prepare();
		//Array of batches, needed for proper batch management
		this.batches = [new Batch(this.ns, this.stepTime, this.target, this.greed, this.usableServers, 0)];
	}

	//Prepare target, usable servers, and thread information
	prepare() {
		//Array of objects containg a host name and approx how many threads it has for use.
		let availThreads = [];

		//Use a recursive function to get all servers in the game minus home (which is why home is then added manually)
		const allServers = [...getAllServers(this.ns), "home"];

		//Go through each server and nuke it, replicate out hack files and filter it per needs
		allServers.forEach(server => {
			nukeServer(this.ns, server); // Nuke
			//Send hacks to servers
			replicateFiles(this.ns, [BatchManager.HACK_SCRIPT, BatchManager.GROW_SCRIPT, BatchManager.WEAK_SCRIPT], server);
			
			//If we can execute scripts on a server and it have ram log it as usable.
			if (this.ns.hasRootAccess(server) && this.ns.getServerMaxRam(server) > 2) {
				availThreads.push({
					//Keep track of the server name and how many threads it has for use
					hostname: server,
					//Approx threads by dividing its total ram by 2 GB.
					threads: Math.floor((this.ns.getServerMaxRam(server) - this.ns.getServerUsedRam(server)) / 2),
				});
			}

			//Likewise if we have accces to a server, we can comfrotable hack it and it has money its a potentialls desirable target.
			if (this.ns.hasRootAccess(server) && this.ns.getServerRequiredHackingLevel(server) < this.ns.getHackingLevel() / 2 && this.ns.getServerMaxMoney(server) > 0) {
				//IF we have not selected a server just take the first one
				if (this.target === "") this.target = server;

				//We need to simulate some data with formulas for the current server we have selected and the potential candidate
				const targetSim = this.ns.getServer(this.target);
				const serverSim = this.ns.getServer(server);

				//Set both sim servers to min difficulty.
				targetSim.hackDifficulty = targetSim.minDifficulty;
				serverSim.hackDifficulty = serverSim.minDifficulty;

				//Calculate a desirability based on: Max money over Min Security mutliple by hack chance and divide by total hack time
				let targetRatio = this.ns.getServerMaxMoney(this.target) / this.ns.getServerMinSecurityLevel(this.target);
				targetRatio *= this.ns.formulas.hacking.hackChance(targetSim, this.ns.getPlayer());
				targetRatio /= (this.ns.formulas.hacking.hackTime(targetSim, this.ns.getPlayer()) * 0.05);

				//Calculate a desirability based on: Max money over Min Security mutliple by hack chance and divide by total hack time
				let serverRatio = this.ns.getServerMaxMoney(server) / this.ns.getServerMinSecurityLevel(server);
				serverRatio *= this.ns.formulas.hacking.hackChance(serverSim, this.ns.getPlayer());
				serverRatio /= (this.ns.formulas.hacking.hackTime(serverSim, this.ns.getPlayer()) * 0.05);

				//If the candidate is better than our target; switch!
				if (serverRatio > targetRatio) this.target = server;
			}
		});

		//Sort server with available threads largest to smallest
		availThreads.sort((a,b) => a.threads - b.threads);
		this.usableServers = availThreads;
	}

	log() {
		this.ns.clearLog();
		this.ns.print("Accumulated Delay: " + this.accumulatedDelay);
		if (this.accumulatedDelay > this.highestDelay) this.highestDelay = this.accumulatedDelay;
		this.ns.print("Highest Delay in last 10 seconds: " + this.highestDelay);
		this.ns.print("Threads: " + this.usableServers.reduce((a,b) => a+b.threads, 0));
		this.ns.print("Batches: " + this.batches.length);
		this.ns.print("Last Batch: " + this.batches[this.batches.length-1].id);
		this.ns.print("Estimated Remaining Batches: " + Math.ceil((this.batches[0].endSafeTime - this.stepTime - this.batches[this.batches.length-1].initialStartTime) / this.stepTime));
		this.ns.print("Server Stats:");
		this.ns.print(`  📝: ${this.target}`);
		this.ns.print(`  🛡️: ${Math.round(this.ns.getServerSecurityLevel(this.target) - this.ns.getServerMinSecurityLevel(this.target))}`);
		this.ns.print(`  💰: ${this.ns.formatPercent(this.ns.getServerMoneyAvailable(this.target) / this.ns.getServerMaxMoney(this.target))}`);
		this.ns.print(`  💎: ${this.ns.getServerMinSecurityLevel(this.target) == this.ns.getServerSecurityLevel(this.target) && this.ns.getServerMoneyAvailable(this.target) == this.ns.getServerMaxMoney(this.target)}`);
	}

	//Perform the logic for managing existing batches and spawning new ones
	async manageBatches() {
		//If a batch is passed the hack launch time we don;t need (or want) to track it anymore; this is critcal for a later stage of this algo.
		this.batches = this.batches.filter(batch => {
			if(Date.now() <= batch.endSafeTime) return true;
			else return false;
		});

		//If we are have reach a point where all batches are dead; spin back up.
		if(this.batches.length == 0) {
			this.batches.push(new Batch(this.ns, this.stepTime, this.target, this.greed, this.usableServers, this.accumulatedDelay));
			this.accumulatedDelay = 0;
		}

		/*
		If this moment Date.now() is at or after when the next batch should be launched*   *this.batches[this.batches.length-1].nextBatchStart
		and is before the pay window (+buffer)* of the oldest batach;                      *this.batches[0].endSafeTime - this.stepTime
		make a new batch                                                                   *this.batches.push(new Batch(...));
		*/
		if (Date.now() >= this.batches[this.batches.length-1].nextBatchStart && Date.now() <= this.batches[0].endSafeTime - this.stepTime) {
			this.batches.push(new Batch(this.ns, this.stepTime, this.target, this.greed, this.usableServers, this.accumulatedDelay));
			this.accumulatedDelay = 0;
		}

		//If a batch has yet to run run it!
		for (const batch of this.batches)
			if(!batch.started) await batch.run();
		
		//Listen to your workers!
		while(!this.workerComms.empty()) {
			this.accumulatedDelay += Math.ceil(this.workerComms.read());
		}

		//A little logging helper.
		if(Date.now() >= this.resetAccDelay) {this.highestDelay = 0; this.resetAccDelay = Date.now() + 10 * 1000;}
	}

	//Tight loop describing algo
	async run() {
		while(true) {
			this.prepare();
			this.log();
			await this.manageBatches();
			await this.ns.sleep(0);
		}
	}
}

class Batch {
	//Easy lil trick to give each batch a unique ID
	static #BATCHID = 0;

	/** @param {NS} ns */
	constructor(ns, stepTime, target, greed, usableServers, delay = 0) {
		this.ns = ns;
		//Assign ID and increment
		this.id = Batch.#BATCHID++;
		//Flag to know if this batch has launched its scripts
		this.started = false;
		//How much money to steal
		this.greed = greed;
		//Time between script deployments
		this.stepTime = stepTime;
		//The server from which to steal
		this.target = target;

		//Timing info that gets initialized when the batch runs via this.perpare();
		this.initialStartTime; 	//When the batch started
		this.endTime; 					//Expected end time of w2 / this batch
		this. hEndTime; 				//When hack will end
		this.w1EndTime; 				//When W1 will end
		this. gEndTime; 				//When grow will end
		this.w2EndTime;				 	//When w2 will end
		this.endSafeTime; 			//When the end of the prep window and beginning of pay window is
		this.nextBatchStart; 		//When this batch believes the next should start
		this.delay = delay 			//By how much, if any, this batch should delay the start of its scripts.

		//Threads for each job
		this.hThreads  = 0;
		this.w1Threads = 0;
		this.gThreads  = 0;
		this.w2Threads = 0;

		//Flags denoating preparedness of server
		this.minSec = false;
		this.maxMon = false;
		this.isPrime = false;

		//Variable to track usable servers
		this.usableServers = usableServers;
	}

	prepare() {
		//When did this batch start?
		this.initialStartTime = Date.now();
		//When should this batch end based on stepTime, delay, start time and weaken time for target server.
		this.endTime = Math.ceil(this.initialStartTime + this.ns.getWeakenTime(this.target) + this.delay + this.stepTime * 2);

		//Ending of each step based on the expected end time fo batch and time step offset
		this. hEndTime = this.endTime - this.stepTime * 3;
		this.w1EndTime = this.endTime - this.stepTime * 2;
		this. gEndTime = this.endTime - this.stepTime * 1;
		this.w2EndTime = this.endTime - this.stepTime * 0;

		//End of safe window begenning of paywindow or when h will start
		this.endSafeTime = Math.floor(this.hEndTime - this.ns.getHackTime(this.target));
		
		//When the next batch should start based on the start time and timestep offset
		this.nextBatchStart = this.initialStartTime + this.stepTime;
	}

	async run() {
		this.prepare();
		//Advised this batch it has run
		this.started = true;

		//Check preparedness of server
		this.minSec = this.ns.getServerSecurityLevel(this.target) == this.ns.getServerMinSecurityLevel(this.target);
		this.maxMon = this.ns.getServerMoneyAvailable(this.target) == this.ns.getServerMaxMoney(this.target);
		this.isPrime = this.minSec && this.maxMon;

		//hack if prime
		this.calcHackThreads();
		if (this.isPrime && this.hThreads > 0) {
			this.distributeScript(BatchManager.HACK_SCRIPT, this.hThreads, this.target, this.hEndTime, this.ns.getHackTime(this.target), 1);
		}
			
		//counter hack or blast sec
		this.calcWeak1Threads();
		if ((this.isPrime || !this.minSec) && this.w1Threads > 0) {
			this.distributeScript(BatchManager.WEAK_SCRIPT, this.w1Threads, this.target, this.w1EndTime, this.ns.getWeakenTime(this.target), 2);
		}
			
		//counter hack or grow per missing
		this.calcGrowThreads();
		if ((this.isPrime || !this.maxMon) && this.gThreads > 0) {
			this.distributeScript(BatchManager.GROW_SCRIPT, this.gThreads, this.target, this.gEndTime, this.ns.getGrowTime(this.target), 3);
		}

		//Counter Grow
		this.calcWeaken2Threads();
		if (this.w2Threads > 0) {
			this.distributeScript(BatchManager.HACK_SCRIPT, this.w2Threads, this.target, this.w2EndTime, this.ns.getWeakenTime(this.target), 4);
		}
		
	}

	//Exec C the script based on the type of job and threads availability
	distributeScript(scriptName, neededThreads, target, endTime, time, type) {
		//Initialize remaining threads to be the amount we calc'd to need
		let remainingThreads = neededThreads;

		//Look throgh all servers we can use
		for (const server of this.usableServers) {
			//If we don't need an threads or this server has no threads move on
			if (remainingThreads < 1 || server.threads < 1) continue;
			//If this is a hack or grow we need to keep all threads together. If this server can't support that move on.
			if ((type == 1 || type == 3) && server.threads < remainingThreads) continue;
			
			//Get the threads on this server
			const availThreads = server.threads;

			//See if this server can take all threads or just some (this is only a question for weaken as we can split those up.)
			const threadsToUse = (availThreads < remainingThreads) ? availThreads : remainingThreads;
			//Launch the thread on the appropriate server with te appropriate threads.
			this.ns.exec(scriptName, server.hostname, threadsToUse, target, endTime, time, type, this.id);
			//lower remaining by used
			remainingThreads -= threadsToUse;
		}
	}

	calcHackThreads() {
		//Return the threads needed to hack a primed server by the specified greed amount.
		if(this.isPrime)
			this.hThreads = Math.ceil(this.ns.hackAnalyzeThreads(this.target, 
									  this.ns.getServerMaxMoney(this.target) * this.greed));
	}

	//Return the threads needed to weaken a server in response to a hack or to get to min security
	calcWeak1Threads() {
		if (this.isPrime)
			this.w1Threads = Math.ceil(this.ns.hackAnalyzeSecurity(this.hThreads) / this.ns.weakenAnalyze(1));
		else if (!this.minSec)
			this.w1Threads = Math.ceil((this.ns.getServerSecurityLevel(this.target) - 
									   this.ns.getServerMinSecurityLevel(this.target)) / 
									   this.ns.weakenAnalyze(1));
	}

	//Grow in response to a hack or if not primed and not at full money; grow as needed.
	calcGrowThreads() {
		if (this.isPrime){
			const simServ = this.ns.getServer(this.target);
			simServ.moneyAvailable = Math.floor(simServ.moneyMax * (1 - this.greed));
			this.gThreads = Math.ceil(this.ns.formulas.hacking.growThreads(simServ, this.ns.getPlayer(), simServ.moneyMax));
		} else if (!this.maxMon) {
			const simServ = this.ns.getServer(this.target);
			this.gThreads = Math.ceil(this.ns.formulas.hacking.growThreads(simServ, this.ns.getPlayer(), simServ.moneyMax));
		}
	}

	//Weaken per growth
	calcWeaken2Threads() {
		this.w2Threads = Math.ceil(this.ns.growthAnalyzeSecurity(this.gThreads));
	}
}