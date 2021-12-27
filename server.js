/*
 * Multiparty chat server built with socket.io and express.
 *
 * Multiple clients connect to a room. The server just echos everything
 * they say to every client in the room. Direct messages are possible.
 */
const port = process.env.PORT || 4423;
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
	cors: {
		origin: [ "https://secret.cards", "http://localhost:4423" ],
		methods: ["GET", "POST"],
	},
});

// if the URL is empty, send the index.html
app.get('/', (req, res) => {
	res.sendFile(__dirname + "/static/index.html");
});

// serve files out of the ./static directory
app.use(express.static('./static'));

// topics that are reserved for the server
const reserved_topics = {
	"to": 1,
	"room": 1,
	"disconnected": 1,
	"connected": 1,
	"members": 1,
};


function room_join(socket, room)
{
	console.log(socket.id + ":" + room + ":join");
	const member_set = io.sockets.adapter.rooms.get(room);
	const members = member_set ? Array.from(member_set) : [];
	console.log("members=", members);

	socket.room = room;
	socket.join(room);
	socket.broadcast.to(room).emit('connected', socket.id);
	io.to(socket.id).emit('members', room, members);
}

function room_leave(socket)
{
	if (!socket.room)
		return;
	console.log(socket.id + ":" + socket.room + ":leave");
	socket.broadcast.to(socket.room).emit('disconnected', socket.id);
	socket.leave(socket.room);
	socket.room = null;
}


io.on('connection', (socket) => {
	console.log(socket.id + ":*:connect", socket.handshake.address);

	socket.room = null;

	//room_join(socket, "default");

	socket.on('disconnect', () => {
		// they are gone, so tell the room
		console.log(socket.id, "disconnect");
		io.to(socket.room).emit('disconnected', socket.id);
	});

	socket.on('room', (room) => {
		// only one room per client, so leave their existing room
		room_leave(socket);
		room_join(socket, room);
	});

	// private message to another socket id or room
	socket.on('to', (dest,topic,msg) => {
		// don't allow them to spoof reserved topics
		if (topic in reserved_topics)
			return;

		console.log(socket.id + ":" + dest + ":" + topic, msg);
		io.to(dest).emit(topic, socket.id, msg);
	});

	// otherwise echo any normal message to everyone in the room
	// prefixing it with the socket id of the sender
	socket.onAny((topic,msg) => {
		// don't forward any reserved topics
		if (topic in reserved_topics)
			return;

		try {
			console.log("GENERIC", socket.id + ":" + socket.room + ":" + topic, msg);
			socket.broadcast.to(socket.room).emit(topic, socket.id, msg);
		} catch (err) {
			console.log(socket.id, "error", err);
		}
	});
});

http.listen(port, () => {
	console.log('listening', port);
});
