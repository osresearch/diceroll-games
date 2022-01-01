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

/*
 * Compute a^e % n with big integers
 * using the modular exponentiation so that it can be done
 * in (non-constant) log2 time.  a and e can be either BigInt,
 * number or hex strings.  Returns a BigInt.
 */
function modExp(a, e, n)
{
	if (typeof(a) === "string")
		a = BigInt("0x" + a);
	else if (typeof(a) == "number")
		a = BigInt(a);

	if (typeof(e) === "string")
		e = BigInt("0x" + e);
	else if (typeof(e) == "number")
		e = BigInt(e);

	let r = 1n;
	let x = a % n;

	while (e != 0n)
	{
		if (e & 1n)
			r = (r * x) % n;

		e >>= 1n;
		x = (x * x) % n;
	}

	return r;
}



/*
 * Make a div into an editable div, with a callback for
 * when the editing is finished.
 */
function make_editable(div, changed = (newvalue) => {}, editing = (div) => {})
{
	let form;
	let input;

	function remove_form()
	{
		input.onblur = null;
		form.parentNode.removeChild(form);
		div.style.display = 'block';
	};

	function finished(e)
	{
		const new_value = input.value;

		e.preventDefault();
		// and update our selves
		for(let d of document.querySelectorAll('.peer-' + sock.id))
			div.innerText = new_value;

		remove_form();
		changed(new_value);
	}

	function clicked()
	{
		form = document.createElement('form');
		input = document.createElement('input');
		form.addEventListener('submit', finished);

		form.appendChild(input);
		div.parentNode.insertBefore(form, div);
		div.style.display = 'none';

		editing(div);

		// select all and move input to the box
		const old_value = div.innerText;
		input.value = old_value;
		input.focus();
		input.select();
		input.id = div.id + "-input";
		input.classList.add("editable");
		input.autocomplete = 'off';
		input.size = old_value.length + 5;
		input.onblur = remove_form;
		console.log(input);
	}

	div.onclick = clicked;
}
