// import {threadCalc, getAllServers, formatUSD, nukeServer, replicateFiles} from "./helpers.js";
/** @param {NS} ns */
export function threadCalc(ns, script, host, threadsNeeded = 0) {
	const serverRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
	const scriptRam = ns.getScriptRam(script, host);
	const totalThreads = Math.floor(serverRam / scriptRam);
	threadsNeeded = Math.floor(threadsNeeded);
	let limit;

	if(threadsNeeded == 0) limit = totalThreads;
	else if(threadsNeeded >= totalThreads) limit = totalThreads;
	else limit = threadsNeeded;

	return Math.floor(limit);
}

/** @param {NS} ns */
export function getAllServers(ns) {
	const targetsSet = new Set();
	const rSSInner = (node) => {
		const foundNodes = ns.scan(node);
		foundNodes.forEach(n => {
			if(!targetsSet.has(n)) {
				targetsSet.add(n);
				rSSInner(n);
			}
		})
	}
	rSSInner("home");
	targetsSet.delete("home");
	return Array.from(targetsSet);
}

/** @param {NS} ns */
export function formatUSD(ns, num) {
	// Create our number formatter.
	const formatter = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		// These options are needed to round to whole numbers if that's what you want.
		//minimumFractionDigits: 0, // (this suffices for whole numbers, but will print 2500.10 as $2,500.1)
		//maximumFractionDigits: 0, // (causes 2500.99 to be printed as $2,501)
	});

	return formatter.format(num);
}

/** @param {NS} ns */
export function nukeServer(ns, target) {
	// If we have the program to open a port on home; open it on the target server.
	if (ns.fileExists("BruteSSH.exe",  "home")) ns.brutessh(target)
	if (ns.fileExists("FTPCrack.exe",  "home")) ns.ftpcrack(target)
	if (ns.fileExists("relaySMTP.exe", "home")) ns.relaysmtp(target);
	if (ns.fileExists("HTTPWorm.exe",  "home")) ns.httpworm(target);
	if (ns.fileExists("SQLInject.exe", "home")) ns.sqlinject(target);
		
	//Get root access to target server
	//Will crash if not enough open ports
	//Prevents the script from dying if this is the case
	if (!ns.hasRootAccess(target)) try { ns.nuke(target); } catch(e) { }
}

/** @param {NS} ns */
export function replicateFiles(ns, files, target) {
	files.forEach(file => {
		ns.scp(file, target, "home");
	});
}