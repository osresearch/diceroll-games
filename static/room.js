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
rekeyed() {}

error(s) {
	console.log(s);
}

constructor(server=document.location.origin, room=document.location.hash)
{
	this.server = server;
	this.sock = io.connect(server);
	this.room = room;
	this.peers = {};
	this.removed_peers = {};
	this.base = 2; // small base is ok
	this.modulus = (1n << 255n) - 19n; // 25519, should be a sophie prime?
	this.handlers = {};

	// generate our private group key component
	this.exponent = randomBigInt(64);
	this.pubkey = modExp(this.base, this.exponent, this.modulus);
	this.id = words.bigint2words(this.pubkey, 4);

	// called when a connection to the server is established
	this.sock.on('connect', () => {
		console.log(this.server, "RECONNECTED id=", this.sock.id);

		// rejoin the desired room
		this.sock.emit('room', this.room);

		// call any subclass handlers
		this.handle('connect');
	});

	// server sends this message when a new room is joined
	// to inform us of the other members. we have to trust
	// that the member list is correct; the worst case is
	// the server adds an peer to the room, but it will appear
	// in the peer list.
	this.sock.on('members', (room, peers) => {
		console.log(this.server, room, "peers", peers);

		// delete any peers not in the new list
		for(const peer in this.peers)
		{
			if (peer in peers)
				continue;

			console.log("----- removed", this.peers[peer].id);

			this.removed_peers[peer] = this.peers[peer];
			delete this.peers[peer];
		}

		// and now create an entry for this peer if we don't know it.
		for(const peer of peers)
		{
			if (peer in this.peers)
				continue;

			this.peers[peer] = {
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
			return this.error("duplicate peer joined");

		this.peers[src] = {
			pubkey: null,
		};

		this.rekey();
	});

	// trigger a rekey when a peer leaves the room
	this.sock.on('disconnected', (src) => {
		console.log(this.server, this.room, "peer left", src);
		if (!(src in this.peers))
			return this.error("unknown peer left");

		this.removed_peers[src] = this.peers[src];
		delete this.peers[src];

		this.rekey();
	});

	// called in the first round of key generation
	this.sock.on('pubkey', (src,pubkey,counter) => this.rekey_pubkey(src,pubkey,counter))
	this.sock.on('pubkey2', (src,pubkey) => this.rekey_pubkey2(src,pubkey))

	// called when an encrypted message arrives
	this.sock.on('message', (src,msg) => this.rx_raw(src,msg));
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

	// destroy the old private key
	this.privkey = null;

	// and our counter for AES-GCM
	this.counter = randomBigInt(12);

	// erase the old pubkey components from each of our peers
	for(const peer in this.peers)
		this.peers[peer].pubkey = null;

	// figure out who our next peer is this time
	this.peer_find();
	console.log("next/prev=", this.next, this.prev);
	this.pubkeys_received = 0;

	// send the public part of our group key and our GCM counter
	const pubkey_str = this.pubkey.toString(16);
	console.log("pubkey", pubkey_str);
	this.sock.emit('pubkey', pubkey_str, this.counter.toString(16));
}

// when we receive a pubkey from a peer
rekey_pubkey(src,pubkey,counter)
{
	if (!(src in this.peers))
		return this.error("unknown peer");

	const peer = this.peers[src];
	if (peer.pubkey != null)
		return this.error("already received pubkey");

	peer.pubkey = BigInt("0x" + pubkey);
	peer.counter = BigInt("0x" + counter);
	peer.id = words.bigint2words(peer.pubkey, 4);

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
	const privkey = modExp(pubkey, this.exponent, this.modulus);

	crypto.subtle.importKey(
		"raw",
		Uint8Array.from(arrayFromBigInt(privkey)),
		'AES-GCM',
		false,
		["encrypt", "decrypt"]
	).then((key_encoded) => {
		this.privkey = key_encoded;

		console.log("private key", privkey.toString(16));
		this.handle('members', this.peers, this.removed_peers);
		this.removed_peers = {};
	});
}


/*
 * Now that all the peers have a shared secret key, we can use it
 * to establish an encrypted channel. 
 */
rx_raw(src,msg)
{
	if (!this.privkey)
		return this.error("encrypted message without privkey");
	if (!(src in this.peers))
		return this.error("encrypted message from unknown peer");

	// counter is tracked per peer and used as the iv
	// it should never be reused since it was a big random value
	const peer = this.peers[src];
	const counter = arrayFromBigInt(peer.counter, 16);
	peer.counter++;

	// THERE HAS GOT TO BE A BETTER WAY
	const enc_buf = Uint8Array.from(arrayFromBigInt(BigInt("0x" + msg), Math.floor(msg.length/2 + 0.5)));

	window.crypto.subtle.decrypt(
		{
			name: "AES-GCM",
			iv: Uint8Array.from(counter),
		},
		this.privkey,
		enc_buf
	).then((buf) => {
		const msg_str = new TextDecoder('utf-8').decode(buf)
		const msg = JSON.parse(msg_str);
		//console.log(peer.id, "decrypted", msg);

		// no topic == chaffe
		if (!("topic" in msg))
			return;
		if (!("msg" in msg))
			return;

		return this.handle(msg.topic, peer, ...msg.msg);
	}).catch((err) => {
		console.log(src, "GCM ERROR", msg, enc_buf, err);
		this.error("decrypt error; server meddling?");
	});
}


tx_raw(buf)
{
	if (!this.privkey)
		return this.error("encrypted tx without privkey");

	const counter = arrayFromBigInt(this.counter, 16);
	this.counter++;

	window.crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: Uint8Array.from(counter),
		},
		this.privkey,
		new TextEncoder().encode(buf)
	).then((enc) => {
		// there has to be a better way, but wtf javascript
		const hex = arrayToBigInt(new Uint8Array(enc)).toString(16);
		this.sock.emit("message", hex);
	});
}


/*
 * And provide a similar socket.io interface to the user of
 * the class.  Any messages that they receive will be encrypted
 * with the counter.
 *
 * Note that direct encrypted messages are not allowed since the
 * counter is shared between all of the peers in the room.
 */
emit(topic, ...args)
{
	const msg = {
		topic: topic,
		msg: [...args],
	};
	this.tx_raw(JSON.stringify(msg));
}

on(topic, handler)
{
	this.handlers[topic] = handler;
}

handle(topic, ...args)
{
	if (!(topic in this.handlers))
		return;

	return this.handlers[topic](...args);
}

}
