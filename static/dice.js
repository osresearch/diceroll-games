/*
 * Dice client connected to the other peers via socket.io
 */
const server = document.location.origin;
const sock = io.connect(server);
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

let room = document.location.hash;
let peers = {};
let rolls = {};


// input box controls to broadcast the user's nick
let nick = "UNKNOWN";
let form = document.getElementById('nick-form');
let input = document.getElementById('nick-input');

form.addEventListener('submit', (e) => {
	e.preventDefault();
	nick = input.value;
	peers[sock.id] = nick;
	console.log("my nick is ", nick);
	sock.emit('nick', nick);

	// and update our selves
	for(let d of document.querySelectorAll('.peer-' + sock.id))
		d.innerText = nick;
});

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


function peer_add(member,nick=member)
{
	rolls = {}; // always cancel any runs in process

	peers[member] = nick;

	log_append(server, '+ ' + member, 'message-public');

	const d = document.getElementById("nicks");
	if (!d)
		return;

	const n = document.createElement('div');
	n.classList.add('peer-' + member);
	n.classList.add(member == sock.id ? 'nick-self' : 'nick');
	n.innerText = nick;
	d.appendChild(n);
}


/*
 * These are the system level ones that the server sends to us
 */
// called when a connection to the server is established
sock.on('connect', () => {
	// reset our peer list, cancel any die rolls in process
	peers = {};
	rolls = {};

	if (nick == "UNKNOWN")
		nick = sock.id;

	// join the room in the URL
	console.log(server, "RECONNECTED");
	log_append(server, 'Reconnected', 'message-server');
	sock.emit('room', room);

	// and also let people know our nick name
	sock.emit('nick', nick);
});

// server sends this message when a new room is joined
// to inform us of the other members
sock.on('members', (room, members) => {
	console.log(room + " members", members);
	log_append(server, 'joined ' + room + ' ' + members.length + ' members', 'message-server');

	// track the peers, including ourselves
	peers = {};

	// reset the nick name list
	const d = document.getElementById("nicks");
	if (d)
		d.textContent = '';

	peer_add(sock.id, nick);

	for(let member of members)
		peer_add(member);
});

// called when a new peer joins the room
// which resets any rolls in process
sock.on('connected', (src) => {
	console.log(src, "new room member");
	log_append(server, '+ ' + src, 'message-public');

	peer_add(src);

	// let the peer know our nickname
	sock.emit('to', src, 'nick', nick);
});

// update the nick display for a peer
sock.on('nick', (src,their_nick) => {
	if (!(src in peers))
	{
		console.log(src, "unknown peer?");
		return;
	}

	peers[src] = their_nick;
	console.log(src, "now known as", their_nick);

	for(let d of document.querySelectorAll('.peer-' + src))
		d.innerText = their_nick;
});

// called when a peer leaves the room
// which resets any rolls in process
sock.on('disconnected', (src) => {
	console.log(src, "room member left");
	log_append(server, '- ' + src, 'message-public');

	rolls = {};

	if (src in peers)
		delete peers[src];

	for(let d of document.querySelectorAll('.peer-' + src))
		d.style.opacity = 0.1;
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
	if (Object.entries(peers).length == 1)
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

	if (Object.entries(peers).length == 1)
		roll_finalize(sock, which, tag);
}

function roll_finalize(sock, which, tag)
{
	// try to compute the result of this roll
	// if any peers have not yet revealed this tag, then we're done
	const roll = rolls[tag];
	const short_tag = tag.substr(0,16);

	let result = BigInt(which); //BigInt("0x" + tag);
	for (let peer in peers)
	{
		if (!(peer in roll))
			return;
		if (!("value" in roll[peer]))
			return;
		result += roll[peer].value; // already bigint
	}

	const choices = dice_set[which].length;
	const short_result = (result >> 200n) % BigInt(choices);
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
}

// called when a peer has initiated a new roll
// which also will update the die with the ones
// from the roller
function roll_row_create(src, new_die)
{
	dice_set = new_die;
	const r = document.getElementById('rolls');
	if (!r)
		return;
	console.log(src, "initiated new roll");
	const src_div = document.createElement('span');
	src_div.innerText = peers[src];
	src_div.classList.add("peer-" + src);
	src_div.classList.add(src == sock.id ? 'nick-self' : 'nick');

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

	roll_row_create(sock.id, dice_set);
	sock.emit('roll', dice_set);

	for(let i = 0 ; i < dice_set.length ; i++)
		roll_commit(sock,i);
}

sock.on('roll', roll_row_create);

// called when another peer has initiated a dice roll or
// is responding to a dice roll by another peer.
sock.on('commit', (src,msg) => {
	console.log("commit", src, msg);

	if (!(src in peers))
	{
		log_append(src, "not in peer group?" + msg, 'message-server');
		return;
	}

	if (!("tag" in msg && "which" in msg && "hash" in msg))
	{
		log_append(src, "bad message" + msg, 'message-server');
		return;
	}

	const tag = msg.tag.toString();
	const short_tag = tag.substr(0,16);
	const which = msg.which;
	const hash = msg.hash;

	if (!(which in dice_set))
	{
		log_append(src, short_tag + " no such die " + which, 'message-server');
		return;
	}

	if (!(tag in rolls))
	{
		// first time we've seen this tag, so let's
		// create the bookkeeping for it
		log_append(src, short_tag + " NEW ROLL");
		rolls[tag] = {}

		// and add our roll and commitment to it,
		// plus send the reply to the room
		roll_commit(sock, which, tag);
	}

	const roll = rolls[tag];

	// if this src has already done this roll, then
	// they are cheating (or the server has duped us)
	if (src in roll)
	{
		console.log("duplicate?", src, msg, roll);
		log_append(src, short_tag + " already rolled?", 'message-server');
		return;
	}

	// does this roll match the die that we are expecting?
	const expected_which = roll[sock.id].which;
	if (which != expected_which)
	{
		log_append(src, short_tag + " wrong dice? expected " + expected_which + " got " + which, 'message-server');
		return;
	}

	roll[src] = { hash: BigInt("0x" + hash) };

	log_append(src, short_tag + " hashed " + hash , 'message-public');

	// if any peers have not yet commited to this tag, then we're done
	for (let peer in peers)
		if (!(peer in roll))
			return;

	roll_reveal(sock, which, tag);
});

sock.on('reveal', (src,msg) => {
	console.log("reveal", src, msg);
	const tag = msg.tag;
	const which = msg.which;
	const value = msg.value;

	if (!(src in peers))
	{
		log_append(src, "not in peer group?" + msg, 'message-server');
		return;
	}

	if (!(tag in rolls))
	{
		log_append(src, tag.substr(0,16) + " not in rolls?" + msg, 'message-server');
		return;
	}

	const roll = rolls[tag];
	if (!(src in roll))
	{
		log_append(src, tag.substr(0,16) + " did not commit?" + msg, 'message-server');
		return;
	}

	const their_roll = roll[src];

	if ("value" in their_roll)
	{
		log_append(src, tag.substr(0,16) + " double reveal?" + msg, 'message-server');
		return;
	}

	const their_value = BigInt("0x" + value);
	const expected_hash = sha256BigInt(their_value);

	if (expected_hash != their_roll.hash)
	{
		console.log(src, "BAD HASH. Expected != Recieved", expected_hash.toString(16), their_roll.hash.toString(16));
		log_append(src, tag.substr(0,16) + " HASH CHEAT", 'message-server');
		return;
	}

	// looks good! accept it
	their_roll.value = their_value;
	log_append(src, tag.substr(0,16) + " reveal " + value);

	for (let peer in peers)
	{
		if (!(peer in roll))
			return;
		if (!("value" in roll[peer]))
			return;
	}

	roll_finalize(sock, which, tag);
});
