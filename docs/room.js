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

"use strict"
/*
 * Turn the ECDSA public key x and y coordinates into a hash
 */
function jwk2id(jwk)
{
	let id = jwk.x + "|" + jwk.y;
	return BigInt("0x" + sha256.sha256hex(id.split('')));
}

// time in milliseconds
function now()
{
	return new Date().getTime();
}

class Room
{
error(s, ...args) {
	console.log(s, ...args);
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
	this.state = "disconnected";

	// maintain ordering of rx and tx events with
	// promises chained off these
	this.rx_chain = true;
	this.tx_chain = true;

	// generate our private group key component
	// which is used to derive the shared encryption key
	this.exponent = randomBigInt(32);
	this.pubkey = modExp(this.base, this.exponent, this.modulus);

	console.log("exponent", this.exponent.toString(16), "pubkey", this.pubkey.toString(16));

	// and our public identity key, which will be used to sign
	// messages from us.
	this.id_create();

	// called when a connection to the server is established
	this.sock.on('connect', () => {
		this.set_state("connected");
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
		if (this.state != "connected")
			console.log(this.server, "unexpected members message");
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
		if (this.state != "secure")
			console.log(this.server, "unexpected peer join");

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
		if (this.state != "secure")
			console.log(this.server, "unexpected peer departure");

		console.log(this.server, this.room, "peer left", src);
		if (!(src in this.peers))
			return this.error("unknown peer left");

		this.removed_peers[src] = this.peers[src];
		delete this.peers[src];

		this.rekey();
	});

	// called in the first round of key generation
	this.sock.on('pubkey', (src,pubkey,id_public) => {
		this.rx_chain = Promise.resolve(this.rx_chain)
			.then(() => this.rekey_pubkey(src,pubkey,id_public));
	});

	this.sock.on('pubkey2', (src,pubkey) => {
		this.rx_chain = Promise.resolve(this.rx_chain)
			.then(() => this.rekey_pubkey2(src,pubkey));
	});

	// called when an encrypted message arrives
	//this.sock.on('message', (src,counter,msg,sig) => this.rx_raw(src,counter,msg,sig));

	// wait for the privkey to become available before trying to
	// receive the message
	this.sock.on('message', (src,counter,msg,sig) => {
		this.rx_chain = Promise.resolve(this.rx_chain)
			.then(() => this.rx_raw(src,counter,msg,sig));
	});

	// wait for an authenticated message from each peer
	this.on('group-verify', (peer,phrase) => {

		if (this.key_phrase != phrase)
		{
			this.set_state("verify-failed", peer);
			return;
		}

		peer.verified = true;

		// if all peers have verified, then we're done
		for(let src in this.peers)
		{
			if (!this.peers[src].verified)
				return;
		}

		this.set_state("secured");
	});
}

set_state(new_state)
{
	this.state_start = now();
	this.state = new_state;

	console.log(this.state_start, "new state", new_state);
	this.handle("state", new_state);
}

id_create()
{
	this.key_param = {
		name: "ECDSA",
		namedCurve: "P-384",
		hash: { name: "SHA-256" },
	};

	this.tx_chain = Promise.resolve(this.tx_chain).then(() => {
		return window.crypto.subtle.generateKey(
			this.key_param,
			true,
			["sign", "verify"]
		);
	}).then((k) => {
		console.log("Key created", k);
		this.id_private = k.privateKey;
		return window.crypto.subtle.exportKey('jwk', k.publicKey);
	}).then((jwk) => {
		this.id_public = jwk;
		this.id = words.bigint2words(jwk2id(jwk), 2);
		console.log("identity", this.id);
	});
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
	this.set_state("rekeying");

	console.log("REKEY INITIATED " + this.peer_count() + " peers");
	console.log("exponent", this.exponent.toString(16), "public", this.pubkey.toString(16));

	// destroy the old private keys
	this.privkey = null;
	this.partial_key = null;

	// cancel any pending rx
	this.rx_deferred = [];

	// erase the old pubkey components from each of our peers
	for(const src in this.peers)
	{
		const peer = this.peers[src];
		peer.pubkey = null;
		peer.id_public = null;
		peer.verified = false;
	}
		

	// if there are no peers, then we don't have to negotiate anything
	if (this.peer_count() == 0)
	{
		this.partial_key = this.base;
		return this.rekey_complete();
	}

	// figure out who our next peer is this time
	this.peer_find();
	console.log("next", this.next, "prev", this.prev);
	this.pubkeys_received = 0;

	// send the public part of our group key
	const pubkey_str = this.pubkey.toString(16);
	console.log("self", "pubkey", pubkey_str, this.id);
	this.sock.emit('pubkey', pubkey_str, this.id_public);
}

// when we receive a pubkey from a peer
rekey_pubkey(src,pubkey_hex,id_public)
{
	if (this.state != "rekeying")
		console.log(src, "unexpected pubkey message");

	if (!(src in this.peers))
		return this.error("unknown peer");

	const peer = this.peers[src];
	if (peer.pubkey != null)
		return this.error("already received pubkey");

	const pubkey = BigInt("0x" + pubkey_hex);
	peer.pubkey = pubkey;
	peer.id = words.bigint2words(jwk2id(id_public), 2);
	console.log(src, peer.id, "pubkey", pubkey_hex);

	// if this is our predecessor in the ring,
	// move it to phase 2; this does not require the
	// promise to have resolved
	if (src == this.prev)
		this.rekey_pubkey2(src, pubkey_hex);

	this.rx_chain = Promise.resolve(this.rx_chain).then(() => {
		return window.crypto.subtle.importKey(
			'jwk',
			id_public,
			this.key_param,
			true,
			[ 'verify' ]
		);
	}).then((imported_public) => {
		peer.id_public = imported_public;

		// otherwise see if this completes our rekeying
		// process; it is safe to call this early since
		// it verifies that all of the prereqs are ready
		this.rekey_complete();
	});
}

// a partial pubkey from our predecessor
rekey_pubkey2(src, pubkey_hex)
{
	if (this.state != "rekeying")
		console.log(src, "unexpected pubkey2");

	// we should only get a pubkey2 from our immediate predecessor
	if (src != this.prev)
		return this.error("pubkey2 from wrong peer");

	console.log(src, "pubkey2", this.pubkeys_received, pubkey_hex);

	const pubkey = BigInt("0x" + pubkey_hex);

	// if we have received the correct number of pubkey2 messages
	// (one partial per peer), then we can finalize the rekey
	// todo: verify that we have received from each peer
	if (++this.pubkeys_received >= this.peer_count())
	{
		this.partial_key = pubkey;
		console.log(this.peers[src].id, "new partial key", pubkey_hex);
		return this.rekey_complete();
	}

	// Note that we *DO NOT* send the final pubkey to our peer;
	// it has all of the other partial components from the peers
	// on it, so performing our modexp would reveal the key.
	// compute the new pubkey and forward it to our next peer
	const new_pubkey = modExp(pubkey, this.exponent, this.modulus).toString(16);
	console.log("sending partial " + (this.pubkeys_received-1), this.next, new_pubkey);
	this.sock.emit('to', this.next, 'pubkey2', new_pubkey);
}

// all rounds completed
rekey_complete()
{
	if (this.state == "secured")
	{
		console.log("already complete?");
		return;
	}

	if (this.state != "rekeying")
	{
		console.log("unexpected rekey_complete");
		return;
	}

	// verify that we have pubkeys for all of our peers
	// and the partial key from the rest of them.
	// if not wait until we do
	if (!this.partial_key)
		return;

	for(let src in this.peers)
	{
		if (!this.peers[src].id_public)
			return;
	}

	// compute the updated group key
	const privkey = modExp(this.partial_key, this.exponent, this.modulus);
	console.log("encryption key", privkey.toString(16));

	// and the verification phrase for the group key and all the clients
	const sorted = Object.keys(this.peers).sort();
	let everything = privkey.toString(16);
	for(let src of sorted)
	{
		const peer = this.peers[src];
		everything += jwk2id(peer.id_public).toString(16);
	}

	const hash = sha256.sha256hex(everything.split(''));
	this.key_phrase = words.bigint2words(BigInt("0x" + hash), 5);
	console.log("verification", this.key_phrase);

	this.rx_chain = crypto.subtle.importKey(
			"raw",
			Uint8Array.from(arrayFromBigInt(privkey)),
			'AES-GCM',
			false,
			["encrypt", "decrypt"]
	).then((key_encoded) => {
		this.privkey = key_encoded;

		console.log("private key", privkey.toString(16), this.peers, this.removed_peers);

		// once the privkey is available, set our state to
		// secured and let the user know the member set
		this.set_state("keyed");
		this.handle('members', this.peers, this.removed_peers);
		this.removed_peers = {};

		// let the others know we have the same key
		// (the actual contents of this message don't matter,
		// since it is encrypted with the key, so this is mostly
		// to ensure that everyone can decrypt our messages)
		console.log("tx group verify", this.key_phrase);
		this.emit('group-verify', this.key_phrase);

		// process any deferred rx
		for(let args of this.rx_deferred)
			this.rx_raw(...args);
		this.rx_deferred = [];

		// and if we are the only peer, then we're secure
		if (this.peer_count() == 0)
			this.set_state("secured");
	});
}


/*
 * Now that all the peers have a shared secret key, we use it
 * to establish an encrypted channel.  Additionally all messages
 * from the peers must be signed with their public key
 *
 * There is an rx_chain promise that ensures that these will be
 * handled in order.  The top-level handler for the encrypted messages
 * ensures that we're on that chain
 */
rx_raw(src,counter_hex,msg,signature)
{
	if (!(src in this.peers))
		return this.error("encrypted message from unknown peer");

	if (!this.privkey)
	{
		// defer until rekeying is done
		this.rx_deferred.push([src,counter_hex,msg,signature]);
		return;
	}

	const peer = this.peers[src];

	const counter = BigInt("0x" + counter_hex);
	const counter_buf = arrayFromBigInt(counter, 16);

	// THERE HAS GOT TO BE A BETTER WAY
	//const enc_buf = Uint8Array.from(arrayFromBigInt(BigInt("0x" + msg), Math.floor(msg.length/2 + 0.5)));
	const enc_buf = msg;
	let clear_buf;

	return window.crypto.subtle.decrypt(
		{
			name: "AES-GCM",
			iv: Uint8Array.from(counter_buf),
		},
		this.privkey,
		enc_buf
	).catch((err) => {
		console.log(src, "GCM ERROR", counter_hex, msg, signature, err);
		this.handle("decryption-failure", peer);
		return null;
	}).then((buf) => {
		if (!buf)
			return false;

		clear_buf = buf;
		return window.crypto.subtle.verify(
			this.key_param,
			peer.id_public,
			signature,
			buf
		);
	}).then((valid) => {
		if (!clear_buf)
			return;
		if (!valid)
		{
			console.log(peer.id, "invalid signature!");
			this.handle("signature-failure", peer, clear_buf, signature)
		}

		const msg_str = new TextDecoder('utf-8').decode(clear_buf)
		let msg = '';

		try {
			msg = JSON.parse(msg_str);
			//console.log(peer.id, "decrypted", msg);
		} catch(err) {
			console.log(err, peer.id, "error decoding", msg_str);
			return;
		}

		// no topic == chaffe
		if (!("topic" in msg))
			return;
		if (!("msg" in msg))
			return;

		console.log(peer.id, "RX", msg.topic);
		return this.handle(msg.topic, peer, ...msg.msg);
	});

	//return this.rx_chain;
}


tx_raw(buf)
{
	if (!this.privkey)
	{
		console.log("tx before secured channel established");
		return;
	}

	const counter = randomBigInt(16);
	const counter_buf = arrayFromBigInt(counter, 16);
	const encoded_buf = new TextEncoder().encode(buf);
	let signature;

	this.tx_chain = Promise.resolve(this.tx_chain).then(() => {
		return window.crypto.subtle.sign(
			this.key_param,
			this.id_private,
			encoded_buf
		);
	}).then((signed_buf) => {
		signature = signed_buf;
		return window.crypto.subtle.encrypt(
			{
				name: "AES-GCM",
				iv: Uint8Array.from(counter_buf),
			},
			this.privkey,
			encoded_buf
		);
	}).then((encrypted_buf) => {
		// there has to be a better way, but wtf javascript
		//const msg_hex = arrayToBigInt(new Uint8Array(enc)).toString(16);
		const counter_hex = counter.toString(16);
		console.log("TX", counter_hex, encrypted_buf, signature);
		this.sock.emit("message", counter_hex, encrypted_buf, signature);
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
