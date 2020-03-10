# pingtest

Browser-based UDP ping, using Janus Gateway. Displays ping, jitter and packet
loss. Also has a graphical meter showing connection quality, which displays
moving average statistics on mouse hover.

## Demo

https://www.groupworld.net/pingtest.html

## Installation

Configure [Janus Gateway](https://github.com/meetecho/janus-gateway), including the text-room plugin.

## Cleanup

Each time a user connects, it creates a Janus TextRoom. You can use the cleanroom.js script to remove empty rooms:

    npm install janus-gateway-js
    node cleanrooms.js
