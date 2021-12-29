# multiparty cryptographic dice rolling server

With diceroll.games you can play dice games with untrustworhy
friends using cryptographic commitments.  As long as there is
one honest player, the other players can not collude to influence
the outcome of the die roll.  Although all the players can
collude; an outside observer can not trust the dice rolls
unless they participate in the rolling process.

The server is not necessarily trustworthy and other parties can spoof
messages, so it is important to build higher-level trust atop of the
system.  Currently not yet implemented.

The site is heavily inspired by https://secret.cards/ and draws
from https://socket.io/get-started/chat for the communication
API.

## Playing games

Send the full URL including the `#abcd-xyzw...` portion to the
other players. Set your nickname in the box. Select the type
of dice to use. Hit `Roll the dice!` and hope for the best.


## Reployment

[![Netlify Status](https://api.netlify.com/api/v1/badges/4e4057d6-a84b-4710-901c-7944b744411a/deploy-status)](https://app.netlify.com/sites/nervous-shockley-4d7118/deploys)

https://diceroll.games/

## Debugging Setup

Once:

```
npm install
```

Then:

```
PORT=9999 npm start
```

And go to http://localhost:9999/ to load the demo chat page


