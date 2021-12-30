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
 * Make a div into an editable div, with a callback for
 * when the editing is finished.
 */
function make_editable(div, changed = () => {})
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
