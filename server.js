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

app.get('/', (req, res) => {
	res.sendFile(__dirname + "/static/index.html");
});
app.use(express.static('./static'));

const reserved_topics = {
	"to": 1,
	"room": 1,
	"disconnected": 1,
	"connected": 1,
	"members": 1,
};


function room_join(socket, room)
{
	console.log(socket.id + ":" + room + ":joining");
	const members = io.sockets.adapter.rooms.get(room);

	socket.room = room;
	socket.join(room);
	socket.to(socket.id).emit('members', room, members);
	socket.broadcast.to(socket.room).emit('connected', socket.id);
}

function room_leave(socket)
{
	if (!socket.room)
		return;
	console.log(socket.id + ":" + socket.room + ":leaving");
	socket.broadcast.to(socket.room).emit('disconnected', socket.id);
	socket.leave(socket.room);
	socket.room = null;
}


io.on('connection', (socket) => {
	console.log(socket.id, 'connect', socket.handshake.address);

	room_join(socket, "default");

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

	socket.on('to', (dest,topic,msg) => {
		// private message to another socket id or room
		console.log(socket.id + ":dest=" + dest + ":topic=" + topic, "msg=", msg);
		socket.to(dest).emit(topic, socket.id, msg);
	});

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
