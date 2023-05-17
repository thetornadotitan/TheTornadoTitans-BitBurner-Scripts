import {threadCalc, getAllServers, formatUSD, nukeServer, replicateFiles} from "./helpers.js";
/** @param {NS} ns */
export async function main(ns) {
	const bm = new BatchManager(ns, 20, 0.5, ["n00dles"], 0, ["home"]);
	await bm.run();
}

class BatchManager {
	//Script refrences
	static HACK_SCRIPT = "b/hack.js";
	static WEAK_SCRIPT = "b/weak.js";
	static GROW_SCRIPT = "b/grow.js";

	/** @param {NS} ns */
	constructor(ns, delay = 20, greed = 0.5, targetServers = [], maxMoney = 0, usableServers = []) {
		this.ns = ns;
		// Key: Server => Value: Batch[]
		this.batchMap = new Map();
		//time between scripts and batches whole numebr >= 5ms
		this.delay = Math.max(Math.ceil(delay), 5);
		//Percent of money to steal 0.01 <= greed <= 1
		this.greed = Math.max(Math.min(greed, 1), 0.01);
		//Whole number >= 1 to limit money steal (min is actual the amount 1 hack thread will steal from the server)
		this.maxMoney = (maxMoney == 0) ? 0 : Math.ceil(Math.max(maxMoney, 1));

		this.allServers = getAllServers(this.ns); //As it says

		//If the player explicity set servers to target; target them. Otherwise, free-for-all
		this.setTargetServers = targetServers;
		this.targetServers = [];

		//If the player explicity set servers to use; use them. Otherwise, free-for-all
		this.setUsableServers = usableServers;
		this.usableServers = [];
	}

	async run() {
		//The logic of use player stuff or free for all
		if (this.setUsableServers.length > 0) this.usableServers = this.setUsableServers;
		else this.#updateUsableServers();
		if (this.setTargetServers.length > 0) this.targetServers = this.setTargetServers;
		else this.#updateTargetServers();
		
		const b = new Batch(this.ns, this.targetServers[0], this.delay, this.greed, this.usableServers[0]);
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

	//Free for all target servers
	#updateTargetServers() {
		this.targetServers = this.allServers.filter(server => {
			nukeServer(this.ns, server);
			if (!this.ns.hasRootAccess(server) || this.ns.getServerRequiredHackingLevel(server) > this.ns.getHackingLevel() / 2) return false;
			return true;
		});
	}
}

class Batch {
	//Give each newly created batch a unique ID.
	static #GID = 0;

	//Port Handle Numbers for Batch to Worker Comms
	static #STATE_PORT    = 19;
	static #RESULT_PORT   = 20;

	//The number of items returned per script when they finish writing to the result port.
	static #RP_ITEM_COUNT = 7;

	/** @param {NS} ns */
	constructor(ns, target, delay, greed, usableServers, maxMoney = 0, startDelay = 0) {
		this.ns = ns;
		//Quick way to make sure every newly instantiated batch has a unique ID;
		this.id = Batch.#GID; Batch.#GID++;
		//This batch's target server.
		this.target = target;
		//All the servers this batch can use to hack, grow, weak target.
		this.usableServers = usableServers;

		//Comm ports
		this.statePort =  this.ns.getPortHandle(Batch.#STATE_PORT);
		this.resultPort = this.ns.getPortHandle(Batch.#RESULT_PORT);

		//Object / Map to hold all the timing info of this batch
		this.timeInfo = {
			delay       : delay, //Delay between scripts
			total  		: { start: 0, end: 0, }, //Total batch time frame
			safeWindow 	: { start: 0, end: 0, }, //Window within the batch it is safe to start new batches
			payWindow  	: { start: 0, end: 0, }, //Window it is unsafe to have other batches ending in
			initialStartTime: Date.now() + startDelay, //The time this batch plus on option delay (for setting up future batches)
			totalDelay: 0, //Total delay this batch experienced during its run
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
				started: false, ended: false, //Flags for this script having started and ended
				nThreads: 0, aThreads: 0}, //NeededThreads, Allocated Threads

			//Same as above but but for weaken
			w1:{type: 2, end: 0, time: 0,
				started: false, ended: false,
				nThreads: 0, aThreads: 0},

			//as above
			g: {type: 3, end: 0, time: 0,
				started: false, ended: false,
				nThreads: 0, aThreads: 0},

			//really they are the same. I prommise.
			w2:{type: 4, end: 0, time: 0,
				started: false, ended: false,
				nThreads: 0, aThreads: 0},

			//Method to determine if this batch is done.
			isComplete: () => {return this.hwgwInfo.h.ended && this.hwgwInfo.w1.ended && 
									  this.hwgwInfo.g.ended && this.hwgwInfo.w2.ended}
		};

		//Set-up the thread with its needed info.
		this.#calcHWGWInfo();
		this.#calcBatchTimes();
	}

	//Call this to begin the magic
	async run() {
		while(!this.hwgwInfo.isComplete()) { 
			if (Date.now() < this.timeInfo.initialStartTime) await this.ns.sleep(0); //Hold off on the magic until its time
			this.#calcHWGWInfo(); //Recalculate script start times to maintain the originally set ending times. (react to level up and other factors)

			if (!this.hwgwInfo.h.started && this.hwgwInfo.isPrimed) {
				this.#launchScript(BatchManager.HACK_SCRIPT, "home", this.hwgwInfo.h); //Launch hacking script
				this.hwgwInfo.h.started = true; //Inform the batch hack was launched
				await this.statePort.nextWrite(); //No wait until we hear back about any delays from the hack script.
				while(!this.statePort.empty()) this.timeInfo.totalDelay += this.statePort.read(); //Add any delays to the batch's totalDelay tracker.
			} else this.hwgwInfo.h.ended = true; //If the server is not primed; skip hacking.

			//as above for weaken 1
			if (!this.hwgwInfo.w1.started) {
				this.#launchScript(BatchManager.WEAK_SCRIPT, "home", this.hwgwInfo.w1);
				this.hwgwInfo.w1.started = true;
				await this.statePort.nextWrite();
				while(!this.statePort.empty()) this.timeInfo.totalDelay += this.statePort.read();
			}

			//Lets not do this again
			if (!this.hwgwInfo.g.started) {
				this.#launchScript(BatchManager.GROW_SCRIPT, "home", this.hwgwInfo.g);
				this.hwgwInfo.g.started = true;
				await this.statePort.nextWrite();
				while(!this.statePort.empty()) this.timeInfo.totalDelay += this.statePort.read();
			}

			//Hope you're enjoying the read.
			if (!this.hwgwInfo.w2.started) {
				this.#launchScript(BatchManager.WEAK_SCRIPT, "home", this.hwgwInfo.w2);
				this.hwgwInfo.w2.started = true;
				await this.statePort.nextWrite();
				while(!this.statePort.empty()) this.timeInfo.totalDelay += this.statePort.read();
			}

			//This results port will listen for script completions and mark them as such.
			//Once all are marked complete the while loop will resolve ending the batch.
			const results = []
			while(!this.resultPort.empty()) {
				for (let i = 0; i < Batch.#RP_ITEM_COUNT; i ++) {
					results.push(this.resultPort.read());
				}

				this.ns.tprint(results);
				if (results[0] == 1) this.hwgwInfo.h.ended = true;
				if (results[0] == 2) this.hwgwInfo.w1.ended = true;
				if (results[0] == 3) this.hwgwInfo.g.ended = true;
				if (results[0] == 4) this.hwgwInfo.w2.ended = true;

				results.splice(0,Batch.#RP_ITEM_COUNT);
			}
			
			//zZz
			await this.ns.sleep(0);
		}
	}

	//Launch the given script and give it info based on the step of HWGW we are on.
	#launchScript(script, server, hwgwType) {
		this.ns.tprint(hwgwType);
		this.ns.exec(script, server, hwgwType.nThreads, this.target, this.id, hwgwType.end, hwgwType.time, hwgwType.type);
	}

	//Set and Calc all the needed HWGW info
	#calcHWGWInfo() {
		//Ram tracker
		let ramNeeded = 0;

		//Deterime if server is ready for a full HWGW or a WGW
		this.hwgwInfo.isPrimed = this.ns.getServerMaxMoney(this.target) == this.ns.getServerMoneyAvailable(this.target) && 
								 this.ns.getServerSecurityLevel(this.target) == this.ns.getServerMinSecurityLevel(this.target);
		
		//Don recalculate if we have already started this script.
		if (!this.hwgwInfo.h.started) {
			//Calc when this script should end. Keep that expecting ending consistent.
			this.hwgwInfo.h.end = this.timeInfo.initialStartTime + this.hwgwInfo.initialWeakenTime - this.timeInfo.delay;
			//Get the time this script will take to run with current stats.
			this.hwgwInfo.h.time = Math.ceil(this.ns.getHackTime(this.target));
			//Get the amount of needed threads based on the max money this script is set to steal.
			this.hwgwInfo.h.nThreads = Math.ceil(this.ns.hackAnalyzeThreads(this.target, this.hwgwInfo.maxMoney));
			//Add to ram tracker
			ramNeeded += this.ns.getScriptRam(BatchManager.HACK_SCRIPT, this.target) * this.hwgwInfo.h.nThreads;
		}

		//mostly the same as above, will comment differences
		if (!this.hwgwInfo.w1.started) {
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

			ramNeeded += this.ns.getScriptRam(BatchManager.WEAK_SCRIPT, this.target) * this.hwgwInfo.w1.nThreads;
		}

		//All you gotta do is keep it strong
		if (!this.hwgwInfo.g.started) {
			const simServer = this.ns.getServer(this.target);
			simServer.moneyAvailable = Math.ceil(simServer.moneyMax * (1 - this.hwgwInfo.greed));

			this.hwgwInfo.g.end = this.timeInfo.initialStartTime + this.hwgwInfo.initialWeakenTime + this.timeInfo.delay;
			this.hwgwInfo.g.time = Math.ceil(this.ns.getGrowTime(this.target));
			this.hwgwInfo.g.nThreads = Math.ceil(this.ns.formulas.hacking.growThreads(simServer, this.ns.getPlayer(), simServer.moneyMax));
			ramNeeded += this.ns.getScriptRam(BatchManager.GROW_SCRIPT, this.target) * this.hwgwInfo.g.nThreads;
		}

		//Move along move along like I know you do.
		if (!this.hwgwInfo.w2.started) {
			this.hwgwInfo.w2.end = this.timeInfo.initialStartTime + this.hwgwInfo.initialWeakenTime + this.timeInfo.delay * 2;
			this.hwgwInfo.w2.time = Math.ceil(this.ns.getWeakenTime(this.target));
			this.hwgwInfo.w2.nThreads = Math.ceil(this.ns.growthAnalyzeSecurity(this.hwgwInfo.g.nThreads) / this.ns.weakenAnalyze(1));
			ramNeeded += this.ns.getScriptRam(BatchManager.WEAK_SCRIPT, this.target) * this.hwgwInfo.w2.nThreads;
		}

		//Update RAM required if we calculated a higher need. 
		if (ramNeeded > this.hwgwInfo.totalRequiredRam) this.hwgwInfo.totalRequiredRam = ramNeeded; 
	}

	//Calculate batch time based on passed in info
	#calcBatchTimes() {
		//Very start to ver end of batch
		this.timeInfo.total.start = this.timeInfo.initialStartTime;
		this.timeInfo.total.end = this.hwgwInfo.w2.end;

		//Window its fine to spawn batches within
		this.timeInfo.safeWindow = this.timeInfo.initialStartTime + this.timeInfo.delay * 3;
		this.timeInfo.safeWindow = this.hwgwInfo.h.end - this.timeInfo.delay;

		//Window you don't want other atches ending in; sad time if you do.
		this.timeInfo.payWindow = this.hwgwInfo.h.end;
		this.timeInfo.payWindow = this.hwgwInfo.w2.end;
	}
}