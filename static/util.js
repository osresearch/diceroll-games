/*
 * BigInt functions that seem like they should be in the
 * normal objects, but whatevers.
 */
function randomBigInt(bytes=32)
{
        let a = new Uint8Array(bytes);
        window.crypto.getRandomValues(a);
	return arrayToBigInt(a);
}

/*
 * Convert a byte array in MSB first order into a BigInt 
 */
function arrayToBigInt(a)
{
	let x = 0n;
	for(let y of a)
		x = (x << 8n) | BigInt(y);
        return x;
}

/*
 * Convert a BigInt to a byte array of length l in MSB first order.
 */
function arrayFromBigInt(m,l=32)
{
	let r = [];

	m = BigInt(m); // just in case

	for(let i = 1 ; i <= l ; i++)
	{
		r[l - i] = Number(m & 0xFFn);
		m >>= 8n;
	}

	if (m != 0n)
		console.log("m too big for l", m, l, r);

	return r;
}

/*
 * Hash a bigint, returning a bigint
 */
function sha256BigInt(x)
{
	return arrayToBigInt(sha256.sha256(arrayFromBigInt(x, 32)));
}
