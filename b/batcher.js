import {threadCalc, getAllServers, formatUSD, nukeServer, replicateFiles} from "./helpers.js";
/** @param {NS} ns */
export async function main(ns) {
	ns.disableLog("ALL");
	if(ns.args[0] && ns.getServer(ns.args[0]))
		await new BatchManager(ns, 100, 0.5, ns.args[0], 0, ["home"]).run();
}

class BatchManager {
	//Script refrences
	static HACK_SCRIPT = "b/hack.js";
	static WEAK_SCRIPT = "b/weak.js";
	static GROW_SCRIPT = "b/grow.js";

	//Port Handle Numbers for Batch to Worker Comms
	//static #STATE_PORT    = 19;
	static #RESULT_PORT   = 20;

	//The number of items returned per script when they finish writing to the result port.
	static #RP_ITEM_COUNT = 3;

	/** @param {NS} ns */
	constructor(ns, delay = 20, greed = 0.5, targetServer, maxMoney = 0, usableServers = []) {
		this.ns = ns;
		// Key: Server => Value: Map(batchID -> Batch)
		this.batchMap = new Map();
		//time between scripts and batches whole numebr >= 5ms
		this.delay = Math.max(Math.ceil(delay), 5);
		//Percent of money to steal 0.01 <= greed <= 1
		this.greed = Math.max(Math.min(greed, 1), 0.01);
		//Whole number >= 1 to limit money steal (min is actual the amount 1 hack thread will steal from the server)
		this.maxMoney = (maxMoney == 0) ? 0 : Math.ceil(Math.max(maxMoney, 1));

		this.allServers = getAllServers(this.ns); //As it says

		//If the player explicity set servers to target; target them. Otherwise, free-for-all
		this.targetServer = targetServer

		//If the player explicity set servers to use; use them. Otherwise, free-for-all
		this.setUsableServers = usableServers;
		this.usableServers = [];

		this.workerComms = this.ns.getPortHandle(BatchManager.#RESULT_PORT);
		this.workerComms.clear();
	}
	async run() {
		let n = 0;
		while(true) {
			if (this.batchMap.size == 0) {
				const b = new Batch(this.ns, this.targetServer, this.delay, this.greed, this.usableServers[0]);
				this.batchMap.set(b.id, b);
				b.run();
			}

			//The logic of use player stuff or free for all
			if (this.setUsableServers.length > 0) this.usableServers = this.setUsableServers;
			else this.#updateUsableServers();

			const now = Date.now();

			const toRemove = [];
			const bm = this.batchMap;
			this.batchMap.forEach((v, k, bm) => {
				if(now >= v.timeInfo.payWindow.start) toRemove.push(k);
			});
			
			toRemove.forEach(v => {
				this.batchMap.delete(v)
			});

			const safeEnd = Array.from(this.batchMap)[0][1].timeInfo.safeWindow.end;
			const safeStart = Array.from(this.batchMap)[0][1].timeInfo.safeWindow.start;
			if(now >= safeStart && now < safeEnd) {
				const nb = new Batch(this.ns, this.targetServer, this.delay, this.greed, this.usableServers[0]);
				this.batchMap.set(nb.id, nb);
			}
			this.ns.print("----");
			this.ns.print(this.batchMap.size);
			this.ns.print("----");

			while(!this.workerComms.empty()) {
				const result = [];
				for (let i = 0; i < BatchManager.#RP_ITEM_COUNT; i++) {
					result.push(this.workerComms.read());
				}

				this.ns.print(result);
			}

			await this.ns.sleep(0);
		}
	}

	//Free for all usable servers
	#updateUsableServers() {
		this.usableServers = this.allServers.filter(server => {
			nukeServer(this.ns, server);
			if (!this.ns.hasRootAccess(server) || this.ns.getServerMaxRam(server) < 2) return false;
			replicateFiles(this.ns, [BatchManager.HACK_SCRIPT, BatchManager.GROW_SCRIPT, BatchManager.WEAK_SCRIPT], server);
			return true;
		});
	}
}

class Batch {
	//Give each newly created batch a unique ID.
	static #GID = 0;

	/** @param {NS} ns */
	constructor(ns, target, delay, greed, usableServers, maxMoney = 0, startDelay = 0) {
		this.ns = ns;
		//Quick way to make sure every newly instantiated batch has a unique ID;
		this.id = Batch.#GID; Batch.#GID++;
		//This batch's target server.
		this.target = target;
		//All the servers this batch can use to hack, grow, weak target.
		this.usableServers = usableServers;

		//Object / Map to hold all the timing info of this batch
		this.timeInfo = {
			delay       : delay, //Delay between scripts
			total  		: { start: 0, end: 0, }, //Total batch time frame
			safeWindow 	: { start: 0, end: 0, }, //Window within the batch it is safe to start new batches
			payWindow  	: { start: 0, end: 0, }, //Window it is unsafe to have other batches ending in
			initialStartTime: Date.now() + startDelay, //The time this batch plus on option delay (for setting up future batches)
			started : false,
		}

		//Object / Map to hold all the hack, weaken, and grow information needed to run.
		this.hwgwInfo = {
			initialWeakenTime: Math.ceil(this.ns.getWeakenTime(this.target)), //Safe the initial weaken time calculated for on the fly adjustments
			totalRequiredRam: 0, //Total RAM that will be required for this batch
			isPrimed: true, //Flag to inform the batch if it will run HWGW or WGW
			greed: greed, //Percentage of many to steal
			maxMoney: (maxMoney < 1) ? Math.ceil(this.ns.getServerMaxMoney(this.target) * greed) : maxMoney, //Max amount of monet to steal; will limit greed.

			//Hack Info
			h: {type: 1, end: 0, time: 0, //hack flag, end time, total run time
				finished: false,  //Flag denoting completion of step
				nThreads: 0, aThreads: 0}, //NeededThreads, Allocated Threads

			//Same as above but but for weaken
			w1:{type: 2, end: 0, time: 0,
				finished: false,
				nThreads: 0, aThreads: 0},

			//as above
			g: {type: 3, end: 0, time: 0,
				finished: false,
				nThreads: 0, aThreads: 0},

			//really they are the same. I prommise.
			w2:{type: 4, end: 0, time: 0,
				finished: false,
				nThreads: 0, aThreads: 0},

			isFinished: () => this.hwgwInfo.h.finished && this.hwgwInfo.w1.finished && this.hwgwInfo.g.finished && this.hwgwInfo.w2.finished,
		};

		//Set-up the thread with its needed info.
		this.#calcHWGWInfo();
		this.#calcBatchTimes();
	}

	//Call this to begin the magic
	run() {
		this.timeInfo.started = true;
		this.ns.print(`🛡️ ${this.ns.getServerMinSecurityLevel(this.target)} / ${this.ns.getServerSecurityLevel(this.target)}`);
		this.ns.print(`💰 ${this.ns.getServerMoneyAvailable(this.target)} / ${this.ns.getServerMaxMoney(this.target)}`);
		this.ns.print(`Primed? ${this.hwgwInfo.isPrimed}`);

		if (this.hwgwInfo.isPrimed) {
			this.ns.print(`H Started`);
			this.#launchScript(BatchManager.HACK_SCRIPT, "home", this.hwgwInfo.h); //Launch hacking script				
		}

		//as above for weaken 1
		if (this.hwgwInfo.w1.nThreads > 0) {
			this.ns.print(`W1 Started`);
			this.#launchScript(BatchManager.WEAK_SCRIPT, "home", this.hwgwInfo.w1);
		}

		//Lets not do this again
		this.ns.print(`G Started`);
		this.#launchScript(BatchManager.GROW_SCRIPT, "home", this.hwgwInfo.g);

		//Hope you're enjoying the read.
		this.ns.print(`W2 Started`);
		this.#launchScript(BatchManager.WEAK_SCRIPT, "home", this.hwgwInfo.w2);
	}

	//Launch the given script and give it info based on the step of HWGW we are on.
	#launchScript(script, server, hwgwType) {
		//this.ns.tprint(hwgwType);
		this.ns.exec(script, server, hwgwType.nThreads, this.target, this.id, hwgwType.end, hwgwType.time, hwgwType.type);
	}

	//Set and Calc all the needed HWGW info
	#calcHWGWInfo() {
		//Ram tracker
		let ramNeeded = 0;

		//Deterime if server is ready for a full HWGW or a WGW
		this.hwgwInfo.isPrimed = this.ns.getServerMaxMoney(this.target) == this.ns.getServerMoneyAvailable(this.target) && 
								 this.ns.getServerSecurityLevel(this.target) == this.ns.getServerMinSecurityLevel(this.target);

		//Calc when this script should end. Keep that expecting ending consistent.
		this.hwgwInfo.h.end = this.timeInfo.initialStartTime + this.hwgwInfo.initialWeakenTime - this.timeInfo.delay;
		//Get the time this script will take to run with current stats.
		this.hwgwInfo.h.time = Math.ceil(this.ns.getHackTime(this.target));
		//Get the amount of needed threads based on the max money this script is set to steal.
		this.hwgwInfo.h.nThreads = Math.ceil(this.ns.hackAnalyzeThreads(this.target, this.hwgwInfo.maxMoney));
		//Add to ram tracker
		ramNeeded += 1.70 * this.hwgwInfo.h.nThreads;

		
		this.hwgwInfo.w1.end = this.timeInfo.initialStartTime + this.hwgwInfo.initialWeakenTime;
		this.hwgwInfo.w1.time = Math.ceil(this.ns.getWeakenTime(this.target));
		//Depending on if the server is primed we either need to counter act the hack or just ge3t sec to min from whereever it is.
		if (this.hwgwInfo.isPrimed)
			//counteract hack
			this.hwgwInfo.w1.nThreads = Math.ceil(this.ns.hackAnalyzeSecurity(this.hwgwInfo.h.nThreads) / this.ns.weakenAnalyze(1));
		else
			//Blast Sec to 0.
			this.hwgwInfo.w1.nThreads = Math.ceil(
				(this.ns.getServerSecurityLevel(this.target) - this.ns.getServerMinSecurityLevel(this.target)) / 
				this.ns.weakenAnalyze(1)
			);
		ramNeeded += this.ns.getScriptRam(BatchManager.WEAK_SCRIPT) * this.hwgwInfo.w1.nThreads;

		//All you gotta do is keep it strong
		const simServer = this.ns.getServer(this.target);
		simServer.moneyAvailable = Math.ceil(simServer.moneyMax * (1 - this.hwgwInfo.greed));

		this.hwgwInfo.g.end = this.timeInfo.initialStartTime + this.hwgwInfo.initialWeakenTime + this.timeInfo.delay;
		this.hwgwInfo.g.time = Math.ceil(this.ns.getGrowTime(this.target));
		this.hwgwInfo.g.nThreads = Math.ceil(this.ns.formulas.hacking.growThreads(simServer, this.ns.getPlayer(), simServer.moneyMax));
		ramNeeded += 1.75 * this.hwgwInfo.g.nThreads;

		this.hwgwInfo.w2.end = this.timeInfo.initialStartTime + this.hwgwInfo.initialWeakenTime + this.timeInfo.delay * 2;
		this.hwgwInfo.w2.time = Math.ceil(this.ns.getWeakenTime(this.target));
		this.hwgwInfo.w2.nThreads = Math.ceil(this.ns.growthAnalyzeSecurity(this.hwgwInfo.g.nThreads) / this.ns.weakenAnalyze(1));
		ramNeeded += 1.75 * this.hwgwInfo.w2.nThreads;
		
		this.hwgwInfo.totalRequiredRam = ramNeeded; 
	}

	//Calculate batch time based on passed in info
	#calcBatchTimes() {
		//Very start to ver end of batch
		this.timeInfo.total.start = this.timeInfo.initialStartTime;
		this.timeInfo.total.end = this.hwgwInfo.w2.end;

		//Window its fine to spawn batches within
		this.timeInfo.safeWindow.start = this.timeInfo.initialStartTime + this.timeInfo.delay * 3;
		this.timeInfo.safeWindow.end = this.hwgwInfo.h.end - this.timeInfo.delay;

		//Window you don't want other atches ending in; sad time if you do.
		this.timeInfo.payWindow.start = this.hwgwInfo.h.end;
		this.timeInfo.payWindow.end = this.hwgwInfo.w2.end;
	}
}