/*
 * End-to-end encrypted room chat
 *
 * Lifecycle is:
 * - Disconnected
 * - Connected to server
 * - Join room
 * - Receive member list / Receive new member notification
 * - Generate new key pair, publish pub key
 * - Receive pub key from every peer
 * - Compute partial group keys in a ring until everyone has all parts
 * - Derive shared secret
 */
class Room
{
reconnected() {}

error(s) {
	console.log(s);
}

constructor(server=document.location.origin, room=document.location.hash)
{
	this.server = server;
	this.sock = io.connect(server);
	this.room = room;
	this.peers = {};
	this.base = 2; // small base is ok
	this.modulus = (1n << 255n) - 19n; // 25519, should be a sophie prime?

	// called when a connection to the server is established
	this.sock.on('connect', () => {
		console.log(this.server, "RECONNECTED id=", this.sock.id);

		// rejoin the desired room
		this.sock.emit('room', this.room);

		// reset our peer list
		this.peers = {};

		// call any subclass handlers
		this.reconnected();
	});

	// server sends this message when a new room is joined
	// to inform us of the other members. we have to trust
	// that the member list is correct; the worst case is
	// the server adds an peer to the room, but it will appear
	// in the peer list.
	this.sock.on('members', (room, peers) => {
		console.log(this.server, room, "peers", peers);

		// reset our peer list
		this.peers = {};

		for(const peer of peers)
		{
			this.peers[peer] = {
				nick: peer,
				pubkey: null,
			};
		}

		this.rekey();
	});

	// called by the server when a new peer joins the room
	// we must begin a new group key agreement at this point.
	this.sock.on('connected', (src) => {
		console.log(this.server, this.room, "new peer", src);

		if (src in this.peers)
			return this.error("duplidate peer joined");

		this.peers[src] = {
			nick: src,
			pubkey: null,
		};

		this.rekey();
	});

	// trigger a rekey when a peer leaves the room
	this.sock.on('disconnected', (src) => {
		console.log(this.server, this.room, "peer left", src);
		if (!(src in this.peers))
			return this.error("unknown peer left");

		delete this.peers[src];

		this.rekey();
	});

	// called in the first round of key generation
	this.sock.on('pubkey', (src,pubkey) => this.rekey_pubkey(src,pubkey))
	this.sock.on('pubkey2', (src,pubkey) => this.rekey_pubkey2(src,pubkey))
}

peer_count()
{
	return Object.entries(this.peers).length;
}

// find the prev and next peer in the alphabetic list of peers
peer_find()
{
	const sorted = Object.keys(this.peers).sort();
	if (sorted.length == 0)
	{
		this.next = null;
		this.prev = null;
		return
	}

	let prev = sorted[sorted.length-1];

	for(let peer of sorted)
	{
		if (peer > this.sock.id)
		{
			this.next = peer;
			this.prev = prev;
			return;
		}

		prev = peer;
	}

	// we ran off the end, so the first element is our next
	// in the ring
	this.next = sorted[0];
	this.prev = prev;
}


// Initiate a re-key by dumping our old keys and
// initiating group key establishment with the new set of peers
// we don't need to dump our key, do we?
rekey()
{
	console.log("REKEY INITIATED " + this.peer_count() + " peers");

	// generate our private group key component
	this.exponent = randomBigInt(64);
	this.pubkey = modExp(this.base, this.exponent, this.modulus);
	this.privkey = null;

	// erase the old pubkey components from each of our peers
	for(const peer in this.peers)
		this.peers[peer].pubkey = null;

	// figure out who our next peer is this time
	this.peer_find();
	console.log("next/prev=", this.next, this.prev);
	this.pubkeys_received = 0;

	// send the public part of our group key
	// along with our nick name.
	this.sock.emit('pubkey', this.pubkey.toString(16));
}

// when we receive a pubkey from a peer
rekey_pubkey(src,pubkey)
{
	if (!(src in this.peers))
		return this.error("unknown peer");

	const peer = this.peers[src];
	if (peer.pubkey != null)
		return this.error("already received pubkey");

	pubkey = BigInt("0x" + pubkey);
	peer.pubkey = pubkey;
	peer.verify = words.bigint2words(pubkey, 4);

	// if this is our predecessor in the ring,
	// move it to phase 2
	if (src == this.prev)
		this.rekey_pubkey2(src, pubkey);
}

// a partial pubkey from our predecessor
rekey_pubkey2(src, pubkey)
{
	// we should only get a pubkey2 from our immediate predecessor
	if (src != this.prev)
		return this.error("pubkey2 from wrong peer");

	// if we have received the correct number of pubkey2 messages
	// (one partial per peer), then we can finalize the rekey
	if (++this.pubkeys_received >= this.peer_count())
		return this.rekey_complete(pubkey);

	// compute the new pubkey and forward it to our next peer
	const new_pubkey = modExp(pubkey, this.exponent, this.modulus).toString(16);
	console.log("partial " + this.pubkeys_received, new_pubkey);
	this.sock.emit('to', this.next, 'pubkey2', new_pubkey);
}

// all rounds completed
rekey_complete(pubkey)
{
	// verify that we have pubkeys for all of our peers
	for(let peer in this.peers)
	{
		if (this.peers[peer].pubkey)
			continue;
		return this.error("peer did not send pubkey");
	}

	// compute the updated group key
	this.privkey = modExp(pubkey, this.exponent, this.modulus);

	// hash my socket id and the group key to prove possession
	//this.sock.emit("
	console.log("private key", this.privkey.toString(16));
}

}
