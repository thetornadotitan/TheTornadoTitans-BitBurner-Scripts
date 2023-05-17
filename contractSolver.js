/** @param {NS} ns */
export async function main(ns) {
	const values = {
		"Find Largest Prime Factor" : lpf,
		"Subarray with Maximum Sum" : sams,
		"Total Ways to Sum" : twts,
		"Total Ways to Sum II" : notImplemented,
		"Spiralize Matrix" : notImplemented,
		"Array Jumping Game" : notImplemented,
		"Array Jumping Game II" : notImplemented,
		"Merge Overlapping Intervals" : notImplemented,
		"Generate IP Addresses" : notImplemented,
		"Algorithmic Stock Trader I" : notImplemented,
		"Algorithmic Stock Trader II" : notImplemented,
		"Algorithmic Stock Trader III" : notImplemented,
		"Algorithmic Stock Trader IV" : notImplemented,
		"Minimum Path Sum in a Triangle" : notImplemented,
		"Unique Paths in a Grid I" : notImplemented,
		"Unique Paths in a Grid II" : notImplemented,
		"Shortest Path in a Grid" : notImplemented,
		"Sanitize Parentheses in Expression" : notImplemented,
		"Find All Valid Math Expressions" : notImplemented,
		"HammingCodes: Integer to Encoded Binary" : notImplemented,
		"HammingCodes: Encoded Binary to Integer" : notImplemented,
		"Proper 2-Coloring of a Graph" : notImplemented,
		"Compression I: RLE Compression" : notImplemented,
		"Compression II: LZ Decompression" : notImplemented,
		"Compression III: LZ Compression" : notImplemented,
		"Encryption I: Caesar Cipher" : notImplemented,
		"Encryption II: Vigenère Cipher" : notImplemented
	}
	const contractMap = new Map(Object.entries(values));

	//ns.codingcontract.createDummyContract("Total Ways to Sum");
}

/** @param {NS} ns */
function notImplemented(ns, key, file, host) {
	ns.tprint(`${key} - Not solved yet.`);
}

/** @param {NS} ns */
function lpf(ns, key, file, host) {
	//primes
	let largest = 2;
	let n = ns.codingcontract.getData(file, host);
	while(largest<=n) {
		if (n % largest == 0) n/=largest;
		else largest++;
	}
	ns.codingcontract.attempt(largest, file, host);
	ns.print(`${key} - Complete. ${largest}`);
}

/** @param {NS} ns */
function sams(ns, key, file, host) {
	const nums = ns.codingcontract.getData(file, host);

	if (nums == null || nums.length == 0) {
    	ns.codingcontract.attempt(0, file, host);
		return;
	}

    let maxSum = nums[0];
    let localMaxSum = nums[0];

    for (let i = 1; i < nums.length; i++) {
        localMaxSum = nums[i] + Math.max(0, localMaxSum);
        maxSum = Math.max(maxSum, localMaxSum);
    }
	
    ns.codingcontract.attempt(maxSum, file, host);
	ns.print(`${key} - Complete. ${largest}`);
}

/** @param {NS} ns */
function twts(ns, key, file, host) {
	const nums = ns.codingcontract.getData(file, host);

	if (nums == null || nums.length == 0) {
    	ns.codingcontract.attempt(0, file, host);
		return;
	}

    let maxSum = nums[0];
    let localMaxSum = nums[0];

    for (let i = 1; i < nums.length; i++) {
        localMaxSum = nums[i] + Math.max(0, localMaxSum);
        maxSum = Math.max(maxSum, localMaxSum);
    }
	
    ns.codingcontract.attempt(maxSum, file, host);
	ns.print(`${key} - Complete. ${largest}`);
}

/** @param {NS} ns */
function twts(ns, key, file, host) {
	let N = ns.codingcontract.getData(file, host);
	let K = 2;
	// Initialize a list
    let dp = Array.from({length: N + 1}, (_, i) => 0);
   
    // Update dp[0] to 1
    dp[0] = 1;
 
    // Iterate over the range [1, K + 1]
    for(let row = 1; row < K + 1; row++)
        // Iterate over the range [1, N + 1]
        for(let col = 1; col < N + 1; col++)
            // If col is greater
            // than or equal to row
            if (col >= row)
                // Update current
                // dp[col] state
                dp[col] = dp[col] + dp[col - row];
 
    // Return the total number of ways
	ns.codingcontract.attempt(dp[N], file, host);
	ns.print(`${key} - Complete. ${largest}`);
}