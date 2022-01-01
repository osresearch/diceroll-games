![header image with some dice rolls](docs/images/header.jpg)

# multiparty cryptographic dice rolling server

![die 1](docs/images/pips/pips-1.png)

With diceroll.games you can play dice games with untrustworhy
friends using cryptographic commitments and end-to-end encrypted
communications through an untrusted server.  As long as there is
one honest player, the other players can not collude to influence
the outcome of the die roll.

The site is heavily inspired by https://secret.cards/ and draws
from https://socket.io/get-started/chat for the communication
API.

## Playing games

![die 2](docs/images/pips/pips-2.png)

Send the full URL including the `#abcd-xyzw...` portion to the
other players.  Set your nickname by clicking on the blue
highlighted player, hover over the other players to get their
verification codes. Select the type of dice to use.
Hit `Roll the dice!` and hope for the best!


## Deployment

![die 3](docs/images/pips/pips-3.png)

Currently running on a home server with an nginx front end
to do SSL termination for https://diceroll.games/

Since it uses the `crypto` API in the webbrowser, it must
be loaded from `localhost` or over `https`.

## Adding dice

![die 4](docs/images/pips/pips-4.png)

Check out `docs/dice.json` to see how to add new dice or sets.

## Debugging Setup

![die 5](docs/images/pips/pips-5.png)

After checkout:

```
npm install
```

Then:

```
PORT=9999 npm start
```

And go to http://localhost:9999/ to load the dice rolling page


## Security analysis

![die 5](docs/images/pips/pips-5.png)

Please contribute if you can! Is the DH implementation ok?
Is AES-GCM the right approach? Feel free to poke at it!
