/*
 * Dice client connected to the other peers via socket.io
 * The rendezvous server for production deploys runs on
 * heroku, for localhost it contacts localhost
 */
const server = document.location.origin.startsWith('http://localhost')
	? document.location.origin
	: 'https://diceroll-games.herokuapp.com/';

// If there isn't a room ID, create one and append
// it to the URL string
if (!document.location.hash)
{
	let rand_room = randomBigInt(16).toString(36);

	console.log("generating random room", rand_room);
	document.location.hash = ''
		+ rand_room.substr(0,4)
		+ '-'
		+ rand_room.substr(4,4)
		+ '-'
		+ rand_room.substr(8,4)
		+ '-'
		+ rand_room.substr(12,4);
}

// update the invite link and add a click-to-copy
const invite = document.getElementById("invite-link");
if (invite)
{
	invite.href = document.location.href;
	invite.title = "Click to copy the invite link";
	invite.onclick = (e) => {
		e.preventDefault();
		navigator.clipboard.writeText(document.location.href)
			.then(() => {});

		// todo: little popup to say "Copied!"
		const d = document.createElement('div');
		d.innerText = "Copied!";
		d.classList.add("floating");
		invite.appendChild(d);
		setTimeout(() => {
			d.classList.add("fade-out");
			setTimeout(() => d.parentNode.removeChild(d), 1200);
		}, 700);

		return false;
	};
}

let room = document.location.hash;
const sock = new Room(server, room);
let rolls = {};
let nick = sock.id;

let distribution = [0,0,0,0,0,0];


// load the dice configurations from the json file
let dice_set = null;
let dice_sets = {};
function dice_sets_populate(new_dice_sets)
{
	const sel = document.getElementById("dice-sets");
	if (!sel)
		return;

	// delete the existing items
	sel.innerText = '';

	// todo: check for existence
	const dice = new_dice_sets["dice"];
	const sets = new_dice_sets["sets"];
	dice_sets = {};

	for(let name in sets)
	{
		const opt = document.createElement("option");
		opt.value = name;
		opt.text = name;
		sel.appendChild(opt);

		const set = [];
		for(let die of sets[name])
		{
			if (!(die in dice))
				console.log(name, "bad die", die);
			set.push(dice[die])
		}

		dice_sets[name] = set;

		// default to the first one
		if (!dice_set)
			dice_set = set;
	}
}

function dice_set_choose(sel)
{
	console.log("choose", sel);
	dice_set = dice_sets[sel.value]; // the chosen dice
}

fetch("dice.json").then(r => r.json()).then(data => dice_sets_populate(data));


function log_append(src, msg, msg_class="message")
{
	const log = document.getElementById("log");
	const e = document.createElement('p');
	const s = document.createElement('span');
	s.classList.add("sender");
	if (src == server)
		s.classList.add("sender-server");
	if (src == sock.id)
		s.classList.add("sender-self");
	s.innerText = src;
	e.appendChild(s);

	e.appendChild(document.createTextNode(" "));

	const m = document.createElement('span');
	m.classList.add(msg_class);
	m.innerText = msg;

	e.appendChild(m);
	log.appendChild(e);
	log.scrollTop = log.scrollHeight;
}

let initial_name = true;

function peer_add(peer)
{
	rolls = {}; // always cancel any runs in process

	log_append(server, '+ ' + peer.id, 'message-public');

	// don't add if they already exist
	if (document.getElementById("peerlist-" + peer.id))
		return;

	// any new peers should be added
	const d = document.getElementById("nicks");
	if (!d)
		return;

	const li = document.createElement('li');
	const n = document.createElement('span');
	n.classList.add('peer-' + peer.id);
	n.classList.add('nick');
	n.id = "peerlist-" + peer.id;

	n.innerText = peer.nick;
	n.title = "Verification code " + peer.id;
	li.appendChild(n);
	d.appendChild(li);

	if (peer.id == sock.id)
	{
		// this is our own entry
		n.classList.add('nick-self');
		n.id = "players-nick-self";

		let editing = () => {};

		if (initial_name)
		{
			// add something to help them know to change it
			const help = document.createElement('span');
			help.innerText = " Click to change!";
			help.classList.add("hover-text");
			help.id = "players-nick-self-help";
			li.appendChild(help);
			initial_name = false;
			n.title = "Click to set your nickname";

			editing = () => {
				help.parentNode.removeChild(help);
				n.title = "Your verification code " + peer.id;
			};
		}

		make_editable(n, nick_set, editing);
	}
}

peer_add({id: sock.id, nick: sock.id});

/*
 * These are the system level ones that the server sends to us
 */
// called when a connection to the server is established
sock.on('connect', () => {
	rolls = {};
	console.log(server, "RECONNECTED");
	log_append(server, 'Reconnected', 'message-server');

	// we can't send any messages until we have the member list,
	// which means that we've been re-keyed
});

// room sends this message when a new room key has been
// negotiated with the list of all the peers and their pubkey.
// this is the first time it is safe to send messages
sock.on('members', (peers,removed_peers) => {
	console.log("members", peers);

	// let people know our nick name
	if (nick && nick != sock.id)
		sock.emit('nick', nick);

	// any removed peers should be grayed out
	for(const src in removed_peers)
	{
		let peer = removed_peers[src];
		console.log(peer.id, "removed");
		for(let d of document.querySelectorAll('.peer-' + peer.id))
			d.style.opacity = 0.1;
	}

	// set a default nick name for each of the peers
	for(const src in peers)
	{
		let peer = peers[src];
		if (!peer.nick)
			peer.nick = peer.id;
		peer_add(peers[src]);

		for(let d of document.querySelectorAll('.peer-' + peer.id))
			d.style.opacity = 1.0; // if they come back
	}

});


function nick_set(new_nick)
{
	nick = new_nick;
	console.log("my nick is ", nick);
	sock.emit('nick', nick);

	for(let d of document.querySelectorAll('.peer-' + sock.id))
		d.innerText = new_nick;
}

// update the nick display for a peer
sock.on('nick', (peer,their_nick) => {
	peer.nick = their_nick;
	console.log(peer.id, "now known as", their_nick);
	log_append(peer.id, "nick " + their_nick);

	for(let d of document.querySelectorAll('.peer-' + peer.id))
		d.innerText = their_nick;
});



/*
 * These are the ones that we define for our dice client
 *
 * A peer can propose a set of dice (N sets of K images)
 *
 * A peer can start a roll for a dice by saying which die and a seed,
 * all peers will generate a random value and publish the hash of
 * the value. Once they have received hashes from all the other peers
 * in the room, they will publish the value.
 *
 * If this is a private roll, the initial peer can add all of the
 * revealed values, plus their own secret one and the seed, and
 * take it modulo the K for that die to learn the roll.
 *
 * When they are ready to reveal, they publish their value and the
 * everyone can compute the same result.
 *
 * Cheaters can't publish fake values, since they have already committed
 * the value.  They can't collude since they can't control the honest
 * player's value.
 * 
 */

// start a dice roll or respond to one
function roll_commit(sock, which=0, tag=randomBigInt())
{
	const tag_str = tag.toString(16);
	const short_tag = tag_str.substr(0,16);

	if (!(tag_str in rolls))
	{
		log_append(sock.id, short_tag + " NEW ROLL " + which);
		rolls[tag_str] = {}
	}

	const my_value = randomBigInt(32);
	const my_hash = sha256BigInt(my_value);
	const my_roll = {
		hash: my_hash,
		value: my_value,
		which: which,
	};

	rolls[tag_str][sock.id] = my_roll;
	const hash_str = my_hash.toString(16);
	log_append(sock.id, short_tag + " hashed " + hash_str, 'message-public');

	sock.emit('commit', {
		"tag": tag_str,
		"which": which,
		"hash": hash_str,
	});

	// if there are no peers, start the reveal
	if (sock.peer_count() == 0)
		roll_reveal(sock, which, tag_str);
}

function roll_reveal(sock, which, tag)
{
	// all peers have committed! time to reveal
	const short_tag = tag.substr(0,16);
	const my_value = rolls[tag][sock.id].value.toString(16);
	log_append(sock.id, short_tag + " reveal " + my_value);

	sock.emit('reveal', {
		"tag": tag,
		"which": which,
		"value": my_value,
	});

	if (sock.peer_count() == 0)
		roll_finalize(sock, which, tag);
}

function roll_finalize(sock, which, tag)
{
	// try to compute the result of this roll
	// if any peers have not yet revealed this tag, then we're done
	const roll = rolls[tag];
	const short_tag = tag.substr(0,16);

	let result = BigInt("0x" + tag);
	const base = (1n << 255n) - 19n;

	// add in our component
	result = modExp(result, roll[sock.id].value, base);

	for (let src in sock.peers)
	{
		const peer = sock.peers[src];
		if (!(peer.id in roll))
			return;
		if (!("value" in roll[peer.id]))
			return;
		result = modExp(result, roll[peer.id].value, base);
	}

	// hash the result to mix it a bit more
	result = sha256BigInt(result);

	const choices = BigInt(dice_set[which].length);
	const short_result = Number(result % choices);
	const output = dice_set[which][short_result];

	log_append(sock.id, short_tag + " die-" + which + " => " + short_result);
	console.log("RESULT", tag, result, short_result, output);

	// create a new output die for this roll
	const d = document.getElementById("rolls");
	if (!d)
		return;

	const r = d.firstChild;
	const img = document.createElement('img');
	img.width = 128;
	img.height = 128;
	img.src = output;
	img.alt = output;
	img.style.opacity = 1.0;
	img.onclick = () => { img.style.opacity = img.style.opacity > 0.5 ? 0.25 : 1.0 };
	r.appendChild(img);

/*
	// update the distribution
	document.getElementById('count-'+short_result).innerText =
		++distribution[short_result];
*/
}

// called when a peer has initiated a new roll
// which also will update the die with the ones
// from the roller
function roll_row_create(peer, new_die)
{
	dice_set = new_die;
	const r = document.getElementById('rolls');
	if (!r)
		return;
	console.log(peer.id, "initiated new roll");
	const src_div = document.createElement('span');
	src_div.innerText = peer.nick;
	src_div.classList.add("peer-" + peer.id);
	src_div.classList.add(peer.id == sock.id ? 'nick-self' : 'nick');

	const time_div = document.createElement('span');
	const now = new Date();
	time_div.innerText = " " + now.toISOString();
	time_div.classList.add("timestamp");

	const orow = document.createElement('div');
	orow.appendChild(src_div);
	orow.appendChild(time_div);

	const d = document.createElement('div');
	d.appendChild(orow);

	const old = r.firstChild;
	if (old)
		old.style.opacity = 0.3;
	r.insertBefore(d, r.firstChild);
}

function roll_all()
{
	if (!dice_set)
	{
		alert("no dice sets loaded?");
		return;
	}

	roll_row_create({id: sock.id, nick: nick}, dice_set);
	sock.emit('roll', dice_set);

	for(let i = 0 ; i < dice_set.length ; i++)
		roll_commit(sock,i);
}

sock.on('roll', roll_row_create);

// called when another peer has initiated a dice roll or
// is responding to a dice roll by another peer.
sock.on('commit', (peer,msg) => {
	console.log("commit", peer.id, msg);

	if (!("tag" in msg && "which" in msg && "hash" in msg))
	{
		log_append(peer.id, "bad message" + msg, 'message-server');
		return;
	}

	const tag = msg.tag.toString();
	const short_tag = tag.substr(0,16);
	const which = msg.which;
	const hash = msg.hash;

	if (!(which in dice_set))
	{
		log_append(peer.id, short_tag + " no such die " + which, 'message-server');
		return;
	}

	if (!(tag in rolls))
	{
		// first time we've seen this tag, so let's
		// create the bookkeeping for it
		log_append(peer.id, short_tag + " NEW ROLL");
		rolls[tag] = {}

		// and add our roll and commitment to it,
		// plus send the reply to the room
		roll_commit(sock, which, tag);
	}

	const roll = rolls[tag];

	// if this src has already done this roll, then
	// they are cheating (or the server has duped us)
	if (peer.id in roll)
	{
		console.log("duplicate?", peer.id, msg, roll);
		log_append(peer.id, short_tag + " already rolled?", 'message-server');
		return;
	}

	// does this roll match the die that we are expecting?
	const expected_which = roll[sock.id].which;
	if (which != expected_which)
	{
		log_append(peer.id, short_tag + " wrong dice? expected " + expected_which + " got " + which, 'message-server');
		return;
	}

	roll[peer.id] = { hash: BigInt("0x" + hash) };

	log_append(peer.id, short_tag + " hashed " + hash , 'message-public');

	// if any peers have not yet commited to this tag, then we're done
	for (let peer in sock.peers)
		if (!(sock.peers[peer].id in roll))
			return;

	roll_reveal(sock, which, tag);
});

sock.on('reveal', (peer,msg) => {
	console.log(peer.id, "reveal", msg);
	const tag = msg.tag;
	const which = msg.which;
	const value = msg.value;

	if (!(tag in rolls))
	{
		log_append(peer.id, tag.substr(0,16) + " not in rolls?" + msg, 'message-server');
		return;
	}

	const roll = rolls[tag];
	if (!(peer.id in roll))
	{
		log_append(peer.id, tag.substr(0,16) + " did not commit?" + msg, 'message-server');
		return;
	}

	const their_roll = roll[peer.id];

	if ("value" in their_roll)
	{
		log_append(peer.id, tag.substr(0,16) + " double reveal?" + msg, 'message-server');
		return;
	}

	const their_value = BigInt("0x" + value);
	const expected_hash = sha256BigInt(their_value);

	if (expected_hash != their_roll.hash)
	{
		console.log(peer.id, "BAD HASH. Expected != Recieved", expected_hash.toString(16), their_roll.hash.toString(16));
		log_append(peer.id, tag.substr(0,16) + " HASH CHEAT", 'message-server');
		return;
	}

	// looks good! accept it
	their_roll.value = their_value;
	log_append(peer.id, tag.substr(0,16) + " reveal " + value);

	for (let peer in sock.peers)
	{
		const id = sock.peers[peer].id;
		if (!(id in roll))
			return;
		if (!("value" in roll[id]))
			return;
	}

	roll_finalize(sock, which, tag);
});


function randtest(n)
{
	let dist = [0,0,0,0,0,0];
	while(1)
	{
		if (dist[Math.floor(Math.random() * 6)]++ > n)
			return dist;
	}
	return dist;
}