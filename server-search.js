/** @param {NS} ns */
export async function main(ns) {
	const serverTree = new Map();

	const recursiveScan = (currentNode, depth) => {
		if (serverTree.has(currentNode)) return;
		
		const children = ns.scan(currentNode);
		serverTree.set(currentNode, children);

		let padding = "";

		for (let i = 0; i < depth * 2; i++) {
			padding += "-";
		}

		ns.tprint((`${padding}${currentNode}`));

		children.forEach(child => {
			recursiveScan(child, depth + 1);
		});

		return;
	}

	recursiveScan("home", 0);
}