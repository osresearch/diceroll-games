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

io.on('connection', (socket) => {
	console.log(socket.id, 'connect', socket.handshake.address);

	socket.room = "default";
	socket.join(socket.room);

	socket.on('disconnect', () => {
		console.log(socket.id, "disconnect");
		io.to(socket.room).send('disconnected', socket.id);
	});

	socket.on('room', (msg) => {
		console.log(socket.id, "room", socket.room, msg);
		io.to(socket.room).send('disconnected', socket.id);
		socket.leave(socket.room);
		socket.room = msg;
		socket.join(socket.room);
		io.to(socket.room).send('connected', socket.id);
	});

	socket.on('to', (msg) => {
		// private message to another socket id
		const dest = msg.dest;
		const topic = msg.topic;
		delete msg.dest;
		delete msg.topic;
		socket.to(dest).emit(topic, socket.id, msg);
	});

	socket.onAny((topic,msg) => {
		try {
			console.log(socket.id, socket.room, topic, msg);
			socket.broadcast.to(socket.room).emit(topic, socket.id, msg);
		} catch (err) {
			console.log(socket.id, "error", err);
		}
	});
});

http.listen(port, () => {
	console.log('listening', port);
});
