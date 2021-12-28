# multiparty chat server

This is the basis for multiparty communication with a simple room
interface.  The clients can join a room (identified by any string)
and send messages to other clients in the room.  When a new client
joins or leaves a room, the other clients are notified so that they
can track all of the other chatters.

The server is not necessarily trustworthy and other parties can spoof
messages, so it is important to build higher-level trust atop of the
system.

The demo is heavily inspired by https://socket.io/get-started/chat


## Setup

Once:

```
npm install
```

Then:

```
npm start
```

And go to http://localhost:4423/ to load the demo chat page


## Writing clients


